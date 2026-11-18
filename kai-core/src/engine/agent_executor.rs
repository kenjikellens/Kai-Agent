use std::path::PathBuf;
use std::sync::Arc;

use regex::Regex;
use serde_json::{json, Value};
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::engine::config_manager::KaiConfig;
use crate::engine::context_manager::ContextManager;
use crate::engine::json_repair::JsonRepair;
use crate::engine::snapshot_manager::TurnSnapshotManager;
use crate::providers::factory::ProviderFactory;
use crate::tools::registry::{AgentMode, ToolRegistry};
use crate::traits::agent_tool::ToolContext;
use crate::traits::host_services::HostServices;
use crate::traits::llm_provider::{ChatMessage, ChatRequest, LlmProvider, StreamSink, ToolCall};

const MAX_TOOL_ITERATIONS: usize = 20;

/// Event emitter contract implemented by host shells (Tauri, CLI, tests) to stream UI updates.
pub trait ExecutorEventSink: Send + Sync {
    fn emit_event(&self, event_type: &str, payload: Value);
}

struct TurnStreamSink {
    turn_id: String,
    emitter: Arc<dyn ExecutorEventSink>,
}

impl StreamSink for TurnStreamSink {
    fn on_token(&self, token: &str) {
        self.emitter.emit_event(
            "agentProgress",
            json!({
                "turnId": self.turn_id,
                "progressType": "token",
                "output": token,
            }),
        );
    }
}

/// Orchestrates multi-turn LLM completions, tool dispatch loops, and mode gating.
pub struct AgentExecutor {
    context_manager: ContextManager,
}

impl AgentExecutor {
    /// Creates a new `AgentExecutor`.
    pub fn new() -> Self {
        Self {
            context_manager: ContextManager::default(),
        }
    }

    /// Parses `<|tool_call|>{...}<|/tool_call|>` blocks embedded in model output.
    fn extract_embedded_tool_calls(text: &str) -> Vec<ToolCall> {
        let Ok(re) = Regex::new(r"(?s)<\|?tool_call\|?>([\s\S]*?)<\|?/tool_call\|?>") else {
            return Vec::new();
        };
        let mut calls = Vec::new();
        for cap in re.captures_iter(text) {
            if let Some(body) = cap.get(1) {
                if let Some(parsed) = JsonRepair::parse_lenient(body.as_str()) {
                    let Some(name) = parsed.get("name").and_then(|v| v.as_str()) else {
                        continue;
                    };
                    let arguments = parsed
                        .get("arguments")
                        .cloned()
                        .unwrap_or_else(|| json!({}));
                    calls.push(ToolCall {
                        id: Uuid::new_v4().to_string(),
                        name: name.to_string(),
                        arguments,
                    });
                }
            }
        }
        calls
    }

    /// Executes one full user prompt turn, iterating through tool calls up to `MAX_TOOL_ITERATIONS`.
    #[allow(clippy::too_many_arguments)]
    pub async fn run_turn(
        &self,
        turn_id: String,
        model_id: &str,
        mode_str: &str,
        workspace_path: PathBuf,
        history: Vec<ChatMessage>,
        config: &KaiConfig,
        host_services: Option<Arc<dyn HostServices>>,
        snapshots: Option<Arc<Mutex<TurnSnapshotManager>>>,
        emitter: Arc<dyn ExecutorEventSink>,
    ) -> Result<String, String> {
        let has_workspace = !workspace_path.to_string_lossy().trim().is_empty();
        let mode = if has_workspace {
            AgentMode::from_str_safe(mode_str)
        } else {
            AgentMode::Ask
        };

        let registry = ToolRegistry::for_mode(mode, has_workspace);
        let provider: Arc<dyn LlmProvider> = ProviderFactory::create(model_id, config);

        let declarations_json = serde_json::to_string(&registry.declarations()).unwrap_or_default();
        let system_prompt = format!(
            "{}\n\nAvailable tools (emit JSON inside <|tool_call|>...</|tool_call|> as {{\"name\":\"...\",\"arguments\":{{...}}}}):\n{}",
            ContextManager::system_prompt(mode_str, &workspace_path.to_string_lossy()),
            declarations_json
        );

        let mut messages = vec![ChatMessage {
            role: "system".to_string(),
            content: system_prompt,
            tool_call_id: None,
            name: None,
        }];
        messages.extend(history);

        let sink = TurnStreamSink {
            turn_id: turn_id.clone(),
            emitter: Arc::clone(&emitter),
        };
        let tool_ctx = ToolContext {
            workspace_path,
            turn_id: turn_id.clone(),
            host_services,
            snapshots,
        };
        let mut modified_files: Vec<String> = Vec::new();

        for _ in 0..MAX_TOOL_ITERATIONS {
            let compacted = self.context_manager.fit_messages(messages.clone());
            let req = ChatRequest {
                model: model_id.to_string(),
                messages: compacted,
                temperature: config.temperature,
                thinking: config.thinking_enabled,
                thinking_level: config.thinking_level.clone(),
            };

            let result = provider
                .stream_chat(req, &sink)
                .await
                .map_err(|e| e.to_string())?;

            let mut calls = result.tool_calls;
            if calls.is_empty() {
                calls = Self::extract_embedded_tool_calls(&result.text);
            }

            if calls.is_empty() {
                messages.push(ChatMessage {
                    role: "assistant".to_string(),
                    content: result.text.clone(),
                    tool_call_id: None,
                    name: None,
                });
                emitter.emit_event(
                    "replyComplete",
                    json!({
                        "turnId": turn_id,
                        "content": result.text,
                        "mode": mode_str,
                        "modifiedFiles": modified_files,
                        "tokensPerSecond": result.tokens_per_second,
                        "fullHistory": messages,
                    }),
                );
                return Ok(result.text);
            }

            messages.push(ChatMessage {
                role: "assistant".to_string(),
                content: result.text.clone(),
                tool_call_id: None,
                name: None,
            });

            for call in calls {
                emitter.emit_event(
                    "agentProgress",
                    json!({
                        "turnId": turn_id,
                        "progressType": "tool_start",
                        "tool": call.name,
                    }),
                );

                let maybe_path = call
                    .arguments
                    .get("path")
                    .and_then(|v| v.as_str())
                    .map(String::from);

                let dispatch_res = registry.dispatch(&call.name, call.arguments, &tool_ctx).await;
                let output = match dispatch_res {
                    Ok(ok) => {
                        if matches!(
                            call.name.as_str(),
                            "write_file"
                                | "replace_file_content"
                                | "multi_replace_file_content"
                                | "delete_item"
                        ) {
                            if let Some(p) = maybe_path {
                                if !modified_files.contains(&p) {
                                    modified_files.push(p);
                                }
                            }
                        }
                        ok
                    }
                    Err(err) => format!("Tool error: {err}"),
                };

                emitter.emit_event(
                    "agentProgress",
                    json!({
                        "turnId": turn_id,
                        "progressType": "tool_end",
                        "tool": call.name,
                        "output": output,
                    }),
                );

                messages.push(ChatMessage {
                    role: "tool".to_string(),
                    content: output,
                    tool_call_id: Some(call.id),
                    name: Some(call.name),
                });
            }
        }

        Err("Exceeded maximum tool execution iterations.".to_string())
    }
}

impl Default for AgentExecutor {
    fn default() -> Self {
        Self::new()
    }
}

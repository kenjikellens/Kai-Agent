use std::path::PathBuf;
use std::sync::{Arc, OnceLock};

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

    /// Normalizes LLM-emitted tool names and parameter keys into canonical `ToolRegistry` names and schemas.
    /// Converts common cross-model aliases (`view_file`, `file_path`, `cmd`) without failing on unknown keys.
    fn normalize_tool_call(raw_name: &str, raw_args: Value) -> (String, Value) {
        let trimmed_name = raw_name.trim().trim_start_matches("functions.");
        let canonical = match trimmed_name.to_ascii_lowercase().as_str() {
            "view_file" | "open_file" | "cat" => "read_file",
            "write_to_file" | "create_file" => "write_file",
            "edit_file" | "replace_in_file" => "replace_file_content",
            "list_directory" | "ls" | "find_by_name" => "list_dir",
            "search_files" | "grep" | "ripgrep" | "rg" => "grep_search",
            "execute_command" | "run_shell" | "bash" | "shell" | "terminal" => "run_command",
            "web_fetch" | "fetch" | "get_url" => "fetch_url",
            "calc" | "math" => "calculate",
            _ => trimmed_name,
        }
        .to_string();

        let mut args = match raw_args {
            Value::String(s) => JsonRepair::parse_lenient(&s).unwrap_or_else(|| json!({})),
            Value::Object(_) => raw_args,
            _ => json!({}),
        };

        if let Some(obj) = args.as_object_mut() {
            if !obj.contains_key("path") {
                for alias in ["file_path", "filePath", "target_file", "dir", "directory", "folder"] {
                    if let Some(v) = obj.get(alias).cloned() {
                        obj.insert("path".to_string(), v);
                        break;
                    }
                }
            }
            if !obj.contains_key("command") {
                if let Some(v) = obj.get("cmd").cloned() {
                    obj.insert("command".to_string(), v);
                }
            }
            if !obj.contains_key("query") {
                for alias in ["pattern", "search", "regex"] {
                    if let Some(v) = obj.get(alias).cloned() {
                        obj.insert("query".to_string(), v);
                        break;
                    }
                }
            }
            if !obj.contains_key("target") {
                for alias in ["old_str", "old_string", "search_text", "TargetContent"] {
                    if let Some(v) = obj.get(alias).cloned() {
                        obj.insert("target".to_string(), v);
                        break;
                    }
                }
            }
            if !obj.contains_key("replacement") {
                for alias in ["new_str", "new_string", "replace_text", "ReplacementContent"] {
                    if let Some(v) = obj.get(alias).cloned() {
                        obj.insert("replacement".to_string(), v);
                        break;
                    }
                }
            }
            if !obj.contains_key("content") {
                if let Some(v) = obj.get("code").or_else(|| obj.get("text")).cloned() {
                    obj.insert("content".to_string(), v);
                }
            }
        }

        (canonical, args)
    }

    /// Parses one JSON object emitted as a fallback text tool call into a normalized `ToolCall`.
    /// Supports `{ "name", "arguments" }`, `{ "tool", ... }`, `{ "type", ... }`, and `call:name{...}` forms.
    fn parse_embedded_json_object(raw: &str, explicit_name: Option<&str>) -> Option<ToolCall> {
        let mut parsed = JsonRepair::parse_lenient(raw)?;
        let obj = parsed.as_object_mut()?;

        let detected_name = obj
            .get("name")
            .or_else(|| obj.get("tool"))
            .or_else(|| obj.get("type"))
            .or_else(|| obj.get("action"))
            .or_else(|| obj.get("function"))
            .and_then(|v| v.as_str())
            .map(str::to_string)
            .or_else(|| explicit_name.map(str::to_string))?;

        let raw_args = obj
            .get("arguments")
            .or_else(|| obj.get("args"))
            .or_else(|| obj.get("parameters"))
            .or_else(|| obj.get("input"))
            .cloned()
            .unwrap_or_else(|| {
                let mut cloned = obj.clone();
                for meta_key in ["name", "tool", "type", "action", "function"] {
                    cloned.remove(meta_key);
                }
                Value::Object(cloned)
            });

        let (name, arguments) = Self::normalize_tool_call(&detected_name, raw_args);
        Some(ToolCall {
            id: Uuid::new_v4().to_string(),
            name,
            arguments,
            thought_signature: None,
        })
    }

    /// Parses `<|tool_call|>`, `<tool_call>`, `call:name{...}`, or fenced JSON tool blocks from model output.
    /// Provides robust fallback execution when local or custom templates omit structured SSE `tool_calls`.
    fn extract_embedded_tool_calls(text: &str) -> Vec<ToolCall> {
        static TOOL_CALL_RE: OnceLock<Regex> = OnceLock::new();
        static CALL_PREFIX_RE: OnceLock<Regex> = OnceLock::new();
        static FENCE_RE: OnceLock<Regex> = OnceLock::new();

        let tag_re = TOOL_CALL_RE.get_or_init(|| {
            Regex::new(r"(?s)<\|?tool_call\|?>([\s\S]*?)(?:<\|?/tool_call\|?>|<\|?tool_call\|?>|$)")
                .expect("valid static tool call regex")
        });
        let mut calls = Vec::new();
        for cap in tag_re.captures_iter(text) {
            if let Some(body) = cap.get(1) {
                if let Some(tc) = Self::parse_embedded_json_object(body.as_str(), None) {
                    calls.push(tc);
                }
            }
        }
        if !calls.is_empty() {
            return calls;
        }

        let call_re = CALL_PREFIX_RE.get_or_init(|| {
            Regex::new(r"(?m)call:([A-Za-z0-9_]+)\s*(\{[\s\S]*\})")
                .expect("valid static call prefix regex")
        });
        if let Some(cap) = call_re.captures(text) {
            if let (Some(fn_name), Some(rest)) = (cap.get(1), cap.get(2)) {
                if let Some(balanced) = JsonRepair::extract_first_balanced_object(rest.as_str()) {
                    if let Some(tc) = Self::parse_embedded_json_object(balanced, Some(fn_name.as_str())) {
                        calls.push(tc);
                        return calls;
                    }
                }
            }
        }

        let fence_re = FENCE_RE.get_or_init(|| {
            Regex::new(r"(?s)```(?:json)?\s*([\s\S]*?)\s*```")
                .expect("valid static markdown json regex")
        });
        for cap in fence_re.captures_iter(text) {
            if let Some(body) = cap.get(1) {
                if let Some(tc) = Self::parse_embedded_json_object(body.as_str(), None) {
                    calls.push(tc);
                    return calls;
                }
            }
        }

        Vec::new()
    }

    /// Extracts a concise display label (filename, query, command, URL, or question) from tool arguments.
    /// Populates `fileName` on `tool_start`/`tool_end` UI progress cards without mutating tool state.
    fn extract_tool_target_label(arguments: &Value) -> String {
        for key in [
            "path",
            "filePath",
            "file_path",
            "target_file",
            "query",
            "command",
            "url",
            "question",
            "expression",
        ] {
            if let Some(val) = arguments.get(key).and_then(|v| v.as_str()) {
                let trimmed = val.trim();
                if !trimmed.is_empty() {
                    return trimmed.to_string();
                }
            }
        }
        String::new()
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
        let declarations = registry.declarations();
        let supports_native = provider.supports_native_tools();

        let system_prompt = if supports_native {
            format!(
                "{}\n\nAvailable tools are attached via native function calling. Call them directly to inspect files, edit code, search, execute commands, fetch URLs, calculate, or ask the user. If native function calling is disabled on your active checkpoint, output `<|tool_call|>{{\"name\":\"...\",\"arguments\":{{...}}}}</|tool_call|>`. Never fabricate tool results.",
                ContextManager::system_prompt(mode_str, &workspace_path.to_string_lossy())
            )
        } else {
            let declarations_json = serde_json::to_string(&declarations).unwrap_or_default();
            format!(
                "{}\n\nAvailable tools (emit JSON inside <|tool_call|>...</|tool_call|> as {{\"name\":\"...\",\"arguments\":{{...}}}}):\n{}",
                ContextManager::system_prompt(mode_str, &workspace_path.to_string_lossy()),
                declarations_json
            )
        };

        let mut messages = vec![ChatMessage {
            role: "system".to_string(),
            content: system_prompt,
            tool_call_id: None,
            name: None,
            tool_calls: Vec::new(),
            images: Vec::new(),
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
            let compacted = self.context_manager.fit_messages_slice(&messages);
            let req = ChatRequest {
                model: model_id.to_string(),
                messages: compacted,
                temperature: config.temperature,
                thinking: config.thinking_enabled,
                thinking_level: config.thinking_level.clone(),
                tools: if supports_native {
                    declarations.clone()
                } else {
                    Vec::new()
                },
            };

            let result = provider
                .stream_chat(req, &sink)
                .await
                .map_err(|e| e.to_string())?;

            let mut calls: Vec<ToolCall> = result
                .tool_calls
                .into_iter()
                .map(|mut tc| {
                    let (norm_name, norm_args) = Self::normalize_tool_call(&tc.name, tc.arguments);
                    tc.name = norm_name;
                    tc.arguments = norm_args;
                    tc
                })
                .collect();
            if calls.is_empty() {
                calls = Self::extract_embedded_tool_calls(&result.text);
            }

            if calls.is_empty() {
                messages.push(ChatMessage {
                    role: "assistant".to_string(),
                    content: result.text.clone(),
                    tool_call_id: None,
                    name: None,
                    tool_calls: Vec::new(),
                    images: Vec::new(),
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
                tool_calls: calls.clone(),
                images: Vec::new(),
            });

            for call in calls {
                let target_label = Self::extract_tool_target_label(&call.arguments);
                let query_arg = call
                    .arguments
                    .get("query")
                    .or_else(|| call.arguments.get("question"))
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string();
                let command_arg = call
                    .arguments
                    .get("command")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string();

                emitter.emit_event(
                    "agentProgress",
                    json!({
                        "turnId": turn_id,
                        "progressType": "tool_start",
                        "toolId": call.id,
                        "tool": call.name,
                        "fileName": target_label,
                        "query": query_arg,
                        "command": command_arg,
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
                    Err(err) => format!("[Error: {err}]"),
                };

                emitter.emit_event(
                    "agentProgress",
                    json!({
                        "turnId": turn_id,
                        "progressType": "tool_end",
                        "toolId": call.id,
                        "tool": call.name,
                        "fileName": target_label,
                        "query": query_arg,
                        "command": command_arg,
                        "output": output,
                    }),
                );

                messages.push(ChatMessage {
                    role: "tool".to_string(),
                    content: output,
                    tool_call_id: Some(call.id),
                    name: Some(call.name),
                    tool_calls: Vec::new(),
                    images: Vec::new(),
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

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::AgentExecutor;

    #[test]
    fn normalizes_tool_aliases_and_argument_keys() {
        let (name, args) = AgentExecutor::normalize_tool_call(
            "functions.view_file",
            json!({ "file_path": "src/main.rs" }),
        );
        assert_eq!(name, "read_file");
        assert_eq!(args["path"], "src/main.rs");

        let (cmd_name, cmd_args) =
            AgentExecutor::normalize_tool_call("bash", json!({ "cmd": "cargo test" }));
        assert_eq!(cmd_name, "run_command");
        assert_eq!(cmd_args["command"], "cargo test");
    }

    #[test]
    fn extracts_embedded_tool_calls_across_formats() {
        let tag_out = AgentExecutor::extract_embedded_tool_calls(
            "<tool_call>{\"name\":\"read_file\",\"arguments\":{\"path\":\"README.md\"}}</tool_call>",
        );
        assert_eq!(tag_out.len(), 1);
        assert_eq!(tag_out[0].name, "read_file");
        assert_eq!(tag_out[0].arguments["path"], "README.md");

        let call_out =
            AgentExecutor::extract_embedded_tool_calls("call:list_dir{\"path\":\".\"}");
        assert_eq!(call_out.len(), 1);
        assert_eq!(call_out[0].name, "list_dir");
        assert_eq!(call_out[0].arguments["path"], ".");
    }
}

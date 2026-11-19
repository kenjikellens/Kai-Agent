use std::collections::BTreeMap;
use std::time::Instant;

use futures_util::StreamExt;
use reqwest::Client;
use serde::Deserialize;
use serde_json::{json, Map, Value};

use super::shared_streaming_client;
use crate::engine::json_repair::JsonRepair;
use crate::traits::agent_tool::FunctionDeclaration;
use crate::traits::{
    ChatMessage, ChatRequest, CompletionResult, ProviderError, StreamSink, ToolCall,
};

#[derive(Deserialize)]
struct SseStreamChunk {
    #[serde(default)]
    choices: Vec<SseStreamChoice>,
    #[serde(default)]
    usage: Option<SseUsage>,
}

#[derive(Deserialize)]
struct SseUsage {
    completion_tokens: Option<u64>,
}

#[derive(Deserialize)]
struct SseStreamChoice {
    #[serde(default)]
    delta: SseStreamDelta,
}

#[derive(Default, Deserialize)]
struct SseDeltaToolCall {
    #[serde(default)]
    index: usize,
    id: Option<String>,
    function: Option<SseDeltaFunction>,
}

#[derive(Default, Deserialize)]
struct SseDeltaFunction {
    name: Option<String>,
    arguments: Option<String>,
}

#[derive(Default, Deserialize)]
struct SseStreamDelta {
    reasoning: Option<String>,
    thought: Option<String>,
    reasoning_content: Option<String>,
    content: Option<String>,
    #[serde(default)]
    tool_calls: Vec<SseDeltaToolCall>,
}

#[derive(Default)]
struct AccumulatedToolCall {
    id: String,
    name: String,
    arguments_raw: String,
}

/// Converts normalized `FunctionDeclaration` schemas into OpenAI `tools` JSON objects.
/// Wraps each declaration under `{ "type": "function", "function": ... }` for `/chat/completions`.
pub(crate) fn serialize_openai_tools(tools: &[FunctionDeclaration]) -> Vec<Value> {
    tools
        .iter()
        .map(|tool| {
            json!({
                "type": "function",
                "function": {
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": tool.parameters,
                }
            })
        })
        .collect()
}

/// Converts `ChatMessage` entries into OpenAI-compatible JSON objects, expanding `images` and `tool_calls`.
/// Preserves `tool_call_id` / `name` on tool responses and serializes assistant `tool_calls` arrays.
pub(crate) fn serialize_openai_messages(messages: &[ChatMessage]) -> Vec<Value> {
    messages
        .iter()
        .map(|m| {
            let mut obj = Map::new();
            obj.insert("role".to_string(), Value::String(m.role.clone()));
            if m.images.is_empty() {
                if m.role == "assistant" && !m.tool_calls.is_empty() && m.content.is_empty() {
                    obj.insert("content".to_string(), Value::Null);
                } else {
                    obj.insert("content".to_string(), Value::String(m.content.clone()));
                }
            } else {
                let mut parts = Vec::with_capacity(m.images.len() + 1);
                if !m.content.is_empty() {
                    parts.push(json!({ "type": "text", "text": m.content }));
                }
                for img in &m.images {
                    parts.push(json!({
                        "type": "image_url",
                        "image_url": { "url": img }
                    }));
                }
                obj.insert("content".to_string(), Value::Array(parts));
            }
            if !m.tool_calls.is_empty() {
                let calls: Vec<Value> = m
                    .tool_calls
                    .iter()
                    .map(|tc| {
                        json!({
                            "id": tc.id,
                            "type": "function",
                            "function": {
                                "name": tc.name,
                                "arguments": tc.arguments.to_string(),
                            }
                        })
                    })
                    .collect();
                obj.insert("tool_calls".to_string(), Value::Array(calls));
            }
            if let Some(id) = &m.tool_call_id {
                obj.insert("tool_call_id".to_string(), Value::String(id.clone()));
            }
            if let Some(name) = &m.name {
                obj.insert("name".to_string(), Value::String(name.clone()));
            }
            Value::Object(obj)
        })
        .collect()
}

/// Accumulates an incoming SSE `SseDeltaToolCall` fragment into the tool-call map indexed by slot.
/// Concatenates streamed function name and JSON argument slices in chunk arrival order.
fn accumulate_tool_call_deltas(
    map: &mut BTreeMap<usize, AccumulatedToolCall>,
    deltas: Vec<SseDeltaToolCall>,
) {
    for partial in deltas {
        let entry = map
            .entry(partial.index)
            .or_insert_with(|| AccumulatedToolCall {
                id: format!("call_{}", partial.index),
                ..Default::default()
            });
        if let Some(id) = partial.id.filter(|s| !s.is_empty()) {
            entry.id = id;
        }
        if let Some(func) = partial.function {
            if let Some(name) = func.name {
                entry.name.push_str(&name);
            }
            if let Some(args) = func.arguments {
                entry.arguments_raw.push_str(&args);
            }
        }
    }
}

/// Finalizes accumulated SSE tool-call fragments into parsed `ToolCall` structs using lenient JSON repair.
/// Skips incomplete entries lacking a tool function name and defaults empty argument strings to `{}`.
fn finalize_accumulated_tool_calls(map: BTreeMap<usize, AccumulatedToolCall>) -> Vec<ToolCall> {
    map.into_values()
        .filter_map(|acc| {
            let name = acc.name.trim().to_string();
            if name.is_empty() {
                return None;
            }
            let arguments = if acc.arguments_raw.trim().is_empty() {
                json!({})
            } else {
                JsonRepair::parse_lenient(&acc.arguments_raw).unwrap_or_else(|| json!({}))
            };
            Some(ToolCall {
                id: acc.id,
                name,
                arguments,
                thought_signature: None,
            })
        })
        .collect()
}

/// Formats throughput as `"X.X tok/s"` from elapsed stream duration and reported or estimated token count.
/// Returns `None` when no text tokens were produced or elapsed duration is negligible.
pub(crate) fn format_tokens_per_second(
    first_token_at: Option<Instant>,
    reported_tokens: Option<u64>,
    char_count: usize,
) -> Option<String> {
    let start = first_token_at?;
    let secs = start.elapsed().as_secs_f64();
    if secs < 0.05 || char_count == 0 {
        return None;
    }
    let tokens = reported_tokens
        .filter(|&t| t > 0)
        .map(|t| t as f64)
        .unwrap_or_else(|| (char_count as f64 / 4.0).max(1.0));
    Some(format!("{:.1} tok/s", tokens / secs))
}

/// Composable HTTP/SSE client shared by OpenAI-compatible cloud and local providers.
#[derive(Clone)]
pub struct OpenAiCompatClient {
    http: Client,
    base_url: String,
    api_key: String,
    extra_headers: Vec<(String, String)>,
}

impl OpenAiCompatClient {
    /// Creates a new OpenAI-compatible streaming client backed by the shared pooled HTTP client.
    /// Reuses TCP/TLS connections across requests while normalizing `base_url`.
    pub fn new(base_url: impl Into<String>, api_key: impl Into<String>) -> Self {
        Self {
            http: shared_streaming_client(),
            base_url: base_url.into().trim_end_matches('/').to_string(),
            api_key: api_key.into(),
            extra_headers: Vec::new(),
        }
    }

    /// Attaches an additional static HTTP header (e.g., `HTTP-Referer`, `X-Title`).
    pub fn with_header(mut self, name: impl Into<String>, value: impl Into<String>) -> Self {
        self.extra_headers.push((name.into(), value.into()));
        self
    }

    /// Queries `/models` and returns discovered model identifiers.
    pub async fn fetch_models(&self) -> Result<Vec<String>, ProviderError> {
        let url = format!("{}/models", self.base_url);
        let mut req = self.http.get(&url);
        if !self.api_key.is_empty() {
            req = req.bearer_auth(&self.api_key);
        }
        let resp = req.send().await?;
        if !resp.status().is_success() {
            let status = resp.status().as_u16();
            let body = resp.text().await.unwrap_or_default();
            return Err(ProviderError::ApiStatus { status, body });
        }
        let parsed: Value = resp.json().await?;
        let ids = parsed["data"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(|m| m["id"].as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default();
        Ok(ids)
    }

    /// Executes an SSE streaming `/chat/completions` call and normalizes reasoning traces into `<think>...</think>`.
    /// Delegates to `stream_completions_with_extra` without additional provider-specific top-level fields.
    pub async fn stream_completions(
        &self,
        request: &ChatRequest,
        model_id: &str,
        reasoning_payload: Option<Value>,
        sink: &dyn StreamSink,
    ) -> Result<CompletionResult, ProviderError> {
        self.stream_completions_with_extra(request, model_id, reasoning_payload, None, sink)
            .await
    }

    /// Executes an SSE streaming `/chat/completions` call with native tools, multimodal images, and HTTP 400 tool fallback.
    /// Streams reasoning/content tokens to `sink`, accumulates `tool_calls` deltas, and computes throughput (`tok/s`).
    pub async fn stream_completions_with_extra(
        &self,
        request: &ChatRequest,
        model_id: &str,
        reasoning_payload: Option<Value>,
        extra_body: Option<Map<String, Value>>,
        sink: &dyn StreamSink,
    ) -> Result<CompletionResult, ProviderError> {
        let url = format!("{}/chat/completions", self.base_url);
        let serialized_messages = serialize_openai_messages(&request.messages);

        let build_body = |include_tools: bool| -> Value {
            let mut body = json!({
                "model": model_id,
                "messages": serialized_messages,
                "temperature": request.temperature,
                "stream": true
            });
            if include_tools && !request.tools.is_empty() {
                body["tools"] = Value::Array(serialize_openai_tools(&request.tools));
                body["tool_choice"] = json!("auto");
            }
            if let Some(reasoning) = &reasoning_payload {
                body["reasoning"] = reasoning.clone();
            }
            if let (Some(extra), Some(obj)) = (&extra_body, body.as_object_mut()) {
                for (k, v) in extra {
                    obj.insert(k.clone(), v.clone());
                }
            }
            body
        };

        let build_request = |include_tools: bool| -> reqwest::RequestBuilder {
            let body = build_body(include_tools);
            let mut req = self.http.post(&url).json(&body);
            if !self.api_key.is_empty() {
                req = req.bearer_auth(&self.api_key);
            }
            for (k, v) in &self.extra_headers {
                req = req.header(k, v);
            }
            req
        };

        let mut resp = build_request(true).send().await?;
        if resp.status().as_u16() == 400 && !request.tools.is_empty() {
            let err_body = resp.text().await.unwrap_or_default();
            let lower = err_body.to_ascii_lowercase();
            if lower.contains("tool") || lower.contains("function") || lower.contains("template") {
                resp = build_request(false).send().await?;
            } else {
                return Err(ProviderError::ApiStatus {
                    status: 400,
                    body: err_body,
                });
            }
        }
        if !resp.status().is_success() {
            let status = resp.status().as_u16();
            let err_body = resp.text().await.unwrap_or_default();
            return Err(ProviderError::ApiStatus {
                status,
                body: err_body,
            });
        }

        let mut stream = resp.bytes_stream();
        let mut buffer = String::new();
        let mut full_text = String::new();
        let mut in_thinking = false;
        let mut first_token_at: Option<Instant> = None;
        let mut generated_chars: usize = 0;
        let mut reported_completion_tokens: Option<u64> = None;
        let mut accumulated_tools: BTreeMap<usize, AccumulatedToolCall> = BTreeMap::new();

        while let Some(chunk_res) = stream.next().await {
            let chunk = chunk_res?;
            buffer.push_str(&String::from_utf8_lossy(&chunk));

            let mut offset = 0;
            let mut done = false;
            while let Some(rel_pos) = buffer[offset..].find('\n') {
                let end = offset + rel_pos;
                let line = buffer[offset..end].trim();
                offset = end + 1;

                let Some(raw_data) = line.strip_prefix("data:") else {
                    continue;
                };
                let data = raw_data.trim();
                if data == "[DONE]" {
                    done = true;
                    break;
                }
                if let Ok(parsed) = serde_json::from_str::<SseStreamChunk>(data) {
                    if let Some(tokens) = parsed.usage.and_then(|u| u.completion_tokens) {
                        reported_completion_tokens = Some(tokens);
                    }
                    let Some(choice) = parsed.choices.into_iter().next() else {
                        continue;
                    };
                    let delta = choice.delta;
                    let reasoning = delta
                        .reasoning
                        .as_deref()
                        .or(delta.thought.as_deref())
                        .or(delta.reasoning_content.as_deref());

                    if let Some(r) = reasoning {
                        if first_token_at.is_none() {
                            first_token_at = Some(Instant::now());
                        }
                        generated_chars += r.chars().count();
                        if !in_thinking {
                            in_thinking = true;
                            full_text.push_str("<think>");
                            sink.on_token("<think>");
                        }
                        full_text.push_str(r);
                        sink.on_token(r);
                    }

                    if let Some(content) = delta.content.as_deref() {
                        if first_token_at.is_none() {
                            first_token_at = Some(Instant::now());
                        }
                        generated_chars += content.chars().count();
                        if in_thinking {
                            in_thinking = false;
                            full_text.push_str("</think>");
                            sink.on_token("</think>");
                        }
                        full_text.push_str(content);
                        sink.on_token(content);
                    }

                    if !delta.tool_calls.is_empty() {
                        accumulate_tool_call_deltas(&mut accumulated_tools, delta.tool_calls);
                    }
                }
            }
            if offset > 0 {
                buffer.drain(..offset);
            }
            if done {
                break;
            }
        }

        if in_thinking {
            full_text.push_str("</think>");
            sink.on_token("</think>");
        }

        let tokens_per_second =
            format_tokens_per_second(first_token_at, reported_completion_tokens, generated_chars);
        let tool_calls = finalize_accumulated_tool_calls(accumulated_tools);

        Ok(CompletionResult {
            text: full_text,
            tokens_per_second,
            tool_calls,
        })
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use serde_json::json;

    use super::{
        accumulate_tool_call_deltas, finalize_accumulated_tool_calls, serialize_openai_messages,
        serialize_openai_tools, SseDeltaFunction, SseDeltaToolCall,
    };
    use crate::traits::agent_tool::FunctionDeclaration;
    use crate::traits::{ChatMessage, ToolCall};

    #[test]
    fn serializes_tools_and_multiturn_tool_history() {
        let tools = vec![FunctionDeclaration {
            name: "read_file".to_string(),
            description: "Read file".to_string(),
            parameters: json!({ "type": "object", "properties": { "path": { "type": "string" } } }),
        }];
        let serialized_tools = serialize_openai_tools(&tools);
        assert_eq!(serialized_tools[0]["type"], "function");
        assert_eq!(serialized_tools[0]["function"]["name"], "read_file");

        let msgs = vec![
            ChatMessage {
                role: "assistant".to_string(),
                content: String::new(),
                tool_call_id: None,
                name: None,
                tool_calls: vec![ToolCall {
                    id: "call_1".to_string(),
                    name: "read_file".to_string(),
                    arguments: json!({ "path": "Cargo.toml" }),
                    thought_signature: None,
                }],
                images: Vec::new(),
            },
            ChatMessage {
                role: "tool".to_string(),
                content: "file contents".to_string(),
                tool_call_id: Some("call_1".to_string()),
                name: Some("read_file".to_string()),
                tool_calls: Vec::new(),
                images: Vec::new(),
            },
        ];

        let serialized_msgs = serialize_openai_messages(&msgs);
        assert!(serialized_msgs[0]["content"].is_null());
        assert_eq!(serialized_msgs[0]["tool_calls"][0]["id"], "call_1");
        assert_eq!(serialized_msgs[1]["tool_call_id"], "call_1");
    }

    #[test]
    fn accumulates_streamed_tool_call_deltas() {
        let mut map = BTreeMap::new();
        accumulate_tool_call_deltas(
            &mut map,
            vec![SseDeltaToolCall {
                index: 0,
                id: Some("call_abc".to_string()),
                function: Some(SseDeltaFunction {
                    name: Some("list_dir".to_string()),
                    arguments: Some("{\"path\":".to_string()),
                }),
            }],
        );
        accumulate_tool_call_deltas(
            &mut map,
            vec![SseDeltaToolCall {
                index: 0,
                id: None,
                function: Some(SseDeltaFunction {
                    name: None,
                    arguments: Some("\".\"}".to_string()),
                }),
            }],
        );
        let calls = finalize_accumulated_tool_calls(map);
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].id, "call_abc");
        assert_eq!(calls[0].name, "list_dir");
        assert_eq!(calls[0].arguments["path"], ".");
    }
}

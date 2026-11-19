use std::time::Instant;

use async_trait::async_trait;
use futures_util::StreamExt;
use reqwest::Client;
use serde::Deserialize;
use serde_json::{json, Map, Value};

use super::openai_compat::format_tokens_per_second;
use super::shared_streaming_client;
use crate::traits::agent_tool::FunctionDeclaration;
use crate::traits::{
    ChatMessage, ChatRequest, CompletionResult, LlmProvider, ProviderError, StreamSink, ToolCall,
};

/// Parses a `data:<mime>;base64,<payload>` URL into `(mime_type, base64_data)` for Gemini `inlineData`.
/// Ignores malformed or non-base64 URLs without raising errors.
fn parse_data_url_image(data_url: &str) -> Option<(&str, &str)> {
    let rest = data_url.strip_prefix("data:")?;
    let (meta, payload) = rest.split_once(',')?;
    let mime = meta.strip_suffix(";base64")?;
    if mime.is_empty() || payload.is_empty() {
        return None;
    }
    Some((mime, payload))
}

/// Strips JSON Schema fields rejected by Gemini `v1beta` `functionDeclarations` (e.g., `$schema`, `additionalProperties`).
/// Ensures every `"object"` schema node includes a `"properties"` object.
pub(crate) fn sanitize_gemini_schema(schema: &Value) -> Value {
    match schema {
        Value::Object(map) => {
            let mut out = Map::new();
            for (k, v) in map {
                if k == "$schema" || k == "additionalProperties" {
                    continue;
                }
                if k == "properties" {
                    if let Some(props) = v.as_object() {
                        let mut clean_props = Map::new();
                        for (pk, pv) in props {
                            clean_props.insert(pk.clone(), sanitize_gemini_schema(pv));
                        }
                        out.insert(k.clone(), Value::Object(clean_props));
                        continue;
                    }
                }
                if k == "items" {
                    out.insert(k.clone(), sanitize_gemini_schema(v));
                    continue;
                }
                out.insert(k.clone(), v.clone());
            }
            if out.get("type").and_then(Value::as_str) == Some("object")
                && !out.contains_key("properties")
            {
                out.insert("properties".to_string(), Value::Object(Map::new()));
            }
            Value::Object(out)
        }
        other => other.clone(),
    }
}

/// Converts normalized `ChatMessage` turns into Gemini `contents` with `functionCall` and `functionResponse` parts.
/// Merges adjacent same-role items cleanly because Gemini disallows consecutive `"user"` turns.
pub(crate) fn to_gemini_contents(messages: &[ChatMessage]) -> Vec<Value> {
    let mut raw: Vec<(String, Vec<Value>)> = Vec::new();
    for m in messages.iter().filter(|m| m.role != "system") {
        if m.role == "assistant" {
            let mut parts = Vec::new();
            if !m.content.is_empty() {
                parts.push(json!({ "text": m.content }));
            }
            for tc in &m.tool_calls {
                let mut fc_part = json!({
                    "functionCall": {
                        "id": tc.id,
                        "name": tc.name,
                        "args": tc.arguments
                    }
                });
                if let Some(sig) = &tc.thought_signature {
                    fc_part["thoughtSignature"] = Value::String(sig.clone());
                }
                parts.push(fc_part);
            }
            if parts.is_empty() {
                parts.push(json!({ "text": "" }));
            }
            raw.push(("model".to_string(), parts));
        } else if m.role == "tool" {
            raw.push((
                "user".to_string(),
                vec![json!({
                    "functionResponse": {
                        "id": m.tool_call_id,
                        "name": m.name,
                        "response": { "result": m.content }
                    }
                })],
            ));
        } else {
            let mut parts = Vec::with_capacity(m.images.len() + 1);
            if !m.content.is_empty() || m.images.is_empty() {
                parts.push(json!({ "text": m.content }));
            }
            for img in &m.images {
                if let Some((mime, b64)) = parse_data_url_image(img) {
                    parts.push(json!({
                        "inlineData": {
                            "mimeType": mime,
                            "data": b64
                        }
                    }));
                }
            }
            raw.push(("user".to_string(), parts));
        }
    }

    let mut collapsed: Vec<(String, Vec<Value>)> = Vec::with_capacity(raw.len());
    for (role, mut parts) in raw {
        if let Some(last) = collapsed.last_mut().filter(|(r, _)| r == &role) {
            last.1.append(&mut parts);
        } else {
            collapsed.push((role, parts));
        }
    }

    collapsed
        .into_iter()
        .map(|(role, parts)| json!({ "role": role, "parts": parts }))
        .collect()
}

/// Converts normalized `FunctionDeclaration` items into a Gemini `tools` payload array.
pub(crate) fn build_gemini_tools(tools: &[FunctionDeclaration]) -> Value {
    let decls: Vec<Value> = tools
        .iter()
        .map(|t| {
            json!({
                "name": t.name,
                "description": t.description,
                "parameters": sanitize_gemini_schema(&t.parameters)
            })
        })
        .collect();
    json!([{ "functionDeclarations": decls }])
}

#[derive(Deserialize)]
struct GeminiSseChunk {
    #[serde(default)]
    candidates: Vec<GeminiCandidate>,
}

#[derive(Deserialize)]
struct GeminiCandidate {
    #[serde(default)]
    content: GeminiContent,
}

#[derive(Default, Deserialize)]
struct GeminiContent {
    #[serde(default)]
    parts: Vec<GeminiPart>,
}

#[derive(Deserialize)]
struct GeminiFunctionCall {
    #[serde(default)]
    id: Option<String>,
    name: String,
    #[serde(default)]
    args: Option<Value>,
}

#[derive(Deserialize)]
struct GeminiPart {
    text: Option<String>,
    #[serde(default)]
    thought: bool,
    #[serde(rename = "functionCall")]
    function_call: Option<GeminiFunctionCall>,
    #[serde(rename = "thoughtSignature", alias = "thought_signature")]
    thought_signature: Option<String>,
}

/// Dedicated Google Gemini provider using `x-goog-api-key` headers and native thinkingConfig.
pub struct GeminiProvider {
    http: Client,
    api_key: String,
}

impl GeminiProvider {
    /// Creates a new `GeminiProvider` reusing the shared pooled HTTP client.
    pub fn new(api_key: impl Into<String>) -> Self {
        Self {
            http: shared_streaming_client(),
            api_key: api_key.into(),
        }
    }

    fn build_thinking_config(model: &str, thinking: bool, level: &str) -> Value {
        if model.contains("gemini-3") {
            let lvl = if thinking {
                level.to_uppercase()
            } else {
                "MINIMAL".to_string()
            };
            json!({ "thinkingLevel": lvl, "includeThoughts": thinking })
        } else {
            let budget = if !thinking {
                0
            } else {
                match level.to_lowercase().as_str() {
                    "low" => 1024,
                    "medium" => 8192,
                    _ => -1,
                }
            };
            json!({ "thinkingBudget": budget, "includeThoughts": thinking })
        }
    }
}

#[async_trait]
impl LlmProvider for GeminiProvider {
    fn id(&self) -> &'static str {
        "gemini"
    }

    fn supports_native_tools(&self) -> bool {
        true
    }

    async fn list_models(&self) -> Result<Vec<String>, ProviderError> {
        Ok(vec![
            "gemini-3.8-flash".into(),
            "gemini-3.7-flash".into(),
            "gemini-3.6-flash".into(),
            "gemini-3.5-flash".into(),
            "gemini-3.5-flash-lite".into(),
            "gemini-3-flash-preview".into(),
            "gemini-3.1-pro-preview".into(),
            "gemini-3.1-flash-lite".into(),
        ])
    }

    async fn stream_chat(
        &self,
        request: ChatRequest,
        sink: &dyn StreamSink,
    ) -> Result<CompletionResult, ProviderError> {
        if self.api_key.trim().is_empty() {
            return Err(ProviderError::MissingApiKey("Google Gemini".into()));
        }

        let model_id = if request.model.is_empty() {
            "gemini-3.1-flash-lite"
        } else {
            request.model.as_str()
        };
        let url = format!(
            "https://generativelanguage.googleapis.com/v1beta/models/{}:streamGenerateContent?alt=sse",
            model_id
        );

        let system_text: Option<String> = request
            .messages
            .iter()
            .find(|m| m.role == "system")
            .map(|m| m.content.clone());

        let contents = to_gemini_contents(&request.messages);

        let mut payload = json!({
            "contents": contents,
            "generationConfig": {
                "temperature": request.temperature,
                "thinkingConfig": Self::build_thinking_config(model_id, request.thinking, &request.thinking_level)
            }
        });
        if !request.tools.is_empty() {
            payload["tools"] = build_gemini_tools(&request.tools);
            payload["toolConfig"] = json!({
                "functionCallingConfig": { "mode": "AUTO" }
            });
        }
        if let Some(sys) = system_text {
            payload["systemInstruction"] = json!({ "parts": [{ "text": sys }] });
        }

        let resp = self
            .http
            .post(&url)
            .header("x-goog-api-key", self.api_key.trim())
            .json(&payload)
            .send()
            .await?;

        if !resp.status().is_success() {
            let status = resp.status().as_u16();
            let body = resp.text().await.unwrap_or_default();
            return Err(ProviderError::ApiStatus { status, body });
        }

        let mut stream = resp.bytes_stream();
        let mut buffer = String::new();
        let mut full_text = String::new();
        let mut in_thinking = false;
        let mut first_token_at: Option<Instant> = None;
        let mut generated_chars: usize = 0;
        let mut tool_calls: Vec<ToolCall> = Vec::new();

        while let Some(chunk_res) = stream.next().await {
            let chunk = chunk_res?;
            buffer.push_str(&String::from_utf8_lossy(&chunk));

            let mut offset = 0;
            while let Some(rel_pos) = buffer[offset..].find('\n') {
                let end = offset + rel_pos;
                let line = buffer[offset..end].trim();
                offset = end + 1;

                let Some(raw_data) = line.strip_prefix("data:") else {
                    continue;
                };
                let data = raw_data.trim();
                if let Ok(parsed) = serde_json::from_str::<GeminiSseChunk>(data) {
                    let Some(candidate) = parsed.candidates.into_iter().next() else {
                        continue;
                    };
                    for part in candidate.content.parts {
                        if let Some(text) = part.text.as_deref() {
                            if first_token_at.is_none() {
                                first_token_at = Some(Instant::now());
                            }
                            generated_chars += text.chars().count();
                            if part.thought {
                                if !in_thinking {
                                    in_thinking = true;
                                    full_text.push_str("<think>");
                                    sink.on_token("<think>");
                                }
                                full_text.push_str(text);
                                sink.on_token(text);
                            } else {
                                if in_thinking {
                                    in_thinking = false;
                                    full_text.push_str("</think>");
                                    sink.on_token("</think>");
                                }
                                full_text.push_str(text);
                                sink.on_token(text);
                            }
                        }
                        if let Some(fc) = part.function_call {
                            let call_id = fc
                                .id
                                .filter(|s| !s.trim().is_empty())
                                .unwrap_or_else(|| format!("gemini_call_{}", tool_calls.len()));
                            tool_calls.push(ToolCall {
                                id: call_id,
                                name: fc.name,
                                arguments: fc.args.unwrap_or_else(|| json!({})),
                                thought_signature: part.thought_signature.clone(),
                            });
                        }
                    }
                }
            }
            if offset > 0 {
                buffer.drain(..offset);
            }
        }

        if in_thinking {
            full_text.push_str("</think>");
            sink.on_token("</think>");
        }

        let tokens_per_second = format_tokens_per_second(first_token_at, None, generated_chars);

        Ok(CompletionResult {
            text: full_text,
            tokens_per_second,
            tool_calls,
        })
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{build_gemini_tools, to_gemini_contents, GeminiSseChunk};
    use crate::traits::agent_tool::FunctionDeclaration;
    use crate::traits::{ChatMessage, ToolCall};

    #[test]
    fn builds_gemini_tools_and_multiturn_contents() {
        let decls = vec![FunctionDeclaration {
            name: "list_dir".to_string(),
            description: "List dir".to_string(),
            parameters: json!({
                "$schema": "http://json-schema.org/draft-07/schema#",
                "type": "object",
                "additionalProperties": false,
                "properties": { "path": { "type": "string" } }
            }),
        }];
        let built = build_gemini_tools(&decls);
        let params = &built[0]["functionDeclarations"][0]["parameters"];
        assert!(params.get("$schema").is_none());
        assert!(params.get("additionalProperties").is_none());

        let msgs = vec![
            ChatMessage {
                role: "assistant".to_string(),
                content: String::new(),
                tool_call_id: None,
                name: None,
                tool_calls: vec![ToolCall {
                    id: "call_g1".to_string(),
                    name: "list_dir".to_string(),
                    arguments: json!({ "path": "." }),
                    thought_signature: Some("sig_123".to_string()),
                }],
                images: Vec::new(),
            },
            ChatMessage {
                role: "tool".to_string(),
                content: "src/".to_string(),
                tool_call_id: Some("call_g1".to_string()),
                name: Some("list_dir".to_string()),
                tool_calls: Vec::new(),
                images: Vec::new(),
            },
        ];
        let contents = to_gemini_contents(&msgs);
        assert_eq!(contents[0]["role"], "model");
        assert_eq!(contents[0]["parts"][0]["functionCall"]["name"], "list_dir");
        assert_eq!(contents[0]["parts"][0]["thoughtSignature"], "sig_123");
        assert_eq!(contents[1]["role"], "user");
        assert_eq!(contents[1]["parts"][0]["functionResponse"]["name"], "list_dir");
    }

    #[test]
    fn parses_gemini_sse_function_call_with_signature() {
        let raw = r#"{"candidates":[{"content":{"parts":[{"functionCall":{"name":"read_file","args":{"path":"Cargo.toml"}},"thoughtSignature":"sig_abc"}]}}]}"#;
        let parsed: GeminiSseChunk = serde_json::from_str(raw).expect("valid gemini sse chunk");
        let part = &parsed.candidates[0].content.parts[0];
        let fc = part.function_call.as_ref().expect("functionCall present");
        assert_eq!(fc.name, "read_file");
        assert_eq!(part.thought_signature.as_deref(), Some("sig_abc"));
    }
}

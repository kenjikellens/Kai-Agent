use async_trait::async_trait;
use futures_util::StreamExt;
use reqwest::Client;
use serde::Deserialize;
use serde_json::{json, Value};

use super::shared_streaming_client;
use crate::traits::{ChatRequest, CompletionResult, LlmProvider, ProviderError, StreamSink};

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
struct GeminiPart {
    text: Option<String>,
    #[serde(default)]
    thought: bool,
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

        let contents: Vec<Value> = request
            .messages
            .iter()
            .filter(|m| m.role != "system")
            .map(|m| {
                json!({
                    "role": if m.role == "assistant" { "model" } else { "user" },
                    "parts": [{ "text": m.content }]
                })
            })
            .collect();

        let mut payload = json!({
            "contents": contents,
            "generationConfig": {
                "temperature": request.temperature,
                "thinkingConfig": Self::build_thinking_config(model_id, request.thinking, &request.thinking_level)
            }
        });
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
                    let Some(candidate) = parsed.candidates.first() else {
                        continue;
                    };
                    for part in &candidate.content.parts {
                        if let Some(text) = part.text.as_deref() {
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

        Ok(CompletionResult {
            text: full_text,
            tokens_per_second: None,
            tool_calls: Vec::new(),
        })
    }
}

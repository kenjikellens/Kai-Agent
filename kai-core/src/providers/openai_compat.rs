use futures_util::StreamExt;
use reqwest::Client;
use serde::Deserialize;
use serde_json::{json, Value};

use super::shared_streaming_client;
use crate::traits::{ChatRequest, CompletionResult, ProviderError, StreamSink};

#[derive(Deserialize)]
struct SseStreamChunk {
    #[serde(default)]
    choices: Vec<SseStreamChoice>,
}

#[derive(Deserialize)]
struct SseStreamChoice {
    #[serde(default)]
    delta: SseStreamDelta,
}

#[derive(Default, Deserialize)]
struct SseStreamDelta {
    reasoning: Option<String>,
    thought: Option<String>,
    reasoning_content: Option<String>,
    content: Option<String>,
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
    pub async fn stream_completions(
        &self,
        request: &ChatRequest,
        model_id: &str,
        reasoning_payload: Option<Value>,
        sink: &dyn StreamSink,
    ) -> Result<CompletionResult, ProviderError> {
        let url = format!("{}/chat/completions", self.base_url);
        let mut body = json!({
            "model": model_id,
            "messages": request.messages,
            "temperature": request.temperature,
            "stream": true
        });
        if let Some(reasoning) = reasoning_payload {
            body["reasoning"] = reasoning;
        }

        let mut req = self.http.post(&url).json(&body);
        if !self.api_key.is_empty() {
            req = req.bearer_auth(&self.api_key);
        }
        for (k, v) in &self.extra_headers {
            req = req.header(k, v);
        }

        let resp = req.send().await?;
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
                    let Some(choice) = parsed.choices.first() else {
                        continue;
                    };
                    let delta = &choice.delta;
                    let reasoning = delta
                        .reasoning
                        .as_deref()
                        .or(delta.thought.as_deref())
                        .or(delta.reasoning_content.as_deref());

                    if let Some(r) = reasoning {
                        if !in_thinking {
                            in_thinking = true;
                            full_text.push_str("<think>");
                            sink.on_token("<think>");
                        }
                        full_text.push_str(r);
                        sink.on_token(r);
                    }

                    if let Some(content) = delta.content.as_deref() {
                        if in_thinking {
                            in_thinking = false;
                            full_text.push_str("</think>");
                            sink.on_token("</think>");
                        }
                        full_text.push_str(content);
                        sink.on_token(content);
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

        Ok(CompletionResult {
            text: full_text,
            tokens_per_second: None,
            tool_calls: Vec::new(),
        })
    }
}

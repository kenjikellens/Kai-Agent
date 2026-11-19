use async_trait::async_trait;
use serde_json::json;

use super::openai_compat::OpenAiCompatClient;
use crate::traits::{ChatRequest, CompletionResult, LlmProvider, ProviderError, StreamSink};

/// Dedicated OpenRouter provider with reasoning extraction and effort payload.
pub struct OpenRouterProvider {
    api_key: String,
    client: OpenAiCompatClient,
}

impl OpenRouterProvider {
    pub fn new(api_key: impl Into<String>) -> Self {
        let key = api_key.into();
        let client = OpenAiCompatClient::new("https://openrouter.ai/api/v1", key.clone())
            .with_header("HTTP-Referer", "https://github.com/KAI-Agent")
            .with_header("X-Title", "KAI Agent Desktop");
        Self {
            api_key: key,
            client,
        }
    }
}

#[async_trait]
impl LlmProvider for OpenRouterProvider {
    fn id(&self) -> &'static str {
        "openrouter"
    }

    /// Enables native OpenAI-compatible function calling for OpenRouter models.
    fn supports_native_tools(&self) -> bool {
        true
    }

    async fn list_models(&self) -> Result<Vec<String>, ProviderError> {
        Ok(vec![
            "openrouter/stealth/ox-alpha".into(),
            "openrouter/google/gemma-4-31b-it:free".into(),
            "openrouter/google/gemma-4-26b-a4b-it:free".into(),
        ])
    }

    async fn stream_chat(
        &self,
        request: ChatRequest,
        sink: &dyn StreamSink,
    ) -> Result<CompletionResult, ProviderError> {
        if self.api_key.trim().is_empty() {
            return Err(ProviderError::MissingApiKey("OpenRouter".into()));
        }
        let model_id = request.model.trim_start_matches("openrouter/").to_string();
        let reasoning = if request.thinking {
            let effort = if request.thinking_level.is_empty() {
                "high"
            } else {
                request.thinking_level.as_str()
            };
            Some(json!({ "effort": effort, "exclude": false }))
        } else {
            Some(json!({ "effort": "none", "exclude": false }))
        };
        self.client
            .stream_completions(&request, &model_id, reasoning, sink)
            .await
    }
}

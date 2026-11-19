use async_trait::async_trait;

use super::openai_compat::OpenAiCompatClient;
use crate::traits::{ChatRequest, CompletionResult, LlmProvider, ProviderError, StreamSink};

/// Dedicated Mistral AI cloud provider.
pub struct MistralProvider {
    api_key: String,
    client: OpenAiCompatClient,
}

impl MistralProvider {
    pub fn new(api_key: impl Into<String>) -> Self {
        let key = api_key.into();
        let client = OpenAiCompatClient::new("https://api.mistral.ai/v1", key.clone());
        Self { api_key: key, client }
    }
}

#[async_trait]
impl LlmProvider for MistralProvider {
    fn id(&self) -> &'static str {
        "mistral"
    }

    /// Enables native OpenAI-compatible function calling for Mistral models.
    fn supports_native_tools(&self) -> bool {
        true
    }

    async fn list_models(&self) -> Result<Vec<String>, ProviderError> {
        Ok(vec![
            "mistral/magistral-small-latest".into(),
            "mistral/mistral-small-latest".into(),
            "mistral/codestral-latest".into(),
        ])
    }

    async fn stream_chat(&self, request: ChatRequest, sink: &dyn StreamSink) -> Result<CompletionResult, ProviderError> {
        if self.api_key.trim().is_empty() {
            return Err(ProviderError::MissingApiKey("Mistral AI".into()));
        }
        let model_id = request.model.trim_start_matches("mistral/").to_string();
        self.client.stream_completions(&request, &model_id, None, sink).await
    }
}

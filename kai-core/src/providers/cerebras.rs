use async_trait::async_trait;

use super::openai_compat::OpenAiCompatClient;
use crate::traits::{ChatRequest, CompletionResult, LlmProvider, ProviderError, StreamSink};

/// Dedicated Cerebras cloud provider.
pub struct CerebrasProvider {
    api_key: String,
    client: OpenAiCompatClient,
}

impl CerebrasProvider {
    pub fn new(api_key: impl Into<String>) -> Self {
        let key = api_key.into();
        let client = OpenAiCompatClient::new("https://api.cerebras.ai/v1", key.clone());
        Self { api_key: key, client }
    }
}

#[async_trait]
impl LlmProvider for CerebrasProvider {
    fn id(&self) -> &'static str {
        "cerebras"
    }

    async fn list_models(&self) -> Result<Vec<String>, ProviderError> {
        Ok(vec!["cerebras/llama-3.3-70b".into(), "cerebras/llama-3.1-8b".into()])
    }

    async fn stream_chat(&self, request: ChatRequest, sink: &dyn StreamSink) -> Result<CompletionResult, ProviderError> {
        if self.api_key.trim().is_empty() {
            return Err(ProviderError::MissingApiKey("Cerebras".into()));
        }
        let model_id = request.model.trim_start_matches("cerebras/").to_string();
        self.client.stream_completions(&request, &model_id, None, sink).await
    }
}

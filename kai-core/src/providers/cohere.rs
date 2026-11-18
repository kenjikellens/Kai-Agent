use async_trait::async_trait;

use super::openai_compat::OpenAiCompatClient;
use crate::traits::{ChatRequest, CompletionResult, LlmProvider, ProviderError, StreamSink};

/// Dedicated Cohere cloud provider.
pub struct CohereProvider {
    api_key: String,
    client: OpenAiCompatClient,
}

impl CohereProvider {
    pub fn new(api_key: impl Into<String>) -> Self {
        let key = api_key.into();
        let client = OpenAiCompatClient::new("https://api.cohere.com/compatibility/v1", key.clone());
        Self { api_key: key, client }
    }
}

#[async_trait]
impl LlmProvider for CohereProvider {
    fn id(&self) -> &'static str {
        "cohere"
    }

    async fn list_models(&self) -> Result<Vec<String>, ProviderError> {
        Ok(vec!["cohere/command-r-plus".into(), "cohere/command-r".into()])
    }

    async fn stream_chat(&self, request: ChatRequest, sink: &dyn StreamSink) -> Result<CompletionResult, ProviderError> {
        if self.api_key.trim().is_empty() {
            return Err(ProviderError::MissingApiKey("Cohere".into()));
        }
        let model_id = request.model.trim_start_matches("cohere/").to_string();
        self.client.stream_completions(&request, &model_id, None, sink).await
    }
}

use async_trait::async_trait;

use super::openai_compat::OpenAiCompatClient;
use crate::traits::{ChatRequest, CompletionResult, LlmProvider, ProviderError, StreamSink};

/// Dedicated OmniRoute local/gateway provider.
pub struct OmniRouteProvider {
    client: OpenAiCompatClient,
}

impl OmniRouteProvider {
    pub fn new(server_url: impl Into<String>, api_key: impl Into<String>) -> Self {
        Self {
            client: OpenAiCompatClient::new(server_url, api_key),
        }
    }
}

#[async_trait]
impl LlmProvider for OmniRouteProvider {
    fn id(&self) -> &'static str {
        "omniroute"
    }

    async fn list_models(&self) -> Result<Vec<String>, ProviderError> {
        Ok(vec!["omniroute/auto".into()])
    }

    async fn stream_chat(&self, request: ChatRequest, sink: &dyn StreamSink) -> Result<CompletionResult, ProviderError> {
        let model_id = request.model.trim_start_matches("omniroute/").to_string();
        self.client.stream_completions(&request, &model_id, None, sink).await
    }
}

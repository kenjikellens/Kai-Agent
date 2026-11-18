use async_trait::async_trait;

use super::openai_compat::OpenAiCompatClient;
use crate::traits::{ChatRequest, CompletionResult, LlmProvider, ProviderError, StreamSink};

/// Dedicated Zhipu AI (GLM) cloud provider.
pub struct ZhipuProvider {
    api_key: String,
    client: OpenAiCompatClient,
}

impl ZhipuProvider {
    pub fn new(api_key: impl Into<String>) -> Self {
        let key = api_key.into();
        let client = OpenAiCompatClient::new("https://open.bigmodel.cn/api/paas/v4", key.clone());
        Self { api_key: key, client }
    }
}

#[async_trait]
impl LlmProvider for ZhipuProvider {
    fn id(&self) -> &'static str {
        "zhipu"
    }

    async fn list_models(&self) -> Result<Vec<String>, ProviderError> {
        Ok(vec!["zhipu/glm-4-flash".into(), "zhipu/glm-4-plus".into()])
    }

    async fn stream_chat(&self, request: ChatRequest, sink: &dyn StreamSink) -> Result<CompletionResult, ProviderError> {
        if self.api_key.trim().is_empty() {
            return Err(ProviderError::MissingApiKey("Zhipu AI".into()));
        }
        let model_id = request.model.trim_start_matches("zhipu/").to_string();
        self.client.stream_completions(&request, &model_id, None, sink).await
    }
}

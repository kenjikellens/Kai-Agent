use async_trait::async_trait;
use tokio::process::Command;

use super::openai_compat::OpenAiCompatClient;
use crate::traits::{ChatRequest, CompletionResult, LlmProvider, ProviderError, StreamSink};

/// Dedicated LM Studio local provider with single-model VRAM enforcement (`lms unload --all`).
pub struct LMStudioProvider {
    client: OpenAiCompatClient,
}

impl LMStudioProvider {
    pub fn new(server_url: impl Into<String>) -> Self {
        Self {
            client: OpenAiCompatClient::new(server_url, ""),
        }
    }

    /// Ensures only the target model is loaded in VRAM before inference.
    pub async fn ensure_single_loaded_model(&self, target_model: &str) {
        if target_model.is_empty() || target_model == "local-model" {
            return;
        }
        let _ = Command::new("lms").args(["unload", "--all"]).output().await;
        let _ = Command::new("lms")
            .args(["load", target_model, "-y"])
            .output()
            .await;
    }
}

#[async_trait]
impl LlmProvider for LMStudioProvider {
    fn id(&self) -> &'static str {
        "lmstudio"
    }

    async fn list_models(&self) -> Result<Vec<String>, ProviderError> {
        self.client.fetch_models().await
    }

    async fn stream_chat(
        &self,
        request: ChatRequest,
        sink: &dyn StreamSink,
    ) -> Result<CompletionResult, ProviderError> {
        let model_id = request.model.trim_end_matches(" (thinking)").to_string();
        self.client
            .stream_completions(&request, &model_id, None, sink)
            .await
    }
}

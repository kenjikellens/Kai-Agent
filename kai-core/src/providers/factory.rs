use std::sync::Arc;

use futures_util::future::join_all;
use serde_json::{json, Value};

use super::{
    cerebras::CerebrasProvider, cohere::CohereProvider, gemini::GeminiProvider,
    lm_studio::LMStudioProvider, mistral::MistralProvider, omniroute::OmniRouteProvider,
    openrouter::OpenRouterProvider, shared_validation_client, zhipu::ZhipuProvider,
};
use crate::engine::config_manager::KaiConfig;
use crate::traits::LlmProvider;

/// Factory resolving a selected model ID into a concrete `Arc<dyn LlmProvider>` and validating provider credentials.
pub struct ProviderFactory;

impl ProviderFactory {
    /// Instantiates the matching OOP provider for `model_id` using `config`.
    pub fn create(model_id: &str, config: &KaiConfig) -> Arc<dyn LlmProvider> {
        let lower = model_id.to_lowercase();
        if lower.starts_with("gemini") {
            Arc::new(GeminiProvider::new(&config.api_key))
        } else if lower.starts_with("openrouter/") {
            Arc::new(OpenRouterProvider::new(&config.openrouter_api_key))
        } else if lower.starts_with("mistral/") {
            Arc::new(MistralProvider::new(&config.mistral_api_key))
        } else if lower.starts_with("cohere/") {
            Arc::new(CohereProvider::new(&config.cohere_api_key))
        } else if lower.starts_with("cerebras/") {
            Arc::new(CerebrasProvider::new(&config.cerebras_api_key))
        } else if lower.starts_with("zhipu/") {
            Arc::new(ZhipuProvider::new(&config.zhipu_api_key))
        } else if lower.starts_with("omniroute/") {
            Arc::new(OmniRouteProvider::new(
                &config.omniroute_server_url,
                &config.omniroute_api_key,
            ))
        } else {
            Arc::new(LMStudioProvider::with_cache_dir(
                &config.server_url,
                &config.lm_studio_cache_dir,
            ))
        }
    }

    /// Validates a provider API key by querying its live `/models` endpoint with timeout protection.
    /// Reuses the shared validation HTTP client for TLS and connection pooling.
    pub async fn validate_provider(config_key: &str, api_key: &str, config: &KaiConfig) -> bool {
        let key = api_key.trim();
        if key.is_empty() && config_key != "omnirouteApiKey" {
            return false;
        }
        let client = shared_validation_client();

        if config_key == "geminiApiKey" {
            return client
                .get("https://generativelanguage.googleapis.com/v1beta/models")
                .header("x-goog-api-key", key)
                .send()
                .await
                .is_ok_and(|r| r.status().is_success());
        }

        let provider: Arc<dyn LlmProvider> = match config_key {
            "openrouterApiKey" => Arc::new(OpenRouterProvider::new(key)),
            "mistralApiKey" => Arc::new(MistralProvider::new(key)),
            "cohereApiKey" => Arc::new(CohereProvider::new(key)),
            "cerebrasApiKey" => Arc::new(CerebrasProvider::new(key)),
            "zhipuApiKey" => Arc::new(ZhipuProvider::new(key)),
            "omnirouteApiKey" => {
                Arc::new(OmniRouteProvider::new(&config.omniroute_server_url, key))
            }
            _ => return false,
        };

        tokio::time::timeout(std::time::Duration::from_secs(8), provider.list_models())
            .await
            .is_ok_and(|res| res.is_ok())
    }

    /// Concurrently validates all cloud providers and returns metadata plus connectivity status matching `DEFAULT_FREE_PROVIDERS`.
    /// Runs all provider `/models` checks in parallel via `join_all` to avoid sequential startup delays.
    pub async fn build_free_providers_status(config: &KaiConfig) -> Vec<Value> {
        let defs: [(&str, &str, &str, &str, Vec<&str>); 7] = [
            (
                "Google Gemini",
                "geminiApiKey",
                "Get free key at aistudio.google.com",
                config.api_key.as_str(),
                vec![
                    "gemini-3.8-flash",
                    "gemini-3.7-flash",
                    "gemini-3.6-flash",
                    "gemini-3.5-flash",
                    "gemini-3.5-flash-lite",
                    "gemini-3-flash-preview",
                    "gemini-3.1-pro-preview",
                    "gemini-3.1-flash-lite",
                ],
            ),
            (
                "Mistral AI",
                "mistralApiKey",
                "Get free key at console.mistral.ai",
                config.mistral_api_key.as_str(),
                vec![
                    "mistral/magistral-small-latest",
                    "mistral/magistral-medium-latest",
                    "mistral/mistral-small-latest",
                    "mistral/mistral-medium-3-5",
                    "mistral/codestral-latest",
                    "mistral/open-mixtral-8x22b",
                ],
            ),
            (
                "Cohere",
                "cohereApiKey",
                "Get free key at dashboard.cohere.com",
                config.cohere_api_key.as_str(),
                vec!["cohere/command-r-plus", "cohere/command-r"],
            ),
            (
                "Cerebras",
                "cerebrasApiKey",
                "Get free key at cloud.cerebras.ai",
                config.cerebras_api_key.as_str(),
                vec!["cerebras/llama-3.3-70b", "cerebras/llama-3.1-8b"],
            ),
            (
                "Zhipu AI",
                "zhipuApiKey",
                "Get free key at open.bigmodel.cn",
                config.zhipu_api_key.as_str(),
                vec!["zhipu/glm-4-flash", "zhipu/glm-4-plus"],
            ),
            (
                "OmniRoute Gateway",
                "omnirouteApiKey",
                "Run OmniRoute via npm: npx omniroute",
                config.omniroute_api_key.as_str(),
                vec!["omniroute/auto"],
            ),
            (
                "OpenRouter",
                "openrouterApiKey",
                "Get API key at openrouter.ai/keys",
                config.openrouter_api_key.as_str(),
                vec![
                    "openrouter/stealth/ox-alpha",
                    "openrouter/google/gemma-4-31b-it:free",
                    "openrouter/google/gemma-4-26b-a4b-it:free",
                    "openrouter/cohere/north-mini-code:free",
                    "openrouter/z-ai/glm-5.2:free",
                    "openrouter/nvidia/nemotron-3.5-lightning:free",
                    "openrouter/nvidia/nemotron-3-super-120b-a12b:free",
                    "openrouter/nvidia/nemotron-3-ultra-550b-a55b:free",
                    "openrouter/poolside/laguna-s-2.1:free",
                    "openrouter/thinkingmachines/inkling:free",
                    "openrouter/liquid/lfm-2.5-2.6b:free",
                ],
            ),
        ];

        let checks = defs.into_iter().map(
            |(name, config_key, key_hint, api_key, models)| async move {
                let trimmed = api_key.trim();
                let connected = if !trimmed.is_empty() {
                    Self::validate_provider(config_key, trimmed, config).await
                } else {
                    false
                };
                json!({
                    "name": name,
                    "configKey": config_key,
                    "keyHint": key_hint,
                    "models": models,
                    "apiKey": trimmed,
                    "connected": connected,
                })
            },
        );
        join_all(checks).await
    }
}

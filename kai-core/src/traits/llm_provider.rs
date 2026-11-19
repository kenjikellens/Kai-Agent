use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use thiserror::Error;

use super::agent_tool::FunctionDeclaration;

/// Errors returned by LLM provider implementations.
#[derive(Debug, Error)]
pub enum ProviderError {
    #[error("Missing API key for provider {0}")]
    MissingApiKey(String),
    #[error("HTTP request failed: {0}")]
    Http(#[from] reqwest::Error),
    #[error("Provider returned HTTP {status}: {body}")]
    ApiStatus { status: u16, body: String },
    #[error("JSON serialization error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Request cancelled")]
    Cancelled,
}

/// A single chat message in a conversation turn, supporting native tool calls and multimodal images.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    #[serde(default)]
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tool_calls: Vec<ToolCall>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub images: Vec<String>,
}

/// Normalized request payload passed to any `LlmProvider` including active tool schemas.
#[derive(Debug, Clone)]
pub struct ChatRequest {
    pub model: String,
    pub messages: Vec<ChatMessage>,
    pub temperature: f32,
    pub thinking: bool,
    pub thinking_level: String,
    pub tools: Vec<FunctionDeclaration>,
}

/// Parsed tool call emitted by an LLM provider or embedded `<|tool_call|>` tag.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCall {
    pub id: String,
    pub name: String,
    pub arguments: serde_json::Value,
    #[serde(
        rename = "thoughtSignature",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub thought_signature: Option<String>,
}

/// Completed generation output from an `LlmProvider`.
#[derive(Debug, Clone)]
pub struct CompletionResult {
    pub text: String,
    pub tokens_per_second: Option<String>,
    pub tool_calls: Vec<ToolCall>,
}

/// Polymorphic stream token receiver implemented by the host UI or orchestrator.
pub trait StreamSink: Send + Sync {
    fn on_token(&self, token: &str);
}

/// Polymorphic LLM provider contract implemented by one dedicated struct per provider.
#[async_trait]
pub trait LlmProvider: Send + Sync {
    /// Returns the provider identifier (e.g., `"gemini"`, `"openrouter"`, `"lmstudio"`).
    fn id(&self) -> &'static str;

    /// Returns true if the provider supports native tool-calling schemas.
    fn supports_native_tools(&self) -> bool {
        false
    }

    /// Discovers or lists available models for this provider.
    async fn list_models(&self) -> Result<Vec<String>, ProviderError>;

    /// Executes a streaming chat completion and forwards tokens to `sink`.
    async fn stream_chat(
        &self,
        request: ChatRequest,
        sink: &dyn StreamSink,
    ) -> Result<CompletionResult, ProviderError>;
}

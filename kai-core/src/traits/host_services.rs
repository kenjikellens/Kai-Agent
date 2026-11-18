use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::path::Path;
use thiserror::Error;

/// Errors raised by host UI or environment adapters.
#[derive(Debug, Error)]
pub enum HostError {
    #[error("Host UI unavailable: {0}")]
    Unavailable(String),
    #[error("Request timed out")]
    Timeout,
}

/// Interactive clarification prompt sent to the UI.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AskUserRequest {
    pub request_id: String,
    pub question: String,
    pub options: Vec<String>,
    pub allow_custom: bool,
}

/// Abstract host services contract decoupling `kai-core` from Tauri or CLI hosts.
#[async_trait]
pub trait HostServices: Send + Sync {
    /// Suspends execution to request user clarification or option selection.
    async fn ask_user(&self, req: AskUserRequest) -> Result<String, HostError>;

    /// Requests explicit user approval before executing a shell command.
    async fn request_command_approval(&self, command: &str) -> Result<bool, HostError>;

    /// Retrieves syntax/compiler diagnostics for a file or workspace.
    async fn get_diagnostics(&self, file_path: Option<&Path>) -> String;

    /// Searches workspace code symbols matching `query`.
    async fn search_symbols(&self, query: &str, workspace_path: &Path) -> String;
}

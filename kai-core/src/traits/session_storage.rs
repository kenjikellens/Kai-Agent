use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use thiserror::Error;

/// Errors raised by persistent session storage drivers.
#[derive(Debug, Error)]
pub enum StorageError {
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Serialization error: {0}")]
    Json(#[from] serde_json::Error),
}

/// Persistent chat session record.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatSessionRecord {
    pub id: String,
    pub title: String,
    pub messages: Vec<serde_json::Value>,
    #[serde(rename = "uiEvents", default)]
    pub ui_events: Option<Vec<serde_json::Value>>,
    #[serde(rename = "workspacePath", default)]
    pub workspace_path: Option<String>,
    pub mode: String,
    pub model: String,
    pub thinking: bool,
    pub timestamp: i64,
}

/// Abstract session persistence driver contract.
#[async_trait]
pub trait SessionStorage: Send + Sync {
    /// Loads all persisted sessions keyed by session ID.
    async fn load(&self) -> Result<HashMap<String, ChatSessionRecord>, StorageError>;

    /// Atomically persists all sessions to storage.
    async fn save(&self, sessions: &HashMap<String, ChatSessionRecord>) -> Result<(), StorageError>;
}

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::PathBuf;
use std::sync::Arc;
use thiserror::Error;

use tokio::sync::Mutex;

use super::host_services::HostServices;
use crate::engine::snapshot_manager::TurnSnapshotManager;

/// Errors raised during tool validation or execution.
#[derive(Debug, Error)]
pub enum ToolError {
    #[error("Path traversal violation: {0}")]
    PathViolation(String),
    #[error("Permission denied: {0}")]
    PermissionDenied(String),
    #[error("Invalid arguments: {0}")]
    InvalidArgs(String),
    #[error("Invalid arguments: {0}")]
    InvalidArguments(String),
    #[error("I/O error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Execution cancelled: {0}")]
    Cancelled(String),
    #[error("Tool execution failed: {0}")]
    Failed(String),
    #[error("Tool execution failed: {0}")]
    ExecutionFailed(String),
}

/// OpenAI-compatible function declaration schema for a tool.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FunctionDeclaration {
    pub name: String,
    pub description: String,
    pub parameters: Value,
}

/// Execution context injected into every `AgentTool::execute` call.
#[derive(Clone)]
pub struct ToolContext {
    pub workspace_path: PathBuf,
    pub turn_id: String,
    pub host_services: Option<Arc<dyn HostServices>>,
    pub snapshots: Option<Arc<Mutex<TurnSnapshotManager>>>,
}

/// Composable output truncator enforcing line and UTF-8 byte caps.
#[derive(Debug, Clone, Copy)]
pub struct OutputTruncator {
    pub max_lines: usize,
    pub max_bytes: usize,
}

impl Default for OutputTruncator {
    fn default() -> Self {
        Self {
            max_lines: 150,
            max_bytes: 8000,
        }
    }
}

impl OutputTruncator {
    /// Truncates large output while preserving head/tail context and valid UTF-8 boundaries.
    pub fn truncate(&self, output: &str) -> String {
        if output.is_empty() {
            return String::new();
        }
        let lines: Vec<&str> = output.lines().collect();
        let mut result = if lines.len() > self.max_lines {
            let head_count = (self.max_lines * 3) / 5;
            let tail_count = self.max_lines - head_count;
            let omitted = lines.len() - self.max_lines;
            format!(
                "{}\n\n... [{} lines omitted] ...\n\n{}",
                lines[..head_count].join("\n"),
                omitted,
                lines[lines.len() - tail_count..].join("\n")
            )
        } else {
            output.to_string()
        };

        if result.len() > self.max_bytes {
            let mut end = self.max_bytes;
            while end > 0 && !result.is_char_boundary(end) {
                end -= 1;
            }
            result.truncate(end);
            result.push_str("\n... [Output truncated at byte limit]");
        }
        result
    }
}

/// Polymorphic agent tool contract implemented by each dedicated tool struct.
#[async_trait]
pub trait AgentTool: Send + Sync {
    /// Returns the canonical tool name used in function calling.
    fn name(&self) -> &'static str;

    /// Returns the tool schema for LLM function declarations.
    fn declaration(&self) -> FunctionDeclaration;

    /// Executes the tool with parsed JSON arguments and workspace context.
    async fn execute(&self, args: Value, ctx: &ToolContext) -> Result<String, ToolError>;
}

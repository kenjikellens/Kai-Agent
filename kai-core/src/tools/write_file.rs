use async_trait::async_trait;
use serde_json::{json, Value};

use crate::tools::path_guard::WorkspacePathGuard;
use crate::traits::agent_tool::{AgentTool, FunctionDeclaration, ToolContext, ToolError};

/// Writes or creates files inside the workspace, optionally restricted to a subdirectory.
pub struct WriteFileTool {
    restricted_subdir: Option<String>,
}

impl WriteFileTool {
    /// Creates a `WriteFileTool` with an optional mode-enforced subdirectory restriction.
    pub fn new(restricted_subdir: Option<String>) -> Self {
        Self { restricted_subdir }
    }
}

#[async_trait]
impl AgentTool for WriteFileTool {
    fn name(&self) -> &'static str {
        "write_file"
    }

    fn declaration(&self) -> FunctionDeclaration {
        FunctionDeclaration {
            name: self.name().to_string(),
            description: "Create or overwrite a file inside the workspace.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "File path relative to workspace" },
                    "content": { "type": "string", "description": "Complete file contents" }
                },
                "required": ["path", "content"]
            }),
        }
    }

    async fn execute(&self, args: Value, ctx: &ToolContext) -> Result<String, ToolError> {
        let raw_path = args
            .get("path")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::InvalidArguments("Missing 'path' argument.".to_string()))?;
        let content = args
            .get("content")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::InvalidArguments("Missing 'content' argument.".to_string()))?;

        let resolved = WorkspacePathGuard::resolve_safe_path(
            &ctx.workspace_path,
            raw_path,
            self.restricted_subdir.as_deref(),
        )?;

        if let Some(snapshots) = &ctx.snapshots {
            snapshots.lock().await.capture_before_write(&ctx.turn_id, &resolved);
        }

        if let Some(parent) = resolved.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        tokio::fs::write(&resolved, content.as_bytes()).await?;

        Ok(format!("Wrote {} bytes to {}", content.len(), raw_path))
    }
}

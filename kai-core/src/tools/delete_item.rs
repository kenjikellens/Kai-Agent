use async_trait::async_trait;
use serde_json::{json, Value};

use crate::tools::path_guard::WorkspacePathGuard;
use crate::traits::agent_tool::{AgentTool, FunctionDeclaration, ToolContext, ToolError};

/// Deletes a file or directory strictly inside the active workspace.
pub struct DeleteItemTool;

#[async_trait]
impl AgentTool for DeleteItemTool {
    fn name(&self) -> &'static str {
        "delete_item"
    }

    fn declaration(&self) -> FunctionDeclaration {
        FunctionDeclaration {
            name: self.name().to_string(),
            description: "Delete a file or directory inside the workspace.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Path relative to workspace root" }
                },
                "required": ["path"]
            }),
        }
    }

    async fn execute(&self, args: Value, ctx: &ToolContext) -> Result<String, ToolError> {
        let raw_path = args
            .get("path")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::InvalidArguments("Missing 'path'.".to_string()))?;

        let resolved = WorkspacePathGuard::resolve_safe_path(&ctx.workspace_path, raw_path, None)?;
        let canonical_ws = ctx.workspace_path.canonicalize().map_err(ToolError::Io)?;
        if resolved == canonical_ws {
            return Err(ToolError::PathViolation(
                "Refusing to delete workspace root.".to_string(),
            ));
        }

        if let Some(snapshots) = &ctx.snapshots {
            snapshots.lock().await.capture_before_write(&ctx.turn_id, &resolved);
        }

        let meta = tokio::fs::metadata(&resolved).await?;
        if meta.is_dir() {
            tokio::fs::remove_dir_all(&resolved).await?;
        } else {
            tokio::fs::remove_file(&resolved).await?;
        }
        Ok(format!("Deleted '{raw_path}'."))
    }
}

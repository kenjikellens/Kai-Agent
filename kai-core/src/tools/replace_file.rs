use async_trait::async_trait;
use serde_json::{json, Value};

use crate::tools::path_guard::WorkspacePathGuard;
use crate::traits::agent_tool::{AgentTool, FunctionDeclaration, ToolContext, ToolError};

/// Performs exact-match surgical single or multi-block text replacements in workspace files.
pub struct ReplaceFileTool {
    multi: bool,
}

impl ReplaceFileTool {
    /// Creates either `replace_file_content` (`multi = false`) or `multi_replace_file_content`.
    pub fn new(multi: bool) -> Self {
        Self { multi }
    }
}

#[async_trait]
impl AgentTool for ReplaceFileTool {
    fn name(&self) -> &'static str {
        if self.multi {
            "multi_replace_file_content"
        } else {
            "replace_file_content"
        }
    }

    fn declaration(&self) -> FunctionDeclaration {
        if self.multi {
            FunctionDeclaration {
                name: self.name().to_string(),
                description: "Apply multiple non-overlapping exact replacements in a file."
                    .to_string(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "path": { "type": "string" },
                        "replacements": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "target": { "type": "string" },
                                    "replacement": { "type": "string" }
                                },
                                "required": ["target", "replacement"]
                            }
                        }
                    },
                    "required": ["path", "replacements"]
                }),
            }
        } else {
            FunctionDeclaration {
                name: self.name().to_string(),
                description: "Replace an exact contiguous block in a workspace file.".to_string(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "path": { "type": "string" },
                        "target": { "type": "string" },
                        "replacement": { "type": "string" }
                    },
                    "required": ["path", "target", "replacement"]
                }),
            }
        }
    }

    async fn execute(&self, args: Value, ctx: &ToolContext) -> Result<String, ToolError> {
        let raw_path = args
            .get("path")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::InvalidArguments("Missing 'path'.".to_string()))?;

        let resolved = WorkspacePathGuard::resolve_safe_path(&ctx.workspace_path, raw_path, None)?;
        if let Some(snapshots) = &ctx.snapshots {
            snapshots.lock().await.capture_before_write(&ctx.turn_id, &resolved);
        }
        let mut text = tokio::fs::read_to_string(&resolved).await?;

        if self.multi {
            let chunks = args
                .get("replacements")
                .and_then(|v| v.as_array())
                .ok_or_else(|| {
                    ToolError::InvalidArguments("Missing 'replacements' array.".to_string())
                })?;

            for chunk in chunks {
                let target = chunk
                    .get("target")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| ToolError::InvalidArguments("Missing chunk target.".to_string()))?;
                let replacement = chunk
                    .get("replacement")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| {
                        ToolError::InvalidArguments("Missing chunk replacement.".to_string())
                    })?;

                if !text.contains(target) {
                    return Err(ToolError::ExecutionFailed(format!(
                        "Target snippet not found in '{raw_path}'."
                    )));
                }
                text = text.replacen(target, replacement, 1);
            }
        } else {
            let target = args
                .get("target")
                .and_then(|v| v.as_str())
                .ok_or_else(|| ToolError::InvalidArguments("Missing 'target'.".to_string()))?;
            let replacement = args
                .get("replacement")
                .and_then(|v| v.as_str())
                .ok_or_else(|| ToolError::InvalidArguments("Missing 'replacement'.".to_string()))?;

            if !text.contains(target) {
                return Err(ToolError::ExecutionFailed(format!(
                    "Target snippet not found in '{raw_path}'."
                )));
            }
            text = text.replacen(target, replacement, 1);
        }

        tokio::fs::write(&resolved, text.as_bytes()).await?;
        Ok(format!("Updated '{raw_path}' successfully."))
    }
}

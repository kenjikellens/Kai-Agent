use async_trait::async_trait;
use serde_json::{json, Value};

use crate::tools::path_guard::WorkspacePathGuard;
use crate::traits::agent_tool::{
    AgentTool, FunctionDeclaration, OutputTruncator, ToolContext, ToolError,
};

/// Reads UTF-8 text files inside the active workspace with optional line slicing.
pub struct ReadFileTool {
    truncator: OutputTruncator,
}

impl ReadFileTool {
    /// Creates a new `ReadFileTool` with standard output truncation bounds.
    pub fn new() -> Self {
        Self {
            truncator: OutputTruncator::default(),
        }
    }
}

impl Default for ReadFileTool {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl AgentTool for ReadFileTool {
    fn name(&self) -> &'static str {
        "read_file"
    }

    fn declaration(&self) -> FunctionDeclaration {
        FunctionDeclaration {
            name: self.name().to_string(),
            description: "Read the contents of a file inside the workspace.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Path relative to workspace root" },
                    "start_line": { "type": "integer", "description": "1-based start line" },
                    "end_line": { "type": "integer", "description": "1-based inclusive end line" }
                },
                "required": ["path"]
            }),
        }
    }

    async fn execute(&self, args: Value, ctx: &ToolContext) -> Result<String, ToolError> {
        let raw_path = args
            .get("path")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::InvalidArguments("Missing 'path' argument.".to_string()))?;

        let resolved = WorkspacePathGuard::resolve_safe_path(&ctx.workspace_path, raw_path, None)?;
        let content = tokio::fs::read_to_string(&resolved).await?;
        let lines: Vec<&str> = content.lines().collect();

        let start = args
            .get("start_line")
            .and_then(|v| v.as_u64())
            .map(|v| v.max(1) as usize)
            .unwrap_or(1);
        let end = args
            .get("end_line")
            .and_then(|v| v.as_u64())
            .map(|v| v as usize)
            .unwrap_or(lines.len());

        let slice = lines
            .iter()
            .enumerate()
            .filter(|(idx, _)| {
                let line_no = idx + 1;
                line_no >= start && line_no <= end
            })
            .map(|(idx, line)| format!("{}: {}", idx + 1, line))
            .collect::<Vec<_>>()
            .join("\n");

        Ok(self.truncator.truncate(&slice))
    }
}

use async_trait::async_trait;
use ignore::WalkBuilder;
use serde_json::{json, Value};

use crate::tools::path_guard::WorkspacePathGuard;
use crate::traits::agent_tool::{
    AgentTool, FunctionDeclaration, OutputTruncator, ToolContext, ToolError,
};

/// Lists files and directories inside the workspace respecting `.gitignore`.
pub struct ListDirTool {
    truncator: OutputTruncator,
}

impl ListDirTool {
    /// Creates a new `ListDirTool`.
    pub fn new() -> Self {
        Self {
            truncator: OutputTruncator::default(),
        }
    }
}

impl Default for ListDirTool {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl AgentTool for ListDirTool {
    fn name(&self) -> &'static str {
        "list_dir"
    }

    fn declaration(&self) -> FunctionDeclaration {
        FunctionDeclaration {
            name: self.name().to_string(),
            description: "List directory entries inside the workspace.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "path": { "type": "string", "description": "Directory path (defaults to '.')" },
                    "max_depth": { "type": "integer", "description": "Max traversal depth (default 2)" }
                }
            }),
        }
    }

    async fn execute(&self, args: Value, ctx: &ToolContext) -> Result<String, ToolError> {
        let raw_path = args.get("path").and_then(|v| v.as_str()).unwrap_or(".");
        let max_depth = args.get("max_depth").and_then(|v| v.as_u64()).unwrap_or(2) as usize;
        let resolved = WorkspacePathGuard::resolve_safe_path(&ctx.workspace_path, raw_path, None)?;

        let mut entries = Vec::new();
        for dent in WalkBuilder::new(&resolved)
            .max_depth(Some(max_depth))
            .build()
            .flatten()
        {
            if dent.path() == resolved {
                continue;
            }
            if let Ok(rel) = dent.path().strip_prefix(&resolved) {
                let suffix = if dent.file_type().is_some_and(|ft| ft.is_dir()) {
                    "/"
                } else {
                    ""
                };
                entries.push(format!("{}{}", rel.to_string_lossy(), suffix));
            }
        }

        Ok(self.truncator.truncate(&entries.join("\n")))
    }
}

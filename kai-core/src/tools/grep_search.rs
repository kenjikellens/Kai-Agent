use async_trait::async_trait;
use ignore::WalkBuilder;
use regex::Regex;
use serde_json::{json, Value};

use crate::tools::path_guard::WorkspacePathGuard;
use crate::traits::agent_tool::{
    AgentTool, FunctionDeclaration, OutputTruncator, ToolContext, ToolError,
};

/// Searches workspace files using regular expressions while respecting `.gitignore`.
pub struct GrepSearchTool {
    truncator: OutputTruncator,
}

impl GrepSearchTool {
    /// Creates a new `GrepSearchTool`.
    pub fn new() -> Self {
        Self {
            truncator: OutputTruncator::default(),
        }
    }
}

impl Default for GrepSearchTool {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl AgentTool for GrepSearchTool {
    fn name(&self) -> &'static str {
        "grep_search"
    }

    fn declaration(&self) -> FunctionDeclaration {
        FunctionDeclaration {
            name: self.name().to_string(),
            description: "Search for a regex or literal pattern across workspace files.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "Regex pattern to match" },
                    "path": { "type": "string", "description": "Subdirectory or file (defaults to '.')" }
                },
                "required": ["query"]
            }),
        }
    }

    async fn execute(&self, args: Value, ctx: &ToolContext) -> Result<String, ToolError> {
        let query = args
            .get("query")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::InvalidArguments("Missing 'query'.".to_string()))?;
        let raw_path = args.get("path").and_then(|v| v.as_str()).unwrap_or(".");
        let resolved = WorkspacePathGuard::resolve_safe_path(&ctx.workspace_path, raw_path, None)?;

        let re = Regex::new(query)
            .map_err(|e| ToolError::InvalidArguments(format!("Invalid regex: {e}")))?;

        let mut matches = Vec::new();
        for dent in WalkBuilder::new(&resolved).build().flatten() {
            if !dent.file_type().is_some_and(|ft| ft.is_file()) {
                continue;
            }
            if let Ok(content) = std::fs::read_to_string(dent.path()) {
                let rel = dent
                    .path()
                    .strip_prefix(&ctx.workspace_path)
                    .unwrap_or(dent.path())
                    .to_string_lossy()
                    .to_string();
                for (idx, line) in content.lines().enumerate() {
                    if re.is_match(line) {
                        matches.push(format!("{}:{}: {}", rel, idx + 1, line.trim()));
                        if matches.len() >= 200 {
                            return Ok(self.truncator.truncate(&matches.join("\n")));
                        }
                    }
                }
            }
        }

        if matches.is_empty() {
            Ok("No matches found.".to_string())
        } else {
            Ok(self.truncator.truncate(&matches.join("\n")))
        }
    }
}

use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};

use async_trait::async_trait;
use ignore::WalkBuilder;
use regex::Regex;
use serde_json::{json, Value};

use crate::tools::path_guard::WorkspacePathGuard;
use crate::traits::agent_tool::{
    AgentTool, FunctionDeclaration, OutputTruncator, ToolContext, ToolError,
};

const MAX_GREP_FILE_BYTES: u64 = 4 * 1024 * 1024;
const MAX_GREP_MATCHES: usize = 200;

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

    /// Executes workspace regex search on a blocking thread with streaming line reads and binary file skipping.
    async fn execute(&self, args: Value, ctx: &ToolContext) -> Result<String, ToolError> {
        let query = args
            .get("query")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::InvalidArguments("Missing 'query'.".to_string()))?;
        let raw_path = args.get("path").and_then(|v| v.as_str()).unwrap_or(".");
        let resolved = WorkspacePathGuard::resolve_safe_path(&ctx.workspace_path, raw_path, None)?;

        let re = Regex::new(query)
            .map_err(|e| ToolError::InvalidArguments(format!("Invalid regex: {e}")))?;

        let workspace_root = ctx.workspace_path.clone();
        let matches = tokio::task::spawn_blocking(move || -> Vec<String> {
            let mut results = Vec::new();
            let mut probe = [0u8; 1024];

            for dent in WalkBuilder::new(&resolved).build().flatten() {
                if !dent.file_type().is_some_and(|ft| ft.is_file()) {
                    continue;
                }
                let path = dent.path();
                let Ok(meta) = dent.metadata() else {
                    continue;
                };
                if meta.len() > MAX_GREP_FILE_BYTES {
                    continue;
                }
                let Ok(mut file) = std::fs::File::open(path) else {
                    continue;
                };
                let Ok(n) = file.read(&mut probe) else {
                    continue;
                };
                if probe[..n].contains(&0) {
                    continue;
                }
                if file.seek(SeekFrom::Start(0)).is_err() {
                    continue;
                }

                let mut rel_cache: Option<String> = None;
                let mut reader = BufReader::new(file);
                let mut line = String::new();
                let mut line_no = 0usize;
                loop {
                    line.clear();
                    match reader.read_line(&mut line) {
                        Ok(0) | Err(_) => break,
                        Ok(_) => {
                            line_no += 1;
                            let trimmed_nl = line.trim_end_matches(&['\r', '\n'][..]);
                            if re.is_match(trimmed_nl) {
                                let rel = rel_cache.get_or_insert_with(|| {
                                    path.strip_prefix(&workspace_root)
                                        .unwrap_or(path)
                                        .to_string_lossy()
                                        .into_owned()
                                });
                                results.push(format!("{}:{}: {}", rel, line_no, trimmed_nl.trim()));
                                if results.len() >= MAX_GREP_MATCHES {
                                    return results;
                                }
                            }
                        }
                    }
                }
            }
            results
        })
        .await
        .map_err(|e| ToolError::ExecutionFailed(format!("Search task failed: {e}")))?;

        if matches.is_empty() {
            Ok("No matches found.".to_string())
        } else {
            Ok(self.truncator.truncate(&matches.join("\n")))
        }
    }
}

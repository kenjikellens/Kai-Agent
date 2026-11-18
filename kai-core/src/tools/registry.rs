use std::collections::HashMap;
use std::sync::Arc;

use serde_json::Value;

use crate::tools::ask_user::AskUserTool;
use crate::tools::delete_item::DeleteItemTool;
use crate::tools::fetch_url::FetchUrlTool;
use crate::tools::grep_search::GrepSearchTool;
use crate::tools::list_dir::ListDirTool;
use crate::tools::read_file::ReadFileTool;
use crate::tools::replace_file::ReplaceFileTool;
use crate::tools::run_command::RunCommandTool;
use crate::tools::utility_tools::{CalculateTool, CurrentTimeTool};
use crate::tools::write_file::WriteFileTool;
use crate::traits::agent_tool::{AgentTool, FunctionDeclaration, ToolContext, ToolError};

/// Operational mode controlling which tools are exposed to the LLM.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AgentMode {
    Ask,
    Planning,
    Agent,
    Chat,
}

impl AgentMode {
    /// Parses a mode string, defaulting safely to `Ask`.
    pub fn from_str_safe(raw: &str) -> Self {
        match raw.trim().to_ascii_lowercase().as_str() {
            "agent" => Self::Agent,
            "planning" => Self::Planning,
            "chat" => Self::Chat,
            _ => Self::Ask,
        }
    }
}

/// Mode-gated registry holding `Arc<dyn AgentTool>` instances.
pub struct ToolRegistry {
    tools: HashMap<String, Arc<dyn AgentTool>>,
}

impl ToolRegistry {
    /// Builds a registry strictly enforcing workspace presence and mode tool permissions.
    pub fn for_mode(mode: AgentMode, has_workspace: bool) -> Self {
        let mut reg = Self {
            tools: HashMap::new(),
        };

        // Always available across all modes
        reg.register(Arc::new(CalculateTool));
        reg.register(Arc::new(CurrentTimeTool));
        reg.register(Arc::new(FetchUrlTool::new()));
        reg.register(Arc::new(AskUserTool));

        if !has_workspace || mode == AgentMode::Chat {
            return reg;
        }

        // Read-only workspace inspection tools
        reg.register(Arc::new(ReadFileTool::new()));
        reg.register(Arc::new(ListDirTool::new()));
        reg.register(Arc::new(GrepSearchTool::new()));

        match mode {
            AgentMode::Ask | AgentMode::Chat => {}
            AgentMode::Planning => {
                // Planning mode restricts writes strictly to `.kai/artifacts`
                reg.register(Arc::new(WriteFileTool::new(Some(
                    ".kai/artifacts".to_string(),
                ))));
            }
            AgentMode::Agent => {
                reg.register(Arc::new(WriteFileTool::new(None)));
                reg.register(Arc::new(ReplaceFileTool::new(false)));
                reg.register(Arc::new(ReplaceFileTool::new(true)));
                reg.register(Arc::new(DeleteItemTool));
                reg.register(Arc::new(RunCommandTool::new()));
            }
        }

        reg
    }

    fn register(&mut self, tool: Arc<dyn AgentTool>) {
        self.tools.insert(tool.name().to_string(), tool);
    }

    /// Returns declarations for all tools permitted in the active mode.
    pub fn declarations(&self) -> Vec<FunctionDeclaration> {
        let mut list: Vec<_> = self.tools.values().map(|t| t.declaration()).collect();
        list.sort_by(|a, b| a.name.cmp(&b.name));
        list
    }

    /// Dispatches a tool call if and only if the tool exists in this mode's registry.
    pub async fn dispatch(
        &self,
        name: &str,
        args: Value,
        ctx: &ToolContext,
    ) -> Result<String, ToolError> {
        let tool = self.tools.get(name).ok_or_else(|| {
            ToolError::PermissionDenied(format!(
                "Tool '{name}' is not permitted in the current mode."
            ))
        })?;
        tool.execute(args, ctx).await
    }
}

#[cfg(test)]
mod tests {
    use super::{AgentMode, ToolRegistry};

    #[test]
    fn ask_mode_blocks_mutating_tools() {
        let reg = ToolRegistry::for_mode(AgentMode::Ask, true);
        let names: Vec<_> = reg.declarations().into_iter().map(|d| d.name).collect();
        assert!(names.contains(&"read_file".to_string()));
        assert!(!names.contains(&"write_file".to_string()));
        assert!(!names.contains(&"run_command".to_string()));
    }

    #[test]
    fn no_workspace_hides_workspace_tools() {
        let reg = ToolRegistry::for_mode(AgentMode::Agent, false);
        let names: Vec<_> = reg.declarations().into_iter().map(|d| d.name).collect();
        assert!(!names.contains(&"read_file".to_string()));
        assert!(names.contains(&"fetch_url".to_string()));
    }
}

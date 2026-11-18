use std::time::Duration;

use async_trait::async_trait;
use serde_json::{json, Value};
use tokio::process::Command;

use crate::traits::agent_tool::{
    AgentTool, FunctionDeclaration, OutputTruncator, ToolContext, ToolError,
};

/// Executes shell commands inside the workspace after explicit user approval.
pub struct RunCommandTool {
    truncator: OutputTruncator,
}

impl RunCommandTool {
    /// Creates a new `RunCommandTool`.
    pub fn new() -> Self {
        Self {
            truncator: OutputTruncator::default(),
        }
    }
}

impl Default for RunCommandTool {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl AgentTool for RunCommandTool {
    fn name(&self) -> &'static str {
        "run_command"
    }

    fn declaration(&self) -> FunctionDeclaration {
        FunctionDeclaration {
            name: self.name().to_string(),
            description: "Execute a shell command inside the active workspace after user approval."
                .to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "command": { "type": "string", "description": "Shell command to execute" }
                },
                "required": ["command"]
            }),
        }
    }

    async fn execute(&self, args: Value, ctx: &ToolContext) -> Result<String, ToolError> {
        let command = args
            .get("command")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::InvalidArguments("Missing 'command'.".to_string()))?;

        if ctx.workspace_path.to_string_lossy().trim().is_empty() {
            return Err(ToolError::PathViolation(
                "Cannot execute command without an active workspace.".to_string(),
            ));
        }

        let host = ctx.host_services.as_ref().ok_or_else(|| {
            ToolError::ExecutionFailed("Command approval service unavailable.".to_string())
        })?;

        let approved = host
            .request_command_approval(command)
            .await
            .map_err(|e| ToolError::ExecutionFailed(e.to_string()))?;

        if !approved {
            return Err(ToolError::PermissionDenied(
                "Command execution denied by user.".to_string(),
            ));
        }

        #[cfg(target_os = "windows")]
        let mut cmd = {
            let mut c = Command::new("powershell");
            c.args(["-NoProfile", "-Command", command]);
            c
        };

        #[cfg(not(target_os = "windows"))]
        let mut cmd = {
            let mut c = Command::new("sh");
            c.args(["-c", command]);
            c
        };

        cmd.current_dir(&ctx.workspace_path);

        let output = tokio::time::timeout(Duration::from_secs(60), cmd.output())
            .await
            .map_err(|_| ToolError::ExecutionFailed("Command timed out after 60s.".to_string()))?
            .map_err(ToolError::Io)?;

        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        let combined = format!(
            "exit_code: {}\nstdout:\n{}\nstderr:\n{}",
            output.status.code().unwrap_or(-1),
            stdout,
            stderr
        );

        Ok(self.truncator.truncate(&combined))
    }
}

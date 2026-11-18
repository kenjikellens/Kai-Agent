use async_trait::async_trait;
use serde_json::{json, Value};

use crate::traits::agent_tool::{AgentTool, FunctionDeclaration, ToolContext, ToolError};
use crate::traits::host_services::AskUserRequest;

/// Prompts the user for clarification or multiple-choice selection via HostServices.
pub struct AskUserTool;

#[async_trait]
impl AgentTool for AskUserTool {
    fn name(&self) -> &'static str {
        "ask_user"
    }

    fn declaration(&self) -> FunctionDeclaration {
        FunctionDeclaration {
            name: self.name().to_string(),
            description: "Ask the user a question with optional multiple-choice options."
                .to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "question": { "type": "string", "description": "Question prompt for the user" },
                    "options": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "Optional clickable choice labels"
                    }
                },
                "required": ["question"]
            }),
        }
    }

    async fn execute(&self, args: Value, ctx: &ToolContext) -> Result<String, ToolError> {
        let question = args
            .get("question")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::InvalidArguments("Missing 'question'.".to_string()))?
            .to_string();

        let options = args
            .get("options")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(ToString::to_string))
                    .collect()
            })
            .unwrap_or_default();

        let host = ctx.host_services.as_ref().ok_or_else(|| {
            ToolError::ExecutionFailed("HostServices unavailable for ask_user.".to_string())
        })?;

        host.ask_user(AskUserRequest {
            request_id: uuid::Uuid::new_v4().to_string(),
            question,
            options,
            allow_custom: true,
        })
        .await
        .map_err(|e| ToolError::ExecutionFailed(e.to_string()))
    }
}

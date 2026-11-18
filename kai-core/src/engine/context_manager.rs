use crate::traits::llm_provider::ChatMessage;

/// Manages system prompts, token budgeting, and sliding-window context trimming.
pub struct ContextManager {
    max_chars: usize,
}

impl ContextManager {
    /// Creates a `ContextManager` with a maximum approximate character budget.
    pub fn new(max_chars: usize) -> Self {
        Self { max_chars }
    }

    /// Builds the mode-specific system prompt instruction.
    pub fn system_prompt(mode: &str, workspace_path: &str) -> String {
        let ws_note = if workspace_path.trim().is_empty() {
            "No active workspace folder is open. Operate in read-only conversational Ask mode."
                .to_string()
        } else {
            format!("Active workspace directory: {workspace_path}")
        };

        let mode_contract = match mode.to_ascii_lowercase().as_str() {
            "agent" => {
                "MODE: AGENT. Execute tool calls directly without preambles, verify edits, and explain root causes concisely."
            }
            "planning" => {
                "MODE: PLANNING. Read-only research plus writing plans strictly under .kai/artifacts/. Do not modify source files."
            }
            "chat" => "MODE: CHAT. Pure conversational assistance without workspace tool mutations.",
            _ => "MODE: ASK. Read-only codebase inspection and external lookup. Never modify files or run commands.",
        };

        format!("You are KAI Agent.\n{ws_note}\n{mode_contract}")
    }

    /// Compacts conversation history to fit within `max_chars` while preserving the system message.
    pub fn fit_messages(&self, mut messages: Vec<ChatMessage>) -> Vec<ChatMessage> {
        let total: usize = messages.iter().map(|m| m.content.len()).sum();
        if total <= self.max_chars || messages.len() <= 2 {
            return messages;
        }

        let has_system = messages.first().is_some_and(|m| m.role == "system");
        let start_idx = if has_system { 1 } else { 0 };
        let mut current_len: usize = messages.iter().map(|m| m.content.len()).sum();

        while current_len > self.max_chars && messages.len() > start_idx + 2 {
            let removed = messages.remove(start_idx);
            current_len = current_len.saturating_sub(removed.content.len());
        }
        messages
    }
}

impl Default for ContextManager {
    fn default() -> Self {
        Self::new(120_000)
    }
}

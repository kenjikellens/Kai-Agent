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

    /// Compacts conversation history to fit within `max_chars` in a single `drain` while preserving the system message.
    pub fn fit_messages(&self, mut messages: Vec<ChatMessage>) -> Vec<ChatMessage> {
        let mut current_len: usize = messages.iter().map(|m| m.content.len()).sum();
        if current_len <= self.max_chars || messages.len() <= 2 {
            return messages;
        }

        let has_system = messages.first().is_some_and(|m| m.role == "system");
        let start_idx = if has_system { 1 } else { 0 };
        let limit = messages.len().saturating_sub(2);
        let mut drop_end = start_idx;
        while current_len > self.max_chars && drop_end < limit {
            current_len = current_len.saturating_sub(messages[drop_end].content.len());
            drop_end += 1;
        }
        if drop_end > start_idx {
            messages.drain(start_idx..drop_end);
        }
        messages
    }

    /// Selects and clones only the messages retained within `max_chars`, skipping dropped history entries entirely.
    /// Preserves an initial system message and at least the two most recent messages.
    pub fn fit_messages_slice(&self, messages: &[ChatMessage]) -> Vec<ChatMessage> {
        let mut current_len: usize = messages.iter().map(|m| m.content.len()).sum();
        if current_len <= self.max_chars || messages.len() <= 2 {
            return messages.to_vec();
        }

        let has_system = messages.first().is_some_and(|m| m.role == "system");
        let start_idx = if has_system { 1 } else { 0 };
        let limit = messages.len().saturating_sub(2);
        let mut drop_end = start_idx;
        while current_len > self.max_chars && drop_end < limit {
            current_len = current_len.saturating_sub(messages[drop_end].content.len());
            drop_end += 1;
        }

        let kept_count = start_idx + (messages.len() - drop_end);
        let mut out = Vec::with_capacity(kept_count);
        if has_system {
            out.push(messages[0].clone());
        }
        out.extend(messages[drop_end..].iter().cloned());
        out
    }
}

impl Default for ContextManager {
    fn default() -> Self {
        Self::new(120_000)
    }
}

#[cfg(test)]
mod tests {
    use super::ContextManager;
    use crate::traits::llm_provider::ChatMessage;

    fn msg(role: &str, content: &str) -> ChatMessage {
        ChatMessage {
            role: role.to_string(),
            content: content.to_string(),
            tool_call_id: None,
            name: None,
            images: Vec::new(),
        }
    }

    #[test]
    fn fit_messages_slice_drops_oldest_non_system_messages() {
        let cm = ContextManager::new(25);
        let history = vec![
            msg("system", "SYS"),
            msg("user", "1234567890"),
            msg("assistant", "1234567890"),
            msg("user", "LATEST1"),
            msg("assistant", "LATEST2"),
        ];
        let fitted = cm.fit_messages_slice(&history);
        assert_eq!(fitted.len(), 3);
        assert_eq!(fitted[0].content, "SYS");
        assert_eq!(fitted[1].content, "LATEST1");
        assert_eq!(fitted[2].content, "LATEST2");
    }
}

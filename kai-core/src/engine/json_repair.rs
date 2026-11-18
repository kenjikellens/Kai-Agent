use serde_json::Value;

/// Extracts and repairs malformed JSON payloads or `<|tool_call|>` blocks emitted by LLMs.
pub struct JsonRepair;

impl JsonRepair {
    /// Parses JSON directly, or strips markdown fences / trailing commas before retrying.
    pub fn parse_lenient(raw: &str) -> Option<Value> {
        let trimmed = raw.trim();
        if let Ok(v) = serde_json::from_str::<Value>(trimmed) {
            return Some(v);
        }

        let unfenced = trimmed
            .trim_start_matches("```json")
            .trim_start_matches("```")
            .trim_end_matches("```")
            .trim();

        if let Ok(v) = serde_json::from_str::<Value>(unfenced) {
            return Some(v);
        }

        // Remove simple trailing commas before `}` or `]`
        let cleaned = unfenced.replace(",}", "}").replace(",]", "]");
        serde_json::from_str::<Value>(&cleaned).ok()
    }
}

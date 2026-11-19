use serde_json::Value;

/// Extracts and repairs malformed JSON payloads or embedded tool call blocks emitted by LLMs.
pub struct JsonRepair;

impl JsonRepair {
    /// Parses JSON directly, strips markdown fences, scans balanced `{...}`, or removes trailing commas.
    pub fn parse_lenient(raw: &str) -> Option<Value> {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            return None;
        }
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

        let cleaned = Self::strip_trailing_commas(unfenced);
        if let Ok(v) = serde_json::from_str::<Value>(&cleaned) {
            return Some(v);
        }

        if let Some(slice) = Self::extract_first_balanced_object(trimmed) {
            if let Ok(v) = serde_json::from_str::<Value>(slice) {
                return Some(v);
            }
            let slice_cleaned = Self::strip_trailing_commas(slice);
            if let Ok(v) = serde_json::from_str::<Value>(&slice_cleaned) {
                return Some(v);
            }
        }
        None
    }

    /// Removes trailing commas immediately before `}` or `]` outside quoted strings when recovering LLM JSON.
    fn strip_trailing_commas(input: &str) -> String {
        let mut out = String::with_capacity(input.len());
        let chars: Vec<char> = input.chars().collect();
        let mut i = 0;
        let mut in_string = false;
        let mut escaped = false;
        while i < chars.len() {
            let c = chars[i];
            if escaped {
                out.push(c);
                escaped = false;
                i += 1;
                continue;
            }
            if in_string && c == '\\' {
                out.push(c);
                escaped = true;
                i += 1;
                continue;
            }
            if c == '"' {
                in_string = !in_string;
                out.push(c);
                i += 1;
                continue;
            }
            if !in_string && c == ',' {
                let mut j = i + 1;
                while j < chars.len() && chars[j].is_whitespace() {
                    j += 1;
                }
                if j < chars.len() && (chars[j] == '}' || chars[j] == ']') {
                    i += 1;
                    continue;
                }
            }
            out.push(c);
            i += 1;
        }
        out
    }

    /// Scans `text` for the first balanced JSON object `{...}` respecting quoted string boundaries.
    pub fn extract_first_balanced_object(text: &str) -> Option<&str> {
        let start = text.find('{')?;
        let mut depth = 0usize;
        let mut in_string = false;
        let mut escaped = false;
        for (rel_idx, ch) in text[start..].char_indices() {
            if escaped {
                escaped = false;
                continue;
            }
            if in_string && ch == '\\' {
                escaped = true;
                continue;
            }
            if ch == '"' {
                in_string = !in_string;
                continue;
            }
            if !in_string {
                if ch == '{' {
                    depth += 1;
                } else if ch == '}' {
                    depth = depth.saturating_sub(1);
                    if depth == 0 {
                        let end = start + rel_idx + ch.len_utf8();
                        return Some(&text[start..end]);
                    }
                }
            }
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::JsonRepair;

    #[test]
    fn parses_fenced_and_trailing_comma_json() {
        let fenced = "```json\n{\"name\": \"read_file\", \"arguments\": {\"path\": \"README.md\",},}\n```";
        let parsed = JsonRepair::parse_lenient(fenced).expect("should parse repaired json");
        assert_eq!(parsed["name"], "read_file");
        assert_eq!(parsed["arguments"]["path"], "README.md");
    }

    #[test]
    fn extracts_balanced_object_from_prose() {
        let prose = "Calling tool now: {\"tool\": \"list_dir\", \"path\": \".\"} done.";
        let parsed = JsonRepair::parse_lenient(prose).expect("should extract object");
        assert_eq!(parsed["tool"], "list_dir");
    }
}

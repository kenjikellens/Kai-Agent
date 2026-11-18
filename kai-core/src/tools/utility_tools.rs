use std::time::{SystemTime, UNIX_EPOCH};

use async_trait::async_trait;
use serde_json::{json, Value};

use crate::traits::agent_tool::{AgentTool, FunctionDeclaration, ToolContext, ToolError};

/// Evaluates safe arithmetic expressions via recursive-descent parsing (no eval).
pub struct CalculateTool;

impl CalculateTool {
    /// Parses and evaluates `+`, `-`, `*`, `/`, `%`, parentheses, and unary signs.
    pub fn evaluate(expr: &str) -> Result<f64, ToolError> {
        let tokens = Self::tokenize(expr)?;
        let mut pos = 0usize;
        let val = Self::parse_expr(&tokens, &mut pos)?;
        if pos != tokens.len() {
            return Err(ToolError::InvalidArguments(
                "Unexpected trailing tokens in expression.".to_string(),
            ));
        }
        Ok(val)
    }

    fn tokenize(expr: &str) -> Result<Vec<String>, ToolError> {
        let mut tokens = Vec::new();
        let chars: Vec<char> = expr.chars().collect();
        let mut i = 0;
        while i < chars.len() {
            let c = chars[i];
            if c.is_whitespace() {
                i += 1;
                continue;
            }
            if "+-*/%()".contains(c) {
                tokens.push(c.to_string());
                i += 1;
                continue;
            }
            if c.is_ascii_digit() || c == '.' {
                let start = i;
                while i < chars.len() && (chars[i].is_ascii_digit() || chars[i] == '.') {
                    i += 1;
                }
                tokens.push(chars[start..i].iter().collect());
                continue;
            }
            return Err(ToolError::InvalidArguments(format!(
                "Disallowed character '{c}' in arithmetic expression."
            )));
        }
        Ok(tokens)
    }

    fn parse_expr(tokens: &[String], pos: &mut usize) -> Result<f64, ToolError> {
        let mut left = Self::parse_term(tokens, pos)?;
        while *pos < tokens.len() && (tokens[*pos] == "+" || tokens[*pos] == "-") {
            let op = tokens[*pos].as_str();
            *pos += 1;
            let right = Self::parse_term(tokens, pos)?;
            left = if op == "+" { left + right } else { left - right };
        }
        Ok(left)
    }

    fn parse_term(tokens: &[String], pos: &mut usize) -> Result<f64, ToolError> {
        let mut left = Self::parse_factor(tokens, pos)?;
        while *pos < tokens.len()
            && (tokens[*pos] == "*" || tokens[*pos] == "/" || tokens[*pos] == "%")
        {
            let op = tokens[*pos].as_str();
            *pos += 1;
            let right = Self::parse_factor(tokens, pos)?;
            match op {
                "*" => left *= right,
                "/" => {
                    if right == 0.0 {
                        return Err(ToolError::InvalidArguments("Division by zero.".to_string()));
                    }
                    left /= right;
                }
                _ => {
                    if right == 0.0 {
                        return Err(ToolError::InvalidArguments("Modulo by zero.".to_string()));
                    }
                    left %= right;
                }
            }
        }
        Ok(left)
    }

    fn parse_factor(tokens: &[String], pos: &mut usize) -> Result<f64, ToolError> {
        if *pos >= tokens.len() {
            return Err(ToolError::InvalidArguments(
                "Unexpected end of expression.".to_string(),
            ));
        }
        if tokens[*pos] == "+" {
            *pos += 1;
            return Self::parse_factor(tokens, pos);
        }
        if tokens[*pos] == "-" {
            *pos += 1;
            return Ok(-Self::parse_factor(tokens, pos)?);
        }
        if tokens[*pos] == "(" {
            *pos += 1;
            let val = Self::parse_expr(tokens, pos)?;
            if *pos >= tokens.len() || tokens[*pos] != ")" {
                return Err(ToolError::InvalidArguments(
                    "Missing closing parenthesis.".to_string(),
                ));
            }
            *pos += 1;
            return Ok(val);
        }
        let num = tokens[*pos]
            .parse::<f64>()
            .map_err(|_| ToolError::InvalidArguments(format!("Invalid number '{}'.", tokens[*pos])))?;
        *pos += 1;
        Ok(num)
    }
}

#[async_trait]
impl AgentTool for CalculateTool {
    fn name(&self) -> &'static str {
        "calculate"
    }

    fn declaration(&self) -> FunctionDeclaration {
        FunctionDeclaration {
            name: self.name().to_string(),
            description: "Safely evaluate an arithmetic expression.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "expression": { "type": "string" }
                },
                "required": ["expression"]
            }),
        }
    }

    async fn execute(&self, args: Value, _ctx: &ToolContext) -> Result<String, ToolError> {
        let expr = args
            .get("expression")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::InvalidArguments("Missing 'expression'.".to_string()))?;
        let res = Self::evaluate(expr)?;
        Ok(res.to_string())
    }
}

/// Returns current UTC Unix timestamp and ISO-like formatted seconds.
pub struct CurrentTimeTool;

#[async_trait]
impl AgentTool for CurrentTimeTool {
    fn name(&self) -> &'static str {
        "get_current_time"
    }

    fn declaration(&self) -> FunctionDeclaration {
        FunctionDeclaration {
            name: self.name().to_string(),
            description: "Get the current UTC timestamp.".to_string(),
            parameters: json!({ "type": "object", "properties": {} }),
        }
    }

    async fn execute(&self, _args: Value, _ctx: &ToolContext) -> Result<String, ToolError> {
        let secs = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        Ok(json!({ "unix_seconds": secs }).to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::CalculateTool;

    #[test]
    fn evaluates_precedence_and_parentheses() {
        assert_eq!(CalculateTool::evaluate("2 + 3 * (4 - 1)").unwrap(), 11.0);
        assert_eq!(CalculateTool::evaluate("-5 + 10 / 2").unwrap(), 0.0);
    }

    #[test]
    fn rejects_non_arithmetic_tokens() {
        assert!(CalculateTool::evaluate("process.exit(1)").is_err());
    }
}

use std::path::{Component, Path, PathBuf};

use crate::traits::agent_tool::ToolError;

/// Enforces workspace-jailed path resolution, blocking traversal and symlinks outside root.
pub struct WorkspacePathGuard;

impl WorkspacePathGuard {
    /// Resolves a relative or absolute path strictly inside `workspace_path`.
    pub fn resolve_safe_path(
        workspace_path: &Path,
        target_path: &str,
        restricted_subdir: Option<&str>,
    ) -> Result<PathBuf, ToolError> {
        let ws_str = workspace_path.to_string_lossy();
        if ws_str.trim().is_empty() {
            return Err(ToolError::PathViolation(
                "No active workspace folder selected.".to_string(),
            ));
        }

        let canonical_root = workspace_path.canonicalize().map_err(|e| {
            ToolError::PathViolation(format!("Invalid workspace root '{}': {e}", ws_str))
        })?;

        let trimmed = target_path.trim();
        if trimmed.is_empty() {
            return Err(ToolError::InvalidArguments("Path cannot be empty.".to_string()));
        }

        let candidate = if Path::new(trimmed).is_absolute() {
            PathBuf::from(trimmed)
        } else {
            canonical_root.join(trimmed)
        };

        let normalized = Self::normalize_lexical(&candidate);

        if let Some(subdir) = restricted_subdir {
            let allowed_root = Self::normalize_lexical(&canonical_root.join(subdir));
            if !normalized.starts_with(&allowed_root) {
                return Err(ToolError::PathViolation(format!(
                    "Writes in this mode are restricted to '{subdir}'."
                )));
            }
        }

        if normalized.exists() {
            let resolved = normalized.canonicalize().map_err(ToolError::Io)?;
            if !resolved.starts_with(&canonical_root) {
                return Err(ToolError::PathViolation(
                    "Path escapes workspace root via symlink.".to_string(),
                ));
            }
            return Ok(resolved);
        }

        // For new files, verify the nearest existing ancestor resides inside workspace root.
        let mut ancestor = normalized.parent();
        while let Some(dir) = ancestor {
            if dir.exists() {
                let resolved_ancestor = dir.canonicalize().map_err(ToolError::Io)?;
                if !resolved_ancestor.starts_with(&canonical_root) {
                    return Err(ToolError::PathViolation(
                        "Parent directory escapes workspace root.".to_string(),
                    ));
                }
                break;
            }
            ancestor = dir.parent();
        }

        if !normalized.starts_with(&canonical_root) {
            return Err(ToolError::PathViolation(
                "Path traversal outside workspace root is forbidden.".to_string(),
            ));
        }

        Ok(normalized)
    }

    /// Normalizes `.` and `..` lexically without requiring the target to exist.
    fn normalize_lexical(path: &Path) -> PathBuf {
        let mut stack = PathBuf::new();
        for comp in path.components() {
            match comp {
                Component::CurDir => {}
                Component::ParentDir => {
                    stack.pop();
                }
                other => stack.push(other.as_os_str()),
            }
        }
        stack
    }
}

#[cfg(test)]
mod tests {
    use super::WorkspacePathGuard;
    use std::path::Path;

    #[test]
    fn rejects_empty_workspace() {
        let res = WorkspacePathGuard::resolve_safe_path(Path::new(""), "foo.txt", None);
        assert!(res.is_err());
    }

    #[test]
    fn rejects_parent_traversal() {
        let temp = std::env::temp_dir();
        let res = WorkspacePathGuard::resolve_safe_path(&temp, "../../etc/passwd", None);
        assert!(res.is_err());
    }

    #[test]
    fn enforces_restricted_subdir() {
        let temp = std::env::temp_dir();
        let blocked = WorkspacePathGuard::resolve_safe_path(&temp, "src/main.rs", Some(".kai/artifacts"));
        assert!(blocked.is_err());
        let allowed = WorkspacePathGuard::resolve_safe_path(
            &temp,
            ".kai/artifacts/plan.md",
            Some(".kai/artifacts"),
        );
        assert!(allowed.is_ok());
    }
}

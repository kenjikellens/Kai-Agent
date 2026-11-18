use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// Captures pre-edit file states per turn so users can cleanly roll back agent modifications.
#[derive(Default)]
pub struct TurnSnapshotManager {
    snapshots: HashMap<String, HashMap<PathBuf, Option<Vec<u8>>>>,
}

impl TurnSnapshotManager {
    /// Creates an empty `TurnSnapshotManager`.
    pub fn new() -> Self {
        Self::default()
    }

    /// Records the original file bytes (or `None` if newly created) before first modification in a turn.
    pub fn capture_before_write(&mut self, turn_id: &str, file_path: &Path) {
        let turn_map = self.snapshots.entry(turn_id.to_string()).or_default();
        if turn_map.contains_key(file_path) {
            return;
        }
        let original = std::fs::read(file_path).ok();
        turn_map.insert(file_path.to_path_buf(), original);
    }

    /// Reverts all files modified during `turn_id` back to their pre-turn state.
    pub fn rollback_turn(&mut self, turn_id: &str) -> Result<usize, std::io::Error> {
        let Some(turn_map) = self.snapshots.remove(turn_id) else {
            return Ok(0);
        };
        let mut reverted = 0;
        for (path, original) in turn_map {
            match original {
                Some(bytes) => {
                    if let Some(parent) = path.parent() {
                        std::fs::create_dir_all(parent)?;
                    }
                    std::fs::write(&path, bytes)?;
                }
                None => {
                    if path.exists() {
                        std::fs::remove_file(&path)?;
                    }
                }
            }
            reverted += 1;
        }
        Ok(reverted)
    }

    /// Discards snapshot data for a turn once no longer needed.
    pub fn clear_turn(&mut self, turn_id: &str) {
        self.snapshots.remove(turn_id);
    }
}

#[cfg(test)]
mod tests {
    use super::TurnSnapshotManager;

    #[test]
    fn restores_modified_and_deletes_created_files() {
        let dir = std::env::temp_dir().join("kai_snapshot_test");
        let _ = std::fs::create_dir_all(&dir);
        let existing = dir.join("existing.txt");
        let created = dir.join("created.txt");
        std::fs::write(&existing, b"before").unwrap();
        let _ = std::fs::remove_file(&created);

        let mut mgr = TurnSnapshotManager::new();
        mgr.capture_before_write("t1", &existing);
        mgr.capture_before_write("t1", &created);

        std::fs::write(&existing, b"after").unwrap();
        std::fs::write(&created, b"new").unwrap();

        let count = mgr.rollback_turn("t1").unwrap();
        assert_eq!(count, 2);
        assert_eq!(std::fs::read_to_string(&existing).unwrap(), "before");
        assert!(!created.exists());
        let _ = std::fs::remove_dir_all(&dir);
    }
}

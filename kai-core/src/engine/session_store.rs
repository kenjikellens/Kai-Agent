use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use async_trait::async_trait;
use tokio::sync::RwLock;

use crate::traits::session_storage::{ChatSessionRecord, SessionStorage, StorageError};

/// Async disk-backed JSON implementation of `SessionStorage` using atomic temp-file writes.
pub struct FileSessionStorage {
    path: PathBuf,
}

impl FileSessionStorage {
    /// Creates a `FileSessionStorage` storing sessions at `app_data_dir/sessions.json`.
    pub fn new(app_data_dir: PathBuf) -> Self {
        Self {
            path: app_data_dir.join("sessions.json"),
        }
    }
}

#[async_trait]
impl SessionStorage for FileSessionStorage {
    async fn load(&self) -> Result<HashMap<String, ChatSessionRecord>, StorageError> {
        if !self.path.exists() {
            return Ok(HashMap::new());
        }
        let raw = tokio::fs::read_to_string(&self.path).await?;
        serde_json::from_str(&raw).map_err(StorageError::Json)
    }

    async fn save(&self, sessions: &HashMap<String, ChatSessionRecord>) -> Result<(), StorageError> {
        if let Some(parent) = self.path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        let tmp = self.path.with_extension("json.tmp");
        let payload = serde_json::to_string_pretty(sessions)?;
        tokio::fs::write(&tmp, payload).await?;
        tokio::fs::rename(&tmp, &self.path).await?;
        Ok(())
    }
}

/// Async, lazily-hydrated in-memory cached session repository delegating to `SessionStorage`.
pub struct SessionStore {
    storage: Arc<dyn SessionStorage>,
    cache: RwLock<Option<HashMap<String, ChatSessionRecord>>>,
}

impl SessionStore {
    /// Creates a `SessionStore` that loads persisted sessions on first async access.
    pub fn new(storage: Arc<dyn SessionStorage>) -> Self {
        Self {
            storage,
            cache: RwLock::new(None),
        }
    }

    async fn ensure_loaded(&self) {
        if self.cache.read().await.is_some() {
            return;
        }
        let loaded = self.storage.load().await.unwrap_or_default();
        let mut guard = self.cache.write().await;
        if guard.is_none() {
            *guard = Some(loaded);
        }
    }

    /// Returns all sessions sorted by `timestamp` descending.
    pub async fn list_sessions(&self) -> Vec<ChatSessionRecord> {
        self.ensure_loaded().await;
        let guard = self.cache.read().await;
        let mut items: Vec<_> = guard
            .as_ref()
            .map(|m| m.values().cloned().collect())
            .unwrap_or_default();
        items.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
        items
    }

    /// Retrieves a single session by ID.
    pub async fn get_session(&self, id: &str) -> Option<ChatSessionRecord> {
        self.ensure_loaded().await;
        self.cache
            .read()
            .await
            .as_ref()
            .and_then(|m| m.get(id).cloned())
    }

    /// Inserts or updates a session and flushes to storage.
    pub async fn upsert_session(&self, record: ChatSessionRecord) -> Result<(), StorageError> {
        self.ensure_loaded().await;
        let snapshot = {
            let mut guard = self.cache.write().await;
            let map = guard.get_or_insert_with(HashMap::new);
            map.insert(record.id.clone(), record);
            map.clone()
        };
        self.storage.save(&snapshot).await
    }

    /// Deletes a session by ID and persists the change.
    pub async fn delete_session(&self, id: &str) -> Result<(), StorageError> {
        self.ensure_loaded().await;
        let snapshot = {
            let mut guard = self.cache.write().await;
            let map = guard.get_or_insert_with(HashMap::new);
            map.remove(id);
            map.clone()
        };
        self.storage.save(&snapshot).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct MemoryStorage;
    #[async_trait]
    impl SessionStorage for MemoryStorage {
        async fn load(&self) -> Result<HashMap<String, ChatSessionRecord>, StorageError> {
            Ok(HashMap::new())
        }
        async fn save(
            &self,
            _sessions: &HashMap<String, ChatSessionRecord>,
        ) -> Result<(), StorageError> {
            Ok(())
        }
    }

    #[tokio::test]
    async fn upserts_and_deletes_sessions() {
        let store = SessionStore::new(Arc::new(MemoryStorage));
        store
            .upsert_session(ChatSessionRecord {
                id: "s1".to_string(),
                title: "Test".to_string(),
                messages: vec![],
                ui_events: None,
                workspace_path: None,
                mode: "ask".to_string(),
                model: "gemini-3.5-flash".to_string(),
                thinking: false,
                timestamp: 100,
            })
            .await
            .unwrap();
        assert_eq!(store.list_sessions().await.len(), 1);
        store.delete_session("s1").await.unwrap();
        assert!(store.list_sessions().await.is_empty());
    }
}

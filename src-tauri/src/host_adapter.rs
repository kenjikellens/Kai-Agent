use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;

use async_trait::async_trait;
use kai_core::engine::agent_executor::ExecutorEventSink;
use kai_core::traits::host_services::{AskUserRequest, HostError, HostServices};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tokio::sync::{oneshot, Mutex};
use uuid::Uuid;

/// Tauri v2 adapter implementing `HostServices` and `ExecutorEventSink`.
pub struct TauriHostServices {
    app: AppHandle,
    pending_prompts: Arc<Mutex<HashMap<String, oneshot::Sender<String>>>>,
}

impl TauriHostServices {
    /// Creates a new `TauriHostServices` bound to the Tauri `AppHandle`.
    pub fn new(app: AppHandle) -> Self {
        Self {
            app,
            pending_prompts: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Resolves a pending `ask_user` or `request_command_approval` prompt from the frontend.
    pub async fn resolve_prompt(&self, request_id: &str, response: String) {
        if let Some(tx) = self.pending_prompts.lock().await.remove(request_id) {
            let _ = tx.send(response);
        }
    }
}

impl ExecutorEventSink for TauriHostServices {
    fn emit_event(&self, event_type: &str, payload: Value) {
        let mut envelope = json!({ "type": event_type });
        if let (Some(obj), Some(extra)) = (envelope.as_object_mut(), payload.as_object()) {
            for (k, v) in extra {
                obj.insert(k.clone(), v.clone());
            }
        }
        let _ = self.app.emit("kai://ipc", envelope);
    }
}

#[async_trait]
impl HostServices for TauriHostServices {
    async fn ask_user(&self, req: AskUserRequest) -> Result<String, HostError> {
        let request_id = if req.request_id.trim().is_empty() {
            Uuid::new_v4().to_string()
        } else {
            req.request_id
        };
        let (tx, rx) = oneshot::channel();
        self.pending_prompts
            .lock()
            .await
            .insert(request_id.clone(), tx);

        self.emit_event(
            "ask_user_request",
            json!({
                "requestId": request_id,
                "question": req.question,
                "options": req.options,
                "allowCustom": req.allow_custom,
            }),
        );

        rx.await
            .map_err(|_| HostError::Unavailable("User prompt was cancelled.".to_string()))
    }

    async fn request_command_approval(&self, command: &str) -> Result<bool, HostError> {
        let request_id = Uuid::new_v4().to_string();
        let (tx, rx) = oneshot::channel();
        self.pending_prompts
            .lock()
            .await
            .insert(request_id.clone(), tx);

        self.emit_event(
            "command_approval_request",
            json!({
                "requestId": request_id,
                "command": command,
            }),
        );

        let reply = rx
            .await
            .map_err(|_| HostError::Unavailable("Approval request cancelled.".to_string()))?;
        Ok(reply.eq_ignore_ascii_case("approved") || reply.eq_ignore_ascii_case("true"))
    }

    async fn get_diagnostics(&self, _file_path: Option<&Path>) -> String {
        "Standalone Tauri mode: IDE diagnostics are not attached.".to_string()
    }

    async fn search_symbols(&self, _query: &str, _workspace_path: &Path) -> String {
        "Standalone Tauri mode: use grep_search for symbol lookup.".to_string()
    }
}

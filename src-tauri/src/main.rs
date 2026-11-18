#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod host_adapter;

use std::path::PathBuf;
use std::sync::Arc;

use kai_core::engine::agent_executor::AgentExecutor;
use kai_core::engine::config_manager::{ConfigManager, KaiConfig};
use kai_core::engine::session_store::{FileSessionStorage, SessionStore};
use kai_core::engine::snapshot_manager::TurnSnapshotManager;
use tauri::Manager;
use tokio::sync::{Mutex, RwLock};
use tokio::task::JoinHandle;

use crate::host_adapter::TauriHostServices;

/// Shared application state managed by Tauri and injected into IPC commands.
pub struct AppRuntimeState {
    pub workspace_path: RwLock<PathBuf>,
    pub config: RwLock<KaiConfig>,
    pub config_manager: ConfigManager,
    pub session_store: Arc<SessionStore>,
    pub snapshots: Arc<Mutex<TurnSnapshotManager>>,
    pub active_turn: Mutex<Option<JoinHandle<()>>>,
    pub executor: Arc<AgentExecutor>,
    pub host_services: Arc<TauriHostServices>,
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| std::env::temp_dir().join("kai-agent"));
            let config_manager = ConfigManager::new(data_dir.clone());
            let initial_cfg = config_manager.load();
            let session_store = Arc::new(SessionStore::new(Arc::new(FileSessionStorage::new(
                data_dir,
            ))));

            let state = AppRuntimeState {
                workspace_path: RwLock::new(PathBuf::new()),
                config: RwLock::new(initial_cfg),
                config_manager,
                session_store,
                snapshots: Arc::new(Mutex::new(TurnSnapshotManager::new())),
                active_turn: Mutex::new(None),
                executor: Arc::new(AgentExecutor::new()),
                host_services: Arc::new(TauriHostServices::new(app.handle().clone())),
            };
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::kai_post_message,
            commands::kai_resolve_prompt_response,
            commands::kai_pick_workspace_folder,
            commands::kai_pick_lm_studio_folder,
        ])
        .run(tauri::generate_context!())
        .expect("error while running KAI Agent Tauri shell");
}

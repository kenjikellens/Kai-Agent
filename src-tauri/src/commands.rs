use std::path::PathBuf;
use std::sync::Arc;

use kai_core::engine::agent_executor::ExecutorEventSink;
use kai_core::engine::config_manager::KaiConfig;
use kai_core::providers::factory::ProviderFactory;
use kai_core::providers::gemini::GeminiProvider;
use kai_core::providers::lm_studio::{build_cache_status_payload, LMStudioProvider};
use kai_core::tools::path_guard::WorkspacePathGuard;
use kai_core::traits::llm_provider::{ChatMessage, LlmProvider};
use kai_core::traits::session_storage::ChatSessionRecord;
use serde_json::{json, Value};
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use url::Url;

use crate::AppRuntimeState;

const MAX_PICKED_FILE_BYTES: u64 = 15 * 1024 * 1024;
const BLOCKED_OPEN_EXTS: &[&str] = &["exe", "bat", "cmd", "ps1", "vbs", "msi", "com", "scr"];

/// Dispatches renderer IPC messages from `WebviewIPCBridge.js` to `kai-core` and Tauri native APIs.
#[tauri::command]
pub async fn kai_post_message(
    app: AppHandle,
    state: State<'_, AppRuntimeState>,
    message: Value,
) -> Result<(), String> {
    let msg_type = message
        .get("type")
        .and_then(|v| v.as_str())
        .unwrap_or_default();

    match msg_type {
        "ask_user_response" => {
            if let Some(req_id) = message.get("requestId").and_then(|v| v.as_str()) {
                let answer = message
                    .get("answer")
                    .and_then(|v| v.as_str())
                    .unwrap_or("User did not answer")
                    .to_string();
                state.host_services.resolve_prompt(req_id, answer).await;
            }
        }
        "command_approval_response" => {
            if let Some(req_id) = message.get("requestId").and_then(|v| v.as_str()) {
                let allowed = message
                    .get("allowed")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                let reply = if allowed { "approved" } else { "denied" }.to_string();
                state.host_services.resolve_prompt(req_id, reply).await;
            }
        }
        "abort" => {
            if let Some(handle) = state.active_turn.lock().await.take() {
                handle.abort();
            }
        }
        "setWorkspace" => {
            let path = message
                .get("workspacePath")
                .or_else(|| message.get("path"))
                .and_then(|v| v.as_str())
                .unwrap_or_default();
            *state.workspace_path.write().await = PathBuf::from(path);
        }
        "browseWorkspaceFolder" => {
            if let Some(folder) = app.dialog().file().blocking_pick_folder() {
                let path_str = folder.to_string();
                *state.workspace_path.write().await = PathBuf::from(&path_str);
                emit_full_connection_status(&state, true).await;
            }
        }
        "browseLMStudioFolder" => {
            if let Some(folder) = app.dialog().file().blocking_pick_folder() {
                let path_str = folder.to_string();
                {
                    let mut cfg = state.config.write().await;
                    cfg.lm_studio_cache_dir = path_str;
                    let _ = state.config_manager.save(&cfg);
                }
                emit_full_connection_status(&state, false).await;
            }
        }
        "openFilePicker" => {
            let picked = app.dialog().file().blocking_pick_files();
            if let Some(paths) = picked {
                let mut files = Vec::new();
                for fp in paths {
                    let path_buf = PathBuf::from(fp.to_string());
                    let Ok(meta) = tokio::fs::metadata(&path_buf).await else {
                        continue;
                    };
                    if meta.len() > MAX_PICKED_FILE_BYTES {
                        continue;
                    }
                    let file_name = path_buf
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("file")
                        .to_string();
                    let ext = path_buf
                        .extension()
                        .and_then(|e| e.to_str())
                        .unwrap_or("")
                        .to_ascii_lowercase();
                    let is_image = matches!(ext.as_str(), "png" | "jpg" | "jpeg" | "webp" | "gif");
                    let content = if is_image {
                        match tokio::fs::read(&path_buf).await {
                            Ok(bytes) => {
                                let mime = if ext == "jpg" { "jpeg" } else { ext.as_str() };
                                format!("data:image/{mime};base64,{}", encode_base64(&bytes))
                            }
                            Err(_) => continue,
                        }
                    } else {
                        tokio::fs::read_to_string(&path_buf).await.unwrap_or_default()
                    };
                    files.push(json!({
                        "fileName": file_name,
                        "filePath": fp.to_string(),
                        "relativePath": file_name,
                        "content": content,
                        "isImage": is_image,
                    }));
                }
                if !files.is_empty() {
                    state
                        .host_services
                        .emit_event("filesSelected", json!({ "files": files }));
                }
            }
        }
        "checkConnection" => {
            emit_full_connection_status(&state, false).await;
        }
        "updateSettings" | "saveSettings" => {
            let cfg_snapshot = {
                let mut cfg = state.config.write().await;
                apply_settings_updates(&mut cfg, &message);
                cfg.clone()
            };
            let cm = state.config_manager.clone();
            tokio::task::spawn_blocking(move || cm.save(&cfg_snapshot))
                .await
                .map_err(|e| e.to_string())?
                .map_err(|e| e.to_string())?;
            emit_full_connection_status(&state, false).await;
        }
        "testProviderConnection" => {
            let config_key = message
                .get("configKey")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            let api_key = message
                .get("apiKey")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            let cfg = state.config.read().await.clone();
            let success = ProviderFactory::validate_provider(&config_key, &api_key, &cfg).await;
            state.host_services.emit_event(
                "providerTestResult",
                json!({ "configKey": config_key, "success": success }),
            );
        }
        "switchLMStudioModel" => {
            let model_id = message
                .get("model")
                .and_then(|v| v.as_str())
                .unwrap_or_default();
            let (server_url, cache_dir) = {
                let cfg = state.config.read().await;
                (cfg.server_url.clone(), cfg.lm_studio_cache_dir.clone())
            };
            LMStudioProvider::with_cache_dir(&server_url, &cache_dir)
                .ensure_single_loaded_model(model_id)
                .await;
            emit_full_connection_status(&state, false).await;
        }
        "loadChatHistory" | "loadSessions" => {
            let chats = state.session_store.list_sessions().await;
            state
                .host_services
                .emit_event("chatHistory", json!({ "chats": chats }));
        }
        "loadChat" => {
            if let Some(id) = message.get("chatId").and_then(|v| v.as_str()) {
                if let Some(chat) = state.session_store.get_session(id).await {
                    state
                        .host_services
                        .emit_event("loadChat", json!({ "chat": chat }));
                }
            }
        }
        "saveChat" => {
            if let Some(chat_val) = message.get("chat") {
                if let Ok(record) = serde_json::from_value::<ChatSessionRecord>(chat_val.clone()) {
                    state
                        .session_store
                        .upsert_session(record)
                        .await
                        .map_err(|e| e.to_string())?;
                    let chats = state.session_store.list_sessions().await;
                    state
                        .host_services
                        .emit_event("chatHistory", json!({ "chats": chats }));
                }
            }
        }
        "deleteChat" | "deleteSession" => {
            if let Some(id) = message
                .get("chatId")
                .or_else(|| message.get("sessionId"))
                .and_then(|v| v.as_str())
            {
                state.snapshots.lock().await.clear_turn(id);
                state
                    .session_store
                    .delete_session(id)
                    .await
                    .map_err(|e| e.to_string())?;
                let chats = state.session_store.list_sessions().await;
                state
                    .host_services
                    .emit_event("chatHistory", json!({ "chats": chats }));
            }
        }
        "rollbackTurn" => {
            let mut ids: Vec<String> = Vec::new();
            if let Some(arr) = message.get("turnIds").and_then(|v| v.as_array()) {
                for item in arr {
                    if let Some(s) = item.as_str() {
                        ids.push(s.to_string());
                    }
                }
            } else if let Some(cid) = message.get("chatId").and_then(|v| v.as_str()) {
                ids.push(cid.to_string());
            }
            let mut guard = state.snapshots.lock().await;
            for id in ids {
                let _ = guard.rollback_turn(&id);
            }
        }
        "openFile" => {
            let ws = state.workspace_path.read().await.clone();
            if let Some(raw) = message.get("filePath").and_then(|v| v.as_str()) {
                if let Ok(resolved) = WorkspacePathGuard::resolve_safe_path(&ws, raw, None) {
                    let ext = resolved
                        .extension()
                        .and_then(|e| e.to_str())
                        .unwrap_or("")
                        .to_ascii_lowercase();
                    if resolved.is_file() && !BLOCKED_OPEN_EXTS.contains(&ext.as_str()) {
                        launch_path_without_shell(&resolved.to_string_lossy());
                    }
                }
            }
        }
        "openExternal" | "openExternalUrl" => {
            if let Some(raw_url) = message.get("url").and_then(|v| v.as_str()) {
                if is_safe_http_url(raw_url) {
                    launch_path_without_shell(raw_url);
                }
            }
        }
        "sendMessage" | "submitPrompt" => {
            if let Some(prev) = state.active_turn.lock().await.take() {
                prev.abort();
            }

            let turn_id = message
                .get("chatId")
                .or_else(|| message.get("turnId"))
                .and_then(|v| v.as_str())
                .unwrap_or("turn")
                .to_string();
            let model = message
                .get("model")
                .and_then(|v| v.as_str())
                .unwrap_or("gemini-3.5-flash")
                .to_string();
            let mode = message
                .get("mode")
                .and_then(|v| v.as_str())
                .unwrap_or("ask")
                .to_string();
            let mut history: Vec<ChatMessage> = message
                .get("messages")
                .or_else(|| message.get("history"))
                .and_then(|v| serde_json::from_value(v.clone()).ok())
                .unwrap_or_default();

            if let Some(attached) = message.get("attachedFiles").and_then(|v| v.as_array()) {
                append_attached_files_to_last_user_msg(&mut history, attached);
            }

            let msg_ws = message
                .get("workspacePath")
                .and_then(|v| v.as_str())
                .unwrap_or_default();
            let workspace_path = if msg_ws.trim().is_empty() {
                state.workspace_path.read().await.clone()
            } else {
                PathBuf::from(msg_ws)
            };

            let mut cfg = state.config.read().await.clone();
            if let Some(thinking) = message.get("thinking").and_then(|v| v.as_bool()) {
                cfg.thinking_enabled = thinking;
            }
            if let Some(level) = message.get("geminiThinkingLevel").and_then(|v| v.as_str()) {
                cfg.thinking_level = level.to_string();
            }

            let executor = Arc::clone(&state.executor);
            let host = Arc::clone(&state.host_services);
            let snapshots = Arc::clone(&state.snapshots);
            host.emit_event("typing", json!({ "turnId": turn_id }));

            let handle = tokio::spawn(async move {
                if let Err(err) = executor
                    .run_turn(
                        turn_id.clone(),
                        &model,
                        &mode,
                        workspace_path,
                        history,
                        &cfg,
                        Some(host.clone()),
                        Some(snapshots),
                        host.clone(),
                    )
                    .await
                {
                    host.emit_event("replyError", json!({ "turnId": turn_id, "error": err }));
                }
            });
            *state.active_turn.lock().await = Some(handle);
        }
        _ => {}
    }

    Ok(())
}

/// Resolves an interactive `ask_user` or command approval prompt triggered from `kai-core`.
#[tauri::command]
pub async fn kai_resolve_prompt_response(
    state: State<'_, AppRuntimeState>,
    request_id: String,
    response: String,
) -> Result<(), String> {
    state
        .host_services
        .resolve_prompt(&request_id, response)
        .await;
    Ok(())
}

/// Opens a native OS folder picker and binds the selected workspace folder.
#[tauri::command]
pub async fn kai_pick_workspace_folder(
    app: AppHandle,
    state: State<'_, AppRuntimeState>,
) -> Result<Option<String>, String> {
    let picked = app.dialog().file().blocking_pick_folder();
    if let Some(folder) = picked {
        let path_str = folder.to_string();
        *state.workspace_path.write().await = PathBuf::from(&path_str);
        emit_full_connection_status(&state, true).await;
        return Ok(Some(path_str));
    }
    Ok(None)
}

/// Opens a native OS folder picker for the LM Studio models directory.
#[tauri::command]
pub async fn kai_pick_lm_studio_folder(app: AppHandle) -> Result<Option<String>, String> {
    let picked = app.dialog().file().blocking_pick_folder();
    Ok(picked.map(|p| p.to_string()))
}

/// Queries LM Studio, Gemini, and cloud provider status concurrently and emits `connectionStatus` to the webview.
/// Reuses `geminiApiKey` status from `build_free_providers_status` to avoid duplicate Gemini validation requests.
/// Aggregates live LM Studio, Gemini, cloud provider, and local cache status and emits `connectionStatus` to the renderer.
/// Passes configured `lm_studio_cache_dir` so cross-PC `lms` resolution and auto-start work seamlessly.
async fn emit_full_connection_status(state: &State<'_, AppRuntimeState>, is_folder_picked: bool) {
    let cfg = state.config.read().await.clone();
    let ws = state.workspace_path.read().await.clone();
    let ws_str = ws.to_string_lossy().to_string();
    let ws_name = ws
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(&ws_str)
        .to_string();

    let lm_provider = LMStudioProvider::with_cache_dir(&cfg.server_url, &cfg.lm_studio_cache_dir);
    let gemini_provider = GeminiProvider::new(&cfg.api_key);
    let (lm_res, gemini_res, free_providers) = tokio::join!(
        lm_provider.list_models(),
        gemini_provider.list_models(),
        ProviderFactory::build_free_providers_status(&cfg)
    );

    let lm_connected = lm_res.is_ok();
    let lm_models = match lm_res {
        Ok(models) => models,
        Err(_) => lm_provider.list_local_cli_models().await,
    };
    let lm_cache_status = build_cache_status_payload(&cfg.lm_studio_cache_dir, lm_models.len());
    let gemini_models = gemini_res.unwrap_or_default();
    let gemini_connected = free_providers
        .iter()
        .find(|p| p.get("configKey").and_then(|v| v.as_str()) == Some("geminiApiKey"))
        .and_then(|p| p.get("connected").and_then(|v| v.as_bool()))
        .unwrap_or(false);

    let loaded_models = if lm_connected {
        lm_models.clone()
    } else if gemini_connected {
        gemini_models.clone()
    } else {
        Vec::new()
    };

    let active_model = lm_models
        .first()
        .cloned()
        .or_else(|| {
            if gemini_connected {
                gemini_models.first().cloned()
            } else {
                None
            }
        })
        .unwrap_or_else(|| "local-model".to_string());

    state.host_services.emit_event(
        "connectionStatus",
        json!({
            "connected": lm_connected,
            "geminiConnected": gemini_connected,
            "model": active_model,
            "lmStudioModels": lm_models,
            "geminiModels": gemini_models,
            "loadedModels": loaded_models,
            "freeProviders": free_providers,
            "serverUrl": cfg.server_url,
            "apiKey": cfg.api_key,
            "lmStudioCacheDir": cfg.lm_studio_cache_dir,
            "lmStudioCacheStatus": lm_cache_status,
            "language": cfg.language,
            "workspacePath": ws_str,
            "workspaceName": ws_name,
            "isFolderPicked": is_folder_picked,
        }),
    );
}

fn apply_settings_updates(cfg: &mut KaiConfig, message: &Value) {
    if let Some(v) = message.get("serverUrl").and_then(|v| v.as_str()) {
        cfg.server_url = v.to_string();
    }
    if let Some(v) = message.get("lmStudioCacheDir").and_then(|v| v.as_str()) {
        cfg.lm_studio_cache_dir = v.to_string();
    }
    if let Some(v) = message.get("apiKey").and_then(|v| v.as_str()) {
        cfg.api_key = v.to_string();
    }
    if let Some(v) = message.get("language").and_then(|v| v.as_str()) {
        cfg.language = v.to_string();
    }
    if let Some(keys) = message.get("providerKeys").and_then(|v| v.as_object()) {
        for (k, val) in keys {
            if let Some(s) = val.as_str() {
                set_provider_key(cfg, k, s);
            }
        }
    }
    if let Some(arr) = message.get("freeProviders").and_then(|v| v.as_array()) {
        for item in arr {
            if let (Some(k), Some(s)) = (
                item.get("configKey").and_then(|v| v.as_str()),
                item.get("apiKey").and_then(|v| v.as_str()),
            ) {
                set_provider_key(cfg, k, s);
            }
        }
    }
}

fn set_provider_key(cfg: &mut KaiConfig, config_key: &str, value: &str) {
    match config_key {
        "geminiApiKey" => cfg.api_key = value.to_string(),
        "openrouterApiKey" => cfg.openrouter_api_key = value.to_string(),
        "mistralApiKey" => cfg.mistral_api_key = value.to_string(),
        "cohereApiKey" => cfg.cohere_api_key = value.to_string(),
        "cerebrasApiKey" => cfg.cerebras_api_key = value.to_string(),
        "zhipuApiKey" => cfg.zhipu_api_key = value.to_string(),
        "omnirouteApiKey" => cfg.omniroute_api_key = value.to_string(),
        _ => {}
    }
}

fn append_attached_files_to_last_user_msg(history: &mut [ChatMessage], attached: &[Value]) {
    let Some(last) = history.iter_mut().rev().find(|m| m.role == "user") else {
        return;
    };
    for file in attached {
        if file.get("isImage").and_then(|v| v.as_bool()) == Some(true) {
            continue;
        }
        let name = file
            .get("fileName")
            .and_then(|v| v.as_str())
            .unwrap_or("attachment");
        if let Some(content) = file.get("content").and_then(|v| v.as_str()) {
            last.content.push_str(&format!("\n\n[Attached File: {name}]\n{content}"));
        }
    }
}

fn is_safe_http_url(raw: &str) -> bool {
    Url::parse(raw)
        .map(|u| u.scheme() == "http" || u.scheme() == "https")
        .unwrap_or(false)
}

fn launch_path_without_shell(target: &str) {
    #[cfg(target_os = "windows")]
    let _ = std::process::Command::new("rundll32.exe")
        .args(["url.dll,FileProtocolHandler", target])
        .spawn();
    #[cfg(target_os = "macos")]
    let _ = std::process::Command::new("open").arg(target).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let _ = std::process::Command::new("xdg-open").arg(target).spawn();
}

fn encode_base64(input: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(input.len().div_ceil(3) * 4);
    for chunk in input.chunks(3) {
        let b0 = chunk[0] as usize;
        let b1 = *chunk.get(1).unwrap_or(&0) as usize;
        let b2 = *chunk.get(2).unwrap_or(&0) as usize;
        out.push(TABLE[b0 >> 2] as char);
        out.push(TABLE[((b0 & 0x03) << 4) | (b1 >> 4)] as char);
        out.push(if chunk.len() > 1 {
            TABLE[((b1 & 0x0f) << 2) | (b2 >> 6)] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            TABLE[b2 & 0x3f] as char
        } else {
            '='
        });
    }
    out
}

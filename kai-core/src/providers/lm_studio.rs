use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use async_trait::async_trait;
use futures_util::future::join_all;
use serde_json::{json, Value};
use tokio::process::Command;
use tokio::sync::Mutex;
use url::Url;

use super::openai_compat::OpenAiCompatClient;
use super::shared_validation_client;
use crate::traits::{ChatRequest, CompletionResult, LlmProvider, ProviderError, StreamSink};

const DEFAULT_LMSTUDIO_URL: &str = "http://127.0.0.1:1234/v1";
const AUTO_START_COOLDOWN: Duration = Duration::from_secs(60);
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

static LAST_AUTO_START: OnceLock<Mutex<Option<Instant>>> = OnceLock::new();

/// Normalizes an LM Studio server URL by ensuring scheme presence and defaulting empty paths to `/v1`.
/// Ensures `/models` and `/chat/completions` requests reach valid LM Studio API routes.
pub fn normalize_lmstudio_base_url(server_url: &str) -> String {
    let mut raw = server_url.trim().trim_end_matches('/').to_string();
    if raw.is_empty() {
        return DEFAULT_LMSTUDIO_URL.to_string();
    }
    if !raw.starts_with("http://") && !raw.starts_with("https://") {
        raw = format!("http://{raw}");
    }
    if let Ok(mut parsed) = Url::parse(&raw) {
        let path = parsed.path().trim_end_matches('/').to_string();
        if path.is_empty() {
            parsed.set_path("/v1");
        } else {
            parsed.set_path(&path);
        }
        return parsed.to_string().trim_end_matches('/').to_string();
    }
    raw
}

/// Extracts the TCP port from an LM Studio server URL, defaulting to `1234`.
/// Used when auto-starting the local LM Studio API server via `lms server start --port`.
pub fn extract_server_port(server_url: &str) -> u16 {
    let normalized = normalize_lmstudio_base_url(server_url);
    Url::parse(&normalized)
        .ok()
        .and_then(|u| u.port())
        .unwrap_or(1234)
}

/// Returns `true` if `model_id` represents a chat/text LLM rather than an embedding-only model.
/// Prevents embedding models from appearing as selectable chat targets in the UI dropdown.
pub fn is_chat_model_id(model_id: &str) -> bool {
    let lower = model_id.to_ascii_lowercase();
    !(lower.contains("embed")
        || lower.starts_with("bge-")
        || lower.contains("/bge-")
        || lower.starts_with("e5-")
        || lower.contains("/e5-")
        || lower.starts_with("gte-")
        || lower.contains("/gte-"))
}

/// Resolves the current user's home directory portably via `USERPROFILE` (Windows) or `HOME` (Unix).
/// Avoids hardcoded user paths or extra crate dependencies when locating LM Studio directories.
fn user_home_dir() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
}

/// Resolves the LM Studio CLI executable path across custom cache dirs, `~/.lmstudio`, `~/.cache/lm-studio`, and `PATH`.
/// Ensures cross-PC and cross-OS portability even when `lms` is not registered on the global system `PATH`.
pub fn resolve_lms_executable(custom_cache_dir: &str) -> PathBuf {
    let exe_name = if cfg!(windows) { "lms.exe" } else { "lms" };
    let mut candidates = Vec::new();

    let trimmed = custom_cache_dir.trim();
    if !trimmed.is_empty() {
        let custom = PathBuf::from(trimmed);
        if custom.is_file() {
            return custom;
        }
        candidates.push(custom.join("bin").join(exe_name));
        candidates.push(custom.join(exe_name));
    }

    if let Some(home) = user_home_dir() {
        candidates.push(home.join(".lmstudio").join("bin").join(exe_name));
        candidates.push(
            home.join(".cache")
                .join("lm-studio")
                .join("bin")
                .join(exe_name),
        );
    }

    #[cfg(windows)]
    if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
        candidates.push(
            PathBuf::from(local_app_data)
                .join("LM-Studio")
                .join("resources")
                .join("app")
                .join(".webpack")
                .join(exe_name),
        );
    }

    for candidate in candidates {
        if candidate.is_file() {
            return candidate;
        }
    }

    PathBuf::from(exe_name)
}

/// Returns an ordered list of candidate LM Studio home/cache directories across PCs and OS layouts.
/// Checks custom configured paths first, followed by `~/.cache/lm-studio`, `~/.lmstudio`, and Windows AppData folders.
pub fn candidate_lmstudio_cache_dirs(custom_cache_dir: &str) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    let trimmed = custom_cache_dir.trim();
    if !trimmed.is_empty() {
        candidates.push(PathBuf::from(trimmed));
    }
    if let Some(home) = user_home_dir() {
        candidates.push(home.join(".cache").join("lm-studio"));
        candidates.push(home.join(".lmstudio"));
    }
    #[cfg(windows)]
    {
        if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
            candidates.push(PathBuf::from(&local_app_data).join("LM Studio"));
            candidates.push(PathBuf::from(local_app_data).join("lm-studio"));
        }
        if let Some(app_data) = std::env::var_os("APPDATA") {
            candidates.push(PathBuf::from(app_data).join("LM Studio"));
        }
    }
    candidates
}

/// Resolves the `model-index-cache.json` path inside a candidate LM Studio directory or direct file path.
/// Handles root cache dirs, `.internal` subdirectories, and direct JSON file selections.
fn index_cache_path_for(candidate: &Path) -> PathBuf {
    if candidate
        .file_name()
        .and_then(|n| n.to_str())
        .is_some_and(|n| n.eq_ignore_ascii_case("model-index-cache.json"))
    {
        return candidate.to_path_buf();
    }
    if candidate
        .file_name()
        .and_then(|n| n.to_str())
        .is_some_and(|n| n.eq_ignore_ascii_case(".internal"))
    {
        return candidate.join("model-index-cache.json");
    }
    candidate.join(".internal").join("model-index-cache.json")
}

/// Resolves the existing LM Studio home/cache directory, preferring one containing `model-index-cache.json`.
/// Returns the first matching directory path so capability parsing and cache status work across PCs.
pub fn resolve_lmstudio_cache_dir(custom_cache_dir: &str) -> Option<PathBuf> {
    let candidates = candidate_lmstudio_cache_dirs(custom_cache_dir);
    for candidate in &candidates {
        if index_cache_path_for(candidate).is_file() {
            return Some(candidate.clone());
        }
    }
    candidates.into_iter().find(|c| c.exists())
}

/// Inserts a capability payload into `out` under exact, lowercase, and basename aliases.
/// Matches how `ModelDropdownController.js` and `ThinkingStateFormatter.js` look up model metadata.
fn insert_capability_aliases(
    out: &mut serde_json::Map<String, Value>,
    aliases: &[String],
    cap: &Value,
) {
    for alias in aliases {
        let trimmed = alias.trim();
        if trimmed.is_empty() {
            continue;
        }
        out.insert(trimmed.to_string(), cap.clone());
        out.insert(trimmed.to_ascii_lowercase(), cap.clone());
        if let Some((_, sub)) = trimmed.rsplit_once('/') {
            if !sub.is_empty() {
                out.insert(sub.to_string(), cap.clone());
                out.insert(sub.to_ascii_lowercase(), cap.clone());
            }
        }
    }
}

/// Parses LM Studio `model-index-cache.json` bytes into the capability map expected by the renderer UI.
/// Extracts `sizeBytes`, `mtime`, `isReasoning`, and manifest `fields` indexed by all model aliases.
pub fn parse_index_cache_capabilities_bytes(raw: &[u8]) -> serde_json::Map<String, Value> {
    let mut out = serde_json::Map::new();
    let Ok(data) = serde_json::from_slice::<Value>(raw) else {
        return out;
    };
    let Some(models) = data.get("models").and_then(Value::as_array) else {
        return out;
    };

    for entry in models {
        let domain = entry["domain"].as_str().unwrap_or("llm");
        let model_id = entry["indexedModelIdentifier"].as_str().unwrap_or_default();
        let display_name = entry["displayName"]
            .as_str()
            .filter(|s| !s.is_empty())
            .unwrap_or(model_id);
        let is_reasoning_flag = entry["virtual"]["metadataOverridesReasoning"]
            .as_bool()
            .unwrap_or(false);

        let mut fields = Vec::new();
        if let Some(raw_fields) = entry["virtual"]["customFieldDefinitions"].as_array() {
            for cf in raw_fields {
                let field_type = if cf["type"].as_str() == Some("select") {
                    "select"
                } else {
                    "boolean"
                };
                let variable = cf["effects"]
                    .as_array()
                    .and_then(|arr| arr.first())
                    .and_then(|e| e["variable"].as_str())
                    .unwrap_or_default();
                let key = cf["key"].as_str().unwrap_or_default();

                if variable.is_empty()
                    || variable == "preserve_thinking"
                    || variable == "preserveThinking"
                    || key.contains("preserveThinking")
                {
                    continue;
                }

                let default_val = if !cf["defaultValue"].is_null() {
                    cf["defaultValue"].clone()
                } else if field_type == "boolean" {
                    Value::Bool(true)
                } else {
                    Value::String("xhigh".to_string())
                };

                let mut field_obj = json!({
                    "displayName": cf["displayName"].as_str().unwrap_or(variable),
                    "type": field_type,
                    "variable": variable,
                    "defaultValue": default_val,
                });

                if field_type == "select" {
                    if let Some(opts) = cf["options"].as_array() {
                        let mapped: Vec<Value> = opts
                            .iter()
                            .map(|opt| {
                                let label = opt["label"]
                                    .as_str()
                                    .or_else(|| opt["value"].as_str())
                                    .unwrap_or_default();
                                let value = opt["value"]
                                    .as_str()
                                    .or_else(|| opt["label"].as_str())
                                    .unwrap_or_default();
                                json!({ "label": label, "value": value })
                            })
                            .collect();
                        field_obj["options"] = Value::Array(mapped);
                    }
                }
                fields.push(field_obj);
            }
        }

        let mut aliases: Vec<String> = [
            entry["indexedModelIdentifier"].as_str(),
            entry["defaultIdentifier"].as_str(),
            entry["originalIndexedModelIdentifier"].as_str(),
            entry["altIndexedModelIdentifier"].as_str(),
            entry["displayName"].as_str(),
            entry["virtual"]["concreteModelIndexedModelIdentifier"].as_str(),
        ]
        .into_iter()
        .flatten()
        .filter(|s| !s.is_empty())
        .map(String::from)
        .collect();

        if let Some(opts) = entry["virtual"]["concreteModelOptions"].as_array() {
            for opt in opts {
                if let Some(s) = opt.as_str() {
                    if !s.is_empty() {
                        aliases.push(s.to_string());
                    }
                }
            }
        }
        if let Some((base, _)) = model_id.split_once('@') {
            if !base.is_empty() {
                aliases.push(base.to_string());
            }
        }
        if let Some(def_id) = entry["defaultIdentifier"].as_str() {
            if let Some((base, _)) = def_id.split_once('@') {
                if !base.is_empty() {
                    aliases.push(base.to_string());
                }
            }
        }

        let size_bytes = entry["sizeBytes"].as_u64().unwrap_or(0);
        let mtime = entry["containingDirMtime"].as_u64().unwrap_or(0);
        let cap = json!({
            "modelId": model_id,
            "displayName": display_name,
            "domain": domain,
            "fields": fields,
            "isReasoning": is_reasoning_flag || !fields.is_empty(),
            "sizeBytes": size_bytes,
            "mtime": mtime,
        });

        insert_capability_aliases(&mut out, &aliases, &cap);
    }

    out
}

/// Reads and parses LM Studio's `model-index-cache.json` from the resolved local cache directory.
/// Supplies `sizeBytes`, `mtime`, and reasoning capability metadata for UI sorting and tooltips.
pub fn parse_lmstudio_capabilities(custom_cache_dir: &str) -> serde_json::Map<String, Value> {
    let Some(cache_dir) = resolve_lmstudio_cache_dir(custom_cache_dir) else {
        return serde_json::Map::new();
    };
    let index_path = index_cache_path_for(&cache_dir);
    let Ok(bytes) = std::fs::read(&index_path) else {
        return serde_json::Map::new();
    };
    parse_index_cache_capabilities_bytes(&bytes)
}

/// Merges `lms ls --json` entries into `caps` for any model missing from `model-index-cache.json`.
/// Ensures size sorting still works on PCs whose LM Studio version stores index metadata elsewhere.
pub fn merge_cli_model_capabilities(
    caps: &mut serde_json::Map<String, Value>,
    cli_json: &[u8],
) {
    let Ok(Value::Array(items)) = serde_json::from_slice::<Value>(cli_json) else {
        return;
    };
    for item in items {
        if item["type"].as_str() != Some("llm") {
            continue;
        }
        let model_key = item["modelKey"].as_str().unwrap_or_default();
        if model_key.is_empty() || !is_chat_model_id(model_key) {
            continue;
        }
        let existing_size = caps
            .get(model_key)
            .or_else(|| caps.get(&model_key.to_ascii_lowercase()))
            .and_then(|v| v["sizeBytes"].as_u64())
            .unwrap_or(0);
        if existing_size > 0 {
            continue;
        }
        let size_bytes = item["sizeBytes"].as_u64().unwrap_or(0);
        let display_name = item["displayName"].as_str().unwrap_or(model_key);
        let mut aliases: Vec<String> = [
            Some(model_key),
            item["indexedModelIdentifier"].as_str(),
            item["selectedVariant"].as_str(),
            item["displayName"].as_str(),
        ]
        .into_iter()
        .flatten()
        .filter(|s| !s.is_empty())
        .map(String::from)
        .collect();
        if let Some(variants) = item["variants"].as_array() {
            for v in variants {
                if let Some(s) = v.as_str() {
                    if !s.is_empty() {
                        aliases.push(s.to_string());
                    }
                }
            }
        }
        let cap = json!({
            "modelId": model_key,
            "displayName": display_name,
            "domain": "llm",
            "fields": [],
            "isReasoning": false,
            "sizeBytes": size_bytes,
            "mtime": 0,
        });
        insert_capability_aliases(caps, &aliases, &cap);
    }
}

/// Builds a hidden `tokio::process::Command` for the resolved `lms` CLI executable.
/// Suppresses console window flashes on Windows using `CREATE_NO_WINDOW`.
fn build_lms_command(custom_cache_dir: &str) -> Command {
    let exe = resolve_lms_executable(custom_cache_dir);
    let mut cmd = Command::new(exe);
    #[cfg(windows)]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// Builds deduplicated `/models` probe URLs across `/v1`, `/api/v0`, and root paths with `127.0.0.1`/`localhost` fallbacks.
/// Ensures model detection succeeds whether LM Studio exposes OpenAI v1 or native v0 endpoints.
pub fn build_model_probe_urls(server_url: &str) -> Vec<String> {
    let normalized = normalize_lmstudio_base_url(server_url);
    let mut urls = Vec::new();
    let mut seen = HashSet::new();

    let mut push_unique = |candidate: String| {
        if seen.insert(candidate.clone()) {
            urls.push(candidate);
        }
    };

    if let Ok(parsed) = Url::parse(&normalized) {
        let scheme = parsed.scheme();
        let host = parsed.host_str().unwrap_or("127.0.0.1");
        let port = parsed.port().unwrap_or(1234);
        let path_prefix = parsed.path().trim_end_matches('/');
        let alt_host = match host {
            "localhost" => "127.0.0.1",
            "127.0.0.1" => "localhost",
            other => other,
        };

        for h in [host, alt_host] {
            if !path_prefix.is_empty() {
                push_unique(format!("{scheme}://{h}:{port}{path_prefix}/models"));
            }
            push_unique(format!("{scheme}://{h}:{port}/v1/models"));
            push_unique(format!("{scheme}://{h}:{port}/api/v0/models"));
            push_unique(format!("{scheme}://{h}:{port}/models"));
        }
    } else {
        push_unique(format!("{normalized}/models"));
    }

    urls
}

/// Probes a single LM Studio `/models` endpoint with a short timeout and returns parsed chat model identifiers.
/// Keeps startup status checks responsive when the local LM Studio server is offline or only serves one path.
async fn probe_models_url(url: String) -> Result<Vec<String>, ProviderError> {
    let resp = tokio::time::timeout(
        Duration::from_millis(1500),
        shared_validation_client().get(&url).send(),
    )
    .await
    .map_err(|_| ProviderError::ApiStatus {
        status: 504,
        body: "LM Studio probe timed out".to_string(),
    })??;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let body = resp.text().await.unwrap_or_default();
        return Err(ProviderError::ApiStatus { status, body });
    }

    let parsed: Value = resp.json().await?;
    let ids = parsed["data"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|m| m["id"].as_str().or_else(|| m["name"].as_str()))
                .map(str::trim)
                .filter(|id| !id.is_empty() && is_chat_model_id(id))
                .map(String::from)
                .collect()
        })
        .unwrap_or_default();
    Ok(ids)
}

/// Validates local LM Studio cache presence and builds the status payload expected by Settings UI.
/// Reports resolved directory path and discovered model count without mutating configuration files.
pub fn build_cache_status_payload(custom_cache_dir: &str, model_count: usize) -> Value {
    match resolve_lmstudio_cache_dir(custom_cache_dir) {
        Some(path) => json!({
            "valid": true,
            "path": path.to_string_lossy(),
            "modelCount": model_count,
        }),
        None => {
            let err = if !custom_cache_dir.trim().is_empty() && !Path::new(custom_cache_dir).exists()
            {
                "Configured LM Studio directory not found"
            } else {
                "LM Studio directory not found (~/.lmstudio or ~/.cache/lm-studio)"
            };
            json!({
                "valid": false,
                "path": "",
                "modelCount": model_count,
                "error": err,
            })
        }
    }
}

/// Dedicated LM Studio local provider with cross-PC CLI resolution, auto-start recovery, and single-model VRAM enforcement.
pub struct LMStudioProvider {
    server_url: String,
    cache_dir: String,
    client: OpenAiCompatClient,
}

impl LMStudioProvider {
    /// Creates an LM Studio provider after normalizing the base URL to include `/v1` when omitted.
    /// Configures the underlying OpenAI-compatible client for model listing and streaming completions.
    pub fn new(server_url: impl Into<String>) -> Self {
        Self::with_cache_dir(server_url, "")
    }

    /// Creates an LM Studio provider with an optional custom cache directory for resolving `lms` across PCs.
    /// Normalizes `server_url` to `/v1` when empty and initializes the pooled OpenAI-compatible client.
    pub fn with_cache_dir(server_url: impl Into<String>, cache_dir: impl Into<String>) -> Self {
        let raw = server_url.into();
        let normalized = normalize_lmstudio_base_url(&raw);
        Self {
            server_url: normalized.clone(),
            cache_dir: cache_dir.into(),
            client: OpenAiCompatClient::new(normalized, ""),
        }
    }

    /// Probes all candidate HTTP `/models` endpoints concurrently and merges chat model IDs.
    /// Returns an error only when every probed host and path variant fails to respond with HTTP 2xx.
    async fn probe_http_models(&self) -> Result<Vec<String>, ProviderError> {
        let candidate_urls = build_model_probe_urls(&self.server_url);
        let results = join_all(candidate_urls.into_iter().map(probe_models_url)).await;

        let mut merged = Vec::new();
        let mut seen = HashSet::new();
        let mut any_success = false;
        let mut last_err: Option<ProviderError> = None;

        for res in results {
            match res {
                Ok(ids) => {
                    any_success = true;
                    for id in ids {
                        if seen.insert(id.to_lowercase()) {
                            merged.push(id);
                        }
                    }
                }
                Err(err) => {
                    last_err = Some(err);
                }
            }
        }

        if any_success {
            Ok(merged)
        } else {
            Err(last_err.unwrap_or_else(|| ProviderError::ApiStatus {
                status: 503,
                body: "Unable to reach local LM Studio server".to_string(),
            }))
        }
    }

    /// Attempts to start the local LM Studio HTTP server via `lms server start --port <port>` with a 60s cooldown.
    /// Allows KAI Agent to automatically recover when LM Studio is installed on a PC with its local server toggled off.
    pub async fn try_auto_start_server(&self) -> bool {
        let lock = LAST_AUTO_START.get_or_init(|| Mutex::new(None));
        {
            let mut last = lock.lock().await;
            if let Some(prev) = *last {
                if prev.elapsed() < AUTO_START_COOLDOWN {
                    return false;
                }
            }
            *last = Some(Instant::now());
        }

        let port = extract_server_port(&self.server_url).to_string();
        let res = tokio::time::timeout(
            Duration::from_secs(6),
            build_lms_command(&self.cache_dir)
                .args(["server", "start", "--port", &port])
                .output(),
        )
        .await;

        matches!(res, Ok(Ok(output)) if output.status.success())
    }

    /// Lists locally downloaded LLM model keys via `lms ls --json` and returns raw stdout bytes for capability fallback.
    /// Excludes embedding models so cache diagnostics and fallback discovery stay accurate across PCs.
    pub async fn query_local_cli_models(&self) -> (Vec<String>, Vec<u8>) {
        let res = tokio::time::timeout(
            Duration::from_secs(4),
            build_lms_command(&self.cache_dir)
                .args(["ls", "--json"])
                .output(),
        )
        .await;

        let Ok(Ok(output)) = res else {
            return (Vec::new(), Vec::new());
        };
        if !output.status.success() {
            return (Vec::new(), Vec::new());
        }
        let Ok(parsed) = serde_json::from_slice::<Value>(&output.stdout) else {
            return (Vec::new(), output.stdout);
        };
        let ids = parsed
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter(|item| item["type"].as_str() == Some("llm"))
                    .filter_map(|item| item["modelKey"].as_str())
                    .filter(|id| !id.is_empty() && is_chat_model_id(id))
                    .map(String::from)
                    .collect()
            })
            .unwrap_or_default();
        (ids, output.stdout)
    }

    /// Lists locally downloaded LLM model keys via `lms ls --json` when the HTTP server is unreachable.
    /// Delegates to `query_local_cli_models` while discarding the raw JSON buffer.
    pub async fn list_local_cli_models(&self) -> Vec<String> {
        self.query_local_cli_models().await.0
    }

    /// Builds LM Studio thinking/reasoning request parameters (`chat_template_kwargs`, `enable_thinking`, manifest fields).
    /// Translates the active UI thinking toggle and reasoning effort into LM Studio-compatible Jinja parameters.
    pub fn build_thinking_extra_body(
        model_id: &str,
        thinking: bool,
        thinking_level: &str,
        caps_map: &serde_json::Map<String, Value>,
    ) -> serde_json::Map<String, Value> {
        let mut extra = serde_json::Map::new();
        let mut kwargs = serde_json::Map::new();

        extra.insert("thinking".to_string(), Value::Bool(thinking));
        extra.insert("enable_thinking".to_string(), Value::Bool(thinking));
        kwargs.insert("enable_thinking".to_string(), Value::Bool(thinking));

        let mut effort = thinking_level.trim().to_ascii_lowercase();
        if effort == "high" || effort == "on" {
            effort = "xhigh".to_string();
        }
        if !thinking || effort.is_empty() || effort == "off" || effort == "minimal" || effort == "none"
        {
            effort.clear();
        }

        if !effort.is_empty() {
            extra.insert("reasoning_effort".to_string(), Value::String(effort.clone()));
            kwargs.insert("reasoning_effort".to_string(), Value::String(effort.clone()));
        }

        let lower = model_id.to_ascii_lowercase();
        let stripped_slash = lower.rsplit_once('/').map(|(_, s)| s).unwrap_or(lower.as_str());
        let stripped_at = lower.split_once('@').map(|(s, _)| s).unwrap_or(lower.as_str());
        let cap = caps_map
            .get(model_id)
            .or_else(|| caps_map.get(&lower))
            .or_else(|| caps_map.get(stripped_slash))
            .or_else(|| caps_map.get(stripped_at));

        if let Some(fields) = cap.and_then(|c| c["fields"].as_array()) {
            for field in fields {
                let Some(var) = field["variable"].as_str().filter(|v| !v.is_empty()) else {
                    continue;
                };
                match field["type"].as_str() {
                    Some("select") => {
                        if !effort.is_empty() {
                            extra.insert(var.to_string(), Value::String(effort.clone()));
                            kwargs.insert(var.to_string(), Value::String(effort.clone()));
                        }
                    }
                    _ => {
                        extra.insert(var.to_string(), Value::Bool(thinking));
                        kwargs.insert(var.to_string(), Value::Bool(thinking));
                    }
                }
            }
        }

        extra.insert("chat_template_kwargs".to_string(), Value::Object(kwargs));
        extra
    }

    /// Queries models actively loaded in VRAM via `/api/v0/models` (`state == "loaded"`) with `lms ps --json` fallback.
    /// Ensures dropdown connection dots show green only for genuinely loaded LM Studio models.
    pub async fn list_loaded_models(&self) -> Vec<String> {
        let mut v0_urls = Vec::new();
        if let Ok(parsed) = Url::parse(&self.server_url) {
            let scheme = parsed.scheme();
            let host = parsed.host_str().unwrap_or("127.0.0.1");
            let port = parsed.port().unwrap_or(1234);
            let alt_host = match host {
                "localhost" => "127.0.0.1",
                "127.0.0.1" => "localhost",
                other => other,
            };
            v0_urls.push(format!("{scheme}://{host}:{port}/api/v0/models"));
            if alt_host != host {
                v0_urls.push(format!("{scheme}://{alt_host}:{port}/api/v0/models"));
            }
        }

        for url in v0_urls {
            let res = tokio::time::timeout(
                Duration::from_millis(1200),
                shared_validation_client().get(&url).send(),
            )
            .await;
            if let Ok(Ok(resp)) = res {
                if resp.status().is_success() {
                    if let Ok(parsed) = resp.json::<Value>().await {
                        if let Some(arr) = parsed["data"].as_array() {
                            let loaded: Vec<String> = arr
                                .iter()
                                .filter(|m| m["state"].as_str() == Some("loaded"))
                                .filter_map(|m| m["id"].as_str().or_else(|| m["name"].as_str()))
                                .filter(|id| !id.is_empty() && is_chat_model_id(id))
                                .map(String::from)
                                .collect();
                            return loaded;
                        }
                    }
                }
            }
        }

        // Fallback: query `lms ps --json` silently
        let cli_res = tokio::time::timeout(
            Duration::from_secs(2),
            build_lms_command(&self.cache_dir)
                .args(["ps", "--json"])
                .output(),
        )
        .await;
        if let Ok(Ok(output)) = cli_res {
            if output.status.success() {
                if let Ok(Value::Array(items)) = serde_json::from_slice::<Value>(&output.stdout) {
                    return items
                        .iter()
                        .filter_map(|m| {
                            m["identifier"]
                                .as_str()
                                .or_else(|| m["modelKey"].as_str())
                                .or_else(|| m["id"].as_str())
                        })
                        .filter(|id| !id.is_empty() && is_chat_model_id(id))
                        .map(String::from)
                        .collect();
                }
            }
        }
        Vec::new()
    }

    /// Ensures the local server is started and only the target model is loaded in VRAM before inference.
    /// Uses cross-PC `lms` executable resolution without flashing console windows on Windows.
    pub async fn ensure_single_loaded_model(&self, target_model: &str) {
        if target_model.is_empty() || target_model == "local-model" {
            return;
        }
        if self.probe_http_models().await.is_err() {
            let _ = self.try_auto_start_server().await;
        }
        let _ = build_lms_command(&self.cache_dir)
            .args(["unload", "--all"])
            .output()
            .await;
        let _ = build_lms_command(&self.cache_dir)
            .args(["load", target_model, "-y"])
            .output()
            .await;
    }
}

#[async_trait]
impl LlmProvider for LMStudioProvider {
    fn id(&self) -> &'static str {
        "lmstudio"
    }

    /// Probes LM Studio HTTP endpoints and automatically starts `lms server start` once if the local server is off.
    /// Re-probes HTTP after auto-start so locally downloaded models become immediately usable.
    async fn list_models(&self) -> Result<Vec<String>, ProviderError> {
        match self.probe_http_models().await {
            Ok(models) => Ok(models),
            Err(initial_err) => {
                if self.try_auto_start_server().await {
                    tokio::time::sleep(Duration::from_millis(400)).await;
                    if let Ok(models) = self.probe_http_models().await {
                        return Ok(models);
                    }
                }
                Err(initial_err)
            }
        }
    }

    /// Streams chat completions from LM Studio with thinking/reasoning parameters and multimodal image support.
    /// Applies manifest-defined Jinja template variables for the selected model before posting.
    async fn stream_chat(
        &self,
        request: ChatRequest,
        sink: &dyn StreamSink,
    ) -> Result<CompletionResult, ProviderError> {
        let model_id = request.model.trim_end_matches(" (thinking)").to_string();
        let cache_dir = self.cache_dir.clone();
        let caps = tokio::task::spawn_blocking(move || parse_lmstudio_capabilities(&cache_dir))
            .await
            .unwrap_or_default();
        let extra = Self::build_thinking_extra_body(
            &model_id,
            request.thinking,
            &request.thinking_level,
            &caps,
        );
        self.client
            .stream_completions_with_extra(&request, &model_id, None, Some(extra), sink)
            .await
    }
}

#[cfg(test)]
mod tests {
    use super::{
        build_model_probe_urls, extract_server_port, is_chat_model_id,
        merge_cli_model_capabilities, normalize_lmstudio_base_url,
        parse_index_cache_capabilities_bytes, LMStudioProvider,
    };
    use crate::traits::session_storage::ChatSessionRecord;

    #[test]
    fn builds_lmstudio_thinking_payload_and_tolerates_partial_session_record() {
        let caps = serde_json::Map::new();
        let extra_on =
            LMStudioProvider::build_thinking_extra_body("gemma-4", true, "high", &caps);
        assert_eq!(extra_on["enable_thinking"].as_bool(), Some(true));
        assert_eq!(
            extra_on["chat_template_kwargs"]["reasoning_effort"].as_str(),
            Some("xhigh")
        );

        let extra_off =
            LMStudioProvider::build_thinking_extra_body("gemma-4", false, "high", &caps);
        assert_eq!(extra_off["enable_thinking"].as_bool(), Some(false));
        assert!(extra_off.get("reasoning_effort").is_none());

        let partial = serde_json::json!({
            "id": "chat-1",
            "title": "Test",
            "timestamp": 123456,
            "messages": [],
            "model": "gemma-4",
            "mode": "ask"
        });
        let record: ChatSessionRecord =
            serde_json::from_value(partial).expect("partial saveChat payload should deserialize");
        assert_eq!(record.id, "chat-1");
        assert!(!record.thinking);
    }

    #[test]
    fn normalizes_bare_host_to_v1_prefix() {
        assert_eq!(
            normalize_lmstudio_base_url("http://127.0.0.1:1234"),
            "http://127.0.0.1:1234/v1"
        );
        assert_eq!(
            normalize_lmstudio_base_url("localhost:1234/"),
            "http://localhost:1234/v1"
        );
        assert_eq!(
            normalize_lmstudio_base_url("http://localhost:1234/v1/"),
            "http://localhost:1234/v1"
        );
    }

    #[test]
    fn builds_v1_v0_and_host_fallback_probe_urls() {
        let urls = build_model_probe_urls("http://127.0.0.1:1234");
        assert!(urls.contains(&"http://127.0.0.1:1234/v1/models".to_string()));
        assert!(urls.contains(&"http://127.0.0.1:1234/api/v0/models".to_string()));
        assert!(urls.contains(&"http://localhost:1234/v1/models".to_string()));
        assert!(urls.contains(&"http://localhost:1234/api/v0/models".to_string()));
    }

    #[test]
    fn filters_out_embedding_model_ids() {
        assert!(is_chat_model_id("google/gemma-4-12b-qat"));
        assert!(is_chat_model_id("ornith-1.5-9b"));
        assert!(!is_chat_model_id("text-embedding-nomic-embed-text-v1.5"));
        assert!(!is_chat_model_id("baai/bge-large-en-v1.5"));
    }

    #[test]
    fn extracts_port_from_server_url() {
        assert_eq!(extract_server_port("http://127.0.0.1:1234/v1"), 1234);
        assert_eq!(extract_server_port("http://localhost:4321"), 4321);
        assert_eq!(extract_server_port("http://localhost"), 1234);
    }

    #[test]
    fn parses_index_cache_size_mtime_and_aliases() {
        let sample = br#"{
            "models": [
                {
                    "indexedModelIdentifier": "google/gemma-4-12b-qat@q4_0",
                    "defaultIdentifier": "google/gemma-4-12b-qat",
                    "displayName": "Gemma 4 12B QAT",
                    "domain": "llm",
                    "sizeBytes": 7151067268,
                    "containingDirMtime": 1793194171823
                }
            ]
        }"#;
        let mut caps = parse_index_cache_capabilities_bytes(sample);
        assert_eq!(
            caps["google/gemma-4-12b-qat"]["sizeBytes"].as_u64(),
            Some(7_151_067_268)
        );
        assert_eq!(
            caps["gemma-4-12b-qat"]["mtime"].as_u64(),
            Some(1_793_194_171_823)
        );

        let cli_sample = br#"[
            {
                "type": "llm",
                "modelKey": "ornith-1.5-9b",
                "displayName": "Ornith 1.5 9B",
                "sizeBytes": 6550813408
            }
        ]"#;
        merge_cli_model_capabilities(&mut caps, cli_sample);
        assert_eq!(
            caps["ornith-1.5-9b"]["sizeBytes"].as_u64(),
            Some(6_550_813_408)
        );
    }
}

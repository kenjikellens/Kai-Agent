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

/// Resolves the existing LM Studio home/cache directory across custom settings, `~/.lmstudio`, and `~/.cache/lm-studio`.
/// Returns the first existing directory path so cache status indicators work consistently across PCs.
pub fn resolve_lmstudio_cache_dir(custom_cache_dir: &str) -> Option<PathBuf> {
    let trimmed = custom_cache_dir.trim();
    if !trimmed.is_empty() {
        let p = PathBuf::from(trimmed);
        if p.exists() {
            return Some(p);
        }
    }
    if let Some(home) = user_home_dir() {
        let modern = home.join(".lmstudio");
        if modern.exists() {
            return Some(modern);
        }
        let legacy = home.join(".cache").join("lm-studio");
        if legacy.exists() {
            return Some(legacy);
        }
    }
    None
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

    /// Lists locally downloaded LLM model keys via `lms ls --json` when the HTTP server is unreachable.
    /// Excludes embedding models so cache diagnostics and fallback discovery stay accurate across PCs.
    pub async fn list_local_cli_models(&self) -> Vec<String> {
        let res = tokio::time::timeout(
            Duration::from_secs(4),
            build_lms_command(&self.cache_dir)
                .args(["ls", "--json"])
                .output(),
        )
        .await;

        let Ok(Ok(output)) = res else {
            return Vec::new();
        };
        if !output.status.success() {
            return Vec::new();
        }
        let Ok(parsed) = serde_json::from_slice::<Value>(&output.stdout) else {
            return Vec::new();
        };
        parsed
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter(|item| item["type"].as_str() == Some("llm"))
                    .filter_map(|item| item["modelKey"].as_str())
                    .filter(|id| !id.is_empty() && is_chat_model_id(id))
                    .map(String::from)
                    .collect()
            })
            .unwrap_or_default()
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

    async fn stream_chat(
        &self,
        request: ChatRequest,
        sink: &dyn StreamSink,
    ) -> Result<CompletionResult, ProviderError> {
        let model_id = request.model.trim_end_matches(" (thinking)").to_string();
        self.client
            .stream_completions(&request, &model_id, None, sink)
            .await
    }
}

#[cfg(test)]
mod tests {
    use super::{
        build_model_probe_urls, extract_server_port, is_chat_model_id, normalize_lmstudio_base_url,
    };

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
}

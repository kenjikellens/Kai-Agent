use std::path::PathBuf;

use serde::{Deserialize, Serialize};

const KEYRING_SERVICE: &str = "com.kai.agent.app";

/// Strongly typed application configuration with OS-keyring backed API secrets.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct KaiConfig {
    pub server_url: String,
    pub lm_studio_cache_dir: String,
    pub api_key: String,
    pub mistral_api_key: String,
    pub cohere_api_key: String,
    pub cerebras_api_key: String,
    pub zhipu_api_key: String,
    pub openrouter_api_key: String,
    pub omniroute_server_url: String,
    pub omniroute_api_key: String,
    pub temperature: f32,
    pub language: String,
    pub active_model: String,
    pub active_mode: String,
    pub thinking_enabled: bool,
    pub thinking_level: String,
}

impl Default for KaiConfig {
    fn default() -> Self {
        Self {
            server_url: "http://127.0.0.1:1234".to_string(),
            lm_studio_cache_dir: String::new(),
            api_key: String::new(),
            mistral_api_key: String::new(),
            cohere_api_key: String::new(),
            cerebras_api_key: String::new(),
            zhipu_api_key: String::new(),
            openrouter_api_key: String::new(),
            omniroute_server_url: "http://127.0.0.1:8080".to_string(),
            omniroute_api_key: String::new(),
            temperature: 0.2,
            language: "en".to_string(),
            active_model: String::new(),
            active_mode: "ask".to_string(),
            thinking_enabled: true,
            thinking_level: "medium".to_string(),
        }
    }
}

/// Manages persistent non-secret settings on disk and API keys in the OS credential vault.
pub struct ConfigManager {
    config_path: PathBuf,
}

impl ConfigManager {
    /// Creates a `ConfigManager` targeting `app_data_dir/config.json`.
    pub fn new(app_data_dir: PathBuf) -> Self {
        Self {
            config_path: app_data_dir.join("config.json"),
        }
    }

    /// Loads settings from disk and hydrates API secrets from the OS keyring.
    pub fn load(&self) -> KaiConfig {
        let mut cfg = std::fs::read_to_string(&self.config_path)
            .ok()
            .and_then(|raw| serde_json::from_str::<KaiConfig>(&raw).ok())
            .unwrap_or_default();

        Self::load_secret("gemini_api_key", &mut cfg.api_key);
        Self::load_secret("mistral_api_key", &mut cfg.mistral_api_key);
        Self::load_secret("cohere_api_key", &mut cfg.cohere_api_key);
        Self::load_secret("cerebras_api_key", &mut cfg.cerebras_api_key);
        Self::load_secret("zhipu_api_key", &mut cfg.zhipu_api_key);
        Self::load_secret("openrouter_api_key", &mut cfg.openrouter_api_key);
        Self::load_secret("omniroute_api_key", &mut cfg.omniroute_api_key);
        cfg
    }

    /// Persists API keys to the OS keyring and saves non-secret preferences with `0o600` permissions.
    pub fn save(&self, cfg: &KaiConfig) -> Result<(), std::io::Error> {
        Self::store_secret("gemini_api_key", &cfg.api_key);
        Self::store_secret("mistral_api_key", &cfg.mistral_api_key);
        Self::store_secret("cohere_api_key", &cfg.cohere_api_key);
        Self::store_secret("cerebras_api_key", &cfg.cerebras_api_key);
        Self::store_secret("zhipu_api_key", &cfg.zhipu_api_key);
        Self::store_secret("openrouter_api_key", &cfg.openrouter_api_key);
        Self::store_secret("omniroute_api_key", &cfg.omniroute_api_key);

        let mut sanitized = cfg.clone();
        sanitized.api_key.clear();
        sanitized.mistral_api_key.clear();
        sanitized.cohere_api_key.clear();
        sanitized.cerebras_api_key.clear();
        sanitized.zhipu_api_key.clear();
        sanitized.openrouter_api_key.clear();
        sanitized.omniroute_api_key.clear();

        if let Some(parent) = self.config_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let json = serde_json::to_string_pretty(&sanitized)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
        std::fs::write(&self.config_path, json)?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(
                &self.config_path,
                std::fs::Permissions::from_mode(0o600),
            );
        }
        Ok(())
    }

    fn load_secret(account: &str, target: &mut String) {
        if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, account) {
            if let Ok(secret) = entry.get_password() {
                if !secret.trim().is_empty() {
                    *target = secret;
                }
            }
        }
    }

    fn store_secret(account: &str, value: &str) {
        if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, account) {
            if value.trim().is_empty() {
                let _ = entry.delete_credential();
            } else {
                let _ = entry.set_password(value.trim());
            }
        }
    }
}

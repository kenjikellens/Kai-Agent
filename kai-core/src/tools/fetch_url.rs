use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
use std::sync::OnceLock;
use std::time::Duration;

use async_trait::async_trait;
use reqwest::redirect::Policy;
use serde_json::{json, Value};
use url::Url;

use crate::traits::agent_tool::{
    AgentTool, FunctionDeclaration, OutputTruncator, ToolContext, ToolError,
};

const MAX_REDIRECTS: usize = 3;
const MAX_BODY_BYTES: usize = 1_048_576; // 1 MiB
static FETCH_HTTP_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

/// Fetches public HTTP/HTTPS resources with strict SSRF IP/DNS blocklists and size caps.
pub struct FetchUrlTool {
    truncator: OutputTruncator,
}

impl FetchUrlTool {
    /// Creates a new `FetchUrlTool`.
    pub fn new() -> Self {
        Self {
            truncator: OutputTruncator::default(),
        }
    }

    /// Returns `true` if an IPv4/IPv6 address belongs to loopback, private, link-local, or ULA space.
    pub fn is_blocked_ip(ip: IpAddr) -> bool {
        match ip {
            IpAddr::V4(v4) => Self::is_blocked_v4(v4),
            IpAddr::V6(v6) => Self::is_blocked_v6(v6),
        }
    }

    fn is_blocked_v4(ip: Ipv4Addr) -> bool {
        let octets = ip.octets();
        ip.is_loopback()
            || ip.is_private()
            || ip.is_link_local()
            || ip.is_unspecified()
            || ip.is_multicast()
            || octets[0] == 100 && (octets[1] >= 64 && octets[1] <= 127) // CGNAT 100.64.0.0/10
    }

    fn is_blocked_v6(ip: Ipv6Addr) -> bool {
        if let Some(mapped) = ip.to_ipv4_mapped() {
            return Self::is_blocked_v4(mapped);
        }
        ip.is_loopback()
            || ip.is_unspecified()
            || ip.is_multicast()
            || (ip.segments()[0] & 0xfe00) == 0xfc00 // ULA fc00::/7
            || (ip.segments()[0] & 0xffc0) == 0xfe80 // Link-local fe80::/10
    }

    /// Validates scheme and checks resolved DNS addresses before connecting.
    pub async fn validate_public_url(raw_url: &str) -> Result<Url, ToolError> {
        let parsed = Url::parse(raw_url)
            .map_err(|e| ToolError::InvalidArguments(format!("Invalid URL: {e}")))?;

        match parsed.scheme() {
            "http" | "https" => {}
            other => {
                return Err(ToolError::PermissionDenied(format!(
                    "Unsupported URL scheme '{other}'."
                )));
            }
        }

        let host = parsed
            .host_str()
            .ok_or_else(|| ToolError::InvalidArguments("URL missing host.".to_string()))?;

        if host.eq_ignore_ascii_case("localhost") || host.ends_with(".local") {
            return Err(ToolError::PermissionDenied(
                "Localhost and .local hostnames are blocked.".to_string(),
            ));
        }

        if let Ok(ip) = host.parse::<IpAddr>() {
            if Self::is_blocked_ip(ip) {
                return Err(ToolError::PermissionDenied(format!(
                    "Blocked private/internal IP: {ip}"
                )));
            }
            return Ok(parsed);
        }

        let port = parsed.port_or_known_default().unwrap_or(443);
        let addrs = tokio::net::lookup_host((host, port))
            .await
            .map_err(|e| ToolError::ExecutionFailed(format!("DNS resolution failed: {e}")))?;

        let mut resolved_any = false;
        for addr in addrs {
            resolved_any = true;
            if Self::is_blocked_ip(addr.ip()) {
                return Err(ToolError::PermissionDenied(format!(
                    "Resolved IP {} is private or loopback.",
                    addr.ip()
                )));
            }
        }

        if !resolved_any {
            return Err(ToolError::ExecutionFailed(
                "DNS returned no addresses.".to_string(),
            ));
        }

        Ok(parsed)
    }
}

impl Default for FetchUrlTool {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl AgentTool for FetchUrlTool {
    fn name(&self) -> &'static str {
        "fetch_url"
    }

    fn declaration(&self) -> FunctionDeclaration {
        FunctionDeclaration {
            name: self.name().to_string(),
            description: "Fetch text content from a public HTTP/HTTPS URL.".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "url": { "type": "string", "description": "Public HTTP/HTTPS URL" }
                },
                "required": ["url"]
            }),
        }
    }

    /// Fetches a validated public URL with pooled no-redirect HTTP client and 1 MiB streaming cap.
    async fn execute(&self, args: Value, _ctx: &ToolContext) -> Result<String, ToolError> {
        let raw_url = args
            .get("url")
            .and_then(|v| v.as_str())
            .ok_or_else(|| ToolError::InvalidArguments("Missing 'url'.".to_string()))?;

        let mut current = Self::validate_public_url(raw_url).await?;
        let client = FETCH_HTTP_CLIENT.get_or_init(|| {
            reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(10))
                .timeout(Duration::from_secs(15))
                .redirect(Policy::none())
                .build()
                .expect("valid static fetch_url client")
        });

        for _ in 0..=MAX_REDIRECTS {
            let mut resp = client
                .get(current.clone())
                .header("User-Agent", "KAI-Agent/1.0")
                .send()
                .await
                .map_err(|e| ToolError::ExecutionFailed(format!("HTTP request failed: {e}")))?;

            if resp.status().is_redirection() {
                if let Some(loc) = resp.headers().get(reqwest::header::LOCATION) {
                    let loc_str = loc.to_str().map_err(|_| {
                        ToolError::ExecutionFailed("Invalid redirect location header.".to_string())
                    })?;
                    let next_url = current
                        .join(loc_str)
                        .map_err(|e| ToolError::ExecutionFailed(format!("Bad redirect URL: {e}")))?;
                    current = Self::validate_public_url(next_url.as_str()).await?;
                    continue;
                }
            }

            if !resp.status().is_success() {
                return Err(ToolError::ExecutionFailed(format!(
                    "HTTP status {}",
                    resp.status()
                )));
            }

            let mut buf = Vec::new();
            while let Some(chunk) = resp
                .chunk()
                .await
                .map_err(|e| ToolError::ExecutionFailed(format!("Read error: {e}")))?
            {
                let remaining = MAX_BODY_BYTES.saturating_sub(buf.len());
                if remaining == 0 {
                    break;
                }
                let take = chunk.len().min(remaining);
                buf.extend_from_slice(&chunk[..take]);
                if buf.len() >= MAX_BODY_BYTES {
                    break;
                }
            }
            let text = String::from_utf8_lossy(&buf);
            return Ok(self.truncator.truncate(&text));
        }

        Err(ToolError::ExecutionFailed(
            "Exceeded maximum redirect limit (3).".to_string(),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::FetchUrlTool;
    use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

    #[test]
    fn blocks_private_and_metadata_ips() {
        assert!(FetchUrlTool::is_blocked_ip(IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1))));
        assert!(FetchUrlTool::is_blocked_ip(IpAddr::V4(Ipv4Addr::new(169, 254, 169, 254))));
        assert!(FetchUrlTool::is_blocked_ip(IpAddr::V4(Ipv4Addr::new(10, 0, 0, 1))));
        assert!(FetchUrlTool::is_blocked_ip(IpAddr::V6(Ipv6Addr::LOCALHOST)));
        assert!(!FetchUrlTool::is_blocked_ip(IpAddr::V4(Ipv4Addr::new(93, 184, 216, 34))));
    }
}

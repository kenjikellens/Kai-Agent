pub mod cerebras;
pub mod cohere;
pub mod factory;
pub mod gemini;
pub mod lm_studio;
pub mod mistral;
pub mod omniroute;
pub mod openai_compat;
pub mod openrouter;
pub mod zhipu;

pub use factory::ProviderFactory;

use std::sync::OnceLock;
use std::time::Duration;
use reqwest::Client;

static STREAMING_HTTP_CLIENT: OnceLock<Client> = OnceLock::new();
static VALIDATION_HTTP_CLIENT: OnceLock<Client> = OnceLock::new();

/// Returns a process-wide shared `reqwest::Client` for streaming completions with connection/TLS pooling.
/// Applies a 10s connect timeout without capping long-running SSE response streams.
pub fn shared_streaming_client() -> Client {
    STREAMING_HTTP_CLIENT
        .get_or_init(|| {
            Client::builder()
                .connect_timeout(Duration::from_secs(10))
                .build()
                .unwrap_or_else(|_| Client::new())
        })
        .clone()
}

/// Returns a process-wide shared `reqwest::Client` for short provider health checks and model discovery.
/// Enforces a 5s connect timeout and an 8s total request timeout.
pub fn shared_validation_client() -> Client {
    VALIDATION_HTTP_CLIENT
        .get_or_init(|| {
            Client::builder()
                .connect_timeout(Duration::from_secs(5))
                .timeout(Duration::from_secs(8))
                .build()
                .unwrap_or_else(|_| Client::new())
        })
        .clone()
}

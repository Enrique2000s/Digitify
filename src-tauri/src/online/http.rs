//! HTTPS for Import from URL (D-028): one agent with Windows' own TLS, timeouts, a little spacing
//! between requests to the same service, one retry when a service asks to slow down, and errors
//! explained in plain words.

use std::collections::HashMap;
use std::io::Read;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde_json::Value;

use crate::error::{AppError, AppResult};

/// The least time between two requests to the same host.
const SPACING: Duration = Duration::from_millis(150);
/// The longest wait a "too many requests" answer is honored for before giving up.
const MAX_RETRY_AFTER: u64 = 30;

pub(crate) fn agent() -> AppResult<&'static ureq::Agent> {
    static AGENT: OnceLock<ureq::Agent> = OnceLock::new();
    if let Some(agent) = AGENT.get() {
        return Ok(agent);
    }
    let tls = native_tls::TlsConnector::new().map_err(|e| AppError::msg(format!("secure connections are unavailable: {e}")))?;
    let agent = ureq::AgentBuilder::new()
        .tls_connector(Arc::new(tls))
        .timeout_connect(Duration::from_secs(10))
        .timeout_read(Duration::from_secs(30))
        .redirects(5)
        .user_agent(concat!("Digitify/", env!("CARGO_PKG_VERSION")))
        .build();
    Ok(AGENT.get_or_init(|| agent))
}

fn space(url: &str) {
    static LAST: OnceLock<Mutex<HashMap<String, Instant>>> = OnceLock::new();
    let host = url::Url::parse(url).ok().and_then(|u| u.host_str().map(str::to_string)).unwrap_or_default();
    let wait = {
        let mut last = LAST.get_or_init(Default::default).lock().unwrap_or_else(|e| e.into_inner());
        let now = Instant::now();
        let next = last.get(&host).map(|at| *at + SPACING).filter(|next| *next > now);
        last.insert(host, next.unwrap_or(now));
        next.map(|next| next - now)
    };
    if let Some(wait) = wait {
        std::thread::sleep(wait);
    }
}

/// What a failed request means, for the person importing.
pub fn explain(service: &str, error: ureq::Error) -> AppError {
    // "the site" (a direct link) starts a sentence capitalized.
    let lead = {
        let mut chars = service.chars();
        chars.next().map(|first| first.to_uppercase().collect::<String>() + chars.as_str()).unwrap_or_default()
    };
    match error {
        ureq::Error::Status(code, response) => {
            let body = response.into_string().unwrap_or_default();
            if body.contains("QUOTA_EXCEEDED") || body.contains("quotaExceeded") || code == 429 {
                return AppError::msg(format!("{lead} is limiting requests right now. Try again in a few minutes."));
            }
            match code {
                400 => AppError::msg(format!("{lead} didn't accept the request. If you set up keys for it in Settings, check them.")),
                401 => AppError::msg(format!("{lead} didn't accept the keys in Settings › Online services. Check them, or remove them to use the link alone.")),
                403 => AppError::msg(format!("{lead} won't share this: it's private, restricted in your region or by age, or the owner turned sharing off.")),
                404 | 410 => AppError::msg(format!("It isn't on {service} anymore: it was removed, or the link is wrong.")),
                500..=599 => AppError::msg(format!("{lead} isn't answering properly right now. Try again later.")),
                _ => AppError::msg(format!("{lead} answered with an error ({code}).")),
            }
        }
        ureq::Error::Transport(_) => AppError::msg(format!("Couldn't reach {service}. Check your internet connection and try again.")),
    }
}

/// Sends a request, waiting once if the service asks to slow down.
pub fn send(service: &str, request: ureq::Request, form: Option<&[(&str, &str)]>) -> AppResult<ureq::Response> {
    for attempt in 0..2 {
        space(request.url());
        let result = match form {
            Some(form) => request.clone().send_form(form),
            None => request.clone().call(),
        };
        match result {
            Ok(response) => return Ok(response),
            Err(ureq::Error::Status(429, response)) if attempt == 0 => {
                let wait = response.header("retry-after").and_then(|v| v.trim().parse::<u64>().ok()).unwrap_or(5);
                if wait > MAX_RETRY_AFTER {
                    return Err(explain(service, ureq::Error::Status(429, response)));
                }
                std::thread::sleep(Duration::from_secs(wait));
            }
            Err(error) => return Err(explain(service, error)),
        }
    }
    Err(explain(service, ureq::Error::Status(429, ureq::Response::new(429, "Too Many Requests", "").map_err(|_| AppError::msg("too many requests"))?)))
}

pub fn get(url: &str) -> AppResult<ureq::Request> {
    Ok(agent()?.get(url))
}

pub fn post(url: &str) -> AppResult<ureq::Request> {
    Ok(agent()?.post(url))
}

pub fn head(url: &str) -> AppResult<ureq::Request> {
    Ok(agent()?.head(url))
}

pub fn json(service: &str, request: ureq::Request) -> AppResult<Value> {
    send(service, request, None)?.into_json::<Value>().map_err(|_| AppError::msg(format!("{service} sent an answer Digitify couldn't read.")))
}

/// An image (a thumbnail or cover), up to 10 MB; none if it can't be fetched.
pub fn image(url: &str) -> Option<Vec<u8>> {
    let request = get(url).ok()?;
    space(url);
    let response = request.call().ok()?;
    let mut bytes = Vec::new();
    response.into_reader().take(10 * 1024 * 1024).read_to_end(&mut bytes).ok()?;
    (!bytes.is_empty()).then_some(bytes)
}

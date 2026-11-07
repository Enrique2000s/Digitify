//! Linux only (D-032): a tiny page on `http://localhost:<port>` that hosts YouTube's embedded player.
//!
//! On Linux the interface is a `tauri://localhost` page, and pages from that scheme send no
//! `Referer`; YouTube's player refuses to play without one (error 153). So on Linux the player's
//! frame points here instead: an ordinary http page that embeds YouTube's player and passes the
//! IFrame API's messages between it and Digitify, so Digitify's buttons keep working.
//!
//! It serves that one page and nothing else, only on the loopback address, only to requests
//! addressed to it by name (no other site can reach it through a renamed host), only for YouTube's
//! own embed addresses, on a port the system picks and that Digitify holds from the moment it is
//! chosen. The rest of the app is untouched: commands and media never go through it. On Windows
//! the page is `http://tauri.localhost`, which YouTube accepts, so there is no server.

#![cfg_attr(not(target_os = "linux"), allow(dead_code))]

#[cfg(target_os = "linux")]
use std::sync::OnceLock;

/// The base address of the page (`http://localhost:<port>`), started on first use. None on
/// Windows, or if the server couldn't start (the player then falls back to the direct embed).
#[tauri::command]
pub fn online_embed_host() -> Option<String> {
    #[cfg(target_os = "linux")]
    {
        static BASE: OnceLock<Option<String>> = OnceLock::new();
        BASE.get_or_init(|| match serve() {
            Ok(port) => Some(format!("http://localhost:{port}")),
            Err(e) => {
                log::warn!("could not start the YouTube host page: {e}");
                None
            }
        })
        .clone()
    }
    #[cfg(not(target_os = "linux"))]
    None
}

#[cfg(target_os = "linux")]
fn serve() -> std::io::Result<u16> {
    let listener = std::net::TcpListener::bind(("127.0.0.1", 0))?;
    let port = listener.local_addr()?.port();
    let server = tiny_http::Server::from_listener(listener, None).map_err(|e| std::io::Error::other(e.to_string()))?;
    std::thread::Builder::new().name("embed-host".into()).spawn(move || {
        for request in server.incoming_requests() {
            let response = answer(&request, port);
            let _ = request.respond(response);
        }
    })?;
    log::info!("YouTube host page at http://localhost:{port}/");
    Ok(port)
}

#[cfg(target_os = "linux")]
type Reply = tiny_http::Response<std::io::Cursor<Vec<u8>>>;

#[cfg(target_os = "linux")]
fn answer(request: &tiny_http::Request, port: u16) -> Reply {
    let host = request.headers().iter().find(|h| h.field.equiv("Host")).map(|h| h.value.as_str().to_ascii_lowercase());
    if !host.as_deref().is_some_and(|host| allowed_host(host, port)) {
        return plain(403, "forbidden");
    }
    if !matches!(request.method(), tiny_http::Method::Get | tiny_http::Method::Head) {
        return plain(405, "method not allowed");
    }
    let Some(player) = player_url(request.url()) else {
        return plain(404, "not found");
    };
    let nonce = nonce();
    let mut response = tiny_http::Response::from_data(page(&player, &nonce).into_bytes()).with_status_code(200);
    let csp = format!(
        "default-src 'none'; script-src 'nonce-{nonce}'; style-src 'nonce-{nonce}'; frame-src {YOUTUBE}; frame-ancestors tauri: http://tauri.localhost; base-uri 'none'; form-action 'none'"
    );
    for (name, value) in [
        ("Content-Type", "text/html; charset=utf-8"),
        ("Content-Security-Policy", csp.as_str()),
        ("Referrer-Policy", "strict-origin-when-cross-origin"),
        ("X-Content-Type-Options", "nosniff"),
        ("Cache-Control", "no-store"),
    ] {
        if let Ok(header) = tiny_http::Header::from_bytes(name, value) {
            response.add_header(header);
        }
    }
    response
}

const YOUTUBE: &str = "https://www.youtube-nocookie.com";

/// The YouTube embed address asked for in `/youtube?src=…`, if it is one (nothing else is hosted).
fn player_url(url: &str) -> Option<String> {
    let query = url.strip_prefix("/youtube?")?;
    let encoded = query.split('&').find_map(|pair| pair.strip_prefix("src="))?;
    let src = percent_decode(encoded)?;
    let parsed = url::Url::parse(&src).ok()?;
    let ok = parsed.scheme() == "https"
        && parsed.host_str() == Some("www.youtube-nocookie.com")
        && parsed.port().is_none()
        && parsed.path().starts_with("/embed/")
        && parsed.username().is_empty();
    ok.then(|| parsed.to_string())
}

fn percent_decode(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' => {
                let hex = std::str::from_utf8(bytes.get(i + 1..i + 3)?).ok()?;
                out.push(u8::from_str_radix(hex, 16).ok()?);
                i += 3;
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            byte => {
                out.push(byte);
                i += 1;
            }
        }
    }
    String::from_utf8(out).ok()
}

/// The host page: YouTube's player filling it, and a relay for the IFrame API's messages.
fn page(player: &str, nonce: &str) -> String {
    let src = player.replace('&', "&amp;").replace('"', "&quot;").replace('<', "&lt;");
    format!(
        r#"<!doctype html>
<html><head><meta charset="utf-8"><meta name="referrer" content="strict-origin-when-cross-origin">
<style nonce="{nonce}">html,body{{margin:0;height:100%;background:#000;overflow:hidden}}iframe{{border:0;width:100%;height:100%;display:block}}</style>
</head><body>
<iframe id="player" src="{src}" allow="autoplay; encrypted-media; fullscreen; picture-in-picture" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>
<script nonce="{nonce}">
const player = document.getElementById("player");
window.addEventListener("message", (event) => {{
  if (event.source === window.parent && player.contentWindow) {{
    player.contentWindow.postMessage(event.data, "{YOUTUBE}");
  }} else if (event.source === player.contentWindow && event.origin === "{YOUTUBE}") {{
    window.parent.postMessage(event.data, "*");
  }}
}});
</script>
</body></html>"#
    )
}

/// A fresh value for the page's Content-Security-Policy nonce.
fn nonce() -> String {
    use std::hash::{BuildHasher, Hasher};
    let mut hasher = std::collections::hash_map::RandomState::new().build_hasher();
    hasher.write_u128(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0));
    format!("{:016x}", hasher.finish())
}

/// Only requests addressed to this server by its own name (guards against DNS rebinding).
fn allowed_host(host: &str, port: u16) -> bool {
    host == format!("localhost:{port}") || host == format!("127.0.0.1:{port}")
}

#[cfg(target_os = "linux")]
fn plain(status: u16, message: &str) -> Reply {
    tiny_http::Response::from_data(message.as_bytes().to_vec()).with_status_code(status)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_its_own_host_names_are_served() {
        assert!(allowed_host("localhost:4242", 4242));
        assert!(allowed_host("127.0.0.1:4242", 4242));
        assert!(!allowed_host("localhost:4243", 4242));
        assert!(!allowed_host("evil.example:4242", 4242));
        assert!(!allowed_host("localhost", 4242));
    }

    #[test]
    fn only_youtube_embeds_are_hosted() {
        let ok = "/youtube?src=https%3A%2F%2Fwww.youtube-nocookie.com%2Fembed%2Faqz-KE-bpKQ%3Fautoplay%3D1%26enablejsapi%3D1";
        assert_eq!(player_url(ok).as_deref(), Some("https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ?autoplay=1&enablejsapi=1"));
        for bad in [
            "/youtube?src=https%3A%2F%2Fevil.example%2Fembed%2Fx",
            "/youtube?src=http%3A%2F%2Fwww.youtube-nocookie.com%2Fembed%2Fx",
            "/youtube?src=https%3A%2F%2Fwww.youtube-nocookie.com%2Fwatch%3Fv%3Dx",
            "/youtube?src=https%3A%2F%2Fwww.youtube-nocookie.com.evil.example%2Fembed%2Fx",
            "/youtube?src=javascript%3Aalert(1)",
            "/other?src=https%3A%2F%2Fwww.youtube-nocookie.com%2Fembed%2Fx",
            "/youtube",
        ] {
            assert_eq!(player_url(bad), None, "{bad}");
        }
    }

    #[test]
    fn the_player_address_is_escaped_in_the_page() {
        let html = page("https://www.youtube-nocookie.com/embed/x?a=1&b=\"<", "n");
        assert!(html.contains("src=\"https://www.youtube-nocookie.com/embed/x?a=1&amp;b=&quot;&lt;\""));
    }
}

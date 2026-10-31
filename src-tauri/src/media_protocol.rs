//! The private `digitify` URI scheme, which the UI reaches at http://digitify.localhost/ on Windows.
//! Only resources Digitify manages are served; file paths never come from the URL.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

use tauri::http::{header, Request, Response, StatusCode};
use tauri::{AppHandle, Manager, Runtime, UriSchemeContext, UriSchemeResponder};

use crate::ambient::{self, AmbientState};
use crate::pages::PageEngine;
use crate::{ebooks, AppState};

type Routed = Result<Response<Vec<u8>>, (StatusCode, String)>;

/// Largest slice returned for one range request; media elements ask for the rest as they play.
const SLICE: u64 = 1024 * 1024;

pub fn handle<R: Runtime>(ctx: UriSchemeContext<'_, R>, request: Request<Vec<u8>>, responder: UriSchemeResponder) {
    let app = ctx.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let response = route(&app, &request).unwrap_or_else(|(status, message)| {
            if status != StatusCode::NOT_FOUND {
                log::warn!("media request {} failed: {message}", request.uri());
            }
            plain(status, message)
        });
        responder.respond(response);
    });
}

fn route<R: Runtime>(app: &AppHandle<R>, request: &Request<Vec<u8>>) -> Routed {
    let path = request.uri().path();
    let mut segments = path.trim_start_matches('/').splitn(2, '/');
    match (segments.next(), segments.next()) {
        (Some("thumb"), Some(key)) => artwork(app, key, false),
        (Some("cover"), Some(key)) => artwork(app, key, true),
        (Some("ambient"), Some(track)) => ambient_track(app, track, request),
        (Some("page"), Some(page)) => book_page(app, page, request),
        (Some("book"), Some(version)) => ebook_file(app, version, request),
        (Some("cd"), Some(track)) => cd_track(track, request),
        _ => Err((StatusCode::NOT_FOUND, format!("unknown resource {path}"))),
    }
}

/// Cached artwork, addressed by its content key.
fn artwork<R: Runtime>(app: &AppHandle<R>, key: &str, full_size: bool) -> Routed {
    let valid = !key.is_empty() && key.len() <= 64 && key.bytes().all(|b| b.is_ascii_alphanumeric());
    if !valid {
        return Err((StatusCode::BAD_REQUEST, "invalid artwork key".into()));
    }
    let library = app
        .state::<AppState>()
        .library()
        .map_err(|e| (StatusCode::SERVICE_UNAVAILABLE, e.to_string()))?;
    let dir = if full_size { library.folder.covers_dir() } else { library.folder.thumbs_dir() };
    let bytes = std::fs::read(dir.join(format!("{key}.jpg")))
        .map_err(|_| (StatusCode::NOT_FOUND, format!("no artwork for {key}")))?;
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "image/jpeg")
        .header(header::CACHE_CONTROL, "public, max-age=31536000, immutable")
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(bytes)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

/// A track of the current ambient playlist, `ambient/<generation>/<index>` (see ambient.rs).
fn ambient_track<R: Runtime>(app: &AppHandle<R>, track: &str, request: &Request<Vec<u8>>) -> Routed {
    let bad = || (StatusCode::BAD_REQUEST, "invalid track".to_string());
    let (generation, index) = track.split_once('/').ok_or_else(bad)?;
    let generation: u64 = generation.parse().map_err(|_| bad())?;
    let index: usize = index.parse().map_err(|_| bad())?;
    let path = app
        .state::<AmbientState>()
        .track(generation, index)
        .ok_or_else(|| (StatusCode::NOT_FOUND, format!("no ambient track {track}")))?;
    stream(&path, ambient::mime_type(&path), request)
}

/// A page of a book, `page/<version>/<index>?w=<width>` (see pages.rs).
fn book_page<R: Runtime>(app: &AppHandle<R>, page: &str, request: &Request<Vec<u8>>) -> Routed {
    let bad = || (StatusCode::BAD_REQUEST, "invalid page".to_string());
    let (version, index) = page.split_once('/').ok_or_else(bad)?;
    let version: i64 = version.parse().map_err(|_| bad())?;
    let index: usize = index.parse().map_err(|_| bad())?;
    let width = request
        .uri()
        .query()
        .and_then(|query| query.split('&').find_map(|pair| pair.strip_prefix("w=")))
        .and_then(|w| w.parse::<u32>().ok());
    let library = app
        .state::<AppState>()
        .library()
        .map_err(|e| (StatusCode::SERVICE_UNAVAILABLE, e.to_string()))?;
    let page = app
        .state::<PageEngine>()
        .page(&library, version, index, width)
        .map_err(|e| (StatusCode::NOT_FOUND, e.to_string()))?;
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, page.mime)
        .header(header::CACHE_CONTROL, "private, max-age=3600")
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(page.bytes.clone())
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

/// The ebook file of a digital copy, `book/<version>`, for the ebook reader (see ebooks.rs).
fn ebook_file<R: Runtime>(app: &AppHandle<R>, version: &str, request: &Request<Vec<u8>>) -> Routed {
    let version: i64 = version.parse().map_err(|_| (StatusCode::BAD_REQUEST, "invalid copy".to_string()))?;
    let library = app
        .state::<AppState>()
        .library()
        .map_err(|e| (StatusCode::SERVICE_UNAVAILABLE, e.to_string()))?;
    let path = ebooks::file(&library, version)
        .map_err(|e| (StatusCode::NOT_FOUND, e.to_string()))?
        .ok_or_else(|| (StatusCode::NOT_FOUND, format!("copy {version} isn't an ebook")))?;
    stream(&path, ebooks::mime_type(&path), request)
}

/// An audio CD track straight from the disc as WAV, `cd/<letter>/<track>`, in range slices.
fn cd_track(track: &str, request: &Request<Vec<u8>>) -> Routed {
    let bad = || (StatusCode::BAD_REQUEST, "invalid track".to_string());
    let (letter, number) = track.split_once('/').ok_or_else(bad)?;
    let number: u32 = number.parse().map_err(|_| bad())?;
    let requested = request.headers().get(header::RANGE).and_then(|v| v.to_str().ok()).map(str::to_string);
    let (_, total) = crate::optical::cd_stream(letter, number, Some((0, 0))).map_err(|e| (StatusCode::NOT_FOUND, e.to_string()))?;
    let range = match &requested {
        Some(value) => Some(parse_range(value, total).ok_or((StatusCode::RANGE_NOT_SATISFIABLE, "bad range".to_string()))?),
        None => None,
    };
    let (bytes, total) = crate::optical::cd_stream(letter, number, range).map_err(|e| (StatusCode::NOT_FOUND, e.to_string()))?;
    let start = range.map_or(0, |(start, _)| start);
    let builder = Response::builder()
        .header(header::CONTENT_TYPE, "audio/wav")
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*");
    let response = if range.is_some() {
        builder
            .status(StatusCode::PARTIAL_CONTENT)
            .header(header::CONTENT_RANGE, format!("bytes {start}-{}/{total}", start + bytes.len() as u64 - 1))
            .body(bytes)
    } else {
        builder.status(StatusCode::OK).body(bytes)
    };
    response.map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

/// Serves a file in slices, the way media elements expect (HTTP range requests), so a long track
/// is never read into memory at once.
fn stream(path: &Path, mime: &str, request: &Request<Vec<u8>>) -> Routed {
    let failed = |e: std::io::Error| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string());
    let mut file = File::open(path).map_err(|_| (StatusCode::NOT_FOUND, format!("cannot open {}", path.display())))?;
    let len = file.metadata().map_err(failed)?.len();
    let builder = Response::builder()
        .header(header::CONTENT_TYPE, mime)
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*");
    let requested = request.headers().get(header::RANGE).and_then(|value| value.to_str().ok());
    let response = match requested {
        None => {
            let mut bytes = Vec::with_capacity(len as usize);
            file.read_to_end(&mut bytes).map_err(failed)?;
            builder.status(StatusCode::OK).body(bytes)
        }
        Some(value) => match parse_range(value, len) {
            Some((start, end)) => {
                let end = end.min(start + SLICE - 1);
                let mut bytes = vec![0; (end - start + 1) as usize];
                file.seek(SeekFrom::Start(start)).map_err(failed)?;
                file.read_exact(&mut bytes).map_err(failed)?;
                builder
                    .status(StatusCode::PARTIAL_CONTENT)
                    .header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{len}"))
                    .body(bytes)
            }
            None => builder
                .status(StatusCode::RANGE_NOT_SATISFIABLE)
                .header(header::CONTENT_RANGE, format!("bytes */{len}"))
                .body(Vec::new()),
        },
    };
    response.map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))
}

/// The first range of a `Range: bytes=...` header, as inclusive offsets within `len` bytes.
fn parse_range(value: &str, len: u64) -> Option<(u64, u64)> {
    let spec = value.trim().strip_prefix("bytes=")?.split(',').next()?.trim();
    let (start, end) = spec.split_once('-')?;
    if len == 0 {
        return None;
    }
    if start.is_empty() {
        // A suffix: the last `end` bytes.
        let count: u64 = end.parse().ok()?;
        return (count > 0).then(|| (len.saturating_sub(count), len - 1));
    }
    let start: u64 = start.parse().ok()?;
    let end = if end.is_empty() { len - 1 } else { end.parse::<u64>().ok()?.min(len - 1) };
    (start <= end).then_some((start, end))
}

fn plain(status: StatusCode, message: String) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(message.into_bytes())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::parse_range;

    #[test]
    fn ranges() {
        assert_eq!(parse_range("bytes=0-", 1000), Some((0, 999)));
        assert_eq!(parse_range("bytes=100-199", 1000), Some((100, 199)));
        assert_eq!(parse_range("bytes=900-5000", 1000), Some((900, 999)));
        assert_eq!(parse_range("bytes=-100", 1000), Some((900, 999)));
        assert_eq!(parse_range("bytes=0-0, 5-9", 1000), Some((0, 0)));
        assert_eq!(parse_range("bytes=1000-", 1000), None);
        assert_eq!(parse_range("bytes=5-2", 1000), None);
        assert_eq!(parse_range("bytes=0-", 0), None);
        assert_eq!(parse_range("items=0-1", 1000), None);
    }
}

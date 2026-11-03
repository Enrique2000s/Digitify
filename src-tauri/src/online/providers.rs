//! What each service tells about a link (D-028), through its official, documented interfaces only:
//! public oEmbed descriptions without keys, and the services' Web APIs with the owner's own keys.
//! Nothing here scrapes pages, and only a direct file link or a SoundCloud track its uploader made
//! downloadable is ever offered for download.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde_json::Value;

use super::http;
use super::keys::Keys;
use super::link::{self, Link, LinkKind, Provider};
use super::{Entry, Preview};
use crate::error::{AppError, AppResult};

/// The most entries listed for one playlist or album.
const MAX_ENTRIES: usize = 500;

pub fn inspect(link: &Link, keys: &Keys) -> AppResult<Preview> {
    match link.provider {
        Provider::YouTube => youtube(link, keys.youtube.as_deref()),
        Provider::Spotify => spotify(link, keys.spotify.as_ref()),
        Provider::SoundCloud => soundcloud(link, keys.soundcloud.as_ref()),
        Provider::Web => web(link),
    }
}

fn text(value: &Value, path: &[&str]) -> Option<String> {
    let mut at = value;
    for key in path {
        at = at.get(*key)?;
    }
    at.as_str().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string)
}

fn entry(link: &Link, kind: LinkKind, id: &str, url: &str, title: String, audio: bool) -> Entry {
    Entry {
        provider: link.provider.key().into(),
        service: link.service.into(),
        kind: kind.key().into(),
        external_id: id.into(),
        url: url.into(),
        title,
        creator: None,
        duration_sec: None,
        thumbnail: None,
        audio,
        downloadable: false,
        download: None,
        available: true,
        reason: None,
        existing: None,
    }
}

/// A preview of one item: the entry is the whole of it.
fn single(link: &Link, item: Entry, notes: Vec<String>) -> Preview {
    Preview {
        provider: link.provider.key().into(),
        service: link.service.into(),
        kind: link.kind.key().into(),
        collection: false,
        title: item.title.clone(),
        creator: item.creator.clone(),
        thumbnail: item.thumbnail.clone(),
        audio: item.audio,
        entries: vec![item],
        notes,
    }
}

fn oembed(service: &str, endpoint: &str, url: &str) -> AppResult<Value> {
    let request = http::get(endpoint)?.query("url", url).query("format", "json");
    http::json(service, request)
}

// ---------------------------------------------------------------------------------------------
// YouTube and YouTube Music: online links only (YouTube's terms allow no downloads).

const YT_API: &str = "https://www.googleapis.com/youtube/v3";

/// "PT1H2M3S" → 3723 seconds.
pub fn iso_duration(text: &str) -> Option<f64> {
    let rest = text.strip_prefix('P')?;
    let (days, time) = match rest.split_once('T') {
        Some((d, t)) => (d, t),
        None => (rest, ""),
    };
    let mut total = 0.0;
    let mut number = String::new();
    for (part, unit_seconds) in [(days, [("D", 86400.0)].as_slice()), (time, [("H", 3600.0), ("M", 60.0), ("S", 1.0)].as_slice())] {
        for c in part.chars() {
            if c.is_ascii_digit() || c == '.' {
                number.push(c);
            } else {
                let value: f64 = number.parse().ok()?;
                let unit = unit_seconds.iter().find(|(u, _)| u.starts_with(c))?.1;
                total += value * unit;
                number.clear();
            }
        }
    }
    Some(total)
}

fn yt_thumbnail(snippet: &Value) -> Option<String> {
    ["maxres", "standard", "high", "medium", "default"].iter().find_map(|size| text(snippet, &["thumbnails", size, "url"]))
}

fn youtube(link: &Link, key: Option<&str>) -> AppResult<Preview> {
    let audio = link.service == "YouTube Music";
    let base = if audio { "https://music.youtube.com" } else { "https://www.youtube.com" };
    let Some(key) = key else {
        // Without a key: the public description of the link (no length, and a playlist stays one link).
        let info = oembed(link.service, "https://www.youtube.com/oembed", &link.url)?;
        let mut item = entry(link, link.kind, &link.id, &link.url, text(&info, &["title"]).unwrap_or_else(|| link.service.into()), audio);
        item.creator = text(&info, &["author_name"]);
        item.thumbnail = text(&info, &["thumbnail_url"]);
        let notes = if link.kind == LinkKind::Playlist {
            vec!["Without a YouTube key the playlist is saved as one link. Add a key in Settings › Online services to see and pick each video.".into()]
        } else {
            Vec::new()
        };
        return Ok(single(link, item, notes));
    };

    let videos = |ids: &[String]| -> AppResult<HashMap<String, Value>> {
        let mut found = HashMap::new();
        for chunk in ids.chunks(50) {
            let request = http::get(&format!("{YT_API}/videos"))?.query("part", "snippet,contentDetails,status").query("id", &chunk.join(",")).query("key", key);
            let page = http::json(link.service, request)?;
            for video in page["items"].as_array().cloned().unwrap_or_default() {
                if let Some(id) = video["id"].as_str() {
                    found.insert(id.to_string(), video);
                }
            }
        }
        Ok(found)
    };
    let video_entry = |id: &str, video: Option<&Value>, fallback_title: Option<String>| -> Entry {
        let url = format!("{base}/watch?v={id}");
        let mut item = entry(link, LinkKind::Video, id, &url, fallback_title.unwrap_or_else(|| "Unavailable video".into()), audio);
        match video {
            Some(video) => {
                item.title = text(video, &["snippet", "title"]).unwrap_or(item.title);
                item.creator = text(video, &["snippet", "channelTitle"]).map(|c| c.trim_end_matches(" - Topic").to_string());
                item.thumbnail = yt_thumbnail(&video["snippet"]);
                item.duration_sec = text(video, &["contentDetails", "duration"]).as_deref().and_then(iso_duration);
                if video["status"]["embeddable"] == Value::Bool(false) {
                    item.reason = Some("Its owner doesn't allow playing it outside YouTube; it opens in your browser.".into());
                }
            }
            None => {
                item.available = false;
                item.reason = Some("Private, removed or blocked in your region.".into());
            }
        }
        item
    };

    if link.kind == LinkKind::Video {
        let found = videos(std::slice::from_ref(&link.id))?;
        let video = found.get(&link.id).ok_or_else(|| AppError::msg(format!("It isn't on {} anymore, or it's private.", link.service)))?;
        return Ok(single(link, video_entry(&link.id, Some(video), None), Vec::new()));
    }

    let request = http::get(&format!("{YT_API}/playlists"))?.query("part", "snippet,contentDetails").query("id", &link.id).query("key", key);
    let info = http::json(link.service, request)?;
    let list = info["items"].get(0).cloned().ok_or_else(|| AppError::msg("That playlist is private or no longer exists."))?;
    let mut ids: Vec<(String, Option<String>)> = Vec::new();
    let mut token: Option<String> = None;
    loop {
        let mut request = http::get(&format!("{YT_API}/playlistItems"))?.query("part", "snippet,contentDetails").query("maxResults", "50").query("playlistId", &link.id).query("key", key);
        if let Some(token) = &token {
            request = request.query("pageToken", token);
        }
        let page = http::json(link.service, request)?;
        for item in page["items"].as_array().cloned().unwrap_or_default() {
            if let Some(id) = text(&item, &["contentDetails", "videoId"]) {
                ids.push((id, text(&item, &["snippet", "title"])));
            }
        }
        token = text(&page, &["nextPageToken"]);
        if token.is_none() || ids.len() >= MAX_ENTRIES {
            break;
        }
    }
    ids.truncate(MAX_ENTRIES);
    let found = videos(&ids.iter().map(|(id, _)| id.clone()).collect::<Vec<_>>())?;
    let entries: Vec<Entry> = ids.iter().map(|(id, title)| video_entry(id, found.get(id), title.clone())).collect();
    let mut notes = Vec::new();
    if list["contentDetails"]["itemCount"].as_u64().is_some_and(|n| n as usize > MAX_ENTRIES) {
        notes.push(format!("Only the first {MAX_ENTRIES} videos are listed."));
    }
    Ok(Preview {
        provider: link.provider.key().into(),
        service: link.service.into(),
        kind: link.kind.key().into(),
        collection: true,
        title: text(&list, &["snippet", "title"]).unwrap_or_else(|| "Playlist".into()),
        creator: text(&list, &["snippet", "channelTitle"]),
        thumbnail: yt_thumbnail(&list["snippet"]),
        audio,
        entries,
        notes,
    })
}

// ---------------------------------------------------------------------------------------------
// Spotify: online links only (Spotify's terms allow no downloads).

type Token = (String, Instant);

fn cached_token(slot: &'static OnceLock<Mutex<HashMap<String, Token>>>, id: &str, fetch: impl FnOnce() -> AppResult<(String, u64)>) -> AppResult<String> {
    let cache = slot.get_or_init(Default::default);
    if let Some((token, until)) = cache.lock().unwrap_or_else(|e| e.into_inner()).get(id) {
        if *until > Instant::now() {
            return Ok(token.clone());
        }
    }
    let (token, seconds) = fetch()?;
    let until = Instant::now() + Duration::from_secs(seconds.saturating_sub(60).max(60));
    cache.lock().unwrap_or_else(|e| e.into_inner()).insert(id.to_string(), (token.clone(), until));
    Ok(token)
}

fn basic(id: &str, secret: &str) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let input = format!("{id}:{secret}").into_bytes();
    let mut out = String::new();
    for chunk in input.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | b[2] as u32;
        for i in 0..4 {
            if i <= chunk.len() {
                out.push(TABLE[((n >> (18 - 6 * i)) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    format!("Basic {out}")
}

fn spotify_token(id: &str, secret: &str) -> AppResult<String> {
    static TOKENS: OnceLock<Mutex<HashMap<String, Token>>> = OnceLock::new();
    cached_token(&TOKENS, id, || {
        let request = http::post("https://accounts.spotify.com/api/token")?.set("Authorization", &basic(id, secret));
        let answer = http::send("Spotify", request, Some(&[("grant_type", "client_credentials")]))?
            .into_json::<Value>()
            .map_err(|_| AppError::msg("Spotify sent an answer Digitify couldn't read."))?;
        let token = text(&answer, &["access_token"]).ok_or_else(|| AppError::msg("Spotify didn't accept the keys in Settings › Online services."))?;
        Ok((token, answer["expires_in"].as_u64().unwrap_or(3600)))
    })
}

fn spotify_track(link: &Link, track: &Value, image: Option<String>) -> Option<Entry> {
    let id = track["id"].as_str()?;
    let mut item = entry(link, LinkKind::Track, id, &format!("https://open.spotify.com/track/{id}"), text(track, &["name"])?, true);
    let artists: Vec<String> = track["artists"].as_array().into_iter().flatten().filter_map(|a| text(a, &["name"])).collect();
    item.creator = (!artists.is_empty()).then(|| artists.join(", "));
    item.duration_sec = track["duration_ms"].as_f64().map(|ms| (ms / 1000.0).round());
    item.thumbnail = track["album"]["images"].get(0).and_then(|i| text(i, &["url"])).or(image);
    if track["is_playable"] == Value::Bool(false) || track["is_local"] == Value::Bool(true) {
        item.available = false;
        item.reason = Some("Not available on Spotify in your region.".into());
    }
    Some(item)
}

fn spotify(link: &Link, keys: Option<&(String, String)>) -> AppResult<Preview> {
    let by_oembed = |notes: Vec<String>| -> AppResult<Preview> {
        let info = oembed("Spotify", "https://open.spotify.com/oembed", &link.url)?;
        let mut item = entry(link, link.kind, &link.id, &link.url, text(&info, &["title"]).unwrap_or_else(|| "Spotify".into()), true);
        item.thumbnail = text(&info, &["thumbnail_url"]);
        Ok(single(link, item, notes))
    };
    let Some((id, secret)) = keys else {
        let notes = if link.kind.is_collection() {
            vec!["Without Spotify keys this is saved as one link, played in Spotify's player. Add keys in Settings › Online services to list its songs.".into()]
        } else {
            Vec::new()
        };
        return by_oembed(notes);
    };
    let token = spotify_token(id, secret)?;
    let api = |path: &str| -> AppResult<Value> {
        let request = http::get(&format!("https://api.spotify.com/v1/{path}"))?.set("Authorization", &format!("Bearer {token}"));
        http::json("Spotify", request)
    };
    match link.kind {
        LinkKind::Track => match api(&format!("tracks/{}", link.id)) {
            Ok(track) => Ok(single(link, spotify_track(link, &track, None).ok_or_else(|| AppError::msg("Spotify sent an answer Digitify couldn't read."))?, Vec::new())),
            // Spotify keeps narrowing what an app may read; the public description still works.
            Err(_) => by_oembed(Vec::new()),
        },
        LinkKind::Album => {
            let album = api(&format!("albums/{}", link.id))?;
            let image = album["images"].get(0).and_then(|i| text(i, &["url"]));
            let mut entries = Vec::new();
            let mut page = album["tracks"].clone();
            loop {
                for track in page["items"].as_array().cloned().unwrap_or_default() {
                    entries.extend(spotify_track(link, &track, image.clone()));
                }
                let Some(next) = text(&page, &["next"]).filter(|_| entries.len() < MAX_ENTRIES) else { break };
                let request = http::get(&next)?.set("Authorization", &format!("Bearer {token}"));
                page = http::json("Spotify", request)?;
            }
            let artists: Vec<String> = album["artists"].as_array().into_iter().flatten().filter_map(|a| text(a, &["name"])).collect();
            Ok(Preview {
                provider: "spotify".into(),
                service: "Spotify".into(),
                kind: "album".into(),
                collection: true,
                title: text(&album, &["name"]).unwrap_or_else(|| "Album".into()),
                creator: (!artists.is_empty()).then(|| artists.join(", ")),
                thumbnail: image,
                audio: true,
                entries,
                notes: vec!["Each song is saved as its own track (Digitify keeps no albums).".into()],
            })
        }
        _ => {
            // Since February 2026 Spotify lists a playlist's songs only to its owner or collaborators.
            let Ok(list) = api(&format!("playlists/{}", link.id)) else {
                return by_oembed(vec!["Spotify didn't list this playlist's songs, so it's saved as one link played in Spotify's player.".into()]);
            };
            let image = list["images"].get(0).and_then(|i| text(i, &["url"]));
            let holder = if list.get("items").is_some() { "items" } else { "tracks" };
            let mut entries = Vec::new();
            let mut page = list[holder].clone();
            loop {
                for row in page["items"].as_array().cloned().unwrap_or_default() {
                    let track = if row.get("item").is_some() { &row["item"] } else { &row["track"] };
                    if track["type"].as_str().unwrap_or("track") == "track" {
                        entries.extend(spotify_track(link, track, image.clone()));
                    }
                }
                let Some(next) = text(&page, &["next"]).filter(|_| entries.len() < MAX_ENTRIES) else { break };
                let request = http::get(&next)?.set("Authorization", &format!("Bearer {token}"));
                match http::json("Spotify", request) {
                    Ok(next_page) => page = next_page,
                    Err(_) => break,
                }
            }
            if entries.is_empty() {
                return by_oembed(vec!["Spotify lists a playlist's songs only to its owner, so it's saved as one link played in Spotify's player.".into()]);
            }
            Ok(Preview {
                provider: "spotify".into(),
                service: "Spotify".into(),
                kind: "playlist".into(),
                collection: true,
                title: text(&list, &["name"]).unwrap_or_else(|| "Playlist".into()),
                creator: text(&list, &["owner", "display_name"]),
                thumbnail: image,
                audio: true,
                entries,
                notes: Vec::new(),
            })
        }
    }
}

// ---------------------------------------------------------------------------------------------
// SoundCloud: links, and downloads of tracks whose uploader allowed them.

const SC_API: &str = "https://api.soundcloud.com";

pub fn soundcloud_token(id: &str, secret: &str) -> AppResult<String> {
    static TOKENS: OnceLock<Mutex<HashMap<String, Token>>> = OnceLock::new();
    cached_token(&TOKENS, id, || {
        let request = http::post("https://secure.soundcloud.com/oauth/token")?.set("Authorization", &basic(id, secret)).set("accept", "application/json; charset=utf-8");
        let answer = http::send("SoundCloud", request, Some(&[("grant_type", "client_credentials")]))?
            .into_json::<Value>()
            .map_err(|_| AppError::msg("SoundCloud sent an answer Digitify couldn't read."))?;
        let token = text(&answer, &["access_token"]).ok_or_else(|| AppError::msg("SoundCloud didn't accept the keys in Settings › Online services."))?;
        Ok((token, answer["expires_in"].as_u64().unwrap_or(3600)))
    })
}

fn sc_path(permalink: &str) -> Option<String> {
    let url = url::Url::parse(permalink).ok()?;
    Some(url.path().trim_matches('/').to_string()).filter(|p| !p.is_empty())
}

fn sc_track(link: &Link, track: &Value) -> Option<Entry> {
    let permalink = text(track, &["permalink_url"])?;
    let path = sc_path(&permalink)?;
    let mut item = entry(link, LinkKind::Track, &path, &permalink, text(track, &["title"])?, true);
    item.creator = text(track, &["user", "username"]);
    item.duration_sec = track["duration"].as_f64().map(|ms| (ms / 1000.0).round());
    item.thumbnail = text(track, &["artwork_url"]).or_else(|| text(track, &["user", "avatar_url"])).map(|u| u.replace("-large.", "-t500x500."));
    if track["downloadable"] == Value::Bool(true) {
        if let Some(download) = text(track, &["download_url"]).filter(|u| u.starts_with(SC_API)) {
            item.downloadable = true;
            item.download = Some(download);
        }
    }
    if track["access"].as_str() == Some("blocked") {
        item.available = false;
        item.reason = Some("Blocked in your region or by its uploader.".into());
    }
    Some(item)
}

fn soundcloud(link: &Link, keys: Option<&(String, String)>) -> AppResult<Preview> {
    // A short link first becomes the full one.
    if link.id.starts_with("on/") {
        let response = http::send("SoundCloud", http::get(&link.url)?, None)?;
        let full = link::detect(response.get_url())?;
        if full.provider != Provider::SoundCloud || full.id.starts_with("on/") {
            return Err(AppError::msg("That SoundCloud short link doesn't lead to a track or a set."));
        }
        return soundcloud(&full, keys);
    }
    let Some((id, secret)) = keys else {
        let info = oembed("SoundCloud", "https://soundcloud.com/oembed", &link.url)?;
        let creator = text(&info, &["author_name"]);
        let title = text(&info, &["title"]).map(|t| match &creator {
            Some(c) => t.trim_end_matches(&format!(" by {c}")).to_string(),
            None => t,
        });
        let mut item = entry(link, link.kind, &link.id, &link.url, title.unwrap_or_else(|| "SoundCloud".into()), true);
        item.creator = creator;
        item.thumbnail = text(&info, &["thumbnail_url"]);
        let notes = vec![if link.kind.is_collection() {
            "Without SoundCloud keys the set is saved as one link. Add keys in Settings › Online services to pick each track, and to download the ones their uploaders allow.".into()
        } else {
            "Without SoundCloud keys Digitify can't tell whether the uploader allows downloads, so it's saved as a link. Add keys in Settings › Online services.".into()
        }];
        return Ok(single(link, item, notes));
    };
    let token = soundcloud_token(id, secret)?;
    let auth = format!("OAuth {token}");
    let resolved = http::json("SoundCloud", http::get(&format!("{SC_API}/resolve"))?.query("url", &link.url).set("Authorization", &auth))?;
    match resolved["kind"].as_str() {
        Some("track") => Ok(single(link, sc_track(link, &resolved).ok_or_else(|| AppError::msg("SoundCloud sent an answer Digitify couldn't read."))?, Vec::new())),
        Some("playlist") => {
            let listed: Vec<Value> = resolved["tracks"].as_array().cloned().unwrap_or_default();
            // Long sets list some tracks by id only; those are fetched together.
            let missing: Vec<String> = listed.iter().filter(|t| t.get("title").is_none()).filter_map(|t| t["id"].as_u64().map(|id| id.to_string())).collect();
            let mut fetched: HashMap<u64, Value> = HashMap::new();
            for chunk in missing.chunks(50) {
                let page = http::json("SoundCloud", http::get(&format!("{SC_API}/tracks"))?.query("ids", &chunk.join(",")).set("Authorization", &auth))?;
                let rows = page.as_array().cloned().or_else(|| page["collection"].as_array().cloned()).unwrap_or_default();
                for track in rows {
                    if let Some(id) = track["id"].as_u64() {
                        fetched.insert(id, track);
                    }
                }
            }
            let entries: Vec<Entry> = listed
                .iter()
                .take(MAX_ENTRIES)
                .filter_map(|t| if t.get("title").is_some() { sc_track(link, t) } else { t["id"].as_u64().and_then(|id| fetched.get(&id)).and_then(|t| sc_track(link, t)) })
                .collect();
            Ok(Preview {
                provider: "soundcloud".into(),
                service: "SoundCloud".into(),
                kind: "playlist".into(),
                collection: true,
                title: text(&resolved, &["title"]).unwrap_or_else(|| "Set".into()),
                creator: text(&resolved, &["user", "username"]),
                thumbnail: text(&resolved, &["artwork_url"]).map(|u| u.replace("-large.", "-t500x500.")),
                audio: true,
                entries,
                notes: Vec::new(),
            })
        }
        _ => Err(AppError::msg("That SoundCloud link isn't a track or a set.")),
    }
}

// ---------------------------------------------------------------------------------------------
// A direct link to a media file: downloaded like any file.

fn web(link: &Link) -> AppResult<Preview> {
    let url = url::Url::parse(&link.url).map_err(|_| AppError::msg("That link can't be read."))?;
    let name = url.path_segments().and_then(|mut s| s.next_back()).unwrap_or_default();
    let name = percent_decode(name);
    let (stem, extension) = name.rsplit_once('.').unwrap_or((&name, ""));
    let mut audio = link::media_of_extension(extension).unwrap_or(false);
    // A look at the file first, where the server allows it; the extension decides otherwise.
    if let Ok(response) = http::send("the site", http::head(&link.url)?, None) {
        let kind = response.content_type().to_ascii_lowercase();
        if kind.starts_with("text/") || kind.contains("html") {
            return Err(AppError::msg("That link leads to a web page, not to an audio or video file."));
        }
        if kind.starts_with("audio/") {
            audio = true;
        } else if kind.starts_with("video/") {
            audio = false;
        }
    }
    let title = stem.replace(['_', '.'], " ").split_whitespace().collect::<Vec<_>>().join(" ");
    let mut item = entry(link, LinkKind::File, &link.id, &link.url, if title.is_empty() { "Download".into() } else { title }, audio);
    item.downloadable = true;
    item.download = Some(link.url.clone());
    Ok(single(link, item, Vec::new()))
}

fn percent_decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(byte) = u8::from_str_radix(&text[i + 1..i + 3], 16) {
                out.push(byte);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn durations_and_credentials() {
        assert_eq!(iso_duration("PT1H2M3S"), Some(3723.0));
        assert_eq!(iso_duration("PT4M"), Some(240.0));
        assert_eq!(iso_duration("P1DT1S"), Some(86401.0));
        assert_eq!(iso_duration("nope"), None);
        assert_eq!(basic("Aladdin", "open sesame"), "Basic QWxhZGRpbjpvcGVuIHNlc2FtZQ==");
        assert_eq!(percent_decode("Song%20One"), "Song One");
    }
}

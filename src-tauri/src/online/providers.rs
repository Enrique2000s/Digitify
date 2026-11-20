//! What each service tells about a link (D-028): public oEmbed descriptions without keys, the
//! services' Web APIs with the owner's own keys, and yt-dlp (D-133) for YouTube playlists and
//! channels without a key, SoundCloud without keys, and the other sites it knows. With yt-dlp,
//! YouTube, SoundCloud and those sites can be downloaded; Spotify never (its media is DRM-protected).

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde_json::Value;

use super::http;
use super::keys::Keys;
use super::link::{self, Link, LinkKind, Provider};
use super::ytdlp::{self, YtDlp};
use super::{Entry, Preview};
use crate::error::{AppError, AppResult};

/// The most entries listed for one playlist or album.
const MAX_ENTRIES: usize = 500;

pub fn inspect(link: &Link, keys: &Keys, tool: Option<&YtDlp>) -> AppResult<Preview> {
    match link.provider {
        Provider::YouTube => youtube(link, keys.youtube.as_deref(), tool),
        Provider::Spotify => spotify(link, keys.spotify.as_ref()),
        Provider::SoundCloud => soundcloud(link, keys.soundcloud.as_ref(), tool),
        Provider::Web => web(link),
        Provider::Site => {
            let tool = tool.ok_or_else(missing_tool)?;
            from_ytdlp(link, &tool.inspect(&link.url)?, false)
        }
    }
}

fn missing_tool() -> AppError {
    AppError::msg("yt-dlp is missing from this installation, so Digitify can't read that link. Reinstall Digitify, or update yt-dlp in Settings › Online services.")
}

/// An entry yt-dlp can download (D-133): what the service doesn't allow downloading itself.
fn by_ytdlp(mut item: Entry, tool: Option<&YtDlp>) -> Entry {
    if tool.is_some() && item.available && !item.downloadable && !item.live {
        item.downloadable = true;
        item.ytdlp = true;
        item.download = Some(item.url.clone());
    }
    item
}

// ---------------------------------------------------------------------------------------------
// What yt-dlp read from a link (D-133): one video or song, or a playlist's entries.

/// Sites whose links are music rather than video.
const AUDIO_SITES: &[&str] = &["bandcamp", "soundcloud", "mixcloud", "audiomack", "hearthis", "jamendo", "audius", "freesound"];

/// A site's key and name from a link: "artist.bandcamp.com" → ("bandcamp", "Bandcamp").
fn site_of(url: &str) -> (String, String) {
    let host = url::Url::parse(url).ok().and_then(|u| u.host_str().map(str::to_ascii_lowercase)).unwrap_or_default();
    let labels: Vec<&str> = host.trim_start_matches("www.").split('.').filter(|l| !l.is_empty()).collect();
    let n = labels.len();
    let name = match n {
        0 => "web",
        1 => labels[0],
        // "bbc.co.uk": the name sits before a two-part ending.
        _ if n >= 3 && labels[n - 2].len() <= 3 && labels[n - 1].len() == 2 => labels[n - 3],
        _ => labels[n - 2],
    };
    let service = match name {
        "soundcloud" => "SoundCloud".to_string(),
        "tiktok" => "TikTok".to_string(),
        "archive" => "Internet Archive".to_string(),
        "nicovideo" => "Niconico".to_string(),
        "x" | "twitter" => "X".to_string(),
        other => {
            let mut chars = other.chars();
            chars.next().map(|first| first.to_uppercase().collect::<String>() + chars.as_str()).unwrap_or_default()
        }
    };
    (name.to_string(), service)
}

fn ytdlp_thumbnail(value: &Value) -> Option<String> {
    text(value, &["thumbnail"]).or_else(|| value["thumbnails"].as_array().and_then(|all| all.iter().rev().find_map(|t| text(t, &["url"]))))
}

/// One entry from yt-dlp's description of a video or song (a playlist's entries are briefer).
fn ytdlp_entry(link: &Link, value: &Value, audio: bool) -> Option<Entry> {
    // A playlist inside the list (a channel's tabs, an artist's albums) isn't an entry.
    if value["_type"].as_str() == Some("playlist") || value["ie_key"].as_str().is_some_and(|k| k.ends_with("Tab") || k.ends_with("Playlist") || k.ends_with("Album") || k.ends_with("User")) {
        return None;
    }
    let page = text(value, &["webpage_url"]).or_else(|| text(value, &["url"])).filter(|u| u.starts_with("https://") || u.starts_with("http://"))?;
    let id = text(value, &["id"]).unwrap_or_else(|| page.clone());
    let title = text(value, &["track"]).filter(|_| audio).or_else(|| text(value, &["title"])).unwrap_or_else(|| "Untitled".into());
    let mut item = match link.provider {
        Provider::YouTube => {
            let base = if link.service == "YouTube Music" { "https://music.youtube.com" } else { "https://www.youtube.com" };
            let mut item = entry(link, LinkKind::Video, &id, &format!("{base}/watch?v={id}"), title, audio);
            item.thumbnail = Some(format!("https://i.ytimg.com/vi/{id}/hqdefault.jpg"));
            item
        }
        Provider::SoundCloud => {
            let mut item = entry(link, LinkKind::Track, &sc_path(&page).unwrap_or(id), &page, title, true);
            item.thumbnail = ytdlp_thumbnail(value);
            item
        }
        _ => {
            let (key, service) = site_of(&page);
            let audio = audio || AUDIO_SITES.contains(&key.as_str()) || value["vcodec"].as_str() == Some("none");
            let mut item = entry(link, if audio { LinkKind::Track } else { LinkKind::Video }, &id, &page, title, audio);
            item.provider = key;
            item.service = service;
            item.thumbnail = ytdlp_thumbnail(value);
            item
        }
    };
    item.creator = ["artist", "creator", "channel", "uploader"].iter().find_map(|k| text(value, &[k])).map(|c| c.trim_end_matches(" - Topic").to_string());
    item.duration_sec = value["duration"].as_f64().filter(|d| *d > 0.0);
    let hidden = item.title.starts_with("[Private") || item.title.starts_with("[Deleted");
    match (value["availability"].as_str(), value["live_status"].as_str()) {
        _ if hidden => {
            item.available = false;
            item.reason = Some("Private or removed.".into());
        }
        (Some("private" | "needs_auth" | "subscriber_only" | "premium_only"), _) => {
            item.available = false;
            item.reason = Some("Private, for members, or behind a sign-in.".into());
        }
        (_, Some("is_upcoming")) => {
            item.available = false;
            item.reason = Some("Not out yet.".into());
        }
        (_, Some("is_live")) => {
            item.live = true;
            item.reason = Some("Live now: it can be downloaded once the stream is over.".into());
        }
        _ => {}
    }
    Some(item)
}

/// A preview from yt-dlp's description of a link: everything it holds can be downloaded.
fn from_ytdlp(link: &Link, info: &Value, audio: bool) -> AppResult<Preview> {
    let mark = |mut item: Entry| {
        if item.available && !item.downloadable && !item.live {
            item.downloadable = true;
            item.ytdlp = true;
            item.download = Some(item.url.clone());
        }
        item
    };
    if info["_type"].as_str() == Some("playlist") {
        let listed: Vec<Value> = info["entries"].as_array().cloned().unwrap_or_default();
        // A channel's entries don't repeat its name.
        let owner = ["channel", "uploader"].iter().find_map(|k| text(info, &[k])).map(|c| c.trim_end_matches(" - Topic").to_string());
        let entries: Vec<Entry> = listed
            .iter()
            .filter_map(|value| ytdlp_entry(link, value, audio))
            .map(|mut item| {
                if item.creator.is_none() {
                    item.creator = owner.clone();
                }
                mark(item)
            })
            .take(ytdlp::MAX_ENTRIES)
            .collect();
        if entries.is_empty() {
            return Err(AppError::msg(if listed.is_empty() {
                "That playlist is empty, or private."
            } else {
                "That page lists playlists rather than videos or songs: open one of them and copy its link."
            }));
        }
        let mut notes = Vec::new();
        if info["playlist_count"].as_u64().is_some_and(|n| n as usize > entries.len()) && entries.len() >= ytdlp::MAX_ENTRIES {
            notes.push(format!("Only the first {} are listed.", ytdlp::MAX_ENTRIES));
        }
        let audio = audio || entries.iter().all(|e| e.audio);
        let (provider, service) = (entries[0].provider.clone(), entries[0].service.clone());
        return Ok(Preview {
            provider,
            service,
            kind: link.kind.key().into(),
            collection: true,
            title: text(info, &["title"]).unwrap_or_else(|| "Playlist".into()),
            creator: owner,
            thumbnail: ytdlp_thumbnail(info).or_else(|| entries.iter().find_map(|e| e.thumbnail.clone())),
            audio,
            entries,
            notes,
        });
    }
    let item = mark(ytdlp_entry(link, info, audio).ok_or_else(|| AppError::msg("Digitify can't find anything to download at that link."))?);
    let mut preview = single(link, item, Vec::new());
    preview.provider = preview.entries[0].provider.clone();
    preview.service = preview.entries[0].service.clone();
    preview.kind = preview.entries[0].kind.clone();
    Ok(preview)
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
        ytdlp: false,
        live: false,
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
// YouTube and YouTube Music: online items in YouTube's player, or downloaded with yt-dlp (D-133).

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

fn youtube(link: &Link, key: Option<&str>, tool: Option<&YtDlp>) -> AppResult<Preview> {
    let audio = link.service == "YouTube Music";
    let base = if audio { "https://music.youtube.com" } else { "https://www.youtube.com" };
    // A channel's videos are listed by yt-dlp (YouTube's API would need its id looked up first).
    let channel = link.kind == LinkKind::Playlist && link.id.contains('/');
    if channel || (link.kind == LinkKind::Playlist && key.is_none() && tool.is_some()) {
        let tool = tool.ok_or_else(missing_tool)?;
        return from_ytdlp(link, &tool.inspect(&link.url)?, audio);
    }
    let Some(key) = key else {
        // Without a key: the public description of the link (no length). When YouTube won't
        // describe it, yt-dlp says why (removed, private…).
        let info = match oembed(link.service, "https://www.youtube.com/oembed", &link.url) {
            Ok(info) => info,
            Err(error) => match tool {
                Some(tool) if link.kind == LinkKind::Video => return from_ytdlp(link, &tool.inspect(&link.url)?, audio),
                _ => return Err(error),
            },
        };
        let mut item = entry(link, link.kind, &link.id, &link.url, text(&info, &["title"]).unwrap_or_else(|| link.service.into()), audio);
        item.creator = text(&info, &["author_name"]);
        item.thumbnail = text(&info, &["thumbnail_url"]);
        let notes = if link.kind == LinkKind::Playlist {
            vec!["Without a YouTube key the playlist is saved as one link. Add a key in Settings › Online services to see and pick each video.".into()]
        } else {
            Vec::new()
        };
        let item = if link.kind == LinkKind::Video { by_ytdlp(item, tool) } else { item };
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
        if video.is_some_and(|v| v["snippet"]["liveBroadcastContent"].as_str() == Some("live")) {
            item.live = true;
            item.reason = Some("Live now: it can be downloaded once the stream is over.".into());
        }
        by_ytdlp(item, tool)
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

fn soundcloud(link: &Link, keys: Option<&(String, String)>, tool: Option<&YtDlp>) -> AppResult<Preview> {
    // A short link first becomes the full one.
    if link.id.starts_with("on/") {
        let response = http::send("SoundCloud", http::get(&link.url)?, None)?;
        let full = link::detect(response.get_url())?;
        if full.provider != Provider::SoundCloud || full.id.starts_with("on/") {
            return Err(AppError::msg("That SoundCloud short link doesn't lead to a track or a set."));
        }
        return soundcloud(&full, keys, tool);
    }
    // Without keys, yt-dlp lists a set's tracks and downloads them (D-133).
    if let (None, Some(tool)) = (keys, tool) {
        return from_ytdlp(link, &tool.inspect(&link.url)?, true);
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
        Some("track") => Ok(single(link, by_ytdlp(sc_track(link, &resolved).ok_or_else(|| AppError::msg("SoundCloud sent an answer Digitify couldn't read."))?, tool), Vec::new())),
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
                .map(|t| by_ytdlp(t, tool))
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

    #[test]
    fn sites_and_ytdlp_entries() {
        assert_eq!(site_of("https://artist.bandcamp.com/track/x"), ("bandcamp".into(), "Bandcamp".into()));
        assert_eq!(site_of("https://www.bbc.co.uk/iplayer"), ("bbc".into(), "Bbc".into()));
        assert_eq!(site_of("https://player.vimeo.com/video/1"), ("vimeo".into(), "Vimeo".into()));
        let link = link::detect("https://www.youtube.com/playlist?list=PLabc").unwrap();
        let info: Value = serde_json::from_str(r#"{"_type":"playlist","title":"Mix","channel":"Someone","playlist_count":3,"entries":[
            {"_type":"url","ie_key":"Youtube","id":"aaaaaaaaaaa","url":"https://www.youtube.com/watch?v=aaaaaaaaaaa","title":"One","duration":61,"channel":"Band - Topic"},
            {"_type":"url","ie_key":"Youtube","id":"bbbbbbbbbbb","url":"https://www.youtube.com/watch?v=bbbbbbbbbbb","title":"[Private video]"},
            {"_type":"url","ie_key":"Youtube","id":"ccccccccccc","url":"https://www.youtube.com/watch?v=ccccccccccc","title":"Live","live_status":"is_live"}]}"#).unwrap();
        let preview = from_ytdlp(&link, &info, false).unwrap();
        assert_eq!((preview.title.as_str(), preview.entries.len(), preview.collection), ("Mix", 3, true));
        let one = &preview.entries[0];
        assert_eq!((one.creator.as_deref(), one.duration_sec, one.downloadable, one.ytdlp), (Some("Band"), Some(61.0), true, true));
        assert_eq!(one.download.as_deref(), Some("https://www.youtube.com/watch?v=aaaaaaaaaaa"));
        assert!(!preview.entries[1].available && !preview.entries[1].downloadable);
        assert!(preview.entries[2].available && !preview.entries[2].downloadable, "a live stream is saved online");
        let site = link::detect("https://vimeo.com/1").unwrap();
        let video: Value = serde_json::from_str(r#"{"id":"1","title":"Short film","uploader":"Studio","webpage_url":"https://vimeo.com/1","duration":300,"vcodec":"avc1"}"#).unwrap();
        let preview = from_ytdlp(&site, &video, false).unwrap();
        assert_eq!((preview.service.as_str(), preview.entries[0].provider.as_str(), preview.entries[0].audio), ("Vimeo", "vimeo", false));
    }
}

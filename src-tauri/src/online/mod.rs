//! Import from URL (D-028): links from YouTube, YouTube Music, Spotify and SoundCloud, the other
//! sites yt-dlp knows (D-133), and direct links to media files.
//!
//! 1. Recognize the link (`link`), without going online.
//! 2. Ask what it is (`providers`): the services' official interfaces, or yt-dlp (`ytdlp`).
//! 3. Queue the chosen entries (`queue`): each is either downloaded (a direct file, a SoundCloud
//!    track its uploader allows, or through yt-dlp) and added like any local file; or saved as an
//!    online item that plays in the service's own player and needs a connection. Nothing online is
//!    ever presented as available offline, and nothing protected with DRM is downloaded.
//!
//! Digitify goes online only here, when the owner pastes a link, and when an online item is played.

pub(crate) mod http;
pub mod keys;
pub mod link;
mod providers;
mod queue;
pub mod ytdlp;

use std::path::{Path, PathBuf};

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, State};

use crate::error::{AppError, AppResult};
use crate::library::{blocking, reindex, sort_key, upsert_person};
use crate::{artwork, AppState, Library};

pub use queue::OnlineState;

/// One thing a link holds: a video, a track, or (when its contents can't be listed) the whole
/// playlist or album as a single link.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub provider: String,
    pub service: String,
    pub kind: String,
    pub external_id: String,
    pub url: String,
    pub title: String,
    pub creator: Option<String>,
    pub duration_sec: Option<f64>,
    pub thumbnail: Option<String>,
    /// Music (true) or video.
    pub audio: bool,
    /// The service allows downloading it (a direct file link, or a SoundCloud track its uploader
    /// made downloadable); otherwise it can only be saved as an online item.
    pub downloadable: bool,
    /// Where the file comes from, when it's downloadable.
    pub download: Option<String>,
    /// Downloaded through yt-dlp (D-133) rather than as a plain file.
    #[serde(default)]
    pub ytdlp: bool,
    /// A live stream: saved as an online item, downloadable once it's over.
    #[serde(default)]
    pub live: bool,
    pub available: bool,
    /// Why it's unavailable, or a limit worth knowing.
    pub reason: Option<String>,
    /// The library item it already is, if any.
    pub existing: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    pub provider: String,
    pub service: String,
    pub kind: String,
    /// A playlist or album whose entries are listed one by one.
    pub collection: bool,
    pub title: String,
    pub creator: Option<String>,
    pub thumbnail: Option<String>,
    pub audio: bool,
    pub entries: Vec<Entry>,
    /// Limits of this service worth telling (no keys, lists only for owners…).
    pub notes: Vec<String>,
}

fn config_dir(app: &AppHandle) -> AppResult<PathBuf> {
    crate::config::config_dir(app)
}

/// What a link is, with each entry marked when it's already in the library.
#[tauri::command]
pub async fn online_inspect(app: AppHandle, state: State<'_, AppState>, url: String) -> AppResult<Preview> {
    let library = state.library()?;
    let dir = config_dir(&app)?;
    blocking(move || {
        let link = link::detect(&url)?;
        let keys = keys::load(&dir);
        let tool = ytdlp::locate(&dir);
        let mut preview = providers::inspect(&link, &keys, tool.as_ref())?;
        library.db.with(|conn| {
            for entry in &mut preview.entries {
                entry.existing = existing(conn, entry)?;
            }
            Ok(())
        })?;
        Ok(preview)
    })
    .await
}

/// The item an entry already is: the same thing on the same service, or the same file link. What
/// yt-dlp downloads as a video and as sound (D-133) are two things; an online-only item is either.
fn existing(conn: &Connection, entry: &Entry) -> AppResult<Option<i64>> {
    Ok(conn
        .query_row(
            "SELECT o.item_id FROM online_sources o WHERE o.provider = ?1 AND o.external_id = ?2 \
             AND (o.kind = ?3 OR (o.kind IN ('video', 'track') AND ?3 IN ('video', 'track') AND (o.downloaded = 0 OR NOT ?4))) \
             ORDER BY o.kind = ?3 DESC LIMIT 1",
            params![entry.provider, entry.external_id, entry.kind, entry.ytdlp],
            |row| row.get(0),
        )
        .optional()?)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportRequest {
    pub entries: Vec<Entry>,
    /// Where music goes (a category key).
    pub music_category: String,
    /// Where videos go: Videos or Movies & Series.
    pub video_category: String,
    /// Download what may be downloaded (otherwise everything is saved as online items).
    pub download: bool,
    /// A playlist for the imported tracks that are available offline, in their original order: the
    /// one with this name, or a new one (D-146: a playlist's next section joins the same one).
    pub playlist_name: Option<String>,
    /// A collection in Videos for the imported videos (D-146): the one with this name, or a new one.
    #[serde(default)]
    pub collection_name: Option<String>,
    /// How yt-dlp downloads (D-133).
    #[serde(default)]
    pub quality: ytdlp::Quality,
}

/// Queues the chosen entries; progress arrives as `online-queue` events.
#[tauri::command]
pub async fn online_import(app: AppHandle, state: State<'_, AppState>, online: State<'_, OnlineState>, request: ImportRequest) -> AppResult<u64> {
    let library = state.library()?;
    if request.entries.is_empty() {
        return Err(AppError::msg("Pick at least one item to import."));
    }
    if request.entries.len() > 1000 {
        return Err(AppError::msg("That's more than Digitify imports at once (1,000)."));
    }
    let playlist = match request.playlist_name.as_deref().map(str::trim).filter(|n| !n.is_empty()) {
        Some(name) => {
            let name: String = name.chars().take(120).collect();
            Some(library.db.with(|conn| {
                let existing: Option<i64> = conn.query_row("SELECT id FROM playlists WHERE lower(name) = lower(?1) ORDER BY id LIMIT 1", [&name], |row| row.get(0)).optional()?;
                Ok(match existing {
                    Some(id) => id,
                    None => {
                        conn.execute("INSERT INTO playlists (name) VALUES (?1)", [&name])?;
                        conn.last_insert_rowid()
                    }
                })
            })?)
        }
        None => None,
    };
    let collection = match request.collection_name.as_deref().map(str::trim).filter(|n| !n.is_empty()) {
        Some(name) if request.entries.iter().any(|e| !e.audio) => {
            let name: String = name.chars().take(120).collect();
            let category = request.video_category.clone();
            Some(library.db.with(|conn| {
                let category = crate::library::category_id(conn, &category)?;
                let existing: Option<i64> = conn
                    .query_row("SELECT id FROM collections WHERE category_id = ?1 AND parent_id IS NULL AND lower(name) = lower(?2) ORDER BY id LIMIT 1", rusqlite::params![category, name], |row| row.get(0))
                    .optional()?;
                Ok(match existing {
                    Some(id) => id,
                    None => {
                        conn.execute("INSERT INTO collections (category_id, name, sort_name) VALUES (?1, ?2, ?3)", rusqlite::params![category, name, crate::library::sort_key(&name)])?;
                        conn.last_insert_rowid()
                    }
                })
            })?)
        }
        _ => None,
    };
    for key in [&request.music_category, &request.video_category] {
        library.db.with(|conn| crate::library::category_id(conn, key))?;
    }
    // Videos from links go to Videos (D-134); one can be moved into Movies & Series from there.
    if request.video_category != "videos" {
        return Err(AppError::msg("Videos from links go to Videos; from there one can go to Movies & Series."));
    }
    Ok(online.enqueue(&app, library, request, playlist, collection))
}

#[tauri::command]
pub fn online_queue(online: State<'_, OnlineState>) -> Vec<queue::JobView> {
    online.snapshot()
}

#[tauri::command]
pub fn online_cancel(app: AppHandle, online: State<'_, OnlineState>, id: Option<u64>) {
    online.cancel(&app, id);
}

#[tauri::command]
pub fn online_retry(app: AppHandle, online: State<'_, OnlineState>, id: u64) {
    online.retry(&app, id);
}

/// Takes finished, failed and cancelled entries off the list.
#[tauri::command]
pub fn online_clear(app: AppHandle, online: State<'_, OnlineState>) {
    online.clear(&app);
}

/// Downloads items saved as online items (D-133), each replacing its online item and keeping its
/// favorite mark, tags and collection. `audio` keeps only the sound (into Music); otherwise each
/// keeps what it is. Returns how many were queued.
#[tauri::command]
pub async fn online_download_items(app: AppHandle, state: State<'_, AppState>, online: State<'_, OnlineState>, ids: Vec<i64>, quality: ytdlp::Quality, audio: Option<bool>) -> AppResult<usize> {
    let library = state.library()?;
    let dir = config_dir(&app)?;
    let lookup = library.clone();
    let planned: Vec<(Entry, String, String)> = blocking(move || {
        if ytdlp::locate(&dir).is_none() {
            return Err(AppError::msg("yt-dlp is missing from this installation. Reinstall Digitify, or update yt-dlp in Settings › Online services."));
        }
        lookup.db.with(|conn| {
            let mut planned = Vec::new();
            for id in ids {
                let row = conn
                    .query_row(
                        "SELECT o.provider, o.service, o.kind, o.external_id, o.url, i.title, c.key, c.handler, \
                         (SELECT p.name FROM item_people ip JOIN people p ON p.id = ip.person_id WHERE ip.item_id = i.id ORDER BY ip.position LIMIT 1), \
                         json_extract(i.metadata, '$.durationSec') \
                         FROM online_sources o JOIN items i ON i.id = o.item_id JOIN categories c ON c.id = i.category_id \
                         WHERE o.item_id = ?1 AND o.downloaded = 0",
                        [id],
                        |row| {
                            Ok((
                                row.get::<_, String>(0)?,
                                row.get::<_, String>(1)?,
                                row.get::<_, String>(2)?,
                                row.get::<_, String>(3)?,
                                row.get::<_, String>(4)?,
                                row.get::<_, String>(5)?,
                                row.get::<_, String>(6)?,
                                row.get::<_, String>(7)?,
                                row.get::<_, Option<String>>(8)?,
                                row.get::<_, Option<f64>>(9)?,
                            ))
                        },
                    )
                    .optional()?;
                let Some((provider, service, kind, external_id, url, title, category, handler, creator, duration)) = row else { continue };
                // Spotify's media is DRM-protected, and a whole playlist saved as one link has no one file.
                if provider == "spotify" || matches!(kind.as_str(), "playlist" | "album") || !(url.starts_with("https://") || url.starts_with("http://")) {
                    continue;
                }
                let as_audio = audio.unwrap_or(handler == "audio");
                let music = if handler == "audio" { category.clone() } else { "music".to_string() };
                let videos = if handler == "video" { category.clone() } else { "videos".to_string() };
                let entry = Entry {
                    provider,
                    service,
                    kind,
                    external_id,
                    url: url.clone(),
                    title,
                    creator,
                    duration_sec: duration,
                    thumbnail: None,
                    audio: as_audio,
                    downloadable: true,
                    download: Some(url),
                    ytdlp: true,
                    live: false,
                    available: true,
                    reason: None,
                    existing: Some(id),
                };
                planned.push((entry, music, videos));
            }
            Ok(planned)
        })
    })
    .await?;
    if planned.is_empty() {
        return Err(AppError::msg("None of these can be downloaded (Spotify's songs and whole playlists saved as one link can't)."));
    }
    let count = planned.len();
    for (entry, music, videos) in planned {
        let request = ImportRequest { entries: vec![entry], music_category: music, video_category: videos, download: true, playlist_name: None, collection_name: None, quality: quality.clone() };
        online.enqueue(&app, library.clone(), request, None, None);
    }
    Ok(count)
}

#[tauri::command]
pub fn ytdlp_status(app: AppHandle) -> AppResult<ytdlp::Status> {
    Ok(ytdlp::status(&config_dir(&app)?))
}

/// Updates yt-dlp to its newest release (only when asked: Digitify never checks by itself).
#[tauri::command]
pub async fn ytdlp_update(app: AppHandle) -> AppResult<ytdlp::Status> {
    let dir = config_dir(&app)?;
    blocking(move || {
        ytdlp::update(&dir)?;
        Ok(ytdlp::status(&dir))
    })
    .await
}

#[tauri::command]
pub fn online_keys_status(app: AppHandle) -> AppResult<keys::KeysStatus> {
    Ok(keys::load(&config_dir(&app)?).status())
}

/// Saves or (with no values) removes one service's keys.
#[tauri::command]
pub fn online_keys_set(app: AppHandle, service: String, first: Option<String>, second: Option<String>) -> AppResult<keys::KeysStatus> {
    let dir = config_dir(&app)?;
    let mut keys = keys::load(&dir);
    let clean = |v: Option<String>| v.map(|v| v.trim().to_string()).filter(|v| !v.is_empty() && v.len() < 500);
    let (first, second) = (clean(first), clean(second));
    match service.as_str() {
        "youtube" => keys.youtube = first,
        "spotify" => keys.spotify = first.zip(second),
        "soundcloud" => keys.soundcloud = first.zip(second),
        _ => return Err(AppError::msg("unknown service")),
    }
    keys::save(&dir, &keys)?;
    Ok(keys.status())
}

/// Where an item came from, for its page and its player.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OnlineSource {
    pub provider: String,
    pub service: String,
    pub kind: String,
    pub external_id: String,
    pub url: String,
    /// A copy is in the library (available offline); otherwise it needs a connection.
    pub downloaded: bool,
}

pub fn source(conn: &Connection, item: i64) -> AppResult<Option<OnlineSource>> {
    Ok(conn
        .query_row(
            "SELECT provider, service, kind, external_id, url, downloaded FROM online_sources WHERE item_id = ?1",
            [item],
            |row| Ok(OnlineSource { provider: row.get(0)?, service: row.get(1)?, kind: row.get(2)?, external_id: row.get(3)?, url: row.get(4)?, downloaded: row.get(5)? }),
        )
        .optional()?)
}

/// Opens an item's original page in the default browser (only the link it was imported from).
#[tauri::command]
pub async fn online_open(state: State<'_, AppState>, id: i64) -> AppResult<()> {
    let library = state.library()?;
    let url = blocking(move || library.db.with(|conn| source(conn, id)))
        .await?
        .map(|s| s.url)
        .ok_or_else(|| AppError::msg("This item wasn't imported from a link."))?;
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err(AppError::msg("That link can't be opened."));
    }
    open_in_browser(&url)
}

fn open_in_browser(url: &str) -> AppResult<()> {
    crate::tools::open_link(url).map_err(|e| AppError::msg(format!("Couldn't open the browser: {e}")))
}

// ---------------------------------------------------------------------------------------------
// Saving

/// The entry's thumbnail as the item's artwork, when it can be fetched.
fn fetch_artwork(library: &Library, entry: &Entry) -> Option<artwork::Artwork> {
    let bytes = http::image(entry.thumbnail.as_deref()?)?;
    artwork::store(&library.folder, &bytes).ok()
}

/// An online item: details and artwork from the service, and where it lives. No files.
pub(crate) fn save_link(library: &Library, entry: &Entry, category: &str) -> AppResult<i64> {
    let art = fetch_artwork(library, entry);
    library.db.with(|conn| {
        let tx = conn.transaction()?;
        let category_id = crate::library::category_id(&tx, category)?;
        let mut metadata = serde_json::Map::new();
        if let Some(seconds) = entry.duration_sec {
            metadata.insert("durationSec".into(), json!(seconds.round() as i64));
        }
        tx.execute(
            "INSERT INTO items (category_id, title, sort_title, cover_key, cover_color, metadata) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![category_id, entry.title, sort_key(&entry.title), art.as_ref().map(|a| &a.key), art.as_ref().map(|a| &a.color), serde_json::Value::Object(metadata).to_string()],
        )?;
        let item = tx.last_insert_rowid();
        if let Some(creator) = &entry.creator {
            let person = upsert_person(&tx, creator)?;
            let role = if entry.audio { "artist" } else { "creator" };
            tx.execute("INSERT INTO item_people (item_id, person_id, role, position) VALUES (?1, ?2, ?3, 0)", params![item, person, role])?;
        }
        record_source(&tx, item, entry, false)?;
        reindex(&tx, item)?;
        tx.commit()?;
        Ok(item)
    })
}

fn record_source(conn: &Connection, item: i64, entry: &Entry, downloaded: bool) -> AppResult<()> {
    conn.execute(
        "INSERT INTO online_sources (item_id, provider, service, kind, external_id, url, downloaded) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) \
         ON CONFLICT(item_id) DO UPDATE SET downloaded = excluded.downloaded",
        params![item, entry.provider, entry.service, entry.kind, entry.external_id, entry.url, downloaded],
    )?;
    Ok(())
}

/// A download taking an online-only item's place: the new item keeps its favorite mark, tags and
/// (in the same category) collection, and the online-only one goes.
fn take_over(conn: &Connection, old: i64, new: i64) -> AppResult<()> {
    conn.execute("UPDATE items SET is_favorite = is_favorite OR (SELECT is_favorite FROM items WHERE id = ?1) WHERE id = ?2", params![old, new])?;
    conn.execute("INSERT OR IGNORE INTO item_tags (item_id, tag_id) SELECT ?2, tag_id FROM item_tags WHERE item_id = ?1", params![old, new])?;
    conn.execute(
        "UPDATE items SET collection_id = (SELECT o.collection_id FROM items o WHERE o.id = ?1 AND o.category_id = items.category_id) \
         WHERE id = ?2 AND collection_id IS NULL",
        params![old, new],
    )?;
    conn.execute("DELETE FROM items_fts WHERE rowid = ?1", [old])?;
    conn.execute("DELETE FROM items WHERE id = ?1", [old])?;
    Ok(())
}

/// A downloaded file, added like any local file (tags, artwork, the same-file check), then given
/// the service's details where the file has none, the chosen category, and its origin. `cover` is
/// the picture yt-dlp saved for it, used over a frame of the video. `replaces` is an online-only
/// item this download takes the place of.
/// Returns the item and whether it was already in the library.
pub(crate) fn save_download(library: &Library, entry: &Entry, category: &str, path: &Path, cover: Option<&[u8]>, replaces: Option<i64>) -> AppResult<(i64, bool)> {
    let ids = crate::import::import_in_place(library, &[path.to_path_buf()])?;
    let Some(&item) = ids.first() else {
        // The very same file is already in the library: keep that one, drop this copy.
        let hash = {
            let size = std::fs::metadata(path)?.len();
            crate::files::quick_hash(path, size)?
        };
        let found: Option<i64> = library.db.with(|conn| {
            Ok(conn
                .query_row("SELECT v.item_id FROM files f JOIN versions v ON v.id = f.version_id WHERE f.quick_hash = ?1 LIMIT 1", [&hash], |row| row.get(0))
                .optional()?)
        })?;
        let _ = std::fs::remove_file(path);
        let found = found.ok_or_else(|| AppError::msg("The downloaded file isn't a format Digitify can play."))?;
        if let Some(old) = replaces.filter(|old| *old != found) {
            library.db.with(|conn| {
                let tx = conn.transaction()?;
                take_over(&tx, old, found)?;
                reindex(&tx, found)?;
                tx.commit()?;
                Ok(())
            })?;
        }
        return Ok((found, true));
    };
    let saved = cover.and_then(|bytes| artwork::store(&library.folder, bytes).ok());
    let art = if saved.is_some() { saved.clone() } else { fetch_artwork(library, entry) };
    library.db.with(|conn| {
        let tx = conn.transaction()?;
        let category_id = crate::library::category_id(&tx, category)?;
        let handler: String = tx.query_row("SELECT handler FROM categories WHERE id = ?1", [category_id], |row| row.get(0))?;
        let current: String = tx.query_row("SELECT c.handler FROM items i JOIN categories c ON c.id = i.category_id WHERE i.id = ?1", [item], |row| row.get(0))?;
        if handler == current || handler == "generic" {
            tx.execute("UPDATE items SET category_id = ?2 WHERE id = ?1", params![item, category_id])?;
        }
        // The title the service shows is the one the person picked; a file name rarely says more.
        tx.execute("UPDATE items SET title = ?2, sort_title = ?3 WHERE id = ?1", params![item, entry.title, sort_key(&entry.title)])?;
        tx.execute("UPDATE parts SET title = ?2 WHERE item_id = ?1 AND kind = 'track'", params![item, entry.title])?;
        let has_people: bool = tx.query_row("SELECT EXISTS (SELECT 1 FROM item_people WHERE item_id = ?1)", [item], |row| row.get(0))?;
        if let (false, Some(creator)) = (has_people, &entry.creator) {
            let person = upsert_person(&tx, creator)?;
            let role = if entry.audio { "artist" } else { "creator" };
            tx.execute("INSERT INTO item_people (item_id, person_id, role, position) VALUES (?1, ?2, ?3, 0)", params![item, person, role])?;
        }
        if let Some(art) = &saved {
            tx.execute("UPDATE items SET cover_key = ?2, cover_color = ?3 WHERE id = ?1", params![item, art.key, art.color])?;
        } else if let Some(art) = &art {
            tx.execute("UPDATE items SET cover_key = ?2, cover_color = ?3 WHERE id = ?1 AND cover_key IS NULL", params![item, art.key, art.color])?;
        }
        if let Some(seconds) = entry.duration_sec {
            tx.execute("UPDATE items SET metadata = json_set(metadata, '$.durationSec', ?2) WHERE id = ?1 AND json_extract(metadata, '$.durationSec') IS NULL", params![item, seconds.round() as i64])?;
        }
        // The online-only item goes before this one takes its link (one item per link).
        if let Some(old) = replaces.filter(|old| *old != item) {
            take_over(&tx, old, item)?;
        }
        record_source(&tx, item, entry, true)?;
        reindex(&tx, item)?;
        tx.commit()?;
        Ok((item, false))
    })
}

//! The music player (Phase 3, D-020): library tracks played by a second, audio-only mpv process,
//! with the queue as mpv's playlist so tracks follow each other without gaps. Tracks are the parts
//! of album items. Also favorite tracks, playlists, recently played, and editing a track's details
//! (in the catalog only; files are never changed, D-009).

use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;

use rusqlite::{params, params_from_iter, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, State};
use tokio::io::AsyncWriteExt;
use tokio::sync::mpsc;

use crate::error::{AppError, AppResult};
use crate::library::{blocking, with_library};
use crate::player;
use crate::{AppState, Library};

/// mpv properties mirrored to the UI as `music-event`s.
const OBSERVED: &[&str] = &["pause", "time-pos", "duration", "playlist-pos", "playlist", "volume", "mute", "loop-playlist", "loop-file", "idle-active"];
const MAX_QUEUE: usize = 5000;

static NEXT_PIPE: AtomicU32 = AtomicU32::new(1);

#[derive(Default)]
pub struct MusicState {
    session: Mutex<Option<Session>>,
}

struct Session {
    child: Child,
    commands: mpsc::UnboundedSender<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub id: i64,
    pub item_id: i64,
    pub title: String,
    pub artist: Option<String>,
    pub album: String,
    pub number: Option<f64>,
    pub duration_ms: Option<i64>,
    pub cover_key: Option<String>,
    pub favorite: bool,
    pub genre: Option<String>,
}

const TRACK_SELECT: &str = "SELECT p.id, p.item_id, coalesce(p.title, i.title), \
     coalesce(json_extract(p.metadata, '$.artist'), \
              (SELECT group_concat(pe.name, ', ') FROM item_people ip JOIN people pe ON pe.id = ip.person_id \
               WHERE ip.item_id = i.id AND ip.role = 'artist')), \
     i.title, p.number, p.duration_ms, i.cover_key, p.is_favorite, json_extract(i.metadata, '$.genre') \
     FROM parts p JOIN items i ON i.id = p.item_id JOIN categories c ON c.id = i.category_id";

fn track(row: &rusqlite::Row<'_>) -> rusqlite::Result<Track> {
    Ok(Track {
        id: row.get(0)?,
        item_id: row.get(1)?,
        title: row.get(2)?,
        artist: row.get(3)?,
        album: row.get(4)?,
        number: row.get(5)?,
        duration_ms: row.get(6)?,
        cover_key: row.get(7)?,
        favorite: row.get(8)?,
        genre: row.get(9)?,
    })
}

/// Which tracks to list: all of them, or narrowed down.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackFilter {
    /// Words matched against title, artist, album and genre.
    pub search: Option<String>,
    pub artist: Option<String>,
    /// One album: its item id.
    pub album: Option<i64>,
    pub favorites: Option<bool>,
    pub playlist: Option<i64>,
    /// Most recently played first.
    pub recent: Option<bool>,
    /// Exactly these tracks, in this order.
    pub ids: Option<Vec<i64>>,
}

fn tracks(conn: &Connection, filter: &TrackFilter) -> AppResult<Vec<Track>> {
    let mut sql = String::from(TRACK_SELECT);
    let mut args: Vec<rusqlite::types::Value> = Vec::new();
    if let Some(playlist) = filter.playlist {
        sql.push_str(" JOIN playlist_tracks pt ON pt.part_id = p.id AND pt.playlist_id = ?");
        args.push(playlist.into());
    }
    sql.push_str(" WHERE p.kind = 'track' AND c.handler = 'audio'");
    if filter.favorites == Some(true) {
        sql.push_str(" AND p.is_favorite = 1");
    }
    if let Some(album) = filter.album {
        sql.push_str(" AND p.item_id = ?");
        args.push(album.into());
    }
    if let Some(ids) = &filter.ids {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        sql.push_str(&format!(" AND p.id IN ({})", vec!["?"; ids.len()].join(",")));
        args.extend(ids.iter().map(|&id| id.into()));
    }
    let haystack = "lower(coalesce(p.title, '') || ' ' || coalesce(json_extract(p.metadata, '$.artist'), '') || ' ' || i.title || ' ' || \
                    coalesce(json_extract(i.metadata, '$.genre'), '') || ' ' || coalesce((SELECT group_concat(pe.name, ' ') FROM item_people ip \
                    JOIN people pe ON pe.id = ip.person_id WHERE ip.item_id = i.id), ''))";
    for word in filter.search.as_deref().unwrap_or_default().split_whitespace().take(8) {
        sql.push_str(&format!(" AND instr({haystack}, ?) > 0"));
        args.push(word.to_lowercase().into());
    }
    if let Some(artist) = &filter.artist {
        sql.push_str(
            " AND (lower(json_extract(p.metadata, '$.artist')) = lower(?) OR EXISTS (SELECT 1 FROM item_people ip JOIN people pe ON pe.id = ip.person_id \
             WHERE ip.item_id = i.id AND ip.role = 'artist' AND lower(pe.name) = lower(?)))",
        );
        args.push(artist.clone().into());
        args.push(artist.clone().into());
    }
    if filter.recent == Some(true) {
        sql.push_str(" AND EXISTS (SELECT 1 FROM plays pl WHERE pl.part_id = p.id) ORDER BY (SELECT max(played_at) FROM plays pl WHERE pl.part_id = p.id) DESC LIMIT 100");
    } else if filter.playlist.is_some() {
        sql.push_str(" ORDER BY pt.position");
    } else if filter.album.is_some() {
        sql.push_str(" ORDER BY p.position, p.number");
    } else {
        sql.push_str(" ORDER BY i.sort_title, p.position, p.number LIMIT 20000");
    }
    let mut list: Vec<Track> = conn.prepare(&sql)?.query_map(params_from_iter(args), track)?.collect::<Result<_, _>>()?;
    if let Some(ids) = &filter.ids {
        list.sort_by_key(|t| ids.iter().position(|&id| id == t.id).unwrap_or(usize::MAX));
    }
    Ok(list)
}

#[tauri::command]
pub async fn music_tracks(state: State<'_, AppState>, filter: TrackFilter) -> AppResult<Vec<Track>> {
    with_library(&state, move |library| library.db.with(|conn| tracks(conn, &filter))).await
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Artist {
    pub name: String,
    pub albums: i64,
    pub tracks: i64,
}

/// Album artists and the artists of individual tracks, with how much of each is in the library.
#[tauri::command]
pub async fn music_artists(state: State<'_, AppState>) -> AppResult<Vec<Artist>> {
    with_library(&state, move |library| {
        library.db.with(|conn| {
            let artists = conn
                .prepare(
                    "WITH credits AS ( \
                       SELECT coalesce(json_extract(p.metadata, '$.artist'), pe.name) AS name, p.item_id, p.id AS part_id \
                       FROM parts p JOIN items i ON i.id = p.item_id JOIN categories c ON c.id = i.category_id \
                       LEFT JOIN item_people ip ON ip.item_id = i.id AND ip.role = 'artist' LEFT JOIN people pe ON pe.id = ip.person_id \
                       WHERE p.kind = 'track' AND c.handler = 'audio') \
                     SELECT name, count(DISTINCT item_id), count(DISTINCT part_id) FROM credits WHERE name IS NOT NULL \
                     GROUP BY lower(name) ORDER BY lower(name)",
                )?
                .query_map([], |row| Ok(Artist { name: row.get(0)?, albums: row.get(1)?, tracks: row.get(2)? }))?
                .collect::<Result<_, _>>()?;
            Ok(artists)
        })
    })
    .await
}

#[tauri::command]
pub async fn music_set_favorite(state: State<'_, AppState>, id: i64, favorite: bool) -> AppResult<()> {
    with_library(&state, move |library| {
        library.db.with(|conn| {
            conn.execute("UPDATE parts SET is_favorite = ?2 WHERE id = ?1 AND kind = 'track'", params![id, favorite])?;
            Ok(())
        })
    })
    .await
}

/// A track's own details, in the catalog only (D-009): its title, artist and number.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackEdit {
    pub title: String,
    pub artist: Option<String>,
    pub number: Option<f64>,
}

#[tauri::command]
pub async fn track_update(state: State<'_, AppState>, id: i64, edit: TrackEdit) -> AppResult<()> {
    let title = edit.title.split_whitespace().collect::<Vec<_>>().join(" ");
    if title.is_empty() {
        return Err(AppError::msg("A track needs a title."));
    }
    let artist = edit.artist.map(|a| a.split_whitespace().collect::<Vec<_>>().join(" ")).filter(|a| !a.is_empty());
    with_library(&state, move |library| {
        library.db.with(|conn| {
            conn.execute(
                "UPDATE parts SET title = ?2, number = ?3, \
                 metadata = CASE WHEN ?4 IS NULL THEN json_remove(metadata, '$.artist') ELSE json_set(metadata, '$.artist', ?4) END \
                 WHERE id = ?1 AND kind = 'track'",
                params![id, title, edit.number, artist],
            )?;
            Ok(())
        })
    })
    .await
}

/// Remembers that a track started playing, for "Recently played".
#[tauri::command]
pub async fn music_played(state: State<'_, AppState>, id: i64) -> AppResult<()> {
    with_library(&state, move |library| {
        library.db.with(|conn| {
            conn.execute("INSERT INTO plays (part_id) SELECT id FROM parts WHERE id = ?1 AND kind = 'track'", [id])?;
            conn.execute("DELETE FROM plays WHERE id NOT IN (SELECT id FROM plays ORDER BY played_at DESC LIMIT 2000)", [])?;
            Ok(())
        })
    })
    .await
}

// ---------------------------------------------------------------------------------------------
// Playlists

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Playlist {
    pub id: i64,
    pub name: String,
    pub tracks: i64,
    pub duration_ms: i64,
    pub updated_at: String,
}

#[tauri::command]
pub async fn playlists_list(state: State<'_, AppState>) -> AppResult<Vec<Playlist>> {
    with_library(&state, move |library| {
        library.db.with(|conn| {
            let lists = conn
                .prepare(
                    "SELECT pl.id, pl.name, count(pt.id), coalesce(sum(p.duration_ms), 0), pl.updated_at FROM playlists pl \
                     LEFT JOIN playlist_tracks pt ON pt.playlist_id = pl.id LEFT JOIN parts p ON p.id = pt.part_id \
                     GROUP BY pl.id ORDER BY lower(pl.name)",
                )?
                .query_map([], |row| Ok(Playlist { id: row.get(0)?, name: row.get(1)?, tracks: row.get(2)?, duration_ms: row.get(3)?, updated_at: row.get(4)? }))?
                .collect::<Result<_, _>>()?;
            Ok(lists)
        })
    })
    .await
}

fn clean_name(name: &str) -> AppResult<String> {
    let name: String = name.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(120).collect();
    if name.is_empty() {
        return Err(AppError::msg("Give the playlist a name."));
    }
    Ok(name)
}

#[tauri::command]
pub async fn playlist_create(state: State<'_, AppState>, name: String, tracks: Vec<i64>) -> AppResult<i64> {
    let name = clean_name(&name)?;
    with_library(&state, move |library| {
        library.db.with(|conn| {
            let tx = conn.transaction()?;
            tx.execute("INSERT INTO playlists (name) VALUES (?1)", [&name])?;
            let id = tx.last_insert_rowid();
            for (position, part) in tracks.iter().enumerate() {
                tx.execute("INSERT INTO playlist_tracks (playlist_id, part_id, position) VALUES (?1, ?2, ?3)", params![id, part, position as i64])?;
            }
            tx.commit()?;
            Ok(id)
        })
    })
    .await
}

#[tauri::command]
pub async fn playlist_rename(state: State<'_, AppState>, id: i64, name: String) -> AppResult<()> {
    let name = clean_name(&name)?;
    with_library(&state, move |library| {
        library.db.with(|conn| {
            conn.execute("UPDATE playlists SET name = ?2, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?1", params![id, name])?;
            Ok(())
        })
    })
    .await
}

#[tauri::command]
pub async fn playlist_delete(state: State<'_, AppState>, id: i64) -> AppResult<()> {
    with_library(&state, move |library| {
        library.db.with(|conn| {
            conn.execute("DELETE FROM playlists WHERE id = ?1", [id])?;
            Ok(())
        })
    })
    .await
}

/// Adds tracks to the end of a playlist.
#[tauri::command]
pub async fn playlist_add(state: State<'_, AppState>, id: i64, tracks: Vec<i64>) -> AppResult<()> {
    with_library(&state, move |library| {
        library.db.with(|conn| {
            let tx = conn.transaction()?;
            let start: i64 = tx.query_row("SELECT coalesce(max(position) + 1, 0) FROM playlist_tracks WHERE playlist_id = ?1", [id], |row| row.get(0))?;
            for (offset, part) in tracks.iter().enumerate() {
                tx.execute("INSERT INTO playlist_tracks (playlist_id, part_id, position) VALUES (?1, ?2, ?3)", params![id, part, start + offset as i64])?;
            }
            tx.execute("UPDATE playlists SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?1", [id])?;
            tx.commit()?;
            Ok(())
        })
    })
    .await
}

/// Replaces a playlist's tracks with these, in this order (reordering and removing).
#[tauri::command]
pub async fn playlist_set(state: State<'_, AppState>, id: i64, tracks: Vec<i64>) -> AppResult<()> {
    with_library(&state, move |library| {
        library.db.with(|conn| {
            let tx = conn.transaction()?;
            tx.execute("DELETE FROM playlist_tracks WHERE playlist_id = ?1", [id])?;
            for (position, part) in tracks.iter().enumerate() {
                tx.execute("INSERT INTO playlist_tracks (playlist_id, part_id, position) VALUES (?1, ?2, ?3)", params![id, part, position as i64])?;
            }
            tx.execute("UPDATE playlists SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?1", [id])?;
            tx.commit()?;
            Ok(())
        })
    })
    .await
}

// ---------------------------------------------------------------------------------------------
// Playback

/// A queued track and the file mpv plays for it; the UI matches mpv's playlist by `path`.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueEntry {
    pub path: String,
    pub track: Track,
}

fn resolve(library: &Library, parts: &[i64]) -> AppResult<Vec<QueueEntry>> {
    if parts.len() > MAX_QUEUE {
        return Err(AppError::msg("That's more tracks than the queue can hold."));
    }
    library.db.with(|conn| {
        let list = tracks(conn, &TrackFilter { ids: Some(parts.to_vec()), ..TrackFilter::default() })?;
        let mut stmt = conn.prepare_cached(
            "SELECT f.path, f.storage, f.status FROM files f JOIN versions v ON v.id = f.version_id \
             WHERE f.part_id = ?1 AND v.kind = 'digital' ORDER BY v.is_primary DESC, v.id LIMIT 1",
        )?;
        let mut entries = Vec::with_capacity(list.len());
        for track in list {
            let row: Option<(String, String, String)> = stmt.query_row([track.id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?))).ok();
            let Some((path, storage, status)) = row else { continue };
            let path: PathBuf = library.folder.resolve(&path, &storage);
            if status == "ok" && path.exists() {
                entries.push(QueueEntry { path: path.to_string_lossy().into_owned(), track });
            }
        }
        Ok(entries)
    })
}

/// Starts the audio-only mpv, or returns the running one's command queue.
async fn session(app: &AppHandle, state: &MusicState, volume: f64) -> AppResult<mpsc::UnboundedSender<String>> {
    {
        let mut guard = state.session.lock().map_err(|_| AppError::msg("music state is unavailable"))?;
        if let Some(session) = guard.as_mut() {
            if matches!(session.child.try_wait(), Ok(None)) {
                return Ok(session.commands.clone());
            }
            *guard = None;
        }
    }
    let pipe = format!(r"\\.\pipe\digitify-music-{}-{}", std::process::id(), NEXT_PIPE.fetch_add(1, Ordering::Relaxed));
    let log_file = app.path().app_log_dir()?.join("mpv-music.log");
    let mut child = Command::new(player::mpv_path()?)
        .args([
            "--no-config".to_string(),
            format!("--input-ipc-server={pipe}"),
            "--idle=yes".into(),
            "--no-video".into(),
            "--audio-display=no".into(),
            "--force-window=no".into(),
            "--gapless-audio=yes".into(),
            "--prefetch-playlist=yes".into(),
            format!("--volume={}", volume.clamp(0.0, 100.0).round()),
            "--input-default-bindings=no".into(),
            "--load-scripts=no".into(),
            "--ytdl=no".into(),
            "--terminal=no".into(),
            format!("--log-file={}", log_file.display()),
        ])
        .spawn()
        .map_err(|e| AppError::msg(format!("could not start mpv: {e}")))?;
    let client = match player::connect(&pipe).await {
        Ok(client) => client,
        Err(e) => {
            let _ = child.kill();
            return Err(e);
        }
    };
    let (reader, mut writer) = tokio::io::split(client);
    let (commands, mut queue) = mpsc::unbounded_channel::<String>();
    tauri::async_runtime::spawn(async move {
        while let Some(line) = queue.recv().await {
            if writer.write_all(line.as_bytes()).await.is_err() {
                break;
            }
        }
    });
    tauri::async_runtime::spawn(player::forward(reader, app.clone(), "music-event"));
    for (index, name) in OBSERVED.iter().enumerate() {
        player::send(&commands, json!({ "command": ["observe_property", index + 1, name] }));
    }
    log::info!("music player started (mpv pid {})", child.id());
    *state.session.lock().map_err(|_| AppError::msg("music state is unavailable"))? = Some(Session { child, commands: commands.clone() });
    Ok(commands)
}

/// Plays these tracks as the queue, starting with the one at `start`.
#[tauri::command]
pub async fn music_play(app: AppHandle, state: State<'_, MusicState>, tracks: Vec<i64>, start: usize, volume: f64) -> AppResult<Vec<QueueEntry>> {
    let library = app.state::<AppState>().library()?;
    let wanted = tracks.get(start).copied();
    let entries = blocking(move || resolve(&library, &tracks)).await?;
    if entries.is_empty() {
        return Err(AppError::msg("None of these tracks can be found. If they're on a drive that isn't connected, connect it."));
    }
    let commands = session(&app, &state, volume).await?;
    let index = wanted.and_then(|id| entries.iter().position(|e| e.track.id == id)).unwrap_or(0);
    for (position, entry) in entries.iter().enumerate() {
        let mode = if position == 0 { "replace" } else { "append" };
        player::send(&commands, json!({ "command": ["loadfile", entry.path, mode] }));
    }
    player::send(&commands, json!({ "command": ["playlist-play-index", index] }));
    player::send(&commands, json!({ "command": ["set_property", "pause", false] }));
    Ok(entries)
}

/// Adds tracks to the queue: after the current track (`next`) or at the end.
#[tauri::command]
pub async fn music_enqueue(app: AppHandle, state: State<'_, MusicState>, tracks: Vec<i64>, next: bool, volume: f64) -> AppResult<Vec<QueueEntry>> {
    let library = app.state::<AppState>().library()?;
    let entries = blocking(move || resolve(&library, &tracks)).await?;
    let commands = session(&app, &state, volume).await?;
    let ordered: Vec<&QueueEntry> = if next { entries.iter().rev().collect() } else { entries.iter().collect() };
    for entry in ordered {
        player::send(&commands, json!({ "command": ["loadfile", entry.path, if next { "insert-next" } else { "append-play" }] }));
    }
    Ok(entries)
}

/// An mpv command for the music player, e.g. `["cycle", "pause"]` or `["playlist-next"]`.
#[tauri::command]
pub fn music_command(state: State<'_, MusicState>, args: Vec<Value>) -> AppResult<()> {
    let guard = state.session.lock().map_err(|_| AppError::msg("music state is unavailable"))?;
    let session = guard.as_ref().ok_or_else(|| AppError::msg("nothing is playing"))?;
    player::send(&session.commands, json!({ "command": args }));
    Ok(())
}

/// Stops the music and closes its mpv.
#[tauri::command]
pub fn music_stop(state: State<'_, MusicState>) -> AppResult<()> {
    stop(&state);
    Ok(())
}

fn stop(state: &MusicState) {
    let Some(mut session) = state.session.lock().ok().and_then(|mut guard| guard.take()) else {
        return;
    };
    player::send(&session.commands, json!({ "command": ["quit"] }));
    std::thread::spawn(move || {
        for _ in 0..40 {
            if matches!(session.child.try_wait(), Ok(Some(_))) {
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(25));
        }
        let _ = session.child.kill();
        let _ = session.child.wait();
    });
}

/// Called when the app exits: mpv must never outlive Digitify.
pub fn shutdown(app: &AppHandle) {
    if let Some(state) = app.try_state::<MusicState>() {
        if let Ok(mut guard) = state.session.lock() {
            if let Some(mut session) = guard.take() {
                let _ = session.child.kill();
                let _ = session.child.wait();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn library_with_album() -> Connection {
        let conn = crate::db::memory();
        conn.execute("INSERT INTO items (id, category_id, title, sort_title, metadata) VALUES (1, (SELECT id FROM categories WHERE key = 'music'), 'Test Tones', 'test tones', '{\"genre\":\"Ambient\"}')", []).unwrap();
        conn.execute("INSERT INTO people (id, name, sort_name) VALUES (1, 'Digitify', 'Digitify')", []).unwrap();
        conn.execute("INSERT INTO item_people (item_id, person_id, role, position) VALUES (1, 1, 'artist', 0)", []).unwrap();
        for (id, title, artist) in [(1, "Low Hum", None), (2, "Bright Beep", Some("Guest Synth"))] {
            let metadata = artist.map(|a| json!({ "artist": a })).unwrap_or(json!({}));
            conn.execute(
                "INSERT INTO parts (id, item_id, kind, number, title, position, metadata) VALUES (?1, 1, 'track', ?1, ?2, ?1, ?3)",
                params![id, title, metadata.to_string()],
            )
            .unwrap();
        }
        conn
    }

    #[test]
    fn tracks_are_found_by_any_detail() {
        let conn = library_with_album();
        let find = |search: &str| tracks(&conn, &TrackFilter { search: Some(search.into()), ..Default::default() }).unwrap().iter().map(|t| t.title.clone()).collect::<Vec<_>>();
        assert_eq!(find("beep"), vec!["Bright Beep"]);
        assert_eq!(find("ambient"), vec!["Low Hum", "Bright Beep"]);
        assert_eq!(find("guest"), vec!["Bright Beep"]);
        assert_eq!(find("digitify tones"), vec!["Low Hum", "Bright Beep"]);
        let all = tracks(&conn, &TrackFilter::default()).unwrap();
        assert_eq!(all[0].artist.as_deref(), Some("Digitify"));
        assert_eq!(all[1].artist.as_deref(), Some("Guest Synth"));
    }

    #[test]
    fn tracks_keep_the_asked_order() {
        let conn = library_with_album();
        let list = tracks(&conn, &TrackFilter { ids: Some(vec![2, 1]), ..Default::default() }).unwrap();
        assert_eq!(list.iter().map(|t| t.id).collect::<Vec<_>>(), vec![2, 1]);
        let by_artist = tracks(&conn, &TrackFilter { artist: Some("guest synth".into()), ..Default::default() }).unwrap();
        assert_eq!(by_artist.len(), 1);
    }
}

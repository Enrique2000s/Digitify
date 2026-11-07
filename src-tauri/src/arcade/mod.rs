//! Arcade (D-034): a launcher for the games of the emulators installed on this computer — Dolphin
//! for GameCube and Wii, Project64 (Windows) and RMG for Nintendo 64.
//!
//! Digitify never ships, downloads or changes games, BIOS files or emulators, nor any emulator's
//! settings: it finds the games in the folders the emulators (or the user) point to, and starts
//! the emulator on the chosen one, which then runs with its own settings. Covers come from
//! Dolphin's own cover cache, a picture the user picks, or — when allowed — GameTDB, by the disc's
//! ID (the one online exception here, like Import from URL, D-028).

mod detect;
mod games;

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Instant;

use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};
use walkdir::WalkDir;

use crate::error::{AppError, AppResult};
use crate::library::{sort_key, with_library};
use crate::{artwork, AppState, Library};

pub use detect::Emulator;
use detect::{Found, Program};
use games::Platform;

/// The game being played, if any (one at a time).
#[derive(Default)]
pub struct ArcadeState {
    running: Mutex<Option<Running>>,
}

#[derive(Clone, Copy)]
struct Running {
    game: i64,
}

// ---------------------------------------------------------------------------------------------
// Status: emulators and folders

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmulatorStatus {
    pub key: &'static str,
    pub name: &'static str,
    /// Consoles it plays.
    pub platforms: Vec<&'static str>,
    /// False where it doesn't exist (Project64 on Linux).
    pub available: bool,
    /// Where it was found (a path, or "Flatpak <id>"), if it was.
    pub found: Option<String>,
    /// Pointed at by hand rather than found where it's usually installed.
    pub picked: bool,
    /// Its game folders are set in Arcade instead of read from its settings (D-035).
    pub custom_folders: bool,
    /// The game folders set up in it.
    pub folders: Vec<FolderStatus>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderStatus {
    /// For folders added in Digitify; none for the emulators' own.
    pub id: Option<i64>,
    pub path: String,
    pub recursive: bool,
    pub exists: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArcadeStatus {
    pub emulators: Vec<EmulatorStatus>,
    /// Folders added in Digitify, searched for every kind of game.
    pub folders: Vec<FolderStatus>,
    /// The game being played.
    pub running: Option<i64>,
    pub games: i64,
}

fn picked_paths(library: &Library) -> AppResult<HashMap<String, PathBuf>> {
    library.db.with(|conn| {
        let rows = conn
            .prepare("SELECT kind, path FROM arcade_emulators WHERE path IS NOT NULL")?
            .query_map([], |row| Ok((row.get::<_, String>(0)?, PathBuf::from(row.get::<_, String>(1)?))))?
            .collect::<Result<_, _>>()?;
        Ok(rows)
    })
}

/// Game folders set in Arcade for an emulator (D-035), replacing the ones in its settings; `None`
/// when it uses its own.
fn custom_folders(library: &Library, emulator: Emulator) -> AppResult<Option<Vec<(PathBuf, bool)>>> {
    library.db.with(|conn| {
        let custom: bool = conn
            .query_row("SELECT custom_folders FROM arcade_emulators WHERE kind = ?1", [emulator.key()], |row| row.get::<_, i64>(0))
            .optional()?
            .is_some_and(|v| v != 0);
        if !custom {
            return Ok(None);
        }
        let rows = conn
            .prepare("SELECT path, recursive FROM arcade_emulator_folders WHERE emulator = ?1 ORDER BY rowid")?
            .query_map([emulator.key()], |row| Ok((PathBuf::from(row.get::<_, String>(0)?), row.get::<_, i64>(1)? != 0)))?
            .collect::<Result<_, _>>()?;
        Ok(Some(rows))
    })
}

/// Each emulator: what was found, whether it was pointed at by hand, and whether its folders are
/// Arcade's own.
fn found_emulators(library: &Library) -> AppResult<Vec<(Emulator, Option<Found>, bool, bool)>> {
    let picked = picked_paths(library)?;
    Emulator::ALL
        .into_iter()
        .map(|emulator| {
            let hand = picked.get(emulator.key());
            let mut found = detect::find(emulator, hand.map(PathBuf::as_path));
            let custom = custom_folders(library, emulator)?;
            if let (Some(found), Some(folders)) = (found.as_mut(), custom.as_ref()) {
                found.folders = folders.clone();
            }
            Ok((emulator, found, hand.is_some(), custom.is_some()))
        })
        .collect()
}

fn platforms_of(emulator: Emulator) -> Vec<&'static str> {
    match emulator {
        Emulator::Dolphin => vec!["gamecube", "wii"],
        Emulator::Project64 | Emulator::Rmg => vec!["n64"],
    }
}

fn user_folders(library: &Library) -> AppResult<Vec<(i64, PathBuf, bool)>> {
    library.db.with(|conn| {
        let rows = conn
            .prepare("SELECT id, path, recursive FROM arcade_folders ORDER BY id")?
            .query_map([], |row| Ok((row.get(0)?, PathBuf::from(row.get::<_, String>(1)?), row.get::<_, i64>(2)? != 0)))?
            .collect::<Result<_, _>>()?;
        Ok(rows)
    })
}

#[tauri::command]
pub async fn arcade_status(state: State<'_, AppState>, arcade: State<'_, ArcadeState>) -> AppResult<ArcadeStatus> {
    let running = arcade.running.lock().ok().and_then(|r| r.map(|r| r.game));
    with_library(&state, move |library| {
        let emulators = found_emulators(library)?
            .into_iter()
            .map(|(emulator, found, picked, custom)| EmulatorStatus {
                key: emulator.key(),
                name: emulator.name(),
                platforms: platforms_of(emulator),
                available: emulator.available_here(),
                found: found.as_ref().map(|f| f.program.label()),
                picked,
                custom_folders: custom,
                folders: found
                    .map(|f| f.folders.into_iter().map(|(path, recursive)| FolderStatus { id: None, exists: path.is_dir(), path: path.display().to_string(), recursive }).collect())
                    .unwrap_or_default(),
            })
            .collect();
        let folders = user_folders(library)?
            .into_iter()
            .map(|(id, path, recursive)| FolderStatus { id: Some(id), exists: path.is_dir(), path: path.display().to_string(), recursive })
            .collect();
        let games = library.db.with(|conn| Ok(conn.query_row("SELECT count(*) FROM arcade_games WHERE missing = 0", [], |row| row.get(0))?))?;
        Ok(ArcadeStatus { emulators, folders, running, games })
    })
    .await
}

/// Points Arcade at an emulator's program by hand; `None` goes back to looking where it's installed.
#[tauri::command]
pub async fn arcade_set_emulator(state: State<'_, AppState>, emulator: String, path: Option<String>) -> AppResult<()> {
    let emulator = Emulator::parse(&emulator).ok_or_else(|| AppError::msg("unknown emulator"))?;
    if !emulator.available_here() {
        return Err(AppError::msg(format!("{} isn't available for this system.", emulator.name())));
    }
    if let Some(path) = &path {
        let file = Path::new(path);
        let name = file.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
        let expected: &[&str] = match emulator {
            Emulator::Dolphin => &["dolphin.exe", "dolphin-emu", "dolphin"],
            Emulator::Project64 => &["project64.exe"],
            Emulator::Rmg => &["rmg.exe", "rmg"],
        };
        if !file.is_file() || !expected.iter().any(|e| name == *e || name.starts_with(e.trim_end_matches(".exe"))) {
            return Err(AppError::msg(format!("That doesn't look like {}'s program ({}).", emulator.name(), expected[0])));
        }
    }
    with_library(&state, move |library| {
        library.db.with(|conn| {
            conn.execute(
                "INSERT INTO arcade_emulators (kind, path) VALUES (?1, ?2) ON CONFLICT(kind) DO UPDATE SET path = excluded.path",
                params![emulator.key(), path],
            )?;
            Ok(())
        })
    })
    .await
}

#[derive(Debug, serde::Deserialize)]
pub struct FolderInput {
    pub path: String,
    #[serde(default = "yes")]
    pub recursive: bool,
}

fn yes() -> bool {
    true
}

/// Sets an emulator's game folders in Arcade, replacing what its settings say (D-035), for when
/// they were read wrong or are elsewhere; `None` goes back to the emulator's own.
#[tauri::command]
pub async fn arcade_emulator_folders(state: State<'_, AppState>, emulator: String, folders: Option<Vec<FolderInput>>) -> AppResult<()> {
    let emulator = Emulator::parse(&emulator).ok_or_else(|| AppError::msg("unknown emulator"))?;
    with_library(&state, move |library| {
        library.db.with(|conn| {
            let tx = conn.transaction()?;
            tx.execute("DELETE FROM arcade_emulator_folders WHERE emulator = ?1", [emulator.key()])?;
            if let Some(folders) = &folders {
                for folder in folders {
                    let path = folder.path.trim();
                    if !path.is_empty() {
                        tx.execute(
                            "INSERT OR IGNORE INTO arcade_emulator_folders (emulator, path, recursive) VALUES (?1, ?2, ?3)",
                            params![emulator.key(), path, folder.recursive],
                        )?;
                    }
                }
            }
            tx.execute(
                "INSERT INTO arcade_emulators (kind, custom_folders) VALUES (?1, ?2) \
                 ON CONFLICT(kind) DO UPDATE SET custom_folders = excluded.custom_folders",
                params![emulator.key(), folders.is_some()],
            )?;
            tx.commit()?;
            Ok(())
        })
    })
    .await
}

#[tauri::command]
pub async fn arcade_folder_add(state: State<'_, AppState>, path: String) -> AppResult<()> {
    if !Path::new(&path).is_dir() {
        return Err(AppError::msg("That folder doesn't exist."));
    }
    with_library(&state, move |library| {
        library.db.with(|conn| {
            conn.execute("INSERT OR IGNORE INTO arcade_folders (path, recursive) VALUES (?1, 1)", [path])?;
            Ok(())
        })
    })
    .await
}

#[tauri::command]
pub async fn arcade_folder_remove(state: State<'_, AppState>, id: i64) -> AppResult<()> {
    with_library(&state, move |library| {
        library.db.with(|conn| {
            conn.execute("DELETE FROM arcade_folders WHERE id = ?1", [id])?;
            Ok(())
        })
    })
    .await
}

// ---------------------------------------------------------------------------------------------
// Scanning

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanReport {
    pub found: usize,
    pub added: usize,
    pub missing: usize,
    /// Covers being downloaded in the background.
    pub covers_queued: usize,
}

/// Which kinds of file a folder is searched for.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Looking {
    Dolphin,
    N64,
    Both,
}

impl Looking {
    fn wants(self, ext: &str) -> bool {
        let dolphin = games::DOLPHIN_EXTENSIONS.contains(&ext);
        let n64 = games::N64_EXTENSIONS.contains(&ext);
        match self {
            Looking::Dolphin => dolphin,
            Looking::N64 => n64,
            Looking::Both => dolphin || n64,
        }
    }
}

/// Looks through every game folder, adds what's new, and marks what's gone as missing (kept, with
/// its play time, in case the drive comes back). Covers: Dolphin's cache at once; GameTDB in the
/// background when `download_covers`.
#[tauri::command]
pub async fn arcade_scan(app: AppHandle, state: State<'_, AppState>, download_covers: bool) -> AppResult<ScanReport> {
    let library = state.library()?;
    let report = crate::library::blocking(move || scan(&app, &library, download_covers)).await?;
    Ok(report)
}

fn scan(app: &AppHandle, library: &std::sync::Arc<Library>, download_covers: bool) -> AppResult<ScanReport> {
    let emulators = found_emulators(library)?;
    let mut folders: Vec<(PathBuf, bool, Looking)> = Vec::new();
    let mut dolphin_covers: Option<PathBuf> = None;
    for (emulator, found, _, _) in &emulators {
        let Some(found) = found else { continue };
        if *emulator == Emulator::Dolphin {
            dolphin_covers = found.covers.clone();
        }
        let looking = if *emulator == Emulator::Dolphin { Looking::Dolphin } else { Looking::N64 };
        folders.extend(found.folders.iter().map(|(path, recursive)| (path.clone(), *recursive, looking)));
    }
    folders.extend(user_folders(library)?.into_iter().map(|(_, path, recursive)| (path, recursive, Looking::Both)));

    let mut seen: HashSet<PathBuf> = HashSet::new();
    let mut files: Vec<PathBuf> = Vec::new();
    for (folder, recursive, looking) in folders {
        if !folder.is_dir() {
            continue;
        }
        let walker = WalkDir::new(&folder).follow_links(false).max_depth(if recursive { 12 } else { 1 });
        for entry in walker.into_iter().filter_map(Result::ok) {
            if entry.file_type().is_file() && looking.wants(&games::extension(entry.path())) && seen.insert(entry.path().to_path_buf()) {
                files.push(entry.into_path());
            }
        }
    }

    let known: HashMap<String, (i64, Option<i64>)> = library.db.with(|conn| {
        let rows = conn
            .prepare("SELECT path, id, size FROM arcade_games")?
            .query_map([], |row| Ok((row.get::<_, String>(0)?, (row.get(1)?, row.get(2)?))))?
            .collect::<Result<_, _>>()?;
        Ok(rows)
    })?;
    let mut added = 0;
    let mut present: HashSet<i64> = HashSet::new();
    for file in &files {
        let key = file.display().to_string();
        let size = std::fs::metadata(file).ok().map(|m| m.len() as i64);
        if let Some((id, known_size)) = known.get(&key) {
            if *known_size == size {
                present.insert(*id);
                continue;
            }
        }
        let Some(info) = games::identify(file) else { continue };
        let id = library.db.with(|conn| {
            conn.execute(
                "INSERT INTO arcade_games (path, platform, title, sort_title, game_id, size) VALUES (?1, ?2, ?3, ?4, ?5, ?6) \
                 ON CONFLICT(path) DO UPDATE SET platform = excluded.platform, title = excluded.title, sort_title = excluded.sort_title, \
                   game_id = excluded.game_id, size = excluded.size, missing = 0",
                params![key, info.platform.key(), info.title, sort_key(&info.title), info.game_id, size],
            )?;
            Ok(conn.query_row("SELECT id FROM arcade_games WHERE path = ?1", [&key], |row| row.get::<_, i64>(0))?)
        })?;
        if !known.contains_key(&key) {
            added += 1;
        }
        present.insert(id);
    }
    // Not in any game folder now (its file gone, its drive unplugged, its folder removed or changed):
    // missing, and hidden, with its play time kept; found again: back.
    let missing = library.db.with(|conn| {
        let tx = conn.transaction()?;
        let mut count = 0;
        {
            let rows: Vec<i64> = tx.prepare("SELECT id FROM arcade_games")?.query_map([], |row| row.get(0))?.collect::<Result<_, _>>()?;
            for id in rows {
                let gone = !present.contains(&id);
                tx.execute("UPDATE arcade_games SET missing = ?2 WHERE id = ?1", params![id, gone])?;
                count += usize::from(gone);
            }
        }
        tx.commit()?;
        Ok(count)
    })?;

    // Covers for games without one.
    let bare: Vec<i64> = library.db.with(|conn| {
        let rows = conn.prepare("SELECT id FROM arcade_games WHERE cover_key IS NULL AND missing = 0")?.query_map([], |row| row.get(0))?.collect::<Result<_, _>>()?;
        Ok(rows)
    })?;
    let covers_queued = find_covers(app, library, &bare, dolphin_covers.as_deref(), download_covers)?;
    let _ = app.emit("arcade-changed", ());
    log::info!("arcade scan: {} games found, {added} new, {missing} missing, {covers_queued} covers to fetch", files.len());
    Ok(ScanReport { found: files.len(), added, missing, covers_queued })
}

/// Covers for `ids`: Dolphin's cache at once; when `download`, GameTDB (GameCube and Wii, by disc ID)
/// and libretro-thumbnails (every console, by name; D-035) in the background. Returns how many
/// games wait for a download.
fn find_covers(app: &AppHandle, library: &std::sync::Arc<Library>, ids: &[i64], dolphin_covers: Option<&Path>, download: bool) -> AppResult<usize> {
    let games: Vec<(i64, Option<String>, String, String, String)> = library.db.with(|conn| {
        let mut stmt = conn.prepare("SELECT id, game_id, platform, path, title FROM arcade_games WHERE id = ?1")?;
        let mut out = Vec::new();
        for id in ids {
            if let Some(row) = stmt.query_row([id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?))).optional()? {
                out.push(row);
            }
        }
        Ok(out)
    })?;
    let mut queue = Vec::new();
    for (id, game_id, platform, path, title) in games {
        let cached = game_id.as_ref().and_then(|g| dolphin_covers.map(|dir| dir.join(format!("{g}.png")))).filter(|p| p.is_file());
        if let Some(bytes) = cached.and_then(|p| std::fs::read(p).ok()) {
            if set_cover(library, id, &bytes, "dolphin").is_ok() {
                continue;
            }
        }
        if !download {
            continue;
        }
        let mut urls = Vec::new();
        if let Some(game_id) = game_id.filter(|_| platform != Platform::N64.key()) {
            urls.extend(games::cover_regions(&game_id).into_iter().map(|region| format!("https://art.gametdb.com/wii/cover/{region}/{game_id}.png")));
        }
        if let Some(system) = games::libretro_system(&platform) {
            let stem = games::title_from_name(Path::new(&path));
            urls.extend(games::libretro_names(&stem, &title).iter().map(|name| games::libretro_url(system, name)));
        }
        if !urls.is_empty() {
            queue.push((id, urls));
        }
    }
    let queued = queue.len();
    if !queue.is_empty() {
        let app = app.clone();
        let library = library.clone();
        std::thread::spawn(move || {
            for (id, urls) in queue {
                for url in urls {
                    let source = if url.contains("gametdb") { "gametdb" } else { "libretro" };
                    if let Some(bytes) = crate::online::http::image(&url) {
                        if set_cover(&library, id, &bytes, source).is_ok() {
                            let _ = app.emit("arcade-changed", ());
                            break;
                        }
                    }
                }
            }
        });
    }
    Ok(queued)
}

fn set_cover(library: &Library, id: i64, bytes: &[u8], source: &str) -> AppResult<()> {
    let art = artwork::store(&library.folder, bytes)?;
    library.db.with(|conn| {
        conn.execute(
            "UPDATE arcade_games SET cover_key = ?2, cover_color = ?3, cover_source = ?4 WHERE id = ?1",
            params![id, art.key, art.color, source],
        )?;
        Ok(())
    })
}

// ---------------------------------------------------------------------------------------------
// The games

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameCard {
    pub id: i64,
    pub title: String,
    pub platform: String,
    pub game_id: Option<String>,
    pub path: String,
    pub size: Option<i64>,
    pub cover_key: Option<String>,
    pub cover_color: Option<String>,
    pub is_favorite: bool,
    pub play_seconds: i64,
    pub play_count: i64,
    pub last_played_at: Option<String>,
    pub added_at: String,
    pub missing: bool,
    /// Place in the custom order, if the game was put there (D-035).
    pub position: Option<f64>,
}

#[tauri::command]
pub async fn arcade_games(state: State<'_, AppState>) -> AppResult<Vec<GameCard>> {
    with_library(&state, move |library| {
        library.db.with(|conn| {
            let rows = conn
                .prepare(
                    "SELECT id, title, platform, game_id, path, size, cover_key, cover_color, is_favorite, play_seconds, play_count, \
                     last_played_at, added_at, missing, position FROM arcade_games ORDER BY sort_title, id",
                )?
                .query_map([], |row| {
                    Ok(GameCard {
                        id: row.get(0)?,
                        title: row.get(1)?,
                        platform: row.get(2)?,
                        game_id: row.get(3)?,
                        path: row.get(4)?,
                        size: row.get(5)?,
                        cover_key: row.get(6)?,
                        cover_color: row.get(7)?,
                        is_favorite: row.get::<_, i64>(8)? != 0,
                        play_seconds: row.get(9)?,
                        play_count: row.get(10)?,
                        last_played_at: row.get(11)?,
                        added_at: row.get(12)?,
                        missing: row.get::<_, i64>(13)? != 0,
                        position: row.get(14)?,
                    })
                })?
                .collect::<Result<_, _>>()?;
            Ok(rows)
        })
    })
    .await
}

#[tauri::command]
pub async fn arcade_set_favorite(state: State<'_, AppState>, id: i64, favorite: bool) -> AppResult<()> {
    with_library(&state, move |library| {
        library.db.with(|conn| {
            conn.execute("UPDATE arcade_games SET is_favorite = ?2 WHERE id = ?1", params![id, favorite])?;
            Ok(())
        })
    })
    .await
}

/// A picture of the user's as a game's cover.
#[tauri::command]
pub async fn arcade_set_cover(state: State<'_, AppState>, id: i64, path: String) -> AppResult<()> {
    with_library(&state, move |library| {
        let bytes = std::fs::read(&path)?;
        set_cover(library, id, &bytes, "user")
    })
    .await
}

/// Takes a game off Arcade's list (its file stays where it is). A later scan finds it again if it
/// is still in a game folder.
#[tauri::command]
pub async fn arcade_forget(state: State<'_, AppState>, id: i64) -> AppResult<()> {
    with_library(&state, move |library| {
        library.db.with(|conn| {
            conn.execute("DELETE FROM arcade_games WHERE id = ?1", [id])?;
            Ok(())
        })
    })
    .await
}

/// Favorites for several games at once.
#[tauri::command]
pub async fn arcade_set_favorite_many(state: State<'_, AppState>, ids: Vec<i64>, favorite: bool) -> AppResult<()> {
    with_library(&state, move |library| {
        library.db.with(|conn| {
            let tx = conn.transaction()?;
            for id in &ids {
                tx.execute("UPDATE arcade_games SET is_favorite = ?2 WHERE id = ?1", params![id, favorite])?;
            }
            tx.commit()?;
            Ok(())
        })
    })
    .await
}

/// Takes several games off Arcade's list; their files stay where they are.
#[tauri::command]
pub async fn arcade_forget_many(state: State<'_, AppState>, ids: Vec<i64>) -> AppResult<usize> {
    with_library(&state, move |library| {
        library.db.with(|conn| {
            let tx = conn.transaction()?;
            let mut removed = 0;
            for id in &ids {
                removed += tx.execute("DELETE FROM arcade_games WHERE id = ?1", [id])?;
            }
            tx.commit()?;
            Ok(removed)
        })
    })
    .await
}

/// Looks for covers again for some games (not those with a picture of the user's).
#[tauri::command]
pub async fn arcade_find_covers(app: AppHandle, state: State<'_, AppState>, ids: Vec<i64>, download: bool) -> AppResult<usize> {
    let library = state.library()?;
    crate::library::blocking(move || {
        library.db.with(|conn| {
            let tx = conn.transaction()?;
            for id in &ids {
                tx.execute("UPDATE arcade_games SET cover_key = NULL, cover_color = NULL, cover_source = NULL WHERE id = ?1 AND coalesce(cover_source, '') <> 'user'", [id])?;
            }
            tx.commit()?;
            Ok(())
        })?;
        let dolphin = found_emulators(&library)?.into_iter().find_map(|(e, f, _, _)| (e == Emulator::Dolphin).then_some(f).flatten()).and_then(|f| f.covers);
        let ids: Vec<i64> = library.db.with(|conn| {
            let mut stmt = conn.prepare("SELECT id FROM arcade_games WHERE id = ?1 AND cover_key IS NULL")?;
            let mut out = Vec::new();
            for id in &ids {
                if stmt.exists([id])? {
                    out.push(*id);
                }
            }
            Ok(out)
        })?;
        let queued = find_covers(&app, &library, &ids, dolphin.as_deref(), download)?;
        let _ = app.emit("arcade-changed", ());
        Ok(queued)
    })
    .await
}

/// Renames a game in Arcade (its file keeps its name).
#[tauri::command]
pub async fn arcade_rename(state: State<'_, AppState>, id: i64, title: String) -> AppResult<()> {
    let title = title.trim().to_string();
    if title.is_empty() {
        return Err(AppError::msg("A game needs a name."));
    }
    with_library(&state, move |library| {
        library.db.with(|conn| {
            conn.execute("UPDATE arcade_games SET title = ?2, sort_title = ?3 WHERE id = ?1", params![id, title, sort_key(&title)])?;
            Ok(())
        })
    })
    .await
}

/// The custom order (D-035): the games in the order given; any left out keep coming after.
#[tauri::command]
pub async fn arcade_reorder(state: State<'_, AppState>, ids: Vec<i64>) -> AppResult<()> {
    with_library(&state, move |library| {
        library.db.with(|conn| {
            let tx = conn.transaction()?;
            for (position, id) in ids.iter().enumerate() {
                tx.execute("UPDATE arcade_games SET position = ?2 WHERE id = ?1", params![id, position as f64])?;
            }
            tx.commit()?;
            Ok(())
        })
    })
    .await
}

#[tauri::command]
pub async fn arcade_reveal(state: State<'_, AppState>, id: i64) -> AppResult<()> {
    let path: String = with_library(&state, move |library| {
        library.db.with(|conn| Ok(conn.query_row("SELECT path FROM arcade_games WHERE id = ?1", [id], |row| row.get(0))?))
    })
    .await?;
    crate::files::reveal(Path::new(&path))
}

// ---------------------------------------------------------------------------------------------
// Playing

/// Starts the emulator on a game, with the emulator's own settings. Nintendo 64 games use `n64`
/// (`project64` or `rmg`) when both are found. Play time is counted until the emulator closes.
#[tauri::command]
pub async fn arcade_launch(app: AppHandle, state: State<'_, AppState>, arcade: State<'_, ArcadeState>, id: i64, n64: Option<String>) -> AppResult<()> {
    if arcade.running.lock().map(|r| r.is_some()).unwrap_or(false) {
        return Err(AppError::msg("A game is already running. Close it first."));
    }
    let library = state.library()?;
    let (path, platform): (String, String) = library
        .db
        .with(|conn| Ok(conn.query_row("SELECT path, platform FROM arcade_games WHERE id = ?1", [id], |row| Ok((row.get(0)?, row.get(1)?))).optional()?))?
        .ok_or_else(|| AppError::msg("That game is no longer in Arcade."))?;
    if !Path::new(&path).is_file() {
        return Err(AppError::msg("The game's file isn't there anymore (was its drive unplugged?)."));
    }
    let emulators = found_emulators(&library)?;
    let found = |e: Emulator| emulators.iter().find(|(k, f, _, _)| *k == e && f.is_some()).and_then(|(_, f, _, _)| f.clone());
    let chosen = if platform == Platform::N64.key() {
        let preferred = n64.as_deref().and_then(Emulator::parse).filter(|e| *e != Emulator::Dolphin);
        let order: Vec<Emulator> = match preferred {
            Some(Emulator::Rmg) => vec![Emulator::Rmg, Emulator::Project64],
            _ => vec![Emulator::Project64, Emulator::Rmg],
        };
        order.into_iter().find_map(found).ok_or_else(|| {
            AppError::msg(if cfg!(windows) { "Nintendo 64 games need Project64 or RMG. Install one, or point Arcade to it." } else { "Nintendo 64 games need RMG. Install it, or point Arcade to it." })
        })?
    } else {
        found(Emulator::Dolphin).ok_or_else(|| AppError::msg("GameCube and Wii games need Dolphin. Install it, or point Arcade to it."))?
    };
    let mut command = launch_command(&chosen, Path::new(&path));
    let mut child = command.spawn().map_err(|e| AppError::msg(format!("Couldn't start {}: {e}", chosen.emulator.name())))?;
    log::info!("arcade: {} started for game {id} (pid {})", chosen.emulator.name(), child.id());
    if let Ok(mut running) = arcade.running.lock() {
        *running = Some(Running { game: id });
    }
    let _ = app.emit("arcade-session", serde_json::json!({ "running": id }));
    // Out of the way while the game runs (D-035): hidden, out of the taskbar; the UI goes silent on
    // the event above. It comes back where it was when the game closes.
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
    let started = Instant::now();
    std::thread::spawn(move || {
        let _ = child.wait();
        let seconds = started.elapsed().as_secs() as i64;
        // A start that ends at once (an emulator refusing the file) isn't a session.
        let played = seconds >= 5;
        let _ = library.db.with(|conn| {
            if played {
                conn.execute(
                    "UPDATE arcade_games SET play_seconds = play_seconds + ?2, play_count = play_count + 1, \
                     last_played_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?1",
                    params![id, seconds],
                )?;
            }
            Ok(())
        });
        if let Some(state) = app.try_state::<ArcadeState>() {
            if let Ok(mut running) = state.running.lock() {
                *running = None;
            }
        }
        let _ = app.emit("arcade-session", serde_json::json!({ "running": null, "seconds": seconds }));
        // Back to Digitify, where it was (Big Picture stays full screen), when the game closes.
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    });
    Ok(())
}

fn launch_command(found: &Found, game: &Path) -> std::process::Command {
    let mut command = match &found.program {
        Program::Native(path) => {
            let mut c = crate::tools::host_command(path);
            if let Some(dir) = path.parent() {
                c.current_dir(dir);
            }
            c
        }
        Program::Flatpak(id) => {
            let mut c = crate::tools::host_command("flatpak");
            c.args(["run", id]);
            c
        }
    };
    match found.emulator {
        // Batch: no game list, and Dolphin closes with the game.
        Emulator::Dolphin => command.args(["-b", "-e"]).arg(game),
        Emulator::Project64 => command.arg(game),
        // Quit after emulation: RMG closes with the game too.
        Emulator::Rmg => command.arg("--quit-after-emulation").arg(game),
    };
    command
}

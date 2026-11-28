//! Arcade (D-034): a launcher for the games of the emulators installed on this computer — Dolphin
//! for GameCube and Wii, Project64 (Windows) and RMG for Nintendo 64, DuckStation for PlayStation,
//! PCSX2 for PlayStation 2, RPCS3 for PlayStation 3, melonDS and DeSmuME for Nintendo DS, Mesen,
//! FCEUX and mGBA for Nintendo's cartridges (D-106), and the games in RetroArch's playlists, each
//! with its core (D-101); PC games from their stores (itch.io's too) and programs added by hand.
//!
//! Digitify never ships, downloads or changes games, BIOS files or emulators, nor any emulator's
//! settings: it finds the games in the folders the emulators (or the user) point to, and starts
//! the emulator on the chosen one, which then runs with its own settings. Covers come from
//! Dolphin's own cover cache, a picture the user picks, or — when allowed — GameTDB, by the disc's
//! ID (the one online exception here, like Import from URL, D-028).

mod artsources;
pub mod collections;
pub mod covers;
mod detect;
mod games;
mod icons;
mod launchers;
mod minecraft;
mod programs;
pub mod play;
#[cfg(windows)]
mod registry;
mod retroarch;
mod sgdb;
mod stores;

use covers::*;
pub use play::{watch_outside, watch_stores};

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
use stores::Store;

/// The game being played, if any (one at a time).
#[derive(Default)]
pub struct ArcadeState {
    running: Mutex<Option<Running>>,
    /// A store game Digitify asked its launcher to start and is waiting to see (D-037), so the
    /// watch for games started elsewhere (D-083) leaves it to that launch.
    starting: Mutex<Option<i64>>,
    /// The covers found for a game to choose from (D-118), by its id, until one is chosen.
    choices: Mutex<HashMap<i64, Vec<(String, Vec<u8>)>>>,
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
    /// The user said not to use it (D-117).
    pub ignored: bool,
    /// Its own icon, from its program on this computer, as a data URL (D-123).
    pub icon: Option<String>,
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
    /// PC stores read for installed games (D-037).
    pub stores: Vec<StoreStatus>,
    /// Store games taken off the list (still installed).
    pub hidden: i64,
    /// Each console and the emulators that play it, in Arcade's order (D-111).
    pub consoles: Vec<ConsoleStatus>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsoleStatus {
    pub key: &'static str,
    /// Emulators for this system, in Arcade's order.
    pub players: Vec<&'static str>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreStatus {
    pub key: &'static str,
    pub name: &'static str,
    pub found: Option<String>,
    pub games: usize,
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

/// The emulators the user said not to use (D-117), even where they're installed.
fn ignored_emulators(library: &Library) -> AppResult<HashSet<String>> {
    library.db.with(|conn| {
        let rows = conn.prepare("SELECT kind FROM arcade_emulators WHERE ignored = 1")?.query_map([], |row| row.get::<_, String>(0))?.collect::<Result<_, _>>()?;
        Ok(rows)
    })
}

/// Stops using an emulator Arcade found (D-117), or uses it again: an ignored one isn't looked for,
/// its folders aren't searched and no game starts in it, until it's used again.
#[tauri::command]
pub async fn arcade_ignore_emulator(state: State<'_, AppState>, emulator: String, ignored: bool) -> AppResult<()> {
    let emulator = Emulator::parse(&emulator).ok_or_else(|| AppError::msg("unknown emulator"))?;
    with_library(&state, move |library| {
        library.db.with(|conn| {
            conn.execute(
                "INSERT INTO arcade_emulators (kind, ignored) VALUES (?1, ?2) ON CONFLICT(kind) DO UPDATE SET ignored = excluded.ignored",
                params![emulator.key(), ignored],
            )?;
            Ok(())
        })
    })
    .await
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
    let ignored = ignored_emulators(library)?;
    Emulator::ALL
        .into_iter()
        .map(|emulator| {
            let hand = picked.get(emulator.key());
            // One the user said not to use isn't looked for (D-117).
            let mut found = if ignored.contains(emulator.key()) { None } else { detect::find(emulator, hand.map(PathBuf::as_path)) };
            let custom = custom_folders(library, emulator)?;
            if let (Some(found), Some(folders)) = (found.as_mut(), custom.as_ref()) {
                found.folders = folders.clone();
            }
            Ok((emulator, found, hand.is_some(), custom.is_some()))
        })
        .collect()
}

fn platforms_of(emulator: Emulator) -> Vec<&'static str> {
    looking_for(emulator).map(|l| l.platforms.iter().map(|p| p.key()).collect()).unwrap_or_default()
}

/// Which emulators play each console, in the order Arcade prefers them unless the user chose one
/// (D-111). It is the one list behind everything about emulators and consoles: what each
/// emulator's folders are searched for, the consoles it shows, the choice of emulator per console,
/// and which one a game starts in. RetroArch plays the games of its own playlists (D-101).
const PLAYS: &[(Platform, &[Emulator])] = {
    use Emulator::*;
    &[
        (Platform::GameCube, &[Dolphin]),
        (Platform::Wii, &[Dolphin]),
        (Platform::N64, &[Project64, Rmg, Ares]),
        (Platform::Ps1, &[DuckStation]),
        (Platform::Ps2, &[Pcsx2]),
        (Platform::Ps3, &[Rpcs3]),
        (Platform::Ds, &[MelonDs, Desmume]),
        (Platform::Nes, &[Mesen, Nestopia, Fceux, Ares]),
        (Platform::Snes, &[Mesen, Snes9x, Zsnes, Ares]),
        (Platform::Gb, &[Mgba, Mesen, Ares]),
        (Platform::Gbc, &[Mgba, Mesen, Ares]),
        (Platform::Gba, &[Mgba, Mesen, Ares]),
        (Platform::Pce, &[Mesen, Ares]),
        (Platform::Sms, &[Mesen, Fusion, Ares]),
        (Platform::GameGear, &[Mesen, Fusion, Ares]),
        (Platform::Genesis, &[Fusion, Ares]),
        (Platform::SegaCd, &[Fusion, Ares]),
        (Platform::Dreamcast, &[Flycast, NullDc]),
        // D-116.
        (Platform::Psp, &[Ppsspp]),
        (Platform::N3ds, &[Azahar]),
        (Platform::WiiU, &[Cemu]),
        (Platform::Xbox, &[Xemu]),
        (Platform::Xbox360, &[Xenia]),
        (Platform::Switch, &[Ryujinx]),
    ]
};

/// The emulators that play a console, in Arcade's order.
fn players(platform: Platform) -> &'static [Emulator] {
    PLAYS.iter().find(|(p, _)| *p == platform).map(|(_, e)| *e).unwrap_or(&[])
}

/// What an emulator's folders are searched for; RetroArch's games come from its playlists instead.
fn looking_for(emulator: Emulator) -> Option<Looking> {
    let platforms: Vec<Platform> = PLAYS.iter().filter(|(_, e)| e.contains(&emulator)).map(|(p, _)| *p).collect();
    if platforms.is_empty() {
        return None;
    }
    // The console a disc that can't say which it is belongs to, in this emulator's folders.
    let hint = match emulator {
        Emulator::DuckStation => Some(Platform::Ps1),
        Emulator::Pcsx2 => Some(Platform::Ps2),
        Emulator::Fceux | Emulator::Nestopia => Some(Platform::Nes),
        Emulator::Fusion => Some(Platform::SegaCd),
        Emulator::NullDc | Emulator::Flycast => Some(Platform::Dreamcast),
        Emulator::Ppsspp => Some(Platform::Psp),
        _ => None,
    };
    Some(Looking { platforms, hint })
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

/// The programs on this computer that could be added as games (D-183), for the list to pick from.
#[tauri::command]
pub async fn arcade_programs(app: AppHandle) -> AppResult<Vec<programs::ProgramEntry>> {
    let cache = crate::config::config_dir(&app)?.join("cache").join("program-icons");
    crate::library::blocking(move || Ok(programs::list(&cache))).await
}

#[tauri::command]
pub async fn arcade_status(app: AppHandle, state: State<'_, AppState>, arcade: State<'_, ArcadeState>) -> AppResult<ArcadeStatus> {
    let running = arcade.running.lock().ok().and_then(|r| r.map(|r| r.game));
    let cache = crate::config::config_dir(&app)?.join("cache").join("emulator-icons");
    with_library(&state, move |library| {
        let ignored = ignored_emulators(library)?;
        let found = found_emulators(library)?;
        let programs: Vec<(Emulator, Program)> = found.iter().filter_map(|(e, f, _, _)| f.as_ref().map(|f| (*e, f.program.clone()))).collect();
        let icons = icons::icons(&programs, &cache);
        let emulators = found
            .into_iter()
            .map(|(emulator, found, picked, custom)| EmulatorStatus {
                ignored: ignored.contains(emulator.key()),
                icon: icons.get(emulator.key()).cloned(),
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
        let games = library.db.with(|conn| Ok(conn.query_row("SELECT count(*) FROM arcade_games WHERE missing = 0 AND hidden = 0", [], |row| row.get(0))?))?;
        let hidden = library.db.with(|conn| Ok(conn.query_row("SELECT count(*) FROM arcade_games WHERE hidden = 1 AND missing = 0", [], |row| row.get(0))?))?;
        let stores = stores::scan_all_cached()
            .into_iter()
            .map(|s| StoreStatus { key: s.store.key(), name: s.store.name(), found: s.found, games: s.games.len() })
            .collect();
        let consoles = PLAYS
            .iter()
            .map(|(platform, emulators)| ConsoleStatus { key: platform.key(), players: emulators.iter().filter(|e| e.available_here()).map(|e| e.key()).collect() })
            .collect();
        Ok(ArcadeStatus { emulators, folders, running, games, stores, hidden, consoles })
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
        let expected = emulator.program_names();
        if !file.is_file() || !expected.iter().any(|e| name.starts_with(e)) {
            return Err(AppError::msg(format!("That doesn't look like {}'s program.", emulator.name())));
        }
    }
    with_library(&state, move |library| {
        library.db.with(|conn| {
            conn.execute(
                "INSERT INTO arcade_emulators (kind, path, ignored) VALUES (?1, ?2, 0) ON CONFLICT(kind) DO UPDATE SET path = excluded.path, ignored = 0",
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

/// Which consoles' games a folder is searched for, and the console of the emulator it belongs to
/// (for discs that can't say which they are).
#[derive(Clone, PartialEq, Eq)]
struct Looking {
    platforms: Vec<Platform>,
    hint: Option<Platform>,
}

impl Looking {
    /// Folders added in Arcade: every kind of game.
    fn everything() -> Self {
        Looking { platforms: Platform::ALL.to_vec(), hint: None }
    }

    fn wants(&self, ext: &str) -> bool {
        self.platforms.iter().any(|p| p.extensions().contains(&ext))
    }

    /// How deep to look: PlayStation 3 games are folders whose PARAM.SFO is two levels down.
    fn depth(&self, recursive: bool) -> usize {
        if self.platforms == [Platform::Ps3] {
            return 3;
        }
        let base = if recursive { 12 } else { 1 };
        // Games kept as folders (a Wii U game's code/*.rpx, an Xbox 360 game's default.xex) sit a
        // few levels down even in a folder searched alone.
        if self.platforms.iter().any(|p| matches!(p, Platform::WiiU | Platform::Xbox360)) {
            base.max(3)
        } else {
            base
        }
    }
}

/// Box art the emulators keep on this computer: Dolphin's covers, RetroArch's thumbnails.
#[derive(Default)]
struct LocalArt {
    dolphin: Option<PathBuf>,
    retroarch: Option<PathBuf>,
}

fn local_art(emulators: &[(Emulator, Option<Found>, bool, bool)]) -> LocalArt {
    let covers = |wanted: Emulator| emulators.iter().find(|(e, ..)| *e == wanted).and_then(|(_, f, ..)| f.as_ref()).and_then(|f| f.covers.clone());
    LocalArt { dolphin: covers(Emulator::Dolphin), retroarch: covers(Emulator::RetroArch) }
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
    let mut playlists: Option<PathBuf> = None;
    for (emulator, found, _, _) in &emulators {
        let Some(found) = found else { continue };
        match looking_for(*emulator) {
            Some(looking) => folders.extend(found.folders.iter().map(|(path, recursive)| (path.clone(), *recursive, looking.clone()))),
            None => playlists = found.folders.first().map(|(path, _)| path.clone()),
        }
    }
    folders.extend(user_folders(library)?.into_iter().map(|(_, path, recursive)| (path, recursive, Looking::everything())));

    let mut seen: HashSet<PathBuf> = HashSet::new();
    let mut files: Vec<(PathBuf, Option<Platform>)> = Vec::new();
    for (folder, recursive, looking) in folders {
        if !folder.is_dir() {
            continue;
        }
        let walker = WalkDir::new(&folder).follow_links(false).max_depth(looking.depth(recursive));
        // Windows' own folders on a drive (its recycle bin, restore points) hold no games and are slow
        // to go through (D-152).
        let skipped = |entry: &walkdir::DirEntry| {
            entry.depth() > 0 && entry.file_type().is_dir() && {
                let name = entry.file_name().to_string_lossy();
                name.starts_with('$') || name.eq_ignore_ascii_case("System Volume Information")
            }
        };
        for entry in walker.into_iter().filter_entry(|e| !skipped(e)).filter_map(Result::ok) {
            if entry.file_type().is_file() && looking.wants(&games::extension(entry.path())) && seen.insert(entry.path().to_path_buf()) {
                files.push((entry.into_path(), looking.hint));
            }
        }
    }
    // A disc's tracks (in its CUE sheet) and a game's discs (in its M3U list) are part of it, not
    // games of their own (D-101).
    let parts: HashSet<PathBuf> = files.iter().flat_map(|(file, _)| games::parts_of(file)).collect();
    files.retain(|(file, _)| !parts.contains(file));

    // Each game's path, id and size, and whether it came from RetroArch's playlists.
    let known: HashMap<String, (i64, Option<i64>, bool)> = library.db.with(|conn| {
        let rows = conn
            .prepare("SELECT path, id, size, system IS NOT NULL FROM arcade_games")?
            .query_map([], |row| Ok((row.get::<_, String>(0)?, (row.get(1)?, row.get(2)?, row.get(3)?))))?
            .collect::<Result<_, _>>()?;
        Ok(rows)
    })?;
    let mut added = 0;
    let mut present: HashSet<i64> = HashSet::new();
    // Games an emulator of their own plays: RetroArch's playlists don't take them over.
    let mut own: HashSet<String> = HashSet::new();
    for (file, hint) in &files {
        let key = file.display().to_string();
        let size = std::fs::metadata(file).ok().map(|m| m.len() as i64);
        if let Some((id, known_size, retro)) = known.get(&key) {
            if *known_size == size && !retro {
                present.insert(*id);
                own.insert(key);
                continue;
            }
        }
        let Some(info) = games::identify(file, *hint) else { continue };
        // A PlayStation 3 game is its folder.
        let (key, size) = match &info.folder {
            Some(folder) => (folder.display().to_string(), None),
            None => (key, size),
        };
        let id = library.db.with(|conn| {
            conn.execute(
                "INSERT INTO arcade_games (path, platform, title, sort_title, game_id, size) VALUES (?1, ?2, ?3, ?4, ?5, ?6) \
                 ON CONFLICT(path) DO UPDATE SET platform = excluded.platform, title = excluded.title, sort_title = excluded.sort_title, \
                   game_id = excluded.game_id, size = excluded.size, core = NULL, system = NULL, missing = 0",
                params![key, info.platform.key(), info.title, sort_key(&info.title), info.game_id, size],
            )?;
            Ok(conn.query_row("SELECT id FROM arcade_games WHERE path = ?1", [&key], |row| row.get::<_, i64>(0))?)
        })?;
        if !known.contains_key(&key) {
            added += 1;
        }
        present.insert(id);
        own.insert(key);
    }
    // RetroArch's playlists (D-101): each game in its console's view, with the core that plays it.
    // A renamed game keeps its name.
    let mut retro_games = 0;
    for game in playlists.as_deref().map(retroarch::games).unwrap_or_default() {
        if own.contains(&game.path) || !retroarch::file_of(&game.path).is_file() {
            continue;
        }
        retro_games += 1;
        let size = std::fs::metadata(retroarch::file_of(&game.path)).ok().map(|m| m.len() as i64);
        let id = library.db.with(|conn| {
            conn.execute(
                "INSERT INTO arcade_games (path, platform, title, sort_title, size, core, system) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) \
                 ON CONFLICT(path) DO UPDATE SET platform = excluded.platform, size = excluded.size, core = excluded.core, system = excluded.system, missing = 0",
                params![game.path, retroarch::platform_of(&game.system), game.title, sort_key(&game.title), size, game.core, game.system],
            )?;
            Ok(conn.query_row("SELECT id FROM arcade_games WHERE path = ?1", [&game.path], |row| row.get::<_, i64>(0))?)
        })?;
        if !known.contains_key(&game.path) {
            added += 1;
        }
        own.insert(game.path);
        present.insert(id);
    }
    // PC games installed through their stores (D-037): known ones keep their names (a rename stays).
    let mut store_games = 0;
    let mut store_art = StoreArt::new();
    for found in stores::scan_all() {
        for game in found.games {
            store_games += 1;
            let key = format!("store://{}/{}", game.store.key(), game.key);
            let (id, new) = library.db.with(|conn| {
                let existed: bool = conn.query_row("SELECT EXISTS (SELECT 1 FROM arcade_games WHERE path = ?1)", [&key], |row| row.get(0))?;
                conn.execute(
                    "INSERT INTO arcade_games (path, platform, title, sort_title, store, store_key, launch, install_dir) VALUES (?1, 'pc', ?2, ?3, ?4, ?5, ?6, ?7) \
                     ON CONFLICT(path) DO UPDATE SET launch = excluded.launch, install_dir = excluded.install_dir, missing = 0",
                    params![key, game.title, sort_key(&game.title), game.store.key(), game.key, game.launch, game.install_dir.display().to_string()],
                )?;
                Ok((conn.query_row("SELECT id FROM arcade_games WHERE path = ?1", [&key], |row| row.get::<_, i64>(0))?, !existed))
            })?;
            added += usize::from(new);
            present.insert(id);
            store_art.insert(key, (game.cover, game.cover_url));
        }
    }

    // Programs added by hand (D-107): there as long as their file is.
    let added_by_hand: Vec<(i64, String)> = library.db.with(|conn| {
        let rows = conn.prepare("SELECT id, path FROM arcade_games WHERE platform = 'pc' AND store IS NULL")?.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?.collect::<Result<_, _>>()?;
        Ok(rows)
    })?;
    present.extend(added_by_hand.into_iter().filter(|(_, path)| Path::new(path).is_file()).map(|(id, _)| id));
    // Not in any game folder now (its file gone, its drive unplugged, its folder removed or changed;
    // a store game uninstalled): missing, and hidden, with its play time kept; found again: back.
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
    let covers_queued = find_covers(app, library, &bare, &local_art(&emulators), download_covers, Some(store_art))?;
    let _ = app.emit("arcade-changed", ());
    let found = files.len() + retro_games + store_games;
    log::info!("arcade scan: {found} games found ({store_games} from stores), {added} new, {missing} missing, {covers_queued} covers to fetch");
    Ok(ScanReport { found, added, missing, covers_queued })
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
    /// Time played in all: what Digitify counted plus what the user added (D-043).
    pub play_seconds: i64,
    /// The part added by hand: time played outside Digitify.
    pub extra_seconds: i64,
    /// The user's rating, 1-5 stars, and note (D-049).
    pub rating: Option<i64>,
    pub note: Option<String>,
    pub play_count: i64,
    pub last_played_at: Option<String>,
    pub added_at: String,
    pub missing: bool,
    /// Place in the custom order, if the game was put there (D-035).
    pub position: Option<f64>,
    /// For PC games, the store it came from (`steam`, `epic`, `xbox`, `gog`, `heroic`; D-037).
    pub store: Option<String>,
    /// From RetroArch's playlists: RetroArch starts it, with its core (D-101).
    pub retroarch: bool,
    /// The emulator this game starts in, over its console's (D-148).
    pub emulator: Option<String>,
    /// When the player marked it as completed (D-149).
    pub completed_at: Option<String>,
    /// The player's own keywords for it (D-160).
    pub keywords: Vec<String>,
    /// How its cover is framed in its box, when adjusted (D-184).
    pub cover_view: Option<crate::library::CoverView>,
}

#[tauri::command]
pub async fn arcade_games(state: State<'_, AppState>) -> AppResult<Vec<GameCard>> {
    with_library(&state, move |library| {
        library.db.with(|conn| {
            let rows = conn
                .prepare(
                    "SELECT id, title, platform, game_id, path, size, cover_key, cover_color, is_favorite, play_seconds + extra_seconds, play_count, \
                     last_played_at, added_at, missing, position, store, extra_seconds, rating, note, system IS NOT NULL, emulator, completed_at, keywords, cover_view FROM arcade_games WHERE hidden = 0 ORDER BY sort_title, id",
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
                        store: row.get(15)?,
                        extra_seconds: row.get(16)?,
                        rating: row.get(17)?,
                        note: row.get(18)?,
                        retroarch: row.get(19)?,
                        emulator: row.get(20)?,
                        completed_at: row.get(21)?,
                        keywords: row.get::<_, Option<String>>(22)?.and_then(|k| serde_json::from_str(&k).ok()).unwrap_or_default(),
                        cover_view: crate::library::CoverView::from_json(row.get(23)?),
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

/// Frames a game's cover in its box (D-184), or leaves it as it comes (`None`).
#[tauri::command]
pub async fn arcade_set_cover_view(state: State<'_, AppState>, id: i64, view: Option<crate::library::CoverView>) -> AppResult<()> {
    with_library(&state, move |library| {
        library.db.with(|conn| {
            let text = view.and_then(crate::library::CoverView::tidy).map(|v| serde_json::to_string(&v).unwrap_or_default());
            conn.execute("UPDATE arcade_games SET cover_view = ?2 WHERE id = ?1", params![id, text])?;
            Ok(())
        })
    })
    .await
}

/// Marks games as completed, or not (D-149); a game marked again keeps its first date.
#[tauri::command]
pub async fn arcade_set_completed(state: State<'_, AppState>, ids: Vec<i64>, completed: bool) -> AppResult<()> {
    with_library(&state, move |library| {
        library.db.with(|conn| {
            let tx = conn.transaction()?;
            for id in &ids {
                if completed {
                    tx.execute("UPDATE arcade_games SET completed_at = coalesce(completed_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) WHERE id = ?1", [id])?;
                } else {
                    tx.execute("UPDATE arcade_games SET completed_at = NULL WHERE id = ?1", [id])?;
                }
            }
            tx.commit()?;
            Ok(())
        })
    })
    .await
}

/// A game's own keywords (D-160): trimmed, without repeats (whatever their case), at most 40 of up
/// to 40 characters; none clears them.
#[tauri::command]
pub async fn arcade_set_keywords(state: State<'_, AppState>, id: i64, keywords: Vec<String>) -> AppResult<Vec<String>> {
    let keywords = clean_keywords(keywords);
    with_library(&state, move |library| {
        library.db.with(|conn| {
            let stored = (!keywords.is_empty()).then(|| serde_json::to_string(&keywords).unwrap_or_default());
            conn.execute("UPDATE arcade_games SET keywords = ?2 WHERE id = ?1", params![id, stored])?;
            Ok(keywords)
        })
    })
    .await
}

/// Keywords added to and taken out of several games at once (D-162); each game keeps its others.
/// Returns how many games changed.
#[tauri::command]
pub async fn arcade_change_keywords(state: State<'_, AppState>, ids: Vec<i64>, add: Vec<String>, remove: Vec<String>) -> AppResult<usize> {
    let add = clean_keywords(add);
    let remove: Vec<String> = remove.iter().map(|k| k.trim().to_lowercase()).collect();
    with_library(&state, move |library| {
        library.db.with(|conn| {
            let tx = conn.transaction()?;
            let mut changed = 0;
            for id in &ids {
                let Some(stored) = tx.query_row("SELECT keywords FROM arcade_games WHERE id = ?1", [id], |row| row.get::<_, Option<String>>(0)).optional()? else { continue };
                let before: Vec<String> = stored.and_then(|k| serde_json::from_str(&k).ok()).unwrap_or_default();
                let mut after: Vec<String> = before.iter().filter(|k| !remove.contains(&k.to_lowercase())).cloned().collect();
                after.extend(add.iter().cloned());
                let after = clean_keywords(after);
                if after != before {
                    let value = (!after.is_empty()).then(|| serde_json::to_string(&after).unwrap_or_default());
                    tx.execute("UPDATE arcade_games SET keywords = ?2 WHERE id = ?1", params![id, value])?;
                    changed += 1;
                }
            }
            tx.commit()?;
            Ok(changed)
        })
    })
    .await
}

pub(crate) fn clean_keywords(keywords: Vec<String>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for keyword in keywords {
        let keyword: String = keyword.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(40).collect();
        if !keyword.is_empty() && !out.iter().any(|k| k.to_lowercase() == keyword.to_lowercase()) {
            out.push(keyword);
        }
    }
    out.truncate(40);
    out
}

/// The emulator one game starts in (D-148), over its console's; none goes back to the console's.
#[tauri::command]
pub async fn arcade_set_game_emulator(state: State<'_, AppState>, id: i64, emulator: Option<String>) -> AppResult<()> {
    with_library(&state, move |library| {
        library.db.with(|conn| {
            if let Some(key) = emulator.as_deref() {
                let platform: String = conn
                    .query_row("SELECT platform FROM arcade_games WHERE id = ?1", [id], |row| row.get(0))
                    .optional()?
                    .ok_or_else(|| AppError::msg("That game is no longer in Arcade."))?;
                let console = Platform::parse(&platform).ok_or_else(|| AppError::msg("Only emulated games can choose an emulator."))?;
                let chosen = Emulator::parse(key).ok_or_else(|| AppError::msg("That emulator isn't one Arcade knows."))?;
                if !players(console).contains(&chosen) {
                    return Err(AppError::msg(format!("{} doesn't play {} games.", chosen.name(), console.name())));
                }
            }
            conn.execute("UPDATE arcade_games SET emulator = ?2 WHERE id = ?1", params![id, emulator])?;
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

/// Adds a PC game by its program (D-107): one that no store Arcade reads installed. It's named after
/// its program (renaming it in Arcade works as for any game), and starts by itself from its folder.
#[tauri::command]
pub async fn arcade_add_program(app: AppHandle, state: State<'_, AppState>, path: String, download_covers: bool) -> AppResult<i64> {
    let program = PathBuf::from(&path);
    if !program.is_file() {
        return Err(AppError::msg("That program isn't there."));
    }
    #[cfg(windows)]
    if !games::extension(&program).eq_ignore_ascii_case("exe") {
        return Err(AppError::msg("Choose the game's program (a .exe file)."));
    }
    let library = state.library()?;
    crate::library::blocking(move || {
        let title = program_title(&program);
        let key = program.display().to_string();
        let dir = program.parent().map(|d| d.display().to_string());
        let id = library.db.with(|conn| {
            if conn.query_row("SELECT EXISTS (SELECT 1 FROM arcade_games WHERE path = ?1 AND missing = 0)", [&key], |row| row.get::<_, bool>(0))? {
                return Err(AppError::msg("That game is already in Arcade."));
            }
            conn.execute(
                "INSERT INTO arcade_games (path, platform, title, sort_title, launch, install_dir) VALUES (?1, 'pc', ?2, ?3, ?4, ?5) \
                 ON CONFLICT(path) DO UPDATE SET missing = 0, hidden = 0, launch = excluded.launch, install_dir = excluded.install_dir",
                params![key, title, sort_key(&title), format!("exe:{key}"), dir],
            )?;
            Ok(conn.query_row("SELECT id FROM arcade_games WHERE path = ?1", [&key], |row| row.get::<_, i64>(0))?)
        })?;
        find_covers(&app, &library, &[id], &LocalArt::default(), download_covers, Some(StoreArt::new()))?;
        let _ = app.emit("arcade-changed", ());
        Ok(id)
    })
    .await
}

/// A program's name as a game's: its file's description where Windows keeps one is not read; the
/// file's name, or its folder's when the file is a generic one ("Game.exe", "Launcher.exe").
fn program_title(program: &Path) -> String {
    let stem = program.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let generic = ["game", "launcher", "start", "play", "run", "main", "app", "client"];
    let lower = stem.to_lowercase();
    let lower = lower.trim_end_matches("-win64-shipping").trim_end_matches("-win64").trim_end_matches("64").trim_end_matches("32").trim_end_matches(['-', '_', ' ']);
    let name = if generic.contains(&lower) || lower.len() < 2 {
        program.parent().and_then(|d| d.file_name()).map(|n| n.to_string_lossy().into_owned()).unwrap_or(stem)
    } else {
        stem
    };
    let name = name.replace(['_', '.'], " ");
    let name = name.split_whitespace().collect::<Vec<_>>().join(" ");
    if name.is_empty() { "Game".to_string() } else { name }
}

/// Takes a game off Arcade's list (its file stays where it is). A later scan finds it again if it
/// is still in a game folder.
#[tauri::command]
pub async fn arcade_forget(state: State<'_, AppState>, id: i64) -> AppResult<()> {
    with_library(&state, move |library| {
        library.db.with(|conn| {
            // A store game is still installed: it's hidden, so the next search doesn't bring it back.
            conn.execute("UPDATE arcade_games SET hidden = 1 WHERE id = ?1 AND store IS NOT NULL", [id])?;
            conn.execute("DELETE FROM arcade_games WHERE id = ?1 AND store IS NULL", [id])?;
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
                removed += tx.execute("UPDATE arcade_games SET hidden = 1 WHERE id = ?1 AND store IS NOT NULL", [id])?;
                removed += tx.execute("DELETE FROM arcade_games WHERE id = ?1 AND store IS NULL", [id])?;
            }
            tx.commit()?;
            Ok(removed)
        })
    })
    .await
}

/// Looks for covers again for some games: those with a picture of the user's keep it, unless
/// `reset` (Default cover, D-039) puts back the launcher's or emulator's own.
#[tauri::command]
pub async fn arcade_find_covers(app: AppHandle, state: State<'_, AppState>, ids: Vec<i64>, download: bool, reset: bool) -> AppResult<usize> {
    let library = state.library()?;
    crate::library::blocking(move || {
        library.db.with(|conn| {
            let tx = conn.transaction()?;
            for id in &ids {
                tx.execute(
                    "UPDATE arcade_games SET cover_key = NULL, cover_color = NULL, cover_source = NULL WHERE id = ?1 AND (?2 OR coalesce(cover_source, '') <> 'user')",
                    params![id, reset],
                )?;
            }
            tx.commit()?;
            Ok(())
        })?;
        let local = local_art(&found_emulators(&library)?);
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
        let queued = find_covers(&app, &library, &ids, &local, download, None)?;
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

/// Time played outside Digitify (D-043), added to the game's total; what Digitify counts stays apart.
#[tauri::command]
pub async fn arcade_set_extra_time(app: AppHandle, state: State<'_, AppState>, id: i64, seconds: i64) -> AppResult<()> {
    // At most 100,000 hours.
    let seconds = seconds.clamp(0, 360_000_000);
    with_library(&state, move |library| {
        library.db.with(|conn| {
            conn.execute("UPDATE arcade_games SET extra_seconds = ?2 WHERE id = ?1", params![id, seconds])?;
            Ok(())
        })
    })
    .await?;
    let _ = app.emit("arcade-changed", ());
    Ok(())
}

/// A Steam game whose hours on Steam are more than Digitify counts (D-167).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SteamHours {
    pub id: i64,
    pub title: String,
    /// What Steam has recorded, and what Digitify counts now (its own and added by hand).
    pub steam_seconds: i64,
    pub digitify_seconds: i64,
}

/// The Steam games in Arcade whose time on Steam (read from Steam's own records, D-167) is more than
/// Digitify counts, most first. Nothing is changed.
#[tauri::command]
pub async fn arcade_steam_hours(state: State<'_, AppState>) -> AppResult<Vec<SteamHours>> {
    let times = crate::library::blocking(|| Ok(stores::steam_playtimes())).await?;
    with_library(&state, move |library| library.db.with(|conn| steam_hours(conn, &times))).await
}

fn steam_hours(conn: &rusqlite::Connection, times: &HashMap<String, i64>) -> AppResult<Vec<SteamHours>> {
    let mut games: Vec<SteamHours> = conn
        .prepare("SELECT id, title, store_key, play_seconds + extra_seconds FROM arcade_games WHERE store = 'steam' AND hidden = 0")?
        .query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?, row.get::<_, Option<String>>(2)?, row.get::<_, i64>(3)?)))?
        .filter_map(Result::ok)
        .filter_map(|(id, title, app, counted)| {
            let steam = times.get(app.as_deref()?)? * 60;
            (steam > counted).then_some(SteamHours { id, title, steam_seconds: steam, digitify_seconds: counted })
        })
        .collect();
    games.sort_by_key(|g| std::cmp::Reverse(g.steam_seconds - g.digitify_seconds));
    Ok(games)
}

/// Brings Steam's hours in (D-167): each Steam game whose time on Steam is more than Digitify counts
/// gets the difference as time played elsewhere, so its total matches Steam's; a game where Digitify
/// counts more keeps its time. Run again, it only adds what Steam has counted since. Returns how many
/// games changed.
#[tauri::command]
pub async fn arcade_steam_hours_apply(app: AppHandle, state: State<'_, AppState>) -> AppResult<usize> {
    let times = crate::library::blocking(|| Ok(stores::steam_playtimes())).await?;
    let changed = with_library(&state, move |library| {
        library.db.with(|conn| {
            let games = steam_hours(conn, &times)?;
            let tx = conn.transaction()?;
            for game in &games {
                tx.execute(
                    "UPDATE arcade_games SET extra_seconds = extra_seconds + ?2 WHERE id = ?1",
                    params![game.id, (game.steam_seconds - game.digitify_seconds).clamp(0, 360_000_000)],
                )?;
            }
            tx.commit()?;
            Ok(games.len())
        })
    })
    .await?;
    let _ = app.emit("arcade-changed", ());
    Ok(changed)
}

/// The user's rating (1-5 stars, or none) and note for a game (D-049).
#[tauri::command]
pub async fn arcade_set_review(app: AppHandle, state: State<'_, AppState>, id: i64, rating: Option<i64>, note: Option<String>) -> AppResult<()> {
    let rating = rating.filter(|r| (1..=5).contains(r));
    let note = note.map(|n| n.trim().to_string()).filter(|n| !n.is_empty()).map(|n| n.chars().take(10_000).collect::<String>());
    with_library(&state, move |library| {
        library.db.with(|conn| {
            conn.execute("UPDATE arcade_games SET rating = ?2, note = ?3 WHERE id = ?1", params![id, rating, note])?;
            Ok(())
        })
    })
    .await?;
    let _ = app.emit("arcade-changed", ());
    Ok(())
}

/// Brings back every store game taken off the list.
#[tauri::command]
pub async fn arcade_unhide(app: AppHandle, state: State<'_, AppState>) -> AppResult<usize> {
    let shown = with_library(&state, move |library| library.db.with(|conn| Ok(conn.execute("UPDATE arcade_games SET hidden = 0 WHERE hidden = 1", [])?))).await?;
    let _ = app.emit("arcade-changed", ());
    Ok(shown)
}

#[tauri::command]
pub async fn arcade_reveal(state: State<'_, AppState>, id: i64) -> AppResult<()> {
    let path: String = with_library(&state, move |library| {
        library.db.with(|conn| Ok(conn.query_row("SELECT coalesce(install_dir, path) FROM arcade_games WHERE id = ?1", [id], |row| row.get(0))?))
    })
    .await?;
    crate::files::reveal(Path::new(&path))
}

#[cfg(test)]
mod schema_tests {
    use crate::db::Database;

    #[test]
    fn keywords_are_cleaned() {
        let cleaned = super::clean_keywords(vec!["  Party  game ".into(), "party GAME".into(), "".into(), "x".repeat(60), "Couch".into()]);
        assert_eq!(cleaned, vec!["Party game".to_string(), "x".repeat(40), "Couch".to_string()]);
        assert_eq!(super::clean_keywords((0..50).map(|i| format!("k{i}")).collect()).len(), 40);
    }

    #[test]
    fn new_consoles_and_emulators_fit_the_tables() {
        let dir = std::env::temp_dir().join(format!("digitify-d101-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let db = Database::open(&dir.join("library.db"), &dir.join("backups")).unwrap();
        db.with(|conn| {
            conn.execute("INSERT INTO arcade_emulators (kind, path) VALUES ('duckstation', 'x'), ('retroarch', 'y')", [])?;
            conn.execute("INSERT INTO arcade_emulator_folders (emulator, path) VALUES ('melonds', 'z')", [])?;
            // D-106: Mesen, FCEUX and mGBA.
            conn.execute("INSERT INTO arcade_emulators (kind, path) VALUES ('mesen', 'm'), ('fceux', 'f'), ('mgba', 'g')", [])?;
            conn.execute("INSERT INTO arcade_emulator_folders (emulator, path) VALUES ('mgba', 'w')", [])?;
            // D-111: any emulator's name, none empty.
            conn.execute("INSERT INTO arcade_emulators (kind, path) VALUES ('ares', 'a'), ('nulldc', 'n'), ('snes9x', 's')", [])?;
            assert!(conn.execute("INSERT INTO arcade_emulators (kind, path) VALUES ('', 'e')", []).is_err(), "an emulator needs a name");
            // D-117: one set aside.
            conn.execute("INSERT INTO arcade_emulators (kind, ignored) VALUES ('nulldc', 1) ON CONFLICT(kind) DO UPDATE SET ignored = 1", [])?;
            assert!(conn.query_row("SELECT ignored FROM arcade_emulators WHERE kind = 'nulldc'", [], |r| r.get::<_, bool>(0))?);
            conn.execute("INSERT INTO arcade_games (path, platform, title, sort_title, core, system) VALUES ('a.sfc', 'snes', 'A', 'a', 'c', 'Nintendo - Super Nintendo Entertainment System')", [])?;
            assert!(conn.execute("INSERT INTO arcade_games (path, platform, title, sort_title) VALUES ('b', '', 'B', 'b')", []).is_err(), "a console needs a name");
            // D-160: a game's keywords, kept as a JSON list.
            conn.execute("UPDATE arcade_games SET keywords = '[\"party\",\"4 players\"]' WHERE path = 'a.sfc'", [])?;
            let kept: String = conn.query_row("SELECT keywords FROM arcade_games WHERE path = 'a.sfc'", [], |r| r.get(0))?;
            assert_eq!(serde_json::from_str::<Vec<String>>(&kept).unwrap(), ["party", "4 players"]);
            Ok(())
        })
        .unwrap();
        drop(db);
        let _ = std::fs::remove_dir_all(&dir);
    }
}

#[cfg(test)]
mod program_tests {
    use super::program_title;
    use std::path::Path;

    #[test]
    fn a_program_is_named_after_itself_or_its_folder() {
        assert_eq!(program_title(Path::new("/g/Celeste/Celeste.exe")), "Celeste");
        assert_eq!(program_title(Path::new("/g/Hollow Knight/Game.exe")), "Hollow Knight");
        assert_eq!(program_title(Path::new("/g/Some_Game/Launcher64.exe")), "Some Game");
        assert_eq!(program_title(Path::new("/g/x/Super_Meat_Boy.exe")), "Super Meat Boy");
    }
}

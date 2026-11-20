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
mod detect;
mod games;
mod icons;
mod launchers;
mod retroarch;
mod sgdb;
mod stores;

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
        let stores = stores::scan_all()
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
        for entry in walker.into_iter().filter_map(Result::ok) {
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

/// Covers for `ids`: Dolphin's cache at once; when `download`, GameTDB (GameCube and Wii, by disc ID)
/// and libretro-thumbnails (every console, by name; D-035) in the background. Returns how many
/// games wait for a download.
/// Each store game's art by its path (`store://…`): on this computer, and its launcher's online.
type StoreArt = HashMap<String, (Option<PathBuf>, Option<String>)>;

fn store_art_now() -> StoreArt {
    stores::scan_all()
        .into_iter()
        .flat_map(|found| found.games)
        .map(|g| (format!("store://{}/{}", g.store.key(), g.key), (g.cover, g.cover_url)))
        .collect()
}

fn find_covers(app: &AppHandle, library: &std::sync::Arc<Library>, ids: &[i64], local: &LocalArt, download: bool, store_art: Option<StoreArt>) -> AppResult<usize> {
    let sgdb_key = steamgriddb_key(app);
    let launchbox = art_cache(app).map(|c| artsources::launchbox_db_path(&c)).filter(|db| db.is_file());
    type Row = (i64, Option<String>, String, String, String, Option<String>, Option<String>, Option<String>);
    let games: Vec<Row> = library.db.with(|conn| {
        let mut stmt = conn.prepare("SELECT id, game_id, platform, path, title, store, store_key, system FROM arcade_games WHERE id = ?1")?;
        let mut out = Vec::new();
        for id in ids {
            if let Some(row) = stmt.query_row([id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?, row.get(6)?, row.get(7)?))).optional()? {
                out.push(row);
            }
        }
        Ok(out)
    })?;
    let mut queue = Vec::new();
    let mut store_art = store_art;
    for (id, game_id, platform, path, title, store, store_key, system) in games {
        // PC games (D-037, D-039): their launcher's art on this computer (Steam's cache, the Xbox app's
        // logos); else, with downloads, the art their launcher shows (Epic's and Heroic's records name
        // it; Steam's by app id).
        if platform == "pc" {
            let art = store_art.get_or_insert_with(store_art_now).get(&path).cloned().unwrap_or_default();
            if let Some(bytes) = art.0.and_then(|p| std::fs::read(p).ok()) {
                if set_cover(library, id, &bytes, "store").is_ok() {
                    continue;
                }
            }
            if download {
                let mut urls: Vec<String> = art.1.into_iter().collect();
                match (store.as_deref(), store_key.as_deref()) {
                    (Some("steam"), Some(app)) => urls.extend(stores::steam_cover_urls(app)),
                    // GOG's catalogue names its box art by the game's ID (D-101).
                    (Some("gog"), Some(game)) => urls.push(format!("gog:{game}")),
                    _ => {}
                }
                // Not from Steam: Steam's store may know the game by its name (D-108).
                if store.as_deref() != Some("steam") {
                    urls.push(format!("steam-search:{title}"));
                }
                // LaunchBox, when its database is here, and the Microsoft Store (D-131).
                if launchbox.is_some() {
                    urls.push(format!("lb:pc|{title}"));
                }
                if store.as_deref() != Some("steam") {
                    urls.push(format!("ms:{title}"));
                }
                // Then SteamGridDB, by name, with the user's key (D-128).
                if sgdb_key.is_some() {
                    urls.push(format!("sgdb:{title}"));
                }
                if !urls.is_empty() {
                    queue.push((id, urls));
                }
            }
            continue;
        }
        let cached = game_id.as_ref().and_then(|g| local.dolphin.as_ref().map(|dir| dir.join(format!("{g}.png")))).filter(|p| p.is_file());
        if let Some(bytes) = cached.and_then(|p| std::fs::read(p).ok()) {
            if set_cover(library, id, &bytes, "dolphin").is_ok() {
                continue;
            }
        }
        let stem = games::title_from_name(Path::new(path.rsplit('#').next().unwrap_or(&path)));
        let names = games::libretro_names(&stem, &title);
        // RetroArch's own box art for the games in its playlists (D-101).
        if let (Some(system), Some(thumbnails)) = (system.as_deref(), local.retroarch.as_deref()) {
            let mut wanted = vec![title.clone()];
            wanted.extend(names.iter().cloned());
            if let Some(bytes) = retroarch::thumbnail(thumbnails, system, &wanted).and_then(|p| std::fs::read(p).ok()) {
                if set_cover(library, id, &bytes, "retroarch").is_ok() {
                    continue;
                }
            }
        }
        // A PlayStation 3 game's own picture: wide, so a downloaded box comes first when allowed.
        let icon = (platform == Platform::Ps3.key()).then(|| games::ps3_icon(Path::new(&path))).flatten();
        if !download {
            if let Some(bytes) = icon.and_then(|p| std::fs::read(p).ok()) {
                let _ = set_cover(library, id, &bytes, "rpcs3");
            }
            continue;
        }
        let mut urls = Vec::new();
        urls.extend(gametdb_urls(&platform, game_id.as_deref()));
        // LaunchBox by name, on this console (D-131).
        if launchbox.is_some() && !artsources::launchbox_platforms(&platform).is_empty() {
            urls.push(format!("lb:{platform}|{title}"));
        }
        let libretro = system.as_deref().map(retroarch::libretro_system).or_else(|| games::libretro_system(&platform).map(str::to_string));
        if let Some(collection) = libretro {
            urls.extend(names.iter().map(|name| games::libretro_url(&collection, name)));
        }
        // The Microsoft Store for Xbox games (D-131).
        if platform == "ogxbox" || platform == "x360" {
            urls.push(format!("ms:{title}"));
        }
        // SteamGridDB by the game's name (D-128): not only the IDs GameTDB knows.
        if sgdb_key.is_some() {
            urls.push(format!("sgdb:{title}"));
        }
        urls.extend(icon.map(|p| format!("file:{}", p.display())));
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
                    // A picture on this computer, tried after the downloads (a PlayStation 3 game's icon).
                    if let Some(file) = url.strip_prefix("file:") {
                        if std::fs::read(file).ok().is_some_and(|bytes| set_cover(&library, id, &bytes, "rpcs3").is_ok()) {
                            let _ = app.emit("arcade-changed", ());
                            break;
                        }
                        continue;
                    }
                    // GOG's catalogue says where the box art is; Steam's store finds a game by its name.
                    let url = if let Some(game) = url.strip_prefix("gog:") {
                        match stores::gog_cover_url(game) {
                            Some(found) => found,
                            None => continue,
                        }
                    } else if let Some(rest) = url.strip_prefix("lb:") {
                        let (platform, title) = rest.split_once('|').unwrap_or(("", rest));
                        match launchbox.as_deref().and_then(|db| artsources::launchbox_covers(db, title, artsources::launchbox_platforms(platform), 1).into_iter().next()) {
                            Some((_, found)) => found,
                            None => continue,
                        }
                    } else if let Some(title) = url.strip_prefix("ms:") {
                        match artsources::msstore_covers(title, 1, false).into_iter().next() {
                            Some((_, found)) => found,
                            None => continue,
                        }
                    } else if let Some(title) = url.strip_prefix("sgdb:") {
                        match sgdb_key.as_deref().and_then(|key| sgdb::first_for(key, title)) {
                            Some(found) => found,
                            None => continue,
                        }
                    } else if let Some(title) = url.strip_prefix("steam-search:") {
                        let urls = stores::steam_search(title).map(|game| stores::steam_cover_urls(&game)).unwrap_or_default();
                        if urls.iter().any(|u| crate::online::http::image(u).is_some_and(|bytes| set_cover(&library, id, &bytes, "steam").is_ok())) {
                            let _ = app.emit("arcade-changed", ());
                            break;
                        }
                        continue;
                    } else {
                        url
                    };
                    let source = if url.contains("steamgriddb") {
                        "steamgriddb"
                    } else if url.contains("launchbox") {
                        "launchbox"
                    } else if url.contains("store-images.s-microsoft") {
                        "msstore"
                    } else if url.contains("gametdb") {
                        "gametdb"
                    } else if url.contains("libretro") {
                        "libretro"
                    } else if url.contains("steamstatic") {
                        "steam"
                    } else if url.contains("gog") {
                        "gog"
                    } else {
                        "store"
                    };
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

/// Where Arcade keeps what it downloads to search (LaunchBox's index, D-131).
fn art_cache(app: &AppHandle) -> Option<PathBuf> {
    crate::config::config_dir(app).ok().map(|d| d.join("cache"))
}

/// LaunchBox's index: when it was downloaded and how many games it knows, if it's here (D-131).
#[tauri::command]
pub fn arcade_launchbox_status(app: AppHandle) -> Option<artsources::LaunchBoxStatus> {
    art_cache(&app).and_then(|c| artsources::status(&c))
}

/// Downloads LaunchBox's database (about 110 MB) and indexes it, replacing the one here (D-131).
#[tauri::command]
pub async fn arcade_launchbox_download(app: AppHandle) -> AppResult<artsources::LaunchBoxStatus> {
    let cache = art_cache(&app).ok_or_else(|| AppError::msg("Digitify's settings folder isn't available."))?;
    crate::library::blocking(move || artsources::download(&cache)).await
}

/// Removes LaunchBox's index from this computer (D-131).
#[tauri::command]
pub fn arcade_launchbox_remove(app: AppHandle) -> AppResult<()> {
    if let Some(cache) = art_cache(&app) {
        let db = artsources::launchbox_db_path(&cache);
        if db.is_file() {
            std::fs::remove_file(db)?;
        }
    }
    Ok(())
}

/// The user's SteamGridDB key, if they gave one (D-128).
fn steamgriddb_key(app: &AppHandle) -> Option<String> {
    app.try_state::<AppState>().and_then(|state| state.config.get().steamgriddb_key).filter(|k| !k.trim().is_empty())
}

/// Whether a SteamGridDB key is set (D-128).
#[tauri::command]
pub fn arcade_steamgriddb_status(app: AppHandle) -> bool {
    steamgriddb_key(&app).is_some()
}

/// Opens SteamGridDB's page where an account's API key is made (D-128), in the browser.
#[tauri::command]
pub fn arcade_steamgriddb_open() -> AppResult<()> {
    crate::tools::open_link("https://www.steamgriddb.com/profile/preferences/api").map_err(|e| AppError::msg(format!("Couldn't open the browser: {e}")))
}

/// Sets the user's SteamGridDB key after checking that SteamGridDB answers with it; `None` removes it.
#[tauri::command]
pub async fn arcade_steamgriddb_set(state: State<'_, AppState>, key: Option<String>) -> AppResult<()> {
    let key = key.map(|k| k.trim().to_string()).filter(|k| !k.is_empty());
    if let Some(key) = key.clone() {
        let works = crate::library::blocking(move || Ok(sgdb::key_works(&key))).await?;
        if !works {
            return Err(AppError::msg("SteamGridDB didn't accept that key. Check it in your SteamGridDB preferences (API)."));
        }
    }
    state.config.update(|config| config.steamgriddb_key = key)?;
    Ok(())
}

/// GameTDB's box art for a game by its ID: GameCube and Wii, 3DS and Wii U (D-116).
fn gametdb_urls(platform: &str, game_id: Option<&str>) -> Vec<String> {
    let Some(id) = game_id else { return Vec::new() };
    let (folder, kinds): (&str, &[&str]) = match platform {
        "gamecube" | "wii" => ("wii", &["png"]),
        "3ds" => ("3ds", &["jpg", "png"]),
        "wiiu" => ("wiiu", &["jpg", "png"]),
        _ => return Vec::new(),
    };
    games::cover_regions(id).into_iter().flat_map(|region| kinds.iter().map(move |kind| format!("https://art.gametdb.com/{folder}/cover/{region}/{id}.{kind}"))).collect()
}

/// Where a cover to choose from comes from.
enum CoverSource {
    File(PathBuf),
    Url(String),
}

/// Every cover Arcade can find for a game (D-118), for the user to choose among: what's on this
/// computer (the launcher's, Dolphin's, RetroArch's, a PlayStation 3 game's icon), then online
/// (GameTDB, libretro-thumbnails, the stores; Steam's store by name, a few close matches).
/// `search` (D-146), when given, is the name looked up instead of the game's title.
/// A search also finds the names that only have some of its words (D-148), each labelled with its name.
fn cover_sources(library: &Library, id: i64, search: Option<&str>, sgdb_key: Option<&str>, launchbox: Option<&Path>, cache: Option<&Path>) -> AppResult<Vec<(String, CoverSource)>> {
    type Row = (Option<String>, String, String, String, Option<String>, Option<String>, Option<String>);
    let (game_id, platform, path, title, store, store_key, system): Row = library
        .db
        .with(|conn| {
            Ok(conn.query_row("SELECT game_id, platform, path, title, store, store_key, system FROM arcade_games WHERE id = ?1", [id], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?, row.get(6)?))
            })?)
        })?;
    let title = search.map(str::trim).filter(|s| !s.is_empty()).map(str::to_string).unwrap_or(title);
    let fuzzy = search.is_some();
    let mut out: Vec<(String, CoverSource)> = Vec::new();
    if platform == "pc" {
        let art = store_art_now().get(&path).cloned().unwrap_or_default();
        out.extend(art.0.map(|p| ("Its launcher".to_string(), CoverSource::File(p))));
        out.extend(art.1.map(|u| ("Its launcher".to_string(), CoverSource::Url(u))));
        match (store.as_deref(), store_key.as_deref()) {
            (Some("steam"), Some(app)) => out.extend(stores::steam_cover_urls(app).into_iter().map(|u| ("Steam".to_string(), CoverSource::Url(u)))),
            (Some("gog"), Some(game)) => out.extend(stores::gog_cover_url(game).map(|u| ("GOG".to_string(), CoverSource::Url(u)))),
            _ => {}
        }
        if store.as_deref() != Some("steam") {
            for (name, app) in stores::steam_search_all(&title).into_iter().take(if fuzzy { 6 } else { 3 }) {
                out.extend(stores::steam_cover_urls(&app).into_iter().take(2).map(|u| (format!("Steam · {name}"), CoverSource::Url(u))));
            }
        }
        // LaunchBox and the Microsoft Store, by name (D-131).
        if let Some(db) = launchbox {
            let found = if fuzzy { artsources::launchbox_by_words(db, &title, artsources::launchbox_platforms("pc"), 6, 2) } else { artsources::launchbox_covers(db, &title, artsources::launchbox_platforms("pc"), 4) };
            out.extend(found.into_iter().map(|(label, u)| (label, CoverSource::Url(u))));
        }
        out.extend(artsources::msstore_covers(&title, 3, fuzzy).into_iter().map(|(label, u)| (label, CoverSource::Url(u))));
        if let Some(key) = sgdb_key {
            match (store.as_deref(), store_key.as_deref()) {
                (Some("steam"), Some(app)) => out.extend(sgdb::steam_grids(key, app, 6).into_iter().map(|u| ("SteamGridDB".to_string(), CoverSource::Url(u)))),
                _ => out.extend(sgdb_by_name(key, &title)),
            }
        }
        return Ok(out);
    }
    let emulators = found_emulators(library)?;
    let local = local_art(&emulators);
    if let (Some(game), Some(dir)) = (game_id.as_deref(), local.dolphin.as_ref()) {
        out.push(("Dolphin".to_string(), CoverSource::File(dir.join(format!("{game}.png")))));
    }
    let stem = games::title_from_name(Path::new(path.rsplit('#').next().unwrap_or(&path)));
    let mut names = games::libretro_names(&stem, &title);
    // The names LaunchBox knows the game by (D-147): "Animal Forest" is libretro's "Doubutsu no Mori
    // (Japan)". LaunchBox writes "A: B" where libretro writes "A - B".
    if let Some(db) = launchbox {
        for other in artsources::launchbox_names(db, &title, artsources::launchbox_platforms(&platform)).into_iter().take(3) {
            let other = other.replace(": ", " - ");
            for name in games::libretro_names(&other, &other) {
                if !names.iter().any(|n| n.eq_ignore_ascii_case(&name)) {
                    names.push(name);
                }
            }
        }
    }
    let collection = system.clone().map(|s| retroarch::libretro_system(&s)).or_else(|| games::libretro_system(&platform).map(str::to_string));
    if let Some(thumbnails) = local.retroarch.as_deref() {
        let folder = system.clone().or_else(|| collection.as_ref().map(|c| c.replace('_', " ")));
        if let Some(folder) = folder {
            let mut wanted = vec![title.clone()];
            wanted.extend(names.iter().cloned());
            out.extend(retroarch::thumbnail(thumbnails, &folder, &wanted).map(|p| ("RetroArch".to_string(), CoverSource::File(p))));
        }
    }
    if platform == Platform::Ps3.key() {
        out.extend(games::ps3_icon(Path::new(&path)).map(|p| ("The game's icon".to_string(), CoverSource::File(p))));
    }
    out.extend(gametdb_urls(&platform, game_id.as_deref()).into_iter().map(|u| ("GameTDB".to_string(), CoverSource::Url(u))));
    if let Some(collection) = collection {
        out.extend(names.iter().map(|name| ("libretro".to_string(), CoverSource::Url(games::libretro_url(&collection, name)))));
        // By its words, among every box libretro has for the console (D-148).
        if let (true, Some(cache)) = (fuzzy, cache) {
            let index = artsources::libretro_index(cache, &collection);
            for name in artsources::best_by_words(index.iter().map(String::as_str), &title, 8) {
                if !names.iter().any(|n| n.eq_ignore_ascii_case(&name)) {
                    out.push((format!("libretro · {name}"), CoverSource::Url(games::libretro_url(&collection, &name))));
                }
            }
        }
    }
    // By the game's name too, not only its ID (D-128, D-131): LaunchBox, Nintendo's store, the
    // Microsoft Store, SteamGridDB.
    if let Some(db) = launchbox {
        let found = if fuzzy { artsources::launchbox_by_words(db, &title, artsources::launchbox_platforms(&platform), 6, 2) } else { artsources::launchbox_covers(db, &title, artsources::launchbox_platforms(&platform), 6) };
        out.extend(found.into_iter().map(|(label, u)| (label, CoverSource::Url(u))));
    }
    out.extend(artsources::eshop_covers(&platform, &title, 3, fuzzy).into_iter().map(|(label, u)| (label, CoverSource::Url(u))));
    if platform == "ogxbox" || platform == "x360" {
        out.extend(artsources::msstore_covers(&title, 3, fuzzy).into_iter().map(|(label, u)| (label, CoverSource::Url(u))));
    }
    if let Some(key) = sgdb_key {
        out.extend(sgdb_by_name(key, &title));
    }
    Ok(out)
}

/// SteamGridDB's box art for the games it finds by a name: the two closest, a few each.
fn sgdb_by_name(key: &str, title: &str) -> Vec<(String, CoverSource)> {
    sgdb::search(key, title)
        .into_iter()
        .take(2)
        .flat_map(|(game, name)| sgdb::game_grids(key, game, 4).into_iter().map(move |u| (format!("SteamGridDB · {name}"), CoverSource::Url(u))))
        .collect()
}

/// A cover to choose from, as the panel shows it: a small picture and where it's from.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoverChoice {
    pub index: usize,
    pub source: String,
    /// A small JPEG of it, as a data URL.
    pub preview: String,
    pub width: u32,
    pub height: u32,
}

pub(crate) fn base64(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
        for i in 0..4 {
            if i <= chunk.len() {
                out.push(TABLE[(n >> (18 - 6 * i) & 63) as usize] as char);
            } else {
                out.push('=');
            }
        }
    }
    out
}

/// Looks for every cover of a game (D-118) and keeps them to choose from: each found once (the
/// same picture from two places counts once), at most a dozen. Online, as asked for by the click.
/// `search` looks them up by another name than the game's (D-146).
#[tauri::command]
pub async fn arcade_cover_choices(app: AppHandle, state: State<'_, AppState>, arcade: State<'_, ArcadeState>, id: i64, search: Option<String>) -> AppResult<Vec<CoverChoice>> {
    let library = state.library()?;
    let key = state.config.get().steamgriddb_key.filter(|k| !k.trim().is_empty());
    let cache = art_cache(&app);
    let launchbox = cache.as_ref().map(|c| artsources::launchbox_db_path(c)).filter(|db| db.is_file());
    let (most_sources, most_kept) = if search.is_some() { (80, 30) } else { (40, 12) };
    let found: Vec<(String, Vec<u8>)> = crate::library::blocking(move || {
        let sources = cover_sources(&library, id, search.as_deref(), key.as_deref(), launchbox.as_deref(), cache.as_deref())?;
        let fetched: Vec<Option<(String, Vec<u8>)>> = std::thread::scope(|scope| {
            let handles: Vec<_> = sources
                .into_iter()
                .take(most_sources)
                .map(|(source, from)| {
                    scope.spawn(move || {
                        let bytes = match from {
                            CoverSource::File(path) => std::fs::read(path).ok(),
                            CoverSource::Url(url) => crate::online::http::image(&url),
                        }?;
                        Some((source, bytes))
                    })
                })
                .collect();
            handles.into_iter().map(|h| h.join().ok().flatten()).collect()
        });
        let mut seen = HashSet::new();
        Ok(fetched.into_iter().flatten().filter(|(_, bytes)| seen.insert(blake3::hash(bytes))).take(most_kept).collect())
    })
    .await?;
    let mut choices = Vec::new();
    let mut kept = Vec::new();
    for (source, bytes) in found {
        let Ok(picture) = image::load_from_memory(&bytes) else { continue };
        let (width, height) = (picture.width(), picture.height());
        let small = picture.thumbnail(320, 320).to_rgb8();
        let mut jpeg = Vec::new();
        if image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, 82).encode_image(&small).is_err() {
            continue;
        }
        choices.push(CoverChoice { index: kept.len(), source: source.clone(), preview: format!("data:image/jpeg;base64,{}", base64(&jpeg)), width, height });
        kept.push((source, bytes));
    }
    if let Ok(mut all) = arcade.choices.lock() {
        all.insert(id, kept);
    }
    Ok(choices)
}

/// Uses one of the covers found for a game (D-118) as its cover.
#[tauri::command]
pub async fn arcade_choose_cover(app: AppHandle, state: State<'_, AppState>, arcade: State<'_, ArcadeState>, id: i64, index: usize) -> AppResult<()> {
    let chosen = arcade.choices.lock().ok().and_then(|mut all| all.remove(&id)).and_then(|mut list| (index < list.len()).then(|| list.swap_remove(index)));
    let (source, bytes) = chosen.ok_or_else(|| AppError::msg("Those covers aren't there anymore; look for them again."))?;
    let source = match source.as_str() {
        "GameTDB" => "gametdb",
        s if s.starts_with("libretro") => "libretro",
        "RetroArch" => "retroarch",
        "Dolphin" => "dolphin",
        "GOG" => "gog",
        s if s.starts_with("SteamGridDB") => "steamgriddb",
        s if s.starts_with("LaunchBox") => "launchbox",
        s if s.starts_with("Nintendo eShop") => "eshop",
        s if s.starts_with("Microsoft Store") => "msstore",
        s if s.starts_with("Steam") => "steam",
        _ => "store",
    };
    with_library(&state, move |library| set_cover(library, id, &bytes, source)).await?;
    let _ = app.emit("arcade-changed", ());
    Ok(())
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
}

#[tauri::command]
pub async fn arcade_games(state: State<'_, AppState>) -> AppResult<Vec<GameCard>> {
    with_library(&state, move |library| {
        library.db.with(|conn| {
            let rows = conn
                .prepare(
                    "SELECT id, title, platform, game_id, path, size, cover_key, cover_color, is_favorite, play_seconds + extra_seconds, play_count, \
                     last_played_at, added_at, missing, position, store, extra_seconds, rating, note, system IS NOT NULL, emulator, completed_at FROM arcade_games WHERE hidden = 0 ORDER BY sort_title, id",
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

// ---------------------------------------------------------------------------------------------
// Playing

/// What Digitify does while a game runs (D-041).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum WhilePlaying {
    /// Stays open; the UI silences its music (the default).
    Stay,
    /// Hides, out of the taskbar, and comes back when the game ends (D-035).
    Hide,
    /// Quits once the game is started; play time isn't counted.
    Quit,
}

impl WhilePlaying {
    fn parse(mode: Option<&str>) -> Self {
        match mode {
            Some("hide") => Self::Hide,
            Some("quit") => Self::Quit,
            _ => Self::Stay,
        }
    }
}

/// Quits Digitify a moment after a game was started (`WhilePlaying::Quit`), leaving the game running.
fn quit_for_game(app: &AppHandle, id: i64) {
    log::info!("arcade: game {id} started; Digitify quits as asked");
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(800));
        app.exit(0);
    });
}

/// Starts the emulator on a game, with the emulator's own settings. Nintendo 64 games use `n64`
/// (`project64` or `rmg`) and Nintendo DS games `ds` (`melonds` or `desmume`) when both are found;
/// games from RetroArch's playlists start in RetroArch with their core. Play time is counted until
/// the emulator closes. `mode` says what Digitify does meanwhile: `stay` (default), `hide` or
/// `quit` (D-041).
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn arcade_launch(
    app: AppHandle,
    state: State<'_, AppState>,
    arcade: State<'_, ArcadeState>,
    id: i64,
    n64: Option<String>,
    ds: Option<String>,
    mode: Option<String>,
    choices: Option<HashMap<String, String>>,
) -> AppResult<()> {
    let mode = WhilePlaying::parse(mode.as_deref());
    if arcade.running.lock().map(|r| r.is_some()).unwrap_or(false) {
        return Err(AppError::msg("A game is already running. Close it first."));
    }
    let library = state.library()?;
    type Row = (String, String, Option<String>, Option<String>, Option<String>, Option<String>, Option<String>, Option<String>);
    let (path, platform, store, launch, install_dir, core, system, own): Row = library
        .db
        .with(|conn| {
            Ok(conn
                .query_row("SELECT path, platform, store, launch, install_dir, core, system, emulator FROM arcade_games WHERE id = ?1", [id], |row| {
                    Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?, row.get(6)?, row.get(7)?))
                })
                .optional()?)
        })?
        .ok_or_else(|| AppError::msg("That game is no longer in Arcade."))?;
    if platform == "pc" {
        let launch = launch.ok_or_else(|| AppError::msg("Arcade doesn't know how to start that game."))?;
        // A program added by hand (D-107) starts by itself; a store's game through its store.
        let name = match store.as_deref() {
            None => "the game",
            Some(key) => Store::parse(key).ok_or_else(|| AppError::msg("That game's store isn't known."))?.name(),
        };
        return launch_store_game(app, library, id, name, &launch, install_dir.map(PathBuf::from), mode);
    }
    let file = retroarch::file_of(&path);
    // A game kept as a folder (PlayStation 3, Wii U, Xbox 360) is its folder.
    let there = file.exists();
    if !there {
        return Err(AppError::msg("The game's file isn't there anymore (was its drive unplugged?)."));
    }
    let emulators = found_emulators(&library)?;
    let found = |e: Emulator| emulators.iter().find(|(k, f, _, _)| *k == e && f.is_some()).and_then(|(_, f, _, _)| f.clone());
    let need = |text: &str| AppError::msg(format!("{text} Install it, or point Arcade to it in Emulators & folders."));
    let chosen = if system.is_some() {
        // From RetroArch's playlists (D-101): RetroArch, with the core the playlist names.
        let found = found(Emulator::RetroArch).ok_or_else(|| need("This game is from RetroArch's playlists, and RetroArch isn't found anymore."))?;
        if core.is_none() {
            return Err(AppError::msg("RetroArch's playlist doesn't say which core plays this game. Choose one for its playlist in RetroArch, then look for games again."));
        }
        found
    } else {
        let console = Platform::parse(&platform).ok_or_else(|| AppError::msg("Arcade doesn't know which emulator plays this game."))?;
        // The game's own emulator (D-148), else the one chosen for its console (Emulators & folders ›
        // Consoles), else Arcade's order. The game's own has to be there: it was picked for it.
        if let Some(own) = own.as_deref().and_then(Emulator::parse) {
            if found(own).is_none() {
                return Err(need(&format!("This game is set to play in {}, which isn't found.", own.name())));
            }
        }
        let chosen = choices
            .as_ref()
            .and_then(|c| c.get(&platform))
            .cloned()
            .or(match console {
                Platform::N64 => n64,
                Platform::Ds => ds,
                _ => None,
            })
            .and_then(|key| Emulator::parse(&key));
        let own = own.as_deref().and_then(Emulator::parse);
        let candidates: Vec<Emulator> = own.into_iter().chain(chosen).chain(players(console).iter().copied()).filter(|e| e.available_here()).collect();
        match candidates.iter().find_map(|e| found(*e)) {
            Some(found) => found,
            None => {
                let mut names: Vec<&str> = players(console).iter().filter(|e| e.available_here()).map(|e| e.name()).collect();
                let last = names.pop().unwrap_or("an emulator");
                let which = if names.is_empty() { last.to_string() } else { format!("{} or {last}", names.join(", ")) };
                return Err(need(&format!("{} games need {which}.", console.name())));
            }
        }
    };
    let mut command = launch_command(&chosen, Path::new(&path), core.as_deref(), &platform);
    let mut child = command.spawn().map_err(|e| AppError::msg(format!("Couldn't start {}: {e}", chosen.emulator.name())))?;
    log::info!("arcade: {} started for game {id} (pid {})", chosen.emulator.name(), child.id());
    if mode == WhilePlaying::Quit {
        quit_for_game(&app, id);
        return Ok(());
    }
    if let Ok(mut running) = arcade.running.lock() {
        *running = Some(Running { game: id });
    }
    let _ = app.emit("arcade-session", serde_json::json!({ "running": id }));
    // The UI goes silent on the event above. Hiding (D-035): out of the taskbar until the game closes.
    if mode == WhilePlaying::Hide {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.hide();
        }
    }
    let started = Instant::now();
    std::thread::spawn(move || {
        let _ = child.wait();
        finish_session(&app, &library, id, started.elapsed().as_secs() as i64, mode == WhilePlaying::Hide);
    });
    Ok(())
}

/// The end of a game session: play time (a start that ends at once isn't a session), Arcade free
/// again, the UI told, and Digitify back where it was when it hid (Big Picture stays full screen).
fn finish_session(app: &AppHandle, library: &Library, id: i64, seconds: i64, restore: bool) {
    if seconds >= 5 {
        let _ = library.db.with(|conn| {
            conn.execute(
                "UPDATE arcade_games SET play_seconds = play_seconds + ?2, play_count = play_count + 1, \
                 last_played_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?1",
                params![id, seconds],
            )?;
            // Home's statistics (D-041).
            conn.execute(
                "INSERT INTO arcade_activity (day, game_id, seconds) SELECT date('now', 'localtime'), id, ?2 FROM arcade_games WHERE id = ?1 \
                 ON CONFLICT (day, game_id) DO UPDATE SET seconds = seconds + excluded.seconds",
                params![id, seconds],
            )?;
            Ok(())
        });
    }
    if let Some(state) = app.try_state::<ArcadeState>() {
        if let Ok(mut running) = state.running.lock() {
            *running = None;
        }
    }
    let _ = app.emit("arcade-session", serde_json::json!({ "running": null, "seconds": seconds }));
    if restore {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    }
}

/// How long a store game has to show up after its launcher was asked to start it.
const STORE_START_WAIT: u64 = 90;

/// Starts a PC game through its store (D-037). The store starts the game in its own way, so
/// Digitify watches for the game's own program — one running from its install folder — and only
/// then hides and goes quiet; when no program from that folder is left, the session ends. A game
/// never seen leaves Digitify as it was.
fn launch_store_game(app: AppHandle, library: std::sync::Arc<Library>, id: i64, name: &str, launch: &str, install_dir: Option<PathBuf>, mode: WhilePlaying) -> AppResult<()> {
    if let Some(game) = launch.strip_prefix("gog:") {
        // GOG's games start through GOG Galaxy, or by themselves without it (D-101).
        let mut command = stores::gog_command(game).ok_or_else(|| AppError::msg("GOG's record of that game isn't there anymore. Is it still installed?"))?;
        command.spawn().map_err(|e| AppError::msg(format!("Couldn't start the game: {e}")))?;
    } else if let Some(code) = launch.strip_prefix("bnet:") {
        // Battle.net starts its games itself, as its shortcuts ask it to (D-112).
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            let client = launchers::battle_net_client(None).ok_or_else(|| AppError::msg("Battle.net isn't found anymore. Is it still installed?"))?;
            crate::tools::command(&client).raw_arg(format!("--exec=\"launch {code}\"")).spawn().map_err(|e| AppError::msg(format!("Couldn't ask Battle.net to start the game: {e}")))?;
        }
        #[cfg(not(windows))]
        return Err(AppError::msg(format!("Battle.net ({code}) is only on Windows.")));
    } else if let Some(key) = launch.strip_prefix("rockstar:") {
        // Rockstar's games start by their program, which hands them to its launcher (D-116).
        let dir = install_dir.clone().ok_or_else(|| AppError::msg("Rockstar's record of that game isn't there anymore."))?;
        let program = launchers::rockstar_program(key, &dir).filter(|p| p.is_file()).ok_or_else(|| AppError::msg("The game's program isn't there anymore. Is it still installed?"))?;
        let mut command = crate::tools::command(&program);
        command.arg("-launchTitleInFolder").arg(&dir).arg("@commandline.txt").current_dir(&dir);
        command.spawn().map_err(|e| AppError::msg(format!("Couldn't start the game: {e}")))?;
    } else if let Some(product) = launch.strip_prefix("riot:") {
        // The Riot Client starts its games itself (D-116).
        #[cfg(windows)]
        {
            let (product, patchline) = product.split_once(':').unwrap_or((product, "live"));
            let client = launchers::riot_client().ok_or_else(|| AppError::msg("The Riot Client isn't found anymore. Is it still installed?"))?;
            crate::tools::command(&client)
                .arg(format!("--launch-product={product}"))
                .arg(format!("--launch-patchline={patchline}"))
                .spawn()
                .map_err(|e| AppError::msg(format!("Couldn't ask the Riot Client to start the game: {e}")))?;
        }
        #[cfg(not(windows))]
        return Err(AppError::msg(format!("The Riot Client ({product}) is only on Windows.")));
    } else if let Some(program) = launch.strip_prefix("exe:") {
        // A program of its own (added by hand, D-107, or installed by itch.io): from its folder.
        let program = Path::new(program);
        if !program.is_file() {
            return Err(AppError::msg("The game's program isn't there anymore (was it moved or uninstalled?)."));
        }
        let mut command = crate::tools::host_command(program);
        if let Some(dir) = program.parent() {
            command.current_dir(dir);
        }
        command.spawn().map_err(|e| AppError::msg(format!("Couldn't start the game: {e}")))?;
    } else {
        crate::tools::open_link(launch).map_err(|e| AppError::msg(format!("Couldn't ask {name} to start the game: {e}")))?;
    }
    log::info!("arcade: started game {id} ({name})");
    if mode == WhilePlaying::Quit {
        quit_for_game(&app, id);
        return Ok(());
    }
    let _ = app.emit("arcade-session", serde_json::json!({ "starting": id, "store": name }));
    let Some(dir) = install_dir.filter(|d| d.is_dir()) else { return Ok(()) };
    let set_starting = |app: &AppHandle, value: Option<i64>| {
        if let Some(state) = app.try_state::<ArcadeState>() {
            if let Ok(mut starting) = state.starting.lock() {
                *starting = value;
            }
        }
    };
    set_starting(&app, Some(id));
    std::thread::spawn(move || {
        let mut system = sysinfo::System::new();
        let deadline = Instant::now() + std::time::Duration::from_secs(STORE_START_WAIT);
        // Wait for the game to appear.
        loop {
            if game_running(&mut system, &dir) {
                break;
            }
            if Instant::now() > deadline {
                log::info!("arcade: game {id} wasn't seen running; Digitify stays as it is");
                set_starting(&app, None);
                let _ = app.emit("arcade-session", serde_json::json!({ "running": null, "notSeen": id }));
                return;
            }
            std::thread::sleep(std::time::Duration::from_secs(2));
        }
        log::info!("arcade: game {id} is running");
        if let Some(state) = app.try_state::<ArcadeState>() {
            if let Ok(mut running) = state.running.lock() {
                *running = Some(Running { game: id });
            }
        }
        set_starting(&app, None);
        let _ = app.emit("arcade-session", serde_json::json!({ "running": id }));
        if mode == WhilePlaying::Hide {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.hide();
            }
        }
        let started = Instant::now();
        // Wait for it to end: no program from its folder for two checks in a row (launchers
        // sometimes hand over from one program to another).
        let mut absent = 0;
        while absent < 2 {
            std::thread::sleep(std::time::Duration::from_secs(3));
            absent = if game_running(&mut system, &dir) { 0 } else { absent + 1 };
        }
        finish_session(&app, &library, id, started.elapsed().as_secs() as i64, mode == WhilePlaying::Hide);
    });
    Ok(())
}

/// Whether a program from `dir` is running: its program file, working folder or command line is
/// inside it (games under Proton show their Windows path, `Z:\home\…`, in the command line).
fn game_running(system: &mut sysinfo::System, dir: &Path) -> bool {
    // The program, its command line and its working folder, read again every time: launchers often
    // start a helper that then becomes the game, keeping its process (the default refresh reads
    // only the program, once).
    let what = sysinfo::ProcessRefreshKind::nothing()
        .with_exe(sysinfo::UpdateKind::Always)
        .with_cmd(sysinfo::UpdateKind::Always)
        .with_cwd(sysinfo::UpdateKind::Always);
    system.refresh_processes_specifics(sysinfo::ProcessesToUpdate::All, true, what);
    let wanted = normalize(&dir.display().to_string());
    if wanted.len() < 4 {
        return false;
    }
    system.processes().values().any(|process| {
        process.exe().is_some_and(|p| normalize(&p.display().to_string()).starts_with(&wanted))
            || process.cwd().is_some_and(|p| normalize(&p.display().to_string()).starts_with(&wanted))
            || process.cmd().iter().any(|arg| normalize(&arg.to_string_lossy()).contains(&wanted))
    })
}

/// The PC game (if any) of `games` whose program runs now: one refresh of the process list, the
/// programs and (on Linux, for Proton) their command lines. Cheap enough to run every few seconds.
fn running_among(system: &mut sysinfo::System, games: &[(i64, String)]) -> Option<i64> {
    let what = if cfg!(windows) {
        sysinfo::ProcessRefreshKind::nothing().with_exe(sysinfo::UpdateKind::OnlyIfNotSet)
    } else {
        sysinfo::ProcessRefreshKind::nothing().with_exe(sysinfo::UpdateKind::OnlyIfNotSet).with_cmd(sysinfo::UpdateKind::OnlyIfNotSet)
    };
    system.refresh_processes_specifics(sysinfo::ProcessesToUpdate::All, true, what);
    let paths: Vec<(String, Vec<String>)> = system
        .processes()
        .values()
        // Crash reporters and anti-cheat helpers can outlive the game itself: they don't count.
        .filter(|p| !p.exe().and_then(|e| e.file_stem()).is_some_and(|n| helper_program(&n.to_string_lossy())))
        .map(|p| (p.exe().map(|e| normalize(&e.display().to_string())).unwrap_or_default(), p.cmd().iter().map(|a| normalize(&a.to_string_lossy())).collect()))
        .collect();
    games.iter().find_map(|(id, dir)| {
        let wanted = format!("{}/", normalize(dir));
        (wanted.len() > 4 && paths.iter().any(|(exe, cmd)| exe.starts_with(&wanted) || cmd.iter().any(|a| a.contains(&wanted)))).then_some(*id)
    })
}

/// Programs beside a game that aren't the game: crash reporters, anti-cheat services, redistributable
/// installers (D-083).
fn helper_program(stem: &str) -> bool {
    let s = stem.to_lowercase();
    ["crashreportclient", "unitycrashhandler", "crashpad_handler", "crashhandler", "easyanticheat", "battleye", "beservice", "vc_redist", "dxsetup", "dotnetfx"]
        .iter()
        .any(|h| s.starts_with(h))
}

/// Games started some other way (D-083): from their own launcher, a desktop shortcut, or before
/// Digitify opened. Every few seconds, when no game is being played, Digitify looks for a program
/// running from one of Arcade's PC games' folders; it then shows that game as playing and counts
/// its time until no program from its folder is left, as if it had been started from Arcade.
pub fn watch_outside(app: AppHandle) {
    std::thread::Builder::new()
        .name("arcade-outside".into())
        .spawn(move || {
            std::thread::sleep(std::time::Duration::from_secs(6));
            let mut system = sysinfo::System::new();
            loop {
                std::thread::sleep(std::time::Duration::from_secs(8));
                let Some(state) = app.try_state::<ArcadeState>() else { continue };
                let busy = state.running.lock().map(|r| r.is_some()).unwrap_or(true) || state.starting.lock().map(|s| s.is_some()).unwrap_or(true);
                if busy {
                    continue;
                }
                let Some(library) = app.try_state::<AppState>().and_then(|s| s.library().ok()) else { continue };
                let games: Vec<(i64, String)> = library
                    .db
                    .with(|conn| {
                        Ok(conn
                            .prepare("SELECT id, install_dir FROM arcade_games WHERE platform = 'pc' AND hidden = 0 AND missing = 0 AND install_dir IS NOT NULL AND length(install_dir) > 3")?
                            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
                            .collect::<Result<_, _>>()?)
                    })
                    .unwrap_or_default();
                if games.is_empty() {
                    continue;
                }
                let Some(id) = running_among(&mut system, &games) else { continue };
                // Claimed now, unless a launch from Arcade got there first.
                {
                    let Ok(mut running) = state.running.lock() else { continue };
                    if running.is_some() || state.starting.lock().map(|s| s.is_some()).unwrap_or(true) {
                        continue;
                    }
                    *running = Some(Running { game: id });
                }
                log::info!("arcade: game {id} is running, started outside Digitify");
                let _ = app.emit("arcade-session", serde_json::json!({ "running": id, "outside": true }));
                let dir = games.iter().find(|(g, _)| *g == id).map(|(_, d)| d.clone()).unwrap_or_default();
                let started = Instant::now();
                let mut absent = 0;
                while absent < 2 {
                    std::thread::sleep(std::time::Duration::from_secs(4));
                    absent = if running_among(&mut system, &[(id, dir.clone())]).is_some() { 0 } else { absent + 1 };
                }
                finish_session(&app, &library, id, started.elapsed().as_secs() as i64, false);
            }
        })
        .ok();
}

/// Paths compared loosely: forward slashes, lower case, no Wine drive letter, no trailing slash.
fn normalize(path: &str) -> String {
    let mut p = path.replace('\\', "/").to_lowercase();
    if p.starts_with("z:/") {
        p = p[2..].to_string();
    }
    p.trim_end_matches('/').to_string()
}

/// Watches the stores' install records and tells the UI when a game was installed or removed, so
/// Arcade refreshes by itself (D-037). Cheap: names and dates of a few folders, every 20 seconds.
pub fn watch_stores(app: AppHandle) {
    std::thread::Builder::new()
        .name("arcade-stores".into())
        .spawn(move || {
            let mut last = stores::fingerprint();
            loop {
                std::thread::sleep(std::time::Duration::from_secs(20));
                let now = stores::fingerprint();
                if now != last {
                    last = now;
                    log::info!("arcade: a store's installed games changed");
                    let _ = app.emit("arcade-stores-changed", ());
                }
            }
        })
        .ok();
}

fn launch_command(found: &Found, game: &Path, core: Option<&str>, platform: &str) -> std::process::Command {
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
        // Batch mode: DuckStation and PCSX2 close with the game.
        Emulator::DuckStation | Emulator::Pcsx2 => command.args(["-batch", "--"]).arg(game),
        // No game list; RPCS3 boots the game's EBOOT.BIN.
        Emulator::Rpcs3 => {
            let eboot = [game.join("PS3_GAME").join("USRDIR").join("EBOOT.BIN"), game.join("USRDIR").join("EBOOT.BIN")].into_iter().find(|p| p.is_file());
            command.arg("--no-gui").arg(eboot.as_deref().unwrap_or(game))
        }
        Emulator::MelonDs | Emulator::Desmume | Emulator::Mesen | Emulator::Fceux | Emulator::Mgba | Emulator::Zsnes | Emulator::Snes9x | Emulator::Nestopia => command.arg(game),
        // Kega Fusion is told when it's a Sega CD disc.
        Emulator::Fusion if platform == Platform::SegaCd.key() => command.arg("-scd").arg(game),
        Emulator::Fusion => command.arg(game),
        // nullDC starts the disc at once instead of showing its menu.
        Emulator::NullDc => {
            let mut image = std::ffi::OsString::from("ImageReader:DefaultImage=");
            image.push(game);
            command.args(["-config", "nullDC:Emulator.Autostart=1", "-config", "ImageReader:LoadDefaultImage=1", "-config"]).arg(image)
        }
        // ares tells most consoles by the file; a Sega CD disc and a Mega Drive .bin are named.
        Emulator::Ares if platform == Platform::SegaCd.key() => command.args(["--system", "Mega CD"]).arg(game),
        Emulator::Ares if platform == Platform::Genesis.key() && games::extension(game) == "bin" => command.args(["--system", "Mega Drive"]).arg(game),
        Emulator::Ares => command.arg(game),
        // D-116: each opens the game as given; Cemu with -g, xemu its disc with -dvd_path; a game
        // kept as a folder starts by its program.
        Emulator::Ppsspp | Emulator::Flycast | Emulator::Azahar | Emulator::Ryujinx => command.arg(game),
        Emulator::Cemu => command.arg("-g").arg(if game.is_dir() { games::folder_program(game) } else { game.to_path_buf() }),
        Emulator::Xenia => command.arg(if game.is_dir() { games::folder_program(game) } else { game.to_path_buf() }),
        Emulator::Xemu => command.arg("-dvd_path").arg(game),
        Emulator::RetroArch => {
            if let Some(core) = core {
                command.arg("-L").arg(core);
            }
            command.arg(game)
        }
    };
    command
}

#[cfg(test)]
mod outside_tests {
    use super::*;

    #[test]
    fn folders_and_helpers_for_games_started_elsewhere() {
        // A folder matches whole names: "Fort" isn't "Fortnite".
        let program = format!("{}/", normalize(r"D:\Games\Fortnite\bin\game.exe"));
        assert!(!program.starts_with(&format!("{}/", normalize(r"D:\Games\Fort"))));
        assert!(program.starts_with(&format!("{}/", normalize(r"D:\Games\Fortnite"))));
        assert_eq!(normalize(r"Z:\home\me\Games\X\\"), "/home/me/games/x");
        assert!(helper_program("CrashReportClient") && helper_program("EasyAntiCheat_EOS") && !helper_program("FortniteClient-Win64-Shipping"));
    }
}

#[cfg(test)]
mod schema_tests {
    use crate::db::Database;

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

#[cfg(test)]
mod launch_tests {
    use super::*;

    fn args(emulator: Emulator, game: &Path, core: Option<&str>) -> Vec<String> {
        args_for(emulator, game, core, "")
    }

    fn args_for(emulator: Emulator, game: &Path, core: Option<&str>, platform: &str) -> Vec<String> {
        let found = Found { emulator, program: Program::Native(PathBuf::from("/emu/program")), folders: Vec::new(), covers: None };
        launch_command(&found, game, core, platform).get_args().map(|a| a.to_string_lossy().into_owned()).collect()
    }

    #[test]
    fn the_newer_emulators_start_their_games() {
        assert_eq!(args(Emulator::Snes9x, Path::new("/g/a.sfc"), None), ["/g/a.sfc"]);
        assert_eq!(args_for(Emulator::Fusion, Path::new("/g/s.cue"), None, "segacd"), ["-scd", "/g/s.cue"]);
        assert_eq!(args_for(Emulator::Fusion, Path::new("/g/s.md"), None, "genesis"), ["/g/s.md"]);
        assert_eq!(
            args_for(Emulator::NullDc, Path::new("/g/Shenmue/disc.gdi"), None, "dreamcast"),
            ["-config", "nullDC:Emulator.Autostart=1", "-config", "ImageReader:LoadDefaultImage=1", "-config", "ImageReader:DefaultImage=/g/Shenmue/disc.gdi"]
        );
        assert_eq!(args_for(Emulator::Ares, Path::new("/g/x.cue"), None, "segacd"), ["--system", "Mega CD", "/g/x.cue"]);
        assert_eq!(args_for(Emulator::Ares, Path::new("/g/x.pce"), None, "pce"), ["/g/x.pce"]);
    }

    #[test]
    fn every_console_has_its_emulators_and_every_emulator_its_consoles() {
        for platform in Platform::ALL {
            assert!(!players(platform).is_empty(), "{} has no emulator", platform.key());
        }
        for emulator in Emulator::ALL {
            assert_eq!(looking_for(emulator).is_none(), emulator == Emulator::RetroArch, "{}", emulator.key());
        }
        let ares = looking_for(Emulator::Ares).unwrap().platforms;
        assert!(ares.contains(&Platform::Pce) && ares.contains(&Platform::Genesis) && !ares.contains(&Platform::Ps2));
    }

    #[test]
    fn each_emulator_starts_the_game_its_own_way() {
        let game = Path::new("/games/Ico.iso");
        assert_eq!(args(Emulator::DuckStation, game, None), ["-batch", "--", "/games/Ico.iso"]);
        assert_eq!(args(Emulator::Pcsx2, game, None), ["-batch", "--", "/games/Ico.iso"]);
        assert_eq!(args(Emulator::MelonDs, Path::new("/games/p.nds"), None), ["/games/p.nds"]);
        assert_eq!(args(Emulator::Mesen, Path::new("/games/z.sfc"), None), ["/games/z.sfc"]);
        assert_eq!(args(Emulator::Fceux, Path::new("/games/m.nes"), None), ["/games/m.nes"]);
        assert_eq!(args(Emulator::Mgba, Path::new("/games/p.gba"), None), ["/games/p.gba"]);
        assert_eq!(args(Emulator::RetroArch, Path::new("/r/a.zip#b.sfc"), Some("/cores/snes9x.so")), ["-L", "/cores/snes9x.so", "/r/a.zip#b.sfc"]);
        // RPCS3 boots the disc's EBOOT.BIN when it's there, else the game's folder.
        let dir = std::env::temp_dir().join(format!("digitify-rpcs3-launch-{}", std::process::id()));
        let eboot = dir.join("PS3_GAME").join("USRDIR").join("EBOOT.BIN");
        std::fs::create_dir_all(eboot.parent().unwrap()).unwrap();
        assert_eq!(args(Emulator::Rpcs3, &dir, None), ["--no-gui".to_string(), dir.display().to_string()]);
        std::fs::write(&eboot, b"x").unwrap();
        assert_eq!(args(Emulator::Rpcs3, &dir, None), ["--no-gui".to_string(), eboot.display().to_string()]);
        let _ = std::fs::remove_dir_all(&dir);
    }
}

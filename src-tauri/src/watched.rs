//! Watched folders (D-060): folders Digitify keeps an eye on; what's new in one is imported by
//! itself into the category chosen for it, left where it is. Checked a little after start and
//! then every two minutes; a file still being written (changed in the last minute) waits for the
//! next look.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime};

use rusqlite::params;
use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::error::{AppError, AppResult};
use crate::import::{ImportMode, ImportRequest};
use crate::library::with_library;
use crate::AppState;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchedFolder {
    pub id: i64,
    pub path: String,
    pub category: String,
    /// The folder isn't there right now (a drive unplugged).
    pub missing: bool,
}

/// Files already handed to the importer this session (path, size, modified), so a file the
/// importer skipped (a duplicate, an unsupported kind) isn't read again every two minutes.
static TRIED: Mutex<Option<HashSet<(String, u64, u64)>>> = Mutex::new(None);

#[tauri::command]
pub async fn watched_list(state: State<'_, AppState>) -> AppResult<Vec<WatchedFolder>> {
    with_library(&state, |library| {
        library.db.with(|conn| {
            let rows = conn
                .prepare("SELECT w.id, w.path, c.key FROM watched_folders w JOIN categories c ON c.id = w.category_id ORDER BY w.path")?
                .query_map([], |row| {
                    let path: String = row.get(1)?;
                    Ok(WatchedFolder { id: row.get(0)?, missing: !Path::new(&path).is_dir(), path, category: row.get(2)? })
                })?
                .collect::<Result<_, _>>()?;
            Ok(rows)
        })
    })
    .await
}

#[tauri::command]
pub async fn watched_add(app: AppHandle, state: State<'_, AppState>, path: String, category: String) -> AppResult<()> {
    if !Path::new(&path).is_dir() {
        return Err(AppError::msg("That folder isn't there."));
    }
    with_library(&state, move |library| {
        library.db.with(|conn| {
            conn.execute(
                "INSERT INTO watched_folders (path, category_id) VALUES (?1, (SELECT id FROM categories WHERE key = ?2)) \
                 ON CONFLICT(path) DO UPDATE SET category_id = excluded.category_id",
                params![path, category],
            )?;
            Ok(())
        })
    })
    .await?;
    // A first look right away.
    std::thread::spawn(move || {
        let _ = look(&app);
    });
    Ok(())
}

#[tauri::command]
pub async fn watched_set_category(state: State<'_, AppState>, id: i64, category: String) -> AppResult<()> {
    with_library(&state, move |library| {
        library.db.with(|conn| {
            conn.execute("UPDATE watched_folders SET category_id = (SELECT id FROM categories WHERE key = ?2) WHERE id = ?1", params![id, category])?;
            Ok(())
        })
    })
    .await
}

/// Stops watching a folder; what was imported from it stays.
#[tauri::command]
pub async fn watched_remove(state: State<'_, AppState>, id: i64) -> AppResult<()> {
    with_library(&state, move |library| {
        library.db.with(|conn| {
            conn.execute("DELETE FROM watched_folders WHERE id = ?1", [id])?;
            Ok(())
        })
    })
    .await
}

/// Files under `dir` (folders inside it too), skipping hidden ones.
fn files_under(dir: &Path, out: &mut Vec<PathBuf>, depth: usize) {
    if depth > 12 {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.filter_map(Result::ok) {
        let name = entry.file_name();
        if name.to_string_lossy().starts_with('.') {
            continue;
        }
        let path = entry.path();
        match entry.file_type() {
            Ok(t) if t.is_dir() => files_under(&path, out, depth + 1),
            Ok(t) if t.is_file() => out.push(path),
            _ => {}
        }
    }
}

/// One look at every watched folder: new files go to the importer, one job per folder.
pub fn look(app: &AppHandle) -> AppResult<usize> {
    let state = app.state::<AppState>();
    let library = state.library()?;
    let folders: Vec<(String, String)> = library.db.with(|conn| {
        let rows = conn
            .prepare("SELECT w.path, c.key FROM watched_folders w JOIN categories c ON c.id = w.category_id")?
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
            .collect::<Result<_, _>>()?;
        Ok(rows)
    })?;
    let mut handed = 0;
    for (folder, category) in folders {
        let root = Path::new(&folder);
        if !root.is_dir() {
            continue;
        }
        let mut files = Vec::new();
        files_under(root, &mut files, 0);
        let known: HashSet<String> = library.db.with(|conn| {
            let prefix = format!("{}%", folder.replace('%', "\\%").replace('_', "\\_"));
            let rows = conn
                .prepare("SELECT path FROM files WHERE path LIKE ?1 ESCAPE '\\'")?
                .query_map([prefix], |row| row.get(0))?
                .collect::<Result<_, _>>()?;
            Ok(rows)
        })?;
        let now = SystemTime::now();
        let mut fresh = Vec::new();
        let mut tried = TRIED.lock().map_err(|_| AppError::msg("watched folders are busy"))?;
        let tried = tried.get_or_insert_with(HashSet::new);
        for file in files {
            let text = file.display().to_string();
            if known.contains(&text) {
                continue;
            }
            let Ok(meta) = file.metadata() else { continue };
            let modified = meta.modified().unwrap_or(now);
            // Still being written (a download, a copy): next time.
            if now.duration_since(modified).unwrap_or_default() < Duration::from_secs(60) {
                continue;
            }
            let stamp = modified.duration_since(SystemTime::UNIX_EPOCH).map_or(0, |d| d.as_secs());
            if !tried.insert((text.clone(), meta.len(), stamp)) {
                continue;
            }
            fresh.push(text);
        }
        if fresh.is_empty() {
            continue;
        }
        handed += fresh.len();
        log::info!("watched folder {folder}: {} new files for {category}", fresh.len());
        crate::import::start(app.clone(), library.clone(), ImportRequest { paths: fresh, mode: ImportMode::Reference, category: Some(category), watched: true })?;
    }
    Ok(handed)
}

/// Looks now (Settings' "Look now").
#[tauri::command]
pub async fn watched_look_now(app: AppHandle) -> AppResult<usize> {
    crate::library::blocking(move || look(&app)).await
}

pub fn watch(app: AppHandle) {
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(30));
        loop {
            if let Err(e) = look(&app) {
                log::warn!("watched folders: {e}");
            }
            std::thread::sleep(Duration::from_secs(120));
        }
    });
}

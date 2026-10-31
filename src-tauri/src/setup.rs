//! App status, choosing the library folder, preferences, and background maintenance.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use rusqlite::params;
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::error::{AppError, AppResult};
use crate::library::blocking;
use crate::library_folder::{self, LibraryFolder};
use crate::{artwork, db, files, pdf, AppState, Library};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppStatus {
    pub version: String,
    pub library_path: Option<String>,
    pub library_open: bool,
    /// Why the configured library could not be opened (e.g. its drive is disconnected).
    pub library_error: Option<String>,
    /// Sync service the library folder lives in, if any (warn: D-010).
    pub cloud_sync: Option<String>,
    pub suggested_path: String,
    pub preferences: Value,
}

pub fn open_library(root: &Path) -> AppResult<Arc<Library>> {
    let folder = LibraryFolder::prepare(root)?;
    let db = db::Database::open(&folder.db_path(), &folder.backups_dir())?;
    log::info!("library opened at {}", root.display());
    Ok(Arc::new(Library { db, folder }))
}

/// Checks referenced files in the background and tells the UI when some went missing or came back.
pub fn spawn_maintenance(app: AppHandle) {
    std::thread::spawn(move || {
        let Ok(library) = app.state::<AppState>().library() else { return };
        match files::check_missing(&library) {
            Ok(0) => {}
            Ok(changed) => {
                log::info!("{changed} file statuses changed");
                let _ = app.emit("library-changed", ());
            }
            Err(e) => log::warn!("missing-file check failed: {e}"),
        }
        match pdf_details(&library) {
            Ok(0) => {}
            Ok(updated) => {
                log::info!("added covers and page counts to {updated} PDFs");
                let _ = app.emit("library-changed", ());
            }
            Err(e) => log::warn!("PDF details failed: {e}"),
        }
    });
}

/// PDFs imported before Digitify could read them get a cover (when they have none) and a page
/// count, once. Titles are left alone: the user may have edited them.
fn pdf_details(library: &Library) -> AppResult<usize> {
    let rows: Vec<(i64, String, String)> = library.db.with(|conn| {
        let rows = conn
            .prepare(
                "SELECT i.id, f.path, f.storage FROM items i \
                 JOIN versions v ON v.item_id = i.id AND v.kind = 'digital' JOIN files f ON f.version_id = v.id \
                 WHERE f.status = 'ok' AND lower(f.path) LIKE '%.pdf' AND json_extract(i.metadata, '$.pageCount') IS NULL \
                 AND json_extract(i.metadata, '$.pdfUnreadable') IS NULL GROUP BY i.id LIMIT 500",
            )?
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
            .collect::<Result<_, _>>()?;
        Ok(rows)
    })?;
    let mut updated = 0;
    for (id, path, storage) in rows {
        let path = library.folder.resolve(&path, &storage);
        let info = match pdf::read_info(&path, 900) {
            Ok(info) => info,
            Err(e) => {
                log::warn!("could not read {}: {e}", path.display());
                library.db.with(|conn| {
                    conn.execute("UPDATE items SET metadata = json_set(metadata, '$.pdfUnreadable', json('true')) WHERE id = ?1", [id])?;
                    Ok(())
                })?;
                continue;
            }
        };
        let art = info.cover.and_then(|bytes| artwork::store(&library.folder, &bytes).ok());
        library.db.with(|conn| {
            conn.execute(
                "UPDATE items SET metadata = json_set(metadata, '$.pageCount', ?2), \
                 cover_key = COALESCE(cover_key, ?3), cover_color = COALESCE(cover_color, ?4) WHERE id = ?1",
                params![id, info.pages as i64, art.as_ref().map(|a| a.key.clone()), art.as_ref().map(|a| a.color.clone())],
            )?;
            Ok(())
        })?;
        updated += 1;
    }
    Ok(updated)
}

fn status(app: &AppHandle, state: &AppState) -> AppStatus {
    let config = state.config.get();
    AppStatus {
        version: app.package_info().version.to_string(),
        cloud_sync: config.library_path.as_deref().and_then(library_folder::cloud_sync_provider).map(str::to_string),
        library_path: config.library_path.map(|p| p.display().to_string()),
        library_open: state.library().is_ok(),
        library_error: state.library_error(),
        suggested_path: library_folder::suggested_path().display().to_string(),
        preferences: config.preferences,
    }
}

#[tauri::command]
pub fn app_status(app: AppHandle, state: State<'_, AppState>) -> AppStatus {
    status(&app, &state)
}

/// Opens (or creates) the library at `path` and remembers it.
#[tauri::command]
pub async fn library_choose(app: AppHandle, state: State<'_, AppState>, path: String) -> AppResult<AppStatus> {
    let root = PathBuf::from(path.trim());
    if !root.is_absolute() {
        return Err(AppError::msg("Please choose a full folder path, such as C:\\Users\\you\\Digitify Library."));
    }
    let library = blocking({
        let root = root.clone();
        move || open_library(&root)
    })
    .await?;
    state.set_library(library);
    state.config.update(|config| config.library_path = Some(root))?;
    spawn_maintenance(app.clone());
    let _ = app.emit("library-changed", ());
    Ok(status(&app, &state))
}

/// Stores the interface preferences (theme, accent, motion, layouts…) owned by the UI.
#[tauri::command]
pub fn preferences_set(state: State<'_, AppState>, preferences: Value) -> AppResult<()> {
    if !preferences.is_object() {
        return Err(AppError::msg("preferences must be an object"));
    }
    state.config.update(|config| config.preferences = preferences)?;
    Ok(())
}

#[tauri::command]
pub fn library_reveal(state: State<'_, AppState>) -> AppResult<()> {
    let library = state.library()?;
    files::reveal(&library.folder.db_path())
}

/// Shows the third-party notices file shipped next to the app.
#[tauri::command]
pub fn notices_reveal(app: AppHandle) -> AppResult<()> {
    let path = app.path().resolve("THIRD_PARTY_NOTICES.md", tauri::path::BaseDirectory::Resource)?;
    files::reveal(&path)
}

/// Path of a folder or file the user can pick in a dialog: tells whether it is cloud-synced.
#[tauri::command]
pub fn path_cloud_sync(path: String) -> Option<String> {
    library_folder::cloud_sync_provider(Path::new(&path)).map(str::to_string)
}

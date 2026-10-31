//! App status, choosing the library folder, preferences, and background maintenance.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::error::{AppError, AppResult};
use crate::library::blocking;
use crate::library_folder::{self, LibraryFolder};
use crate::{db, files, AppState, Library};

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
    });
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

//! Library backups (D-006): consistent snapshots of the library database, kept in the library
//! folder's `backups` directory, and restoring from them.
//!
//! A backup holds the whole catalog: items, people, physical and digital copies, edits, progress
//! and settings. Artwork and copied media stay in the library folder; back up the whole folder
//! for a complete copy.

use std::path::{Path, PathBuf};

use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::db::{self, MIGRATIONS};
use crate::error::{AppError, AppResult};
use crate::library::blocking;
use crate::{files, AppState, Library};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub name: String,
    /// Local time, `YYYY-MM-DDTHH:MM:SS`.
    pub created: String,
    /// `manual`, `before-upgrade` or `before-restore`.
    pub kind: String,
    pub size: u64,
}

/// Parses `library-YYYYMMDD-HHMMSS-<kind>.db`.
fn describe(path: &Path) -> Option<BackupInfo> {
    let name = path.file_name()?.to_str()?.to_string();
    let stem = name.strip_prefix("library-")?.strip_suffix(".db")?;
    let (stamp, kind) = (stem.get(..15)?, stem.get(16..)?);
    let digits = stamp.replace('-', "");
    if digits.len() != 14 || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let created = format!(
        "{}-{}-{}T{}:{}:{}",
        &digits[0..4], &digits[4..6], &digits[6..8], &digits[8..10], &digits[10..12], &digits[12..14]
    );
    Some(BackupInfo { created, kind: kind.to_string(), size: std::fs::metadata(path).ok()?.len(), name })
}

pub fn list(library: &Library) -> AppResult<Vec<BackupInfo>> {
    let mut backups: Vec<BackupInfo> = match std::fs::read_dir(library.folder.backups_dir()) {
        Ok(entries) => entries.filter_map(Result::ok).filter_map(|entry| describe(&entry.path())).collect(),
        Err(_) => Vec::new(),
    };
    backups.sort_by(|a, b| b.created.cmp(&a.created).then_with(|| b.name.cmp(&a.name)));
    Ok(backups)
}

pub fn create(library: &Library, kind: &str) -> AppResult<BackupInfo> {
    let dir = library.folder.backups_dir();
    std::fs::create_dir_all(&dir)?;
    let stamp = library.db.with(|conn| db::timestamp(conn))?;
    let mut path = dir.join(format!("library-{stamp}-{kind}.db"));
    if path.exists() {
        // Two backups within the same second: wait for the clock rather than overwrite.
        std::thread::sleep(std::time::Duration::from_millis(1100));
        let stamp = library.db.with(|conn| db::timestamp(conn))?;
        path = dir.join(format!("library-{stamp}-{kind}.db"));
    }
    library.db.snapshot(&path)?;
    log::info!("backup written to {}", path.display());
    describe(&path).ok_or_else(|| AppError::msg("backup was written but could not be read back"))
}

/// Resolves a backup by name, refusing anything outside the backups folder.
fn backup_path(library: &Library, name: &str) -> AppResult<PathBuf> {
    let valid = name.starts_with("library-") && name.ends_with(".db") && !name.contains(['/', '\\', ':']) && !name.contains("..");
    let path = library.folder.backups_dir().join(name);
    if !valid || !path.is_file() {
        return Err(AppError::msg("That backup no longer exists."));
    }
    Ok(path)
}

/// Checks that a file is a readable Digitify library this version can open.
fn validate(path: &Path) -> AppResult<()> {
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let version: i64 = conn.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if version < 1 || version > MIGRATIONS.len() as i64 {
        return Err(AppError::msg("This backup was made by a different version of Digitify and can't be restored here."));
    }
    let integrity: String = conn.query_row("PRAGMA quick_check", [], |row| row.get(0))?;
    if integrity != "ok" {
        return Err(AppError::msg(format!("This backup is damaged ({integrity}).")));
    }
    conn.query_row("SELECT count(*) FROM items", [], |row| row.get::<_, i64>(0))?;
    Ok(())
}

pub fn restore(library: &Library, name: &str) -> AppResult<()> {
    let source = backup_path(library, name)?;
    validate(&source)?;
    // The current state is kept as a backup first, so a restore can always be undone.
    create(library, "before-restore")?;
    library.db.replace_with(&source, &library.folder.backups_dir())?;
    log::info!("library restored from {name}");
    Ok(())
}

// ---------------------------------------------------------------------------------------------
// Automatic backups (D-056): daily, weekly or monthly, kept in the library's backups folder and,
// when a folder is chosen (another drive), copied there too; a missing folder is reported.

/// How automatic backups went last.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoStatus {
    /// When the last automatic backup was made (local time), if ever.
    pub last: Option<String>,
    /// The chosen folder, when it couldn't be reached at the last try (a drive not connected).
    pub missing_folder: Option<String>,
    pub error: Option<String>,
}

static AUTO: std::sync::Mutex<Option<AutoStatus>> = std::sync::Mutex::new(None);

/// Automatic backup settings, from the saved preferences (`autoBackup`).
struct AutoSettings {
    days: Option<i64>,
    folder: Option<PathBuf>,
    keep: usize,
}

fn auto_settings(app: &AppHandle) -> AutoSettings {
    use tauri::Manager;
    let config = app.state::<AppState>().config.get();
    let value = config.preferences.get("autoBackup").cloned().unwrap_or_default();
    let days = match value.get("every").and_then(|v| v.as_str()) {
        Some("daily") => Some(1),
        Some("weekly") => Some(7),
        Some("monthly") => Some(30),
        _ => None,
    };
    let folder = value.get("folder").and_then(|v| v.as_str()).filter(|s| !s.trim().is_empty()).map(PathBuf::from);
    let keep = value.get("keep").and_then(|v| v.as_u64()).unwrap_or(8).clamp(1, 100) as usize;
    AutoSettings { days, folder, keep }
}

/// Removes the oldest automatic backups in `dir` beyond `keep`.
fn prune(dir: &Path, keep: usize) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    let mut autos: Vec<PathBuf> = entries.filter_map(Result::ok).map(|e| e.path()).filter(|p| describe(p).is_some_and(|b| b.kind == "auto")).collect();
    autos.sort();
    while autos.len() > keep {
        let old = autos.remove(0);
        let _ = std::fs::remove_file(&old);
    }
}

/// Makes an automatic backup now when one is due (or `force`), copies it to the chosen folder,
/// and records how it went.
pub fn auto_run(app: &AppHandle, force: bool) -> AppResult<AutoStatus> {
    use tauri::Manager;
    let library = app.state::<AppState>().library()?;
    let settings = auto_settings(app);
    let mut status = AutoStatus::default();
    let backups = list(&library)?;
    let last = backups.iter().find(|b| b.kind == "auto").map(|b| b.created.clone());
    status.last = last.clone();
    let due = match (settings.days, &last) {
        (None, _) => false,
        (Some(_), None) => true,
        (Some(days), Some(last)) => library.db.with(|conn| {
            Ok(conn.query_row("SELECT julianday('now', 'localtime') - julianday(?1) >= ?2", rusqlite::params![last, days as f64 - 0.01], |row| row.get::<_, bool>(0))?)
        })?,
    };
    if due || force {
        let backup = create(&library, "auto")?;
        prune(&library.folder.backups_dir(), settings.keep);
        status.last = Some(backup.created.clone());
        if let Some(folder) = &settings.folder {
            // The folder (or its drive) has to be there: it's never created out of nothing.
            if folder.is_dir() {
                let target = folder.join("Digitify backups");
                let copied = std::fs::create_dir_all(&target).and_then(|_| std::fs::copy(library.folder.backups_dir().join(&backup.name), target.join(&backup.name)));
                match copied {
                    Ok(_) => prune(&target, settings.keep),
                    Err(e) => status.error = Some(format!("Couldn't copy the backup to {}: {e}", folder.display())),
                }
            } else {
                status.missing_folder = Some(folder.display().to_string());
            }
        }
        log::info!("automatic backup: {}", backup.name);
    } else if let Some(folder) = settings.folder.as_ref().filter(|_| settings.days.is_some()) {
        if !folder.is_dir() {
            status.missing_folder = Some(folder.display().to_string());
        }
    }
    if let Ok(mut saved) = AUTO.lock() {
        *saved = Some(status.clone());
    }
    let _ = app.emit("backup-status", &status);
    Ok(status)
}

/// Checks a little after start and then every half hour whether an automatic backup is due.
pub fn watch_auto(app: AppHandle) {
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(45));
        loop {
            if let Err(e) = auto_run(&app, false) {
                log::warn!("automatic backup failed: {e}");
                if let Ok(mut saved) = AUTO.lock() {
                    let mut status = saved.clone().unwrap_or_default();
                    status.error = Some(e.to_string());
                    *saved = Some(status);
                }
            }
            std::thread::sleep(std::time::Duration::from_secs(30 * 60));
        }
    });
}

#[tauri::command]
pub fn backup_auto_status() -> AutoStatus {
    AUTO.lock().ok().and_then(|s| s.clone()).unwrap_or_default()
}

/// Makes an automatic backup now (to try the chosen folder, or after connecting its drive).
#[tauri::command]
pub async fn backup_auto_now(app: AppHandle) -> AppResult<AutoStatus> {
    blocking(move || auto_run(&app, true)).await
}

#[tauri::command]
pub async fn backup_list(state: State<'_, AppState>) -> AppResult<Vec<BackupInfo>> {
    let library = state.library()?;
    blocking(move || list(&library)).await
}

#[tauri::command]
pub async fn backup_create(state: State<'_, AppState>) -> AppResult<BackupInfo> {
    let library = state.library()?;
    blocking(move || create(&library, "manual")).await
}

#[tauri::command]
pub async fn backup_restore(app: AppHandle, state: State<'_, AppState>, name: String) -> AppResult<()> {
    let library = state.library()?;
    blocking(move || restore(&library, &name)).await?;
    let _ = app.emit("library-changed", ());
    Ok(())
}

#[tauri::command]
pub fn backup_reveal(state: State<'_, AppState>, name: Option<String>) -> AppResult<()> {
    let library = state.library()?;
    match name {
        Some(name) => files::reveal(&backup_path(&library, &name)?),
        None => files::reveal(&library.folder.backups_dir()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backup_names_are_parsed() {
        let dir = std::env::temp_dir().join(format!("digitify-backup-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("library-20261030-163012-before-restore.db");
        std::fs::write(&path, b"x").unwrap();
        let info = describe(&path).unwrap();
        assert_eq!(info.created, "2026-10-30T16:30:12");
        assert_eq!(info.kind, "before-restore");
        assert!(describe(&dir.join("notes.txt")).is_none());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}

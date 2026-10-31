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

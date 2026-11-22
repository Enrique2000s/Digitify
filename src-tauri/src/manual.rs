//! The manual that comes with Digitify (D-149): a PDF, "Digitify Manual", that the app puts in
//! Books the first time a library opens. It's an item like any other: it can be read, marked,
//! moved into a collection, or deleted. When a newer Digitify brings a newer manual, the library's
//! copy is replaced in place (the item keeps its marks). Once deleted it stays gone, until Books ›
//! Add › Digitify Manual brings it back. What became of it is kept in the library's settings.

use std::path::{Path, PathBuf};

use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::error::{AppError, AppResult};
use crate::{AppState, Library};

/// Raised whenever the manual's text changes, so libraries take the new one.
pub const VERSION: i64 = 9;
const TITLE: &str = "Digitify Manual";
const FILE: &str = "Digitify-Manual.pdf";
/// Its own book-shaped cover (D-150), so Books shows it whole.
const COVER: &str = "Digitify-Manual-cover.png";
const KEY: &str = "builtin.manual";

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(tag = "state", rename_all = "camelCase")]
enum Kept {
    Added { version: i64, item: i64 },
    Removed,
}

/// Where a file of the manual is: in the installation, or (developing) in the source tree.
fn bundled_file(app: &AppHandle, name: &str) -> Option<PathBuf> {
    let installed = app.path().resolve(format!("manual/{name}"), tauri::path::BaseDirectory::Resource).ok().filter(|p| p.is_file());
    installed.or_else(|| Some(Path::new(env!("CARGO_MANIFEST_DIR")).join("resources/manual").join(name)).filter(|p| p.is_file()))
}

/// The manual and its cover.
fn bundled(app: &AppHandle) -> Option<(PathBuf, Option<PathBuf>)> {
    Some((bundled_file(app, FILE)?, bundled_file(app, COVER)))
}

/// Puts the manual's own cover on its item (the PDF's first page is wide, and would be cut).
fn set_cover(library: &Library, item: i64, cover: Option<&Path>) -> AppResult<()> {
    let Some(cover) = cover else { return Ok(()) };
    let bytes = std::fs::read(cover)?;
    let art = crate::artwork::store(&library.folder, &bytes)?;
    library.db.with(|conn| {
        conn.execute("UPDATE items SET cover_key = ?2, cover_color = ?3 WHERE id = ?1", rusqlite::params![item, art.key, art.color])?;
        Ok(())
    })
}

fn read(conn: &Connection) -> AppResult<Option<Kept>> {
    let value: Option<String> = conn.query_row("SELECT value FROM settings WHERE key = ?1", [KEY], |row| row.get(0)).optional()?;
    Ok(value.and_then(|v| serde_json::from_str(&v).ok()))
}

fn write(conn: &Connection, kept: Kept) -> AppResult<()> {
    let value = serde_json::to_string(&kept).map_err(|e| AppError::msg(e.to_string()))?;
    conn.execute("INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [KEY, &value])?;
    Ok(())
}

fn exists(conn: &Connection, item: i64) -> AppResult<bool> {
    Ok(conn.query_row("SELECT 1 FROM items WHERE id = ?1", [item], |_| Ok(())).optional()?.is_some())
}

fn mark(conn: &Connection, item: i64) -> AppResult<()> {
    conn.execute("UPDATE items SET metadata = json_set(coalesce(metadata, '{}'), '$.builtin', 'manual', '$.builtinVersion', ?2) WHERE id = ?1", rusqlite::params![item, VERSION])?;
    Ok(())
}

fn add(library: &Library, file: &Path, cover: Option<&Path>) -> AppResult<i64> {
    let item = crate::import::import_bundled(library, file, "books", TITLE)?;
    set_cover(library, item, cover)?;
    library.db.with(|conn| {
        mark(conn, item)?;
        write(conn, Kept::Added { version: VERSION, item })
    })?;
    Ok(item)
}

/// What to do about the manual now: add it the first time, notice it was deleted, or replace an
/// older one. Gives whether the library changed.
fn sync(library: &Library, file: &Path, cover: Option<&Path>) -> AppResult<bool> {
    let kept = library.db.with(|conn| read(conn))?;
    match kept {
        None => {
            // Only into a library that has Books.
            let books = library.db.with(|conn| Ok(conn.query_row("SELECT 1 FROM categories WHERE key = 'books'", [], |_| Ok(())).optional()?.is_some()))?;
            if !books {
                return Ok(false);
            }
            add(library, file, cover)?;
            Ok(true)
        }
        Some(Kept::Removed) => Ok(false),
        Some(Kept::Added { version, item }) => {
            if !library.db.with(|conn| exists(conn, item))? {
                library.db.with(|conn| write(conn, Kept::Removed))?;
                return Ok(false);
            }
            if version >= VERSION {
                return Ok(false);
            }
            crate::import::replace_bundled(library, item, file)?;
            set_cover(library, item, cover)?;
            library.db.with(|conn| {
                mark(conn, item)?;
                write(conn, Kept::Added { version: VERSION, item })
            })?;
            Ok(true)
        }
    }
}

/// Run when a library opens (by the app, once): the manual added, kept up to date, or left gone.
#[tauri::command]
pub async fn manual_sync(app: AppHandle, state: State<'_, AppState>) -> AppResult<()> {
    let library = state.library()?;
    let Some((file, cover)) = bundled(&app) else { return Ok(()) };
    let changed = crate::library::blocking(move || sync(&library, &file, cover.as_deref())).await?;
    if changed {
        let _ = app.emit("library-changed", ());
    }
    Ok(())
}

/// Books › Add › Digitify Manual: the manual back in Books (or the one there). Gives its item.
#[tauri::command]
pub async fn manual_add(app: AppHandle, state: State<'_, AppState>) -> AppResult<i64> {
    let library = state.library()?;
    let (file, cover) = bundled(&app).ok_or_else(|| AppError::msg("The manual is missing from this installation."))?;
    let item = crate::library::blocking(move || {
        if let Some(Kept::Added { item, .. }) = library.db.with(|conn| read(conn))? {
            if library.db.with(|conn| exists(conn, item))? {
                return Ok(item);
            }
        }
        add(&library, &file, cover.as_deref())
    })
    .await?;
    let _ = app.emit("library-changed", ());
    Ok(item)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn what_became_of_the_manual_is_kept() {
        let dir = std::env::temp_dir().join(format!("digitify-d149-manual-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let db = crate::db::Database::open(&dir.join("library.db"), &dir.join("backups")).unwrap();
        db.with(|conn| {
            assert_eq!(read(conn)?, None);
            write(conn, Kept::Added { version: 1, item: 7 })?;
            assert_eq!(read(conn)?, Some(Kept::Added { version: 1, item: 7 }));
            assert!(!exists(conn, 7)?);
            write(conn, Kept::Removed)?;
            assert_eq!(read(conn)?, Some(Kept::Removed));
            Ok(())
        })
        .unwrap();
        drop(db);
        let _ = std::fs::remove_dir_all(&dir);
    }
}

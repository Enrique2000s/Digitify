//! The imports history (D-137): each entry imported from a link and each import of files and
//! folders, with how and when it ended, kept in the library until cleared. What's still running
//! comes from the queues themselves (`online-queue` and `import-progress` events).

use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};

use crate::error::{AppError, AppResult};
use crate::import::{ImportProgress, ImportRequest as FilesRequest};
use crate::library::with_library;
use crate::online::{ImportRequest as LinkRequest, OnlineState};
use crate::{AppState, Library};

/// The most kept; older ones go first.
const KEEP: i64 = 2000;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub id: i64,
    /// "link" or "files".
    pub kind: String,
    pub title: String,
    pub detail: Option<String>,
    pub action: Option<String>,
    pub state: String,
    pub error: Option<String>,
    pub item_id: Option<i64>,
    pub counts: Value,
    /// It can be tried again (a link entry that failed or was cancelled).
    pub retry: bool,
    pub finished_at: String,
}

fn trim(conn: &rusqlite::Connection) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM import_history WHERE id NOT IN (SELECT id FROM import_history ORDER BY id DESC LIMIT ?1)", [KEEP])?;
    Ok(())
}

/// One link entry's outcome: a new row, or `existing` updated (a retry from the queue). Returns
/// the row. `request` is what it takes to try it again.
#[allow(clippy::too_many_arguments)]
pub fn record_link(library: &Library, existing: Option<i64>, title: &str, service: &str, action: &str, state: &str, error: Option<&str>, item: Option<i64>, request: &Value) -> Option<i64> {
    let result = library.db.with(|conn| {
        if let Some(id) = existing {
            let updated = conn.execute(
                "UPDATE import_history SET action = ?2, state = ?3, error = ?4, item_id = ?5, finished_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?1",
                params![id, action, state, error, item],
            )?;
            if updated > 0 {
                return Ok(id);
            }
        }
        conn.execute(
            "INSERT INTO import_history (kind, title, detail, action, state, error, item_id, request) VALUES ('link', ?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![title, service, action, state, error, item, request.to_string()],
        )?;
        let id = conn.last_insert_rowid();
        trim(conn)?;
        Ok(id)
    });
    match result {
        Ok(id) => Some(id),
        Err(e) => {
            log::warn!("couldn't keep an import in the history: {e}");
            None
        }
    }
}

/// One import of files and folders, once it's over. A watched folder's that brought nothing new
/// (its files were already in the library) isn't kept.
pub fn record_files(library: &Library, request: &FilesRequest, progress: &ImportProgress) {
    if request.watched && progress.imported == 0 && progress.failed == 0 {
        return;
    }
    let name = |path: &str| std::path::Path::new(path).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| path.to_string());
    let title = match request.paths.as_slice() {
        [] => "Files".to_string(),
        [one] => name(one),
        [first, rest @ ..] => format!("{} and {} more", name(first), rest.len()),
    };
    let state = match progress.phase {
        "cancelled" => "cancelled",
        "failed" => "failed",
        _ if progress.imported == 0 && progress.failed > 0 => "failed",
        _ => "done",
    };
    let counts = json!({ "total": progress.total, "imported": progress.imported, "duplicates": progress.duplicates, "skipped": progress.skipped, "failed": progress.failed });
    let result = library.db.with(|conn| {
        let detail: Option<String> = match &request.category {
            Some(key) => conn.query_row("SELECT name FROM categories WHERE key = ?1", [key], |row| row.get(0)).optional()?,
            None => None,
        };
        conn.execute(
            "INSERT INTO import_history (kind, title, detail, state, error, counts) VALUES ('files', ?1, ?2, ?3, ?4, ?5)",
            params![title, detail, state, progress.errors.first(), counts.to_string()],
        )?;
        trim(conn)?;
        Ok(())
    });
    if let Err(e) = result {
        log::warn!("couldn't keep an import in the history: {e}");
    }
}

#[tauri::command]
pub async fn history_list(state: State<'_, AppState>) -> AppResult<Vec<HistoryEntry>> {
    with_library(&state, |library| {
        library.db.with(|conn| {
            let rows = conn
                .prepare(
                    "SELECT id, kind, title, detail, action, state, error, item_id, counts, request IS NOT NULL AND state IN ('failed', 'cancelled'), finished_at \
                     FROM import_history ORDER BY id DESC LIMIT 500",
                )?
                .query_map([], |row| {
                    Ok(HistoryEntry {
                        id: row.get(0)?,
                        kind: row.get(1)?,
                        title: row.get(2)?,
                        detail: row.get(3)?,
                        action: row.get(4)?,
                        state: row.get(5)?,
                        error: row.get(6)?,
                        item_id: row.get(7)?,
                        counts: serde_json::from_str(&row.get::<_, String>(8)?).unwrap_or(Value::Null),
                        retry: row.get(9)?,
                        finished_at: row.get(10)?,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(rows)
        })
    })
    .await
}

/// Empties the history, and takes finished entries off the import queue's list too.
#[tauri::command]
pub async fn history_clear(app: AppHandle, state: State<'_, AppState>, online: State<'_, OnlineState>) -> AppResult<()> {
    with_library(&state, |library| library.db.with(|conn| Ok(conn.execute("DELETE FROM import_history", []).map(|_| ())?))).await?;
    online.clear(&app);
    let _ = app.emit("import-history", ());
    Ok(())
}

/// Tries a link entry again: it goes back in the queue, and its row is replaced by the new outcome.
#[tauri::command]
pub async fn history_retry(app: AppHandle, state: State<'_, AppState>, online: State<'_, OnlineState>, id: i64) -> AppResult<()> {
    let library = state.library()?;
    let lookup = library.clone();
    let request: LinkRequest = with_library(&state, move |_| {
        let saved: Option<String> = lookup.db.with(|conn| Ok(conn.query_row("SELECT request FROM import_history WHERE id = ?1 AND kind = 'link'", [id], |row| row.get(0)).optional()?.flatten()))?;
        let saved = saved.ok_or_else(|| AppError::msg("That import can't be tried again."))?;
        let request: LinkRequest = serde_json::from_str(&saved).map_err(|_| AppError::msg("That import can't be tried again."))?;
        lookup.db.with(|conn| Ok(conn.execute("DELETE FROM import_history WHERE id = ?1", [id]).map(|_| ())?))?;
        Ok(request)
    })
    .await?;
    online.enqueue(&app, library, request, None, None);
    let _ = app.emit("import-history", ());
    Ok(())
}

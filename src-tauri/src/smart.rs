//! Smart lists (D-051): saved rules that fill a list by themselves ("Films I haven't watched from
//! 2024", "Comics rated 4 stars or more"). A list keeps its rules as a library query (category,
//! tag, favorites, ownership, progress, years, how recently added, your rating); the Library view
//! runs it like any other.

use rusqlite::params;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::State;

use crate::error::{AppError, AppResult};
use crate::library::with_library;
use crate::AppState;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartList {
    pub id: i64,
    pub name: String,
    /// The rules, as the fields of a library query.
    pub query: Value,
}

#[tauri::command]
pub async fn smart_lists(state: State<'_, AppState>) -> AppResult<Vec<SmartList>> {
    with_library(&state, |library| {
        library.db.with(|conn| {
            let rows = conn
                .prepare("SELECT id, name, query FROM smart_lists ORDER BY position, name COLLATE NOCASE, id")?
                .query_map([], |row| {
                    let query: String = row.get(2)?;
                    Ok(SmartList { id: row.get(0)?, name: row.get(1)?, query: serde_json::from_str(&query).unwrap_or(Value::Null) })
                })?
                .collect::<Result<_, _>>()?;
            Ok(rows)
        })
    })
    .await
}

/// Creates a smart list (`id` none) or changes one; returns its id.
#[tauri::command]
pub async fn smart_list_save(state: State<'_, AppState>, id: Option<i64>, name: String, query: Value) -> AppResult<i64> {
    let name = name.trim().chars().take(60).collect::<String>();
    if name.is_empty() {
        return Err(AppError::msg("A smart list needs a name."));
    }
    if !query.is_object() {
        return Err(AppError::msg("A smart list's rules must be an object."));
    }
    let text = query.to_string();
    with_library(&state, move |library| {
        library.db.with(|conn| {
            Ok(match id {
                Some(id) => {
                    conn.execute("UPDATE smart_lists SET name = ?2, query = ?3 WHERE id = ?1", params![id, name, text])?;
                    id
                }
                None => {
                    conn.execute(
                        "INSERT INTO smart_lists (name, query, position) VALUES (?1, ?2, (SELECT coalesce(max(position), 0) + 1 FROM smart_lists))",
                        params![name, text],
                    )?;
                    conn.last_insert_rowid()
                }
            })
        })
    })
    .await
}

/// Deletes a smart list (its items stay where they are: a smart list only shows them).
#[tauri::command]
pub async fn smart_list_delete(state: State<'_, AppState>, id: i64) -> AppResult<()> {
    with_library(&state, move |library| {
        library.db.with(|conn| {
            conn.execute("DELETE FROM smart_lists WHERE id = ?1", [id])?;
            Ok(())
        })
    })
    .await
}

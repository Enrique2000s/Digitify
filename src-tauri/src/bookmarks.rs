//! Bookmarks (Phase 2): places in a book worth coming back to. A page of a page-based book
//! (`{"page": n}`) or a place in an ebook (`{"cfi": …, "fraction": f, "location": n}`), each with a
//! label the reader can change.

use rusqlite::params;
use serde::Serialize;
use serde_json::Value;
use tauri::State;

use crate::error::{AppError, AppResult};
use crate::library::with_library;
use crate::AppState;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bookmark {
    pub id: i64,
    pub locator: Value,
    pub label: Option<String>,
    pub created_at: String,
}

/// Keeps only the fields readers write, so arbitrary JSON never reaches the database.
fn clean_locator(locator: &Value) -> AppResult<Value> {
    let invalid = || AppError::msg("That isn't a place in a book.");
    if let Some(page) = locator.get("page").and_then(Value::as_u64) {
        return Ok(serde_json::json!({ "page": page }));
    }
    let cfi = locator.get("cfi").and_then(Value::as_str).filter(|cfi| cfi.starts_with("epubcfi(") && cfi.len() <= 4096).ok_or_else(invalid)?;
    let fraction = locator.get("fraction").and_then(Value::as_f64).filter(|f| f.is_finite()).unwrap_or(0.0).clamp(0.0, 1.0);
    let location = locator.get("location").and_then(Value::as_u64);
    Ok(serde_json::json!({ "cfi": cfi, "fraction": fraction, "location": location }))
}

/// Book order: by page, or by how far through an ebook.
fn place(locator: &Value) -> f64 {
    locator
        .get("page")
        .and_then(Value::as_f64)
        .or_else(|| locator.get("fraction").and_then(Value::as_f64))
        .unwrap_or(0.0)
}

fn label(label: Option<String>) -> Option<String> {
    label.map(|text| text.trim().chars().take(200).collect::<String>()).filter(|text| !text.is_empty())
}

#[tauri::command]
pub async fn bookmarks_list(state: State<'_, AppState>, id: i64) -> AppResult<Vec<Bookmark>> {
    with_library(&state, move |library| {
        library.db.with(|conn| {
            let mut bookmarks: Vec<Bookmark> = conn
                .prepare("SELECT id, locator, label, created_at FROM bookmarks WHERE item_id = ?1 AND part_id = 0")?
                .query_map([id], |row| {
                    let locator: String = row.get(1)?;
                    Ok(Bookmark { id: row.get(0)?, locator: serde_json::from_str(&locator).unwrap_or(Value::Null), label: row.get(2)?, created_at: row.get(3)? })
                })?
                .collect::<Result<_, _>>()?;
            bookmarks.sort_by(|a, b| place(&a.locator).total_cmp(&place(&b.locator)));
            Ok(bookmarks)
        })
    })
    .await
}

#[tauri::command]
pub async fn bookmark_add(state: State<'_, AppState>, id: i64, locator: Value, label: Option<String>) -> AppResult<Bookmark> {
    let locator = clean_locator(&locator)?;
    let label = self::label(label);
    with_library(&state, move |library| {
        library.db.with(|conn| {
            conn.execute(
                "INSERT INTO bookmarks (item_id, part_id, locator, label) VALUES (?1, 0, ?2, ?3)",
                params![id, locator.to_string(), label],
            )?;
            let bookmark_id = conn.last_insert_rowid();
            let created_at: String = conn.query_row("SELECT created_at FROM bookmarks WHERE id = ?1", [bookmark_id], |row| row.get(0))?;
            Ok(Bookmark { id: bookmark_id, locator, label, created_at })
        })
    })
    .await
}

#[tauri::command]
pub async fn bookmark_rename(state: State<'_, AppState>, id: i64, label: Option<String>) -> AppResult<()> {
    let label = self::label(label);
    with_library(&state, move |library| {
        library.db.with(|conn| {
            conn.execute("UPDATE bookmarks SET label = ?2 WHERE id = ?1", params![id, label])?;
            Ok(())
        })
    })
    .await
}

#[tauri::command]
pub async fn bookmark_remove(state: State<'_, AppState>, id: i64) -> AppResult<()> {
    with_library(&state, move |library| {
        library.db.with(|conn| {
            conn.execute("DELETE FROM bookmarks WHERE id = ?1", [id])?;
            Ok(())
        })
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn locators_are_cleaned() {
        assert_eq!(clean_locator(&serde_json::json!({ "page": 4, "extra": "x" })).unwrap(), serde_json::json!({ "page": 4 }));
        let ebook = clean_locator(&serde_json::json!({ "cfi": "epubcfi(/6/4!/4/2)", "fraction": 1.7, "location": 12 })).unwrap();
        assert_eq!(ebook["fraction"], 1.0);
        assert_eq!(ebook["location"], 12);
        assert!(clean_locator(&serde_json::json!({ "cfi": "javascript:alert(1)" })).is_err());
        assert!(clean_locator(&serde_json::json!({ "page": -1 })).is_err());
    }

    #[test]
    fn labels_are_trimmed() {
        assert_eq!(label(Some("  Chapter 2  ".into())), Some("Chapter 2".into()));
        assert_eq!(label(Some("   ".into())), None);
    }
}

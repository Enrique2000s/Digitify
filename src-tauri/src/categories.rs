//! The order and visibility of the categories (D-039: categories are fixed; nothing else about
//! them changes).

use rusqlite::params;
use tauri::State;

use crate::error::AppResult;
use crate::library::with_library;
use crate::AppState;

/// Sets the order of categories (on Home and in the section pills) and which ones are hidden.
#[tauri::command]
pub async fn categories_arrange(state: State<'_, AppState>, order: Vec<String>, hidden: Vec<String>) -> AppResult<()> {
    with_library(&state, move |library| {
        library.db.with(|conn| {
            let tx = conn.transaction()?;
            for (position, key) in order.iter().enumerate() {
                tx.execute(
                    "UPDATE categories SET sort_order = ?2, is_hidden = ?3 WHERE key = ?1",
                    params![key, position as i64 + 1, hidden.contains(key)],
                )?;
            }
            tx.commit()?;
            Ok(())
        })
    })
    .await
}

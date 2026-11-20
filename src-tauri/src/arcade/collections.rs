//! Arcade's collections (D-148), as in Steam's library: a collection of the player's own holds the
//! games put in it; a dynamic one keeps its rules (words in the name, consoles and launchers, play
//! state), which the app applies to the games as they are, so it fills and empties by itself.

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use serde_json::Value;
use tauri::State;

use crate::error::{AppError, AppResult};
use crate::library::with_library;
use crate::AppState;

/// A collection, with the games put in it (none for a dynamic one: its rules pick them).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionView {
    pub id: i64,
    pub name: String,
    pub dynamic: bool,
    pub rules: Option<Value>,
    pub games: Vec<i64>,
}

fn clean_name(name: &str) -> AppResult<String> {
    let name: String = name.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(80).collect();
    if name.is_empty() {
        return Err(AppError::msg("A collection needs a name."));
    }
    Ok(name)
}

/// The rules kept as they come (the app reads them), as long as they're a small JSON object.
fn clean_rules(rules: &Value) -> AppResult<String> {
    if !rules.is_object() {
        return Err(AppError::msg("A dynamic collection's filters weren't understood."));
    }
    let text = rules.to_string();
    if text.len() > 8_000 {
        return Err(AppError::msg("That's more filters than a collection keeps."));
    }
    Ok(text)
}

pub fn list(conn: &Connection) -> AppResult<Vec<CollectionView>> {
    let mut stmt = conn.prepare("SELECT id, name, dynamic, rules FROM arcade_collections ORDER BY position, id")?;
    let mut out: Vec<CollectionView> = stmt
        .query_map([], |row| {
            let rules: Option<String> = row.get(3)?;
            Ok(CollectionView { id: row.get(0)?, name: row.get(1)?, dynamic: row.get::<_, i64>(2)? != 0, rules: rules.and_then(|r| serde_json::from_str(&r).ok()), games: Vec::new() })
        })?
        .collect::<Result<_, _>>()?;
    let mut games = conn.prepare("SELECT game_id FROM arcade_collection_games WHERE collection_id = ?1 ORDER BY added_at, game_id")?;
    for collection in out.iter_mut().filter(|c| !c.dynamic) {
        collection.games = games.query_map([collection.id], |row| row.get(0))?.collect::<Result<_, _>>()?;
    }
    Ok(out)
}

pub fn create(conn: &Connection, name: &str, rules: Option<&Value>, games: &[i64]) -> AppResult<i64> {
    let name = clean_name(name)?;
    let rules = rules.map(clean_rules).transpose()?;
    let next: i64 = conn.query_row("SELECT coalesce(max(position), -1) + 1 FROM arcade_collections", [], |row| row.get(0))?;
    conn.execute("INSERT INTO arcade_collections (name, dynamic, rules, position) VALUES (?1, ?2, ?3, ?4)", params![name, rules.is_some(), rules, next])?;
    let id = conn.last_insert_rowid();
    if rules.is_none() {
        add(conn, id, games)?;
    }
    Ok(id)
}

fn is_dynamic(conn: &Connection, id: i64) -> AppResult<bool> {
    conn.query_row("SELECT dynamic FROM arcade_collections WHERE id = ?1", [id], |row| row.get::<_, i64>(0))
        .optional()?
        .map(|d| d != 0)
        .ok_or_else(|| AppError::msg("That collection isn't there anymore."))
}

pub fn add(conn: &Connection, id: i64, games: &[i64]) -> AppResult<usize> {
    if is_dynamic(conn, id)? {
        return Err(AppError::msg("A dynamic collection picks its games by its filters; games can't be put in it."));
    }
    let mut added = 0;
    for game in games {
        added += conn.execute("INSERT OR IGNORE INTO arcade_collection_games (collection_id, game_id) SELECT ?1, id FROM arcade_games WHERE id = ?2", params![id, game])?;
    }
    Ok(added)
}

#[tauri::command]
pub async fn arcade_collections(state: State<'_, AppState>) -> AppResult<Vec<CollectionView>> {
    with_library(&state, move |library| library.db.with(|conn| list(conn))).await
}

/// A new collection: of the player's own (with these games in it), or dynamic with its rules.
#[tauri::command]
pub async fn arcade_collection_create(state: State<'_, AppState>, name: String, rules: Option<Value>, games: Option<Vec<i64>>) -> AppResult<i64> {
    with_library(&state, move |library| library.db.with(|conn| create(conn, &name, rules.as_ref(), games.as_deref().unwrap_or_default()))).await
}

/// Renames a collection, and for a dynamic one changes its rules.
#[tauri::command]
pub async fn arcade_collection_update(state: State<'_, AppState>, id: i64, name: String, rules: Option<Value>) -> AppResult<()> {
    with_library(&state, move |library| {
        library.db.with(|conn| {
            let name = clean_name(&name)?;
            let dynamic = is_dynamic(conn, id)?;
            conn.execute("UPDATE arcade_collections SET name = ?2 WHERE id = ?1", params![id, name])?;
            if dynamic {
                if let Some(rules) = rules {
                    conn.execute("UPDATE arcade_collections SET rules = ?2 WHERE id = ?1", params![id, clean_rules(&rules)?])?;
                }
            }
            Ok(())
        })
    })
    .await
}

/// Deletes a collection; its games stay in Arcade.
#[tauri::command]
pub async fn arcade_collection_delete(state: State<'_, AppState>, id: i64) -> AppResult<()> {
    with_library(&state, move |library| {
        library.db.with(|conn| {
            conn.execute("DELETE FROM arcade_collections WHERE id = ?1", [id])?;
            Ok(())
        })
    })
    .await
}

#[tauri::command]
pub async fn arcade_collection_add(state: State<'_, AppState>, id: i64, games: Vec<i64>) -> AppResult<usize> {
    with_library(&state, move |library| library.db.with(|conn| add(conn, id, &games))).await
}

#[tauri::command]
pub async fn arcade_collection_remove(state: State<'_, AppState>, id: i64, games: Vec<i64>) -> AppResult<usize> {
    with_library(&state, move |library| {
        library.db.with(|conn| {
            let mut removed = 0;
            for game in &games {
                removed += conn.execute("DELETE FROM arcade_collection_games WHERE collection_id = ?1 AND game_id = ?2", params![id, game])?;
            }
            Ok(removed)
        })
    })
    .await
}

/// The collections in a new order.
#[tauri::command]
pub async fn arcade_collections_reorder(state: State<'_, AppState>, ids: Vec<i64>) -> AppResult<()> {
    with_library(&state, move |library| {
        library.db.with(|conn| {
            let tx = conn.transaction()?;
            for (position, id) in ids.iter().enumerate() {
                tx.execute("UPDATE arcade_collections SET position = ?2 WHERE id = ?1", params![id, position as i64])?;
            }
            tx.commit()?;
            Ok(())
        })
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;

    #[test]
    fn collections_hold_their_games_and_dynamic_ones_their_rules() {
        let dir = std::env::temp_dir().join(format!("digitify-d148-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let db = Database::open(&dir.join("library.db"), &dir.join("backups")).unwrap();
        db.with(|conn| {
            conn.execute("INSERT INTO arcade_games (id, path, platform, title, sort_title) VALUES (1, 'a.z64', 'n64', 'Animal Forest', 'animal forest'), (2, 'b.iso', 'gamecube', 'Animal Crossing', 'animal crossing')", [])?;
            let mine = create(conn, "  Cozy   games ", None, &[1, 2, 99])?;
            let rules = serde_json::json!({ "include": "animal", "match": "all", "views": ["n64"] });
            let smart = create(conn, "Animals on N64", Some(&rules), &[1])?;
            let all = list(conn)?;
            assert_eq!(all.len(), 2);
            assert_eq!((all[0].name.as_str(), all[0].dynamic, all[0].games.clone()), ("Cozy games", false, vec![1, 2]), "a game that isn't there is left out");
            assert_eq!((all[1].dynamic, all[1].games.len()), (true, 0));
            assert_eq!(all[1].rules.as_ref().unwrap()["include"], "animal");
            assert!(add(conn, smart, &[2]).is_err(), "a dynamic collection takes no games");
            assert_eq!(add(conn, mine, &[1])?, 0, "already in it");
            assert!(create(conn, "   ", None, &[]).is_err(), "a collection needs a name");
            // A game leaving Arcade leaves its collections.
            conn.execute("DELETE FROM arcade_games WHERE id = 2", [])?;
            assert_eq!(list(conn)?[0].games, vec![1]);
            conn.execute("DELETE FROM arcade_collections WHERE id = ?1", [mine])?;
            assert_eq!(conn.query_row("SELECT count(*) FROM arcade_collection_games", [], |r| r.get::<_, i64>(0))?, 0);
            // D-148: a game's own emulator; D-149: completed, and smart lists gone.
            conn.execute("UPDATE arcade_games SET emulator = 'rmg', completed_at = '2026-11-20T00:00:00Z' WHERE id = 1", [])?;
            assert!(conn.query_row("SELECT count(*) FROM sqlite_master WHERE name = 'smart_lists'", [], |r| r.get::<_, i64>(0))? == 0);
            Ok(())
        })
        .unwrap();
        drop(db);
        let _ = std::fs::remove_dir_all(&dir);
    }
}

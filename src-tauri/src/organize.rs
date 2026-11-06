//! Organizing beyond categories (decision D-004): nested collections, which give an item its
//! single home inside a category; shelves, hand-picked lists that cut across categories; and
//! tags. Also the edits applied to many selected items at once.

use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::error::{AppError, AppResult};
use crate::library::{category_id, reindex, sort_key, with_library, TileCover};
use crate::AppState;

const NOW: &str = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NamedRef {
    pub id: i64,
    pub name: String,
}

fn named(row: &Row<'_>) -> rusqlite::Result<NamedRef> {
    Ok(NamedRef { id: row.get(0)?, name: row.get(1)? })
}

fn cover(row: &Row<'_>) -> rusqlite::Result<TileCover> {
    Ok(TileCover { key: row.get(0)?, color: row.get(1)?, handler: row.get(2)? })
}

/// A name as typed: trimmed, inner whitespace collapsed, at most `max` characters.
pub(crate) fn clean_name(name: &str, max: usize) -> Option<String> {
    let name: String = name.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(max).collect();
    (!name.is_empty()).then_some(name)
}

fn reindex_all(conn: &Connection, ids: &[i64]) -> AppResult<()> {
    for id in ids {
        reindex(conn, *id)?;
    }
    Ok(())
}

fn item_ids(conn: &Connection, sql: &str, id: i64) -> AppResult<Vec<i64>> {
    let rows = conn.prepare(sql)?.query_map([id], |row| row.get(0))?.collect::<Result<_, _>>()?;
    Ok(rows)
}

// ---------------------------------------------------------------------------------------------
// Tags

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    pub id: i64,
    pub name: String,
    pub item_count: i64,
}

#[tauri::command]
pub async fn tags_list(state: State<'_, AppState>) -> AppResult<Vec<Tag>> {
    with_library(&state, |library| {
        library.db.with(|conn| {
            let rows = conn
                .prepare(
                    "SELECT t.id, t.name, (SELECT count(*) FROM item_tags it WHERE it.tag_id = t.id) \
                     FROM tags t ORDER BY t.name COLLATE NOCASE",
                )?
                .query_map([], |row| Ok(Tag { id: row.get(0)?, name: row.get(1)?, item_count: row.get(2)? }))?
                .collect::<Result<_, _>>()?;
            Ok(rows)
        })
    })
    .await
}

/// The id of the tag called `name` (case-insensitive), creating it when needed.
fn tag_id(conn: &Connection, name: &str) -> rusqlite::Result<i64> {
    conn.query_row(
        "INSERT INTO tags (name) VALUES (?1) ON CONFLICT(name) DO UPDATE SET name = tags.name RETURNING id",
        [name],
        |row| row.get(0),
    )
}

fn add_tags(conn: &Connection, ids: &[i64], names: &[String]) -> AppResult<()> {
    for name in names.iter().filter_map(|name| clean_name(name, 60)) {
        let tag = tag_id(conn, &name)?;
        for id in ids {
            conn.execute("INSERT OR IGNORE INTO item_tags (item_id, tag_id) VALUES (?1, ?2)", params![id, tag])?;
        }
    }
    Ok(())
}

fn remove_tags(conn: &Connection, ids: &[i64], names: &[String]) -> AppResult<()> {
    for name in names.iter().filter_map(|name| clean_name(name, 60)) {
        for id in ids {
            conn.execute(
                "DELETE FROM item_tags WHERE item_id = ?1 AND tag_id = (SELECT id FROM tags WHERE name = ?2)",
                params![id, name],
            )?;
        }
    }
    prune_tags(conn)
}

/// Tags exist through the items that carry them; one left on nothing disappears.
fn prune_tags(conn: &Connection) -> AppResult<()> {
    conn.execute("DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM item_tags)", [])?;
    Ok(())
}

/// Replaces an item's tags.
#[tauri::command]
pub async fn item_tags_set(state: State<'_, AppState>, id: i64, names: Vec<String>) -> AppResult<()> {
    with_library(&state, move |library| {
        library.db.with(|conn| {
            let tx = conn.transaction()?;
            tx.execute("DELETE FROM item_tags WHERE item_id = ?1", [id])?;
            add_tags(&tx, &[id], &names)?;
            prune_tags(&tx)?;
            reindex(&tx, id)?;
            tx.commit()?;
            Ok(())
        })
    })
    .await
}

/// Renames a tag; renaming it to another tag's name merges the two.
#[tauri::command]
pub async fn tag_rename(state: State<'_, AppState>, id: i64, name: String) -> AppResult<()> {
    let name = clean_name(&name, 60).ok_or_else(|| AppError::msg("A tag needs a name."))?;
    with_library(&state, move |library| library.db.with(|conn| rename_tag(conn, id, &name))).await
}

fn rename_tag(conn: &mut Connection, id: i64, name: &str) -> AppResult<()> {
    let tx = conn.transaction()?;
    let other: Option<i64> = tx
        .query_row("SELECT id FROM tags WHERE name = ?1 AND id <> ?2", params![name, id], |row| row.get(0))
        .optional()?;
    let target = match other {
        Some(other) => {
            tx.execute(
                "INSERT OR IGNORE INTO item_tags (item_id, tag_id) SELECT item_id, ?2 FROM item_tags WHERE tag_id = ?1",
                params![id, other],
            )?;
            tx.execute("DELETE FROM tags WHERE id = ?1", [id])?;
            other
        }
        None => {
            tx.execute("UPDATE tags SET name = ?2 WHERE id = ?1", params![id, name])?;
            id
        }
    };
    let ids = item_ids(&tx, "SELECT item_id FROM item_tags WHERE tag_id = ?1", target)?;
    reindex_all(&tx, &ids)?;
    tx.commit()?;
    Ok(())
}

/// Takes a tag off every item. The items themselves stay.
#[tauri::command]
pub async fn tag_delete(state: State<'_, AppState>, id: i64) -> AppResult<()> {
    with_library(&state, move |library| {
        library.db.with(|conn| {
            let tx = conn.transaction()?;
            let ids = item_ids(&tx, "SELECT item_id FROM item_tags WHERE tag_id = ?1", id)?;
            tx.execute("DELETE FROM tags WHERE id = ?1", [id])?;
            reindex_all(&tx, &ids)?;
            tx.commit()?;
            Ok(())
        })
    })
    .await
}

// ---------------------------------------------------------------------------------------------
// Collections

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Collection {
    pub id: i64,
    pub parent_id: Option<i64>,
    pub name: String,
    /// Items in this collection and in every collection inside it.
    pub item_count: i64,
    pub child_count: i64,
    pub covers: Vec<TileCover>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionLevel {
    /// The collections from the category root down to the one being shown (empty at the root).
    pub path: Vec<NamedRef>,
    pub children: Vec<Collection>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionNode {
    pub id: i64,
    pub parent_id: Option<i64>,
    pub name: String,
    pub depth: i64,
}

/// `subtree(id)`: a collection and every collection inside it; bind the collection as `?1`.
const SUBTREE: &str = "WITH RECURSIVE subtree(id) AS (SELECT ?1 UNION ALL \
                       SELECT c.id FROM collections c JOIN subtree s ON c.parent_id = s.id)";

/// The collections from the category root down to `id`.
pub fn collection_path(conn: &Connection, id: i64) -> AppResult<Vec<NamedRef>> {
    let rows = conn
        .prepare(
            "WITH RECURSIVE up(id, parent_id, name, depth) AS ( \
               SELECT id, parent_id, name, 0 FROM collections WHERE id = ?1 \
               UNION ALL SELECT c.id, c.parent_id, c.name, up.depth + 1 FROM collections c JOIN up ON c.id = up.parent_id) \
             SELECT id, name FROM up ORDER BY depth DESC",
        )?
        .query_map([id], named)?
        .collect::<Result<_, _>>()?;
    Ok(rows)
}

fn collection_category(conn: &Connection, id: i64) -> AppResult<i64> {
    conn.query_row("SELECT category_id FROM collections WHERE id = ?1", [id], |row| row.get(0))
        .optional()?
        .ok_or_else(|| AppError::msg("That collection no longer exists."))
}

fn subtree_items(conn: &Connection, id: i64) -> AppResult<Vec<i64>> {
    item_ids(conn, &format!("{SUBTREE} SELECT i.id FROM items i WHERE i.collection_id IN subtree"), id)
}

/// The collections directly inside `parent` (or at the root of `category`), with the path to it.
#[tauri::command]
pub async fn collections_list(state: State<'_, AppState>, category: String, parent: Option<i64>) -> AppResult<CollectionLevel> {
    with_library(&state, move |library| library.db.with(|conn| collections(conn, &category, parent))).await
}

pub fn collections(conn: &Connection, category: &str, parent: Option<i64>) -> AppResult<CollectionLevel> {
    let category = category_id(conn, category)?;
    let mut children: Vec<Collection> = conn
        .prepare(
            "SELECT c.id, c.parent_id, c.name, (SELECT count(*) FROM collections k WHERE k.parent_id = c.id) \
             FROM collections c WHERE c.category_id = ?1 AND c.parent_id IS ?2 ORDER BY c.sort_order, c.sort_name",
        )?
        .query_map(params![category, parent], |row| {
            Ok(Collection {
                id: row.get(0)?,
                parent_id: row.get(1)?,
                name: row.get(2)?,
                child_count: row.get(3)?,
                item_count: 0,
                covers: Vec::new(),
            })
        })?
        .collect::<Result<_, _>>()?;
    let mut count = conn.prepare(&format!("{SUBTREE} SELECT count(*) FROM items WHERE collection_id IN subtree"))?;
    let mut covers = conn.prepare(&format!(
        "{SUBTREE} SELECT i.cover_key, i.cover_color, c.handler FROM items i JOIN categories c ON c.id = i.category_id \
         WHERE i.collection_id IN subtree AND i.cover_key IS NOT NULL ORDER BY i.sort_title LIMIT 3"
    ))?;
    for child in &mut children {
        child.item_count = count.query_row([child.id], |row| row.get(0))?;
        child.covers = covers.query_map([child.id], cover)?.collect::<Result<_, _>>()?;
    }
    let path = match parent {
        Some(parent) => collection_path(conn, parent)?,
        None => Vec::new(),
    };
    Ok(CollectionLevel { path, children })
}

/// Every collection of a category in tree order, for pickers.
#[tauri::command]
pub async fn collection_tree(state: State<'_, AppState>, category: String) -> AppResult<Vec<CollectionNode>> {
    with_library(&state, move |library| {
        library.db.with(|conn| {
            let category = category_id(conn, &category)?;
            let rows = conn
                .prepare(
                    "WITH RECURSIVE tree(id, parent_id, name, depth, path) AS ( \
                       SELECT id, parent_id, name, 0, sort_name FROM collections WHERE category_id = ?1 AND parent_id IS NULL \
                       UNION ALL SELECT c.id, c.parent_id, c.name, t.depth + 1, t.path || char(31) || c.sort_name \
                       FROM collections c JOIN tree t ON c.parent_id = t.id) \
                     SELECT id, parent_id, name, depth FROM tree ORDER BY path",
                )?
                .query_map([category], |row| {
                    Ok(CollectionNode { id: row.get(0)?, parent_id: row.get(1)?, name: row.get(2)?, depth: row.get(3)? })
                })?
                .collect::<Result<_, _>>()?;
            Ok(rows)
        })
    })
    .await
}

#[tauri::command]
pub async fn collection_create(state: State<'_, AppState>, category: String, parent: Option<i64>, name: String) -> AppResult<i64> {
    let name = clean_name(&name, 120).ok_or_else(|| AppError::msg("A collection needs a name."))?;
    with_library(&state, move |library| library.db.with(|conn| create_collection(conn, &category, parent, &name))).await
}

pub fn create_collection(conn: &Connection, category: &str, parent: Option<i64>, name: &str) -> AppResult<i64> {
    let category = category_id(conn, category)?;
    if let Some(parent) = parent {
        if collection_category(conn, parent)? != category {
            return Err(AppError::msg("That collection belongs to another category."));
        }
    }
    conn.execute(
        "INSERT INTO collections (category_id, parent_id, name, sort_name) VALUES (?1, ?2, ?3, ?4)",
        params![category, parent, name, sort_key(name)],
    )?;
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
pub async fn collection_rename(state: State<'_, AppState>, id: i64, name: String) -> AppResult<()> {
    let name = clean_name(&name, 120).ok_or_else(|| AppError::msg("A collection needs a name."))?;
    with_library(&state, move |library| {
        library.db.with(|conn| {
            let tx = conn.transaction()?;
            tx.execute(
                &format!("UPDATE collections SET name = ?2, sort_name = ?3, updated_at = {NOW} WHERE id = ?1"),
                params![id, name, sort_key(&name)],
            )?;
            let ids = subtree_items(&tx, id)?;
            reindex_all(&tx, &ids)?;
            tx.commit()?;
            Ok(())
        })
    })
    .await
}

/// Moves a collection (with everything inside it) under another collection of the same category,
/// or to the category's top level.
#[tauri::command]
pub async fn collection_move(state: State<'_, AppState>, id: i64, parent: Option<i64>) -> AppResult<()> {
    with_library(&state, move |library| library.db.with(|conn| move_collection(conn, id, parent))).await
}

pub fn move_collection(conn: &mut Connection, id: i64, parent: Option<i64>) -> AppResult<()> {
    let tx = conn.transaction()?;
    let category = collection_category(&tx, id)?;
    if let Some(parent) = parent {
        if collection_category(&tx, parent)? != category {
            return Err(AppError::msg("A collection can only move within its own category."));
        }
        let inside: bool = tx.query_row(&format!("{SUBTREE} SELECT EXISTS (SELECT 1 FROM subtree WHERE id = ?2)"), params![id, parent], |row| row.get(0))?;
        if inside {
            return Err(AppError::msg("A collection can't go inside itself."));
        }
    }
    tx.execute(&format!("UPDATE collections SET parent_id = ?2, updated_at = {NOW} WHERE id = ?1"), params![id, parent])?;
    let ids = subtree_items(&tx, id)?;
    reindex_all(&tx, &ids)?;
    tx.commit()?;
    Ok(())
}

/// Deletes a collection but nothing in it: its items and collections move up one level.
#[tauri::command]
pub async fn collection_delete(state: State<'_, AppState>, id: i64) -> AppResult<()> {
    with_library(&state, move |library| library.db.with(|conn| delete_collection(conn, id))).await
}

pub fn delete_collection(conn: &mut Connection, id: i64) -> AppResult<()> {
    let tx = conn.transaction()?;
    let ids = subtree_items(&tx, id)?;
    let parent: Option<i64> = tx
        .query_row("SELECT parent_id FROM collections WHERE id = ?1", [id], |row| row.get(0))
        .optional()?
        .ok_or_else(|| AppError::msg("That collection no longer exists."))?;
    tx.execute("UPDATE items SET collection_id = ?2 WHERE collection_id = ?1", params![id, parent])?;
    tx.execute("UPDATE collections SET parent_id = ?2 WHERE parent_id = ?1", params![id, parent])?;
    tx.execute("DELETE FROM collections WHERE id = ?1", [id])?;
    reindex_all(&tx, &ids)?;
    tx.commit()?;
    Ok(())
}

// ---------------------------------------------------------------------------------------------
// Bulk edits

#[derive(Debug, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase")]
pub enum BulkOp {
    Favorite { favorite: bool },
    AddTags { names: Vec<String> },
    RemoveTags { names: Vec<String> },
    /// A new home: a category, optionally inside one of its collections.
    Move { category: String, collection: Option<i64> },
    SetYear { year: Option<i64> },
    SetSeries { series: Option<String> },
    /// `ltr` or `rtl`: how comics and manga turn their pages.
    SetDirection { direction: String },
    /// `square` or `disc` (music), `poster` or `landscape` (video); none goes back to the default.
    SetCoverShape { shape: Option<String> },
    /// The color of a cover without artwork (`#rrggbb`); none goes back to the neutral one.
    SetCoverColor { color: Option<String> },
    /// Every selected track to the end of a playlist (music only).
    AddToPlaylist { playlist: i64 },
}

/// What a selection allows beyond the actions every item takes (favorites, tags, shelves, moving,
/// the year, a cover image or color, removing). Each holds only when every selected item supports
/// it (D-027); the bulk bar shows these, and `apply_bulk` refuses anything else.
#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BulkActions {
    /// Music tracks, all of them: "Add to playlist".
    pub playlist: bool,
    /// The cover shapes all of them can take: music square or CD, Videos horizontal or vertical;
    /// none when Movies & Series (always vertical) or different kinds are selected.
    pub cover_shapes: Vec<&'static str>,
    /// Books and comics: a series name.
    pub series: bool,
    /// Comics and manga: the reading direction.
    pub direction: bool,
}

pub fn bulk_actions(conn: &Connection, ids: &[i64]) -> AppResult<BulkActions> {
    let list = serde_json::to_string(ids).map_err(|e| AppError::msg(e.to_string()))?;
    let (total, tracks, videos, music, books, comics): (i64, i64, i64, i64, i64, i64) = conn.query_row(
        "SELECT count(*), \
           coalesce(sum(c.handler = 'audio' AND EXISTS (SELECT 1 FROM parts p WHERE p.item_id = i.id AND p.kind = 'track')), 0), \
           coalesce(sum(c.handler = 'video' AND c.key <> 'video'), 0), coalesce(sum(c.handler = 'audio'), 0), \
           coalesce(sum(c.handler IN ('book', 'comic')), 0), coalesce(sum(c.handler = 'comic'), 0) \
         FROM items i JOIN categories c ON c.id = i.category_id WHERE i.id IN (SELECT value FROM json_each(?1))",
        [list],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?)),
    )?;
    if total == 0 {
        return Ok(BulkActions::default());
    }
    Ok(BulkActions {
        playlist: tracks == total,
        cover_shapes: if music == total {
            vec!["square", "disc"]
        } else if videos == total {
            vec!["landscape", "poster"]
        } else {
            Vec::new()
        },
        series: books == total,
        direction: comics == total,
    })
}

#[tauri::command]
pub async fn items_bulk_actions(state: State<'_, AppState>, ids: Vec<i64>) -> AppResult<BulkActions> {
    with_library(&state, move |library| library.db.with(|conn| bulk_actions(conn, &ids))).await
}

/// Applies `ops` to every item in `ids`, all or nothing.
#[tauri::command]
pub async fn items_bulk(state: State<'_, AppState>, ids: Vec<i64>, ops: Vec<BulkOp>) -> AppResult<usize> {
    if ids.is_empty() {
        return Ok(0);
    }
    with_library(&state, move |library| library.db.with(|conn| apply_bulk(conn, &ids, &ops))).await
}

pub fn apply_bulk(conn: &mut Connection, ids: &[i64], ops: &[BulkOp]) -> AppResult<usize> {
    let tx = conn.transaction()?;
    let allowed = bulk_actions(&tx, ids)?;
    let unfit = || AppError::msg("That doesn't apply to every selected item.");
    for op in ops {
        let fits = match op {
            BulkOp::SetCoverShape { shape: Some(shape) } => allowed.cover_shapes.contains(&shape.as_str()) || !["square", "disc", "poster", "landscape"].contains(&shape.as_str()),
            BulkOp::SetSeries { .. } => allowed.series,
            BulkOp::SetDirection { .. } => allowed.direction,
            BulkOp::AddToPlaylist { .. } => allowed.playlist,
            _ => true,
        };
        if !fits {
            return Err(unfit());
        }
    }
    let touch = format!("UPDATE items SET updated_at = {NOW} WHERE id = ?1");
    let mut searchable = false;
    for op in ops {
        match op {
            BulkOp::Favorite { favorite } => {
                for id in ids {
                    tx.execute(&format!("UPDATE items SET is_favorite = ?2, updated_at = {NOW} WHERE id = ?1"), params![id, favorite])?;
                    tx.execute("UPDATE parts SET is_favorite = ?2 WHERE item_id = ?1 AND kind = 'track'", params![id, favorite])?;
                }
            }
            BulkOp::AddTags { names } => {
                add_tags(&tx, ids, names)?;
                searchable = true;
            }
            BulkOp::RemoveTags { names } => {
                remove_tags(&tx, ids, names)?;
                searchable = true;
            }
            BulkOp::Move { category, collection } => {
                let category = category_id(&tx, category)?;
                if let Some(collection) = collection {
                    if collection_category(&tx, *collection)? != category {
                        return Err(AppError::msg("That collection belongs to another category."));
                    }
                }
                for id in ids {
                    tx.execute(
                        &format!("UPDATE items SET category_id = ?2, collection_id = ?3, updated_at = {NOW} WHERE id = ?1"),
                        params![id, category, collection],
                    )?;
                    // Into Movies & Series: a horizontal cover goes back to the vertical default.
                    tx.execute(
                        "UPDATE items SET metadata = json_remove(metadata, '$.coverShape') WHERE id = ?1                          AND json_extract(metadata, '$.coverShape') = 'landscape' AND category_id = (SELECT id FROM categories WHERE key = 'video')",
                        [id],
                    )?;
                }
                searchable = true;
            }
            BulkOp::SetYear { year } => {
                if year.is_some_and(|y| !(0..=3000).contains(&y)) {
                    return Err(AppError::msg("Year should be a whole number, like 1927."));
                }
                for id in ids {
                    tx.execute(&format!("UPDATE items SET year = ?2, updated_at = {NOW} WHERE id = ?1"), params![id, year])?;
                }
            }
            BulkOp::SetSeries { series } => {
                let series = series.as_deref().and_then(|s| clean_name(s, 200));
                for id in ids {
                    match &series {
                        Some(series) => tx.execute("UPDATE items SET metadata = json_set(metadata, '$.series', ?2) WHERE id = ?1", params![id, series])?,
                        None => tx.execute("UPDATE items SET metadata = json_remove(metadata, '$.series') WHERE id = ?1", [id])?,
                    };
                    tx.execute(&touch, [id])?;
                }
                searchable = true;
            }
            BulkOp::SetDirection { direction } => {
                if direction != "ltr" && direction != "rtl" {
                    return Err(AppError::msg("Reading direction is either left to right or right to left."));
                }
                for id in ids {
                    tx.execute("UPDATE items SET metadata = json_set(metadata, '$.readingDirection', ?2) WHERE id = ?1", params![id, direction])?;
                }
            }
            BulkOp::SetCoverShape { shape } => match shape.as_deref() {
                None => {
                    for id in ids {
                        tx.execute("UPDATE items SET metadata = json_remove(metadata, '$.coverShape') WHERE id = ?1", [id])?;
                    }
                }
                Some(shape @ ("square" | "disc" | "poster" | "landscape")) => {
                    // Each kind takes only its own shapes; Movies & Series covers are always vertical (D-027).
                    let fits = match shape {
                        "square" | "disc" => "c.handler = 'audio'",
                        "landscape" => "c.handler = 'video' AND c.key <> 'video'",
                        _ => "c.handler = 'video'",
                    };
                    for id in ids {
                        tx.execute(
                            &format!(
                                "UPDATE items SET metadata = json_set(metadata, '$.coverShape', ?2) WHERE id = ?1                                  AND EXISTS (SELECT 1 FROM categories c WHERE c.id = items.category_id AND {fits})"
                            ),
                            params![id, shape],
                        )?;
                    }
                }
                Some(_) => return Err(AppError::msg("That isn't a cover shape.")),
            },
            BulkOp::AddToPlaylist { playlist } => {
                let mut parts = Vec::with_capacity(ids.len());
                for id in ids {
                    let part: Option<i64> = tx
                        .query_row("SELECT id FROM parts WHERE item_id = ?1 AND kind = 'track' ORDER BY position LIMIT 1", [id], |row| row.get(0))
                        .optional()?;
                    parts.extend(part);
                }
                crate::music::append_to_playlist(&tx, *playlist, &parts)?;
            }
            BulkOp::SetCoverColor { color } => {
                if let Some(color) = color {
                    if color.len() != 7 || !color.starts_with('#') || !color[1..].chars().all(|c| c.is_ascii_hexdigit()) {
                        return Err(AppError::msg("That isn't a color."));
                    }
                }
                // Only covers without artwork use it; artwork brings its own color.
                for id in ids {
                    tx.execute("UPDATE items SET cover_color = ?2 WHERE id = ?1 AND cover_key IS NULL", params![id, color])?;
                }
            }
        }
    }
    if searchable {
        reindex_all(&tx, ids)?;
    }
    tx.commit()?;
    Ok(ids.len())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    fn item(conn: &Connection, category: &str, title: &str) -> i64 {
        conn.execute(
            "INSERT INTO items (category_id, title, sort_title) VALUES ((SELECT id FROM categories WHERE key = ?1), ?2, ?3)",
            params![category, title, sort_key(title)],
        )
        .unwrap();
        let id = conn.last_insert_rowid();
        reindex(conn, id).unwrap();
        id
    }

    fn search(conn: &Connection, text: &str) -> Vec<i64> {
        let expr = crate::library::fts_query(text).unwrap();
        conn.prepare("SELECT rowid FROM items_fts WHERE items_fts MATCH ?1 ORDER BY rowid")
            .unwrap()
            .query_map([expr], |row| row.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap()
    }

    #[test]
    fn collections_nest_move_and_delete_without_losing_items() {
        let mut conn = db::memory();
        let piece = create_collection(&conn, "manga", None, "One Piece").unwrap();
        let arc = create_collection(&conn, "manga", Some(piece), "East Blue").unwrap();
        let volume = item(&conn, "manga", "Volume 1");
        apply_bulk(&mut conn, &[volume], &[BulkOp::Move { category: "manga".into(), collection: Some(arc) }]).unwrap();

        // Search finds the item through its collections, and the collection counts it.
        assert_eq!(search(&conn, "one piece"), vec![volume]);
        let level = collections(&conn, "manga", None).unwrap();
        assert_eq!((level.children[0].item_count, level.children[0].child_count), (1, 1));
        assert_eq!(collection_path(&conn, arc).unwrap().iter().map(|c| c.name.as_str()).collect::<Vec<_>>(), ["One Piece", "East Blue"]);

        // No cycles, and no moving into another category's collection.
        assert!(move_collection(&mut conn, piece, Some(arc)).is_err());
        let books = create_collection(&conn, "books", None, "Classics").unwrap();
        assert!(apply_bulk(&mut conn, &[volume], &[BulkOp::Move { category: "manga".into(), collection: Some(books) }]).is_err());

        // Deleting a collection moves its contents up a level.
        delete_collection(&mut conn, arc).unwrap();
        let home: Option<i64> = conn.query_row("SELECT collection_id FROM items WHERE id = ?1", [volume], |row| row.get(0)).unwrap();
        assert_eq!(home, Some(piece));
        delete_collection(&mut conn, piece).unwrap();
        let home: Option<i64> = conn.query_row("SELECT collection_id FROM items WHERE id = ?1", [volume], |row| row.get(0)).unwrap();
        assert_eq!(home, None);
        assert_eq!(search(&conn, "one piece"), Vec::<i64>::new());
    }

    #[test]
    fn tags_merge_on_rename_and_disappear_when_unused() {
        let mut conn = db::memory();
        let a = item(&conn, "books", "Alpha");
        let b = item(&conn, "books", "Beta");
        apply_bulk(&mut conn, &[a], &[BulkOp::AddTags { names: vec!["  To   read ".into()] }]).unwrap();
        apply_bulk(&mut conn, &[b], &[BulkOp::AddTags { names: vec!["Signed".into(), "to read".into()] }]).unwrap();
        let tags: Vec<(String, i64)> = conn
            .prepare("SELECT name, (SELECT count(*) FROM item_tags WHERE tag_id = tags.id) FROM tags ORDER BY name")
            .unwrap()
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(tags, [("Signed".to_string(), 1), ("To read".to_string(), 2)]);
        assert_eq!(search(&conn, "signed"), vec![b]);

        let signed: i64 = conn.query_row("SELECT id FROM tags WHERE name = 'Signed'", [], |row| row.get(0)).unwrap();
        rename_tag(&mut conn, signed, "to READ").unwrap();
        let count: i64 = conn.query_row("SELECT count(*) FROM tags", [], |row| row.get(0)).unwrap();
        assert_eq!(count, 1);

        apply_bulk(&mut conn, &[a, b], &[BulkOp::RemoveTags { names: vec!["To read".into()] }]).unwrap();
        let count: i64 = conn.query_row("SELECT count(*) FROM tags", [], |row| row.get(0)).unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn selections_offer_only_what_every_item_takes() {
        let mut conn = db::memory();
        let songs: Vec<i64> = (0..5)
            .map(|n| {
                let id = item(&conn, "music", &format!("Song {n}"));
                conn.execute("INSERT INTO parts (item_id, kind, number) VALUES (?1, 'track', 1)", [id]).unwrap();
                id
            })
            .collect();
        let clip = item(&conn, "videos", "Clip");
        let film = item(&conn, "video", "Film");
        let actions = bulk_actions(&conn, &songs).unwrap();
        assert!(actions.playlist);
        assert_eq!(actions.cover_shapes, ["square", "disc"]);
        // One video among the songs and "Add to playlist" is gone; without it, it's back.
        let mixed = [songs.clone(), vec![clip]].concat();
        let actions = bulk_actions(&conn, &mixed).unwrap();
        assert!(!actions.playlist && actions.cover_shapes.is_empty());
        assert_eq!(bulk_actions(&conn, &[clip]).unwrap().cover_shapes, ["landscape", "poster"]);
        assert!(bulk_actions(&conn, &[clip, film]).unwrap().cover_shapes.is_empty());
        // The core refuses what doesn't fit, and adds what does.
        conn.execute("INSERT INTO playlists (id, name) VALUES (1, 'Mix')", []).unwrap();
        assert!(apply_bulk(&mut conn, &mixed, &[BulkOp::AddToPlaylist { playlist: 1 }]).is_err());
        apply_bulk(&mut conn, &songs, &[BulkOp::AddToPlaylist { playlist: 1 }]).unwrap();
        let count: i64 = conn.query_row("SELECT count(*) FROM playlist_tracks WHERE playlist_id = 1", [], |row| row.get(0)).unwrap();
        assert_eq!(count, 5);
        // General actions take any mix.
        apply_bulk(&mut conn, &mixed, &[BulkOp::Favorite { favorite: true }]).unwrap();
    }
}

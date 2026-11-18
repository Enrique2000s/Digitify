//! Catalog queries and edits behind the library views.

use std::collections::HashMap;
use std::time::Instant;

use rusqlite::types::Value as SqlValue;
use rusqlite::{params, params_from_iter, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::State;

use crate::error::{AppError, AppResult};
use crate::organize::NamedRef;
use crate::{artwork, files, AppState, Library};

// ---------------------------------------------------------------------------------------------
// Shared helpers

/// Runs blocking work (SQLite, file I/O) off the async runtime's worker threads.
pub async fn blocking<T: Send + 'static>(f: impl FnOnce() -> AppResult<T> + Send + 'static) -> AppResult<T> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| AppError::msg(format!("background task failed: {e}")))?
}

pub(crate) async fn with_library<T: Send + 'static>(
    state: &AppState,
    f: impl FnOnce(&Library) -> AppResult<T> + Send + 'static,
) -> AppResult<T> {
    let library = state.library()?;
    blocking(move || f(&library)).await
}

/// Turns free text into an FTS5 query in which every word must match as a prefix.
/// Splitting on anything that isn't a letter or digit also strips FTS syntax characters.
pub fn fts_query(text: &str) -> Option<String> {
    let terms: Vec<String> = text
        .split(|c: char| !c.is_alphanumeric())
        .filter(|word| !word.is_empty())
        .map(|word| format!("\"{}\"*", word.to_lowercase()))
        .collect();
    (!terms.is_empty()).then(|| terms.join(" "))
}

/// Sort key for titles: case-insensitive, ignoring a leading English article.
pub fn sort_key(title: &str) -> String {
    let lower = title.trim().to_lowercase();
    for article in ["the ", "a ", "an "] {
        if let Some(rest) = lower.strip_prefix(article) {
            return rest.trim_start().to_string();
        }
    }
    lower
}

/// "Jane Austen" → "Austen, Jane".
pub fn person_sort_name(name: &str) -> String {
    match name.trim().rsplit_once(' ') {
        Some((first, last)) => format!("{last}, {first}"),
        None => name.trim().to_string(),
    }
}

pub fn upsert_person(conn: &Connection, name: &str) -> rusqlite::Result<i64> {
    conn.query_row(
        "INSERT INTO people (name, sort_name) VALUES (?1, ?2) \
         ON CONFLICT(name) DO UPDATE SET name = excluded.name RETURNING id",
        params![name.trim(), person_sort_name(name)],
        |row| row.get(0),
    )
}

/// Rebuilds an item's full-text entry: title, people, tags, category, the collections it sits in,
/// series/album, genre and part titles (so tracks and chapters are searchable).
pub fn reindex(conn: &Connection, item_id: i64) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM items_fts WHERE rowid = ?1", [item_id])?;
    conn.execute(
        "INSERT INTO items_fts (rowid, title, people, tags, extra) \
         SELECT i.id, i.title || ' ' || COALESCE(i.subtitle, ''), \
           COALESCE((SELECT group_concat(p.name, ' ') FROM item_people ip JOIN people p ON p.id = ip.person_id WHERE ip.item_id = i.id), ''), \
           COALESCE((SELECT group_concat(t.name, ' ') FROM item_tags it JOIN tags t ON t.id = it.tag_id WHERE it.item_id = i.id), ''), \
           c.name || ' ' || COALESCE(json_extract(i.metadata, '$.series'), '') || ' ' || \
           COALESCE(json_extract(i.metadata, '$.album'), '') || ' ' || COALESCE(json_extract(i.metadata, '$.genre'), '') || ' ' || \
           COALESCE((WITH RECURSIVE up(id, parent_id, name) AS ( \
               SELECT id, parent_id, name FROM collections WHERE id = i.collection_id \
               UNION ALL SELECT k.id, k.parent_id, k.name FROM collections k JOIN up ON k.id = up.parent_id) \
             SELECT group_concat(name, ' ') FROM up), '') || ' ' || \
           COALESCE((SELECT group_concat(pt.title, ' ') FROM parts pt WHERE pt.item_id = i.id), '') \
         FROM items i JOIN categories c ON c.id = i.category_id WHERE i.id = ?1",
        [item_id],
    )?;
    Ok(())
}

pub(crate) fn category_id(conn: &Connection, key: &str) -> AppResult<i64> {
    conn.query_row("SELECT id FROM categories WHERE key = ?1", [key], |row| row.get(0))
        .optional()?
        .ok_or_else(|| AppError::msg(format!("unknown category '{key}'")))
}

pub(crate) fn clean(text: Option<String>) -> Option<String> {
    text.map(|t| t.trim().to_string()).filter(|t| !t.is_empty())
}

// ---------------------------------------------------------------------------------------------
// Categories

/// A photo's card shape from its proportions (D-033): wide ones landscape, tall ones poster.
macro_rules! photo_shape {
    () => {
        "(CASE WHEN json_extract(i.metadata, '$.width') >= 1.2 * json_extract(i.metadata, '$.height') THEN 'landscape' \
               WHEN json_extract(i.metadata, '$.height') >= 1.2 * json_extract(i.metadata, '$.width') THEN 'poster' ELSE 'square' END)"
    };
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Category {
    pub id: i64,
    pub key: String,
    pub name: String,
    pub icon: String,
    pub color: Option<String>,
    pub handler: String,
    pub sort_order: i64,
    pub is_hidden: bool,
    pub is_builtin: bool,
    pub item_count: i64,
    /// Kind-specific settings, such as `readingDirection` for comics.
    pub settings: Value,
}

#[tauri::command]
pub async fn categories_list(state: State<'_, AppState>) -> AppResult<Vec<Category>> {
    with_library(&state, |library| library.db.with(|conn| categories(conn))).await
}

pub fn categories(conn: &Connection) -> AppResult<Vec<Category>> {
    let mut stmt = conn.prepare(
        "SELECT c.id, c.key, c.name, c.icon, c.color, c.handler, c.sort_order, c.is_hidden, c.is_builtin, \
         (SELECT count(*) FROM items i WHERE i.category_id = c.id), c.settings \
         FROM categories c ORDER BY c.sort_order, c.name",
    )?;
    let rows: Vec<Category> = stmt
        .query_map([], |row| {
            let settings: String = row.get(10)?;
            Ok(Category {
                id: row.get(0)?,
                key: row.get(1)?,
                name: row.get(2)?,
                icon: row.get(3)?,
                color: row.get(4)?,
                handler: row.get(5)?,
                sort_order: row.get(6)?,
                is_hidden: row.get::<_, i64>(7)? != 0,
                is_builtin: row.get::<_, i64>(8)? != 0,
                item_count: row.get(9)?,
                settings: serde_json::from_str(&settings).unwrap_or_else(|_| Value::Object(Default::default())),
            })
        })?
        .collect::<Result<_, _>>()?;
    Ok(rows)
}

// ---------------------------------------------------------------------------------------------
// Library views

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct QueryParams {
    pub category: Option<String>,
    /// A collection and everything inside it.
    pub collection: Option<i64>,
    pub tag: Option<i64>,
    pub search: Option<String>,
    pub favorites: bool,
    /// `digital` (files in the library) or `online` (from a link, played online), D-029.
    pub ownership: Option<String>,
    /// `title` (default), `added`, `year`, `creator`, `durationAsc`, `durationDesc`, `custom`, or
    /// `relevance` when searching.
    pub sort: Option<String>,
    pub offset: i64,
    pub limit: i64,
    /// The view whose hand-arranged order `sort: "custom"` uses ("books", "all", "collection:3"…).
    pub custom: Option<String>,
    /// Only items of this kind of category (`image` for the image viewer's photos, D-033).
    #[serde(default)]
    pub handler: Option<String>,
    /// Smart lists' rules (D-051): `unstarted`, `inProgress` or `finished`…
    #[serde(default)]
    pub progress: Option<String>,
    /// …a range of years…
    #[serde(default)]
    pub year_from: Option<i64>,
    #[serde(default)]
    pub year_to: Option<i64>,
    /// …added within so many days…
    #[serde(default)]
    pub added_days: Option<i64>,
    /// …and at least this many stars of your rating.
    #[serde(default)]
    pub min_rating: Option<i64>,
    /// Only what's in Later (D-062), newest first unless sorted otherwise.
    #[serde(default)]
    pub later: bool,
}


#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemCard {
    pub id: i64,
    pub title: String,
    pub subtitle: Option<String>,
    pub year: Option<i64>,
    pub category: String,
    pub handler: String,
    pub cover_key: Option<String>,
    pub cover_color: Option<String>,
    pub is_favorite: bool,
    pub formats: Vec<String>,
    pub has_physical: bool,
    pub has_digital: bool,
    pub missing: bool,
    pub progress: Option<f64>,
    /// The item's own cover shape (`square`, `disc`, `poster` or `landscape`), if it has one.
    pub cover_shape: Option<String>,
    /// Imported from a link and not downloaded: it plays online only (D-028).
    pub online: bool,
    /// The service it came from (YouTube, YouTube Music, Spotify, SoundCloud), for its tag.
    pub source: Option<String>,
    /// A film's disc format (`dvd`, `bluray`, `uhd-bluray`, `bluray-3d`), for the case band.
    pub disc_format: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    pub total: i64,
    pub offset: i64,
    pub items: Vec<ItemCard>,
    /// Time spent inside SQLite, for performance tracking.
    pub elapsed_ms: f64,
}

#[tauri::command]
pub async fn library_query(state: State<'_, AppState>, params: QueryParams) -> AppResult<QueryResult> {
    with_library(&state, move |library| library.db.with(|conn| query(conn, &params))).await
}

/// Each matching item's kind and cover shape, in view order, two letters per item: the kind (`b`ook,
/// `c`omic, `v`ideo, `m`ovies & series, `a`udio, `g`eneric, `i`mage) and its own shape (`s`quare, `d`isc, `p`oster,
/// `l`andscape, or `-` for the default). The grid lays out rows of equal height from these.
#[tauri::command]
pub async fn library_query_shapes(state: State<'_, AppState>, params: QueryParams) -> AppResult<String> {
    with_library(&state, move |library| {
        library.db.with(|conn| {
                        let QueryParts { joins, filter, args, order, .. } = QueryParts::new(&params);
            let photo = photo_shape!();
            let mut stmt = conn.prepare(&format!(
                "SELECT (SELECT CASE c.key WHEN 'video' THEN 'm' ELSE substr(c.handler, 1, 1) END FROM categories c WHERE c.id = i.category_id),                  coalesce(substr(json_extract(i.metadata, '$.coverShape'), 1, 1), CASE WHEN (SELECT c.handler FROM categories c WHERE c.id = i.category_id) = 'image' THEN substr({photo}, 1, 1) END, '-')                  FROM items i{joins}{filter} ORDER BY {order} LIMIT 100000"
            ))?;
            let mut out = String::new();
            let mut rows = stmt.query(params_from_iter(args.iter()))?;
            while let Some(row) = rows.next()? {
                out.push_str(&row.get::<_, String>(0)?);
                out.push_str(&row.get::<_, String>(1)?);
            }
            Ok(out)
        })
    })
    .await
}

/// Every id matching `params`, in view order (for "Select all"). Capped at 100,000.
#[tauri::command]
pub async fn library_query_ids(state: State<'_, AppState>, params: QueryParams) -> AppResult<Vec<i64>> {
    with_library(&state, move |library| {
        library.db.with(|conn| {
                        let QueryParts { joins, filter, args, order, .. } = QueryParts::new(&params);
            ids(conn, &format!("SELECT i.id FROM items i{joins}{filter} ORDER BY {order} LIMIT 100000"), &args)
        })
    })
    .await
}

/// When a photo was taken (D-033): its EXIF date, else its file's date, else when it was added.
pub(crate) const TAKEN_SORT: &str = "coalesce(json_extract(i.metadata, '$.taken'), \
    strftime('%Y-%m-%dT%H:%M:%S', json_extract(i.metadata, '$.fileDate'), 'unixepoch', 'localtime'), i.added_at)";

pub(crate) const CREATOR_SORT: &str = "(SELECT p.sort_name FROM item_people ip JOIN people p ON p.id = ip.person_id \
                            WHERE ip.item_id = i.id ORDER BY ip.position LIMIT 1)";

/// An item's length in seconds: its own (films, tracks), else the sum of its parts (a series'
/// episodes); none for books and anything not measured.
pub(crate) const DURATION_SORT: &str = "coalesce(json_extract(i.metadata, '$.durationSec'),                             (SELECT sum(pd.duration_ms) / 1000.0 FROM parts pd WHERE pd.item_id = i.id))";

const CARD_COLUMNS: &str = concat!("i.id, i.title, \
    COALESCE((SELECT p.name FROM item_people ip JOIN people p ON p.id = ip.person_id \
              WHERE ip.item_id = i.id ORDER BY ip.position LIMIT 1), i.subtitle), \
    i.year, c.key, c.handler, i.cover_key, i.cover_color, i.is_favorite, \
    (SELECT group_concat(v.format, '|') FROM versions v WHERE v.item_id = i.id AND v.format IS NOT NULL), \
    EXISTS (SELECT 1 FROM versions v WHERE v.item_id = i.id AND v.kind = 'physical'), \
    EXISTS (SELECT 1 FROM versions v WHERE v.item_id = i.id AND v.kind = 'digital'), \
    EXISTS (SELECT 1 FROM files f JOIN versions v ON v.id = f.version_id WHERE v.item_id = i.id AND f.status <> 'ok'), \
    (SELECT pr.fraction FROM progress pr WHERE pr.item_id = i.id AND pr.part_id = 0), \
    coalesce(json_extract(i.metadata, '$.coverShape'), CASE WHEN c.handler = 'image' THEN ", photo_shape!(), " END),     EXISTS (SELECT 1 FROM online_sources o WHERE o.item_id = i.id AND o.downloaded = 0), \
    (SELECT o.service FROM online_sources o WHERE o.item_id = i.id AND o.provider <> 'web'), \
    json_extract(i.metadata, '$.discFormat')");

fn card(row: &Row<'_>) -> rusqlite::Result<ItemCard> {
    let formats: Option<String> = row.get(9)?;
    let mut formats: Vec<String> = formats
        .map(|f| f.split('|').map(str::to_string).collect())
        .unwrap_or_default();
    formats.dedup();
    Ok(ItemCard {
        id: row.get(0)?,
        title: row.get(1)?,
        subtitle: row.get(2)?,
        year: row.get(3)?,
        category: row.get(4)?,
        handler: row.get(5)?,
        cover_key: row.get(6)?,
        cover_color: row.get(7)?,
        is_favorite: row.get::<_, i64>(8)? != 0,
        formats,
        has_physical: row.get::<_, i64>(10)? != 0,
        has_digital: row.get::<_, i64>(11)? != 0,
        missing: row.get::<_, i64>(12)? != 0,
        progress: row.get(13)?,
        cover_shape: row.get(14)?,
        online: row.get::<_, i64>(15)? != 0,
        source: row.get(16)?,
        disc_format: row.get(17)?,
    })
}

/// Loads cards for `ids`, keeping the given order.
pub fn cards_by_ids(conn: &Connection, ids: &[i64]) -> AppResult<Vec<ItemCard>> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let placeholders = vec!["?"; ids.len()].join(",");
    let mut stmt = conn.prepare(&format!(
        "SELECT {CARD_COLUMNS} FROM items i JOIN categories c ON c.id = i.category_id WHERE i.id IN ({placeholders})"
    ))?;
    let mut by_id: HashMap<i64, ItemCard> = stmt
        .query_map(params_from_iter(ids.iter()), card)?
        .map(|row| row.map(|card| (card.id, card)))
        .collect::<Result<_, _>>()?;
    Ok(ids.iter().filter_map(|id| by_id.remove(id)).collect())
}

fn ids(conn: &Connection, sql: &str, args: &[SqlValue]) -> AppResult<Vec<i64>> {
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map(params_from_iter(args.iter()), |row| row.get(0))?.collect::<Result<_, _>>()?;
    Ok(rows)
}

/// The joins, conditions, arguments and order shared by the paged query and "Select all".
struct QueryParts {
    joins: String,
    filter: String,
    args: Vec<SqlValue>,
    /// How many of `args` the filter uses (the rest belong to the order).
    counted: usize,
    order: String,
}

impl QueryParts {
    fn new(params: &QueryParams) -> Self {
        let mut joins = String::new();
        let mut conditions: Vec<String> = Vec::new();
        let mut args: Vec<SqlValue> = Vec::new();

        let search = params.search.as_deref().and_then(fts_query);
        if let Some(expr) = &search {
            joins.push_str(" JOIN items_fts f ON f.rowid = i.id");
            args.push(SqlValue::Text(expr.clone()));
            conditions.push(format!("items_fts MATCH ?{}", args.len()));
        }
        if let Some(category) = &params.category {
            args.push(SqlValue::Text(category.clone()));
            conditions.push(format!("i.category_id = (SELECT id FROM categories WHERE key = ?{})", args.len()));
        }
        if let Some(collection) = params.collection {
            args.push(SqlValue::Integer(collection));
            conditions.push(format!(
                "i.collection_id IN (WITH RECURSIVE subtree(id) AS (SELECT ?{} UNION ALL \
                 SELECT c.id FROM collections c JOIN subtree s ON c.parent_id = s.id) SELECT id FROM subtree)",
                args.len()
            ));
        }
        if let Some(tag) = params.tag {
            args.push(SqlValue::Integer(tag));
            conditions.push(format!("EXISTS (SELECT 1 FROM item_tags it WHERE it.item_id = i.id AND it.tag_id = ?{})", args.len()));
        }
        if params.favorites {
            conditions.push("i.is_favorite = 1".into());
        }
        if let Some(handler) = &params.handler {
            args.push(SqlValue::Text(handler.clone()));
            conditions.push(format!("i.category_id IN (SELECT id FROM categories WHERE handler = ?{})", args.len()));
        }
        // Smart lists' rules (D-051).
        match params.progress.as_deref() {
            Some("unstarted") => conditions.push("NOT EXISTS (SELECT 1 FROM progress pr WHERE pr.item_id = i.id AND pr.part_id = 0 AND (pr.fraction > 0.01 OR pr.completed = 1))".into()),
            Some("inProgress") => conditions.push("EXISTS (SELECT 1 FROM progress pr WHERE pr.item_id = i.id AND pr.part_id = 0 AND pr.fraction > 0.01 AND pr.completed = 0)".into()),
            Some("finished") => conditions.push("EXISTS (SELECT 1 FROM progress pr WHERE pr.item_id = i.id AND pr.part_id = 0 AND pr.completed = 1)".into()),
            _ => {}
        }
        if let Some(year) = params.year_from {
            args.push(SqlValue::Integer(year));
            conditions.push(format!("i.year >= ?{}", args.len()));
        }
        if let Some(year) = params.year_to {
            args.push(SqlValue::Integer(year));
            conditions.push(format!("i.year <= ?{}", args.len()));
        }
        if let Some(days) = params.added_days.filter(|d| *d > 0) {
            args.push(SqlValue::Text(format!("-{days} days")));
            conditions.push(format!("i.added_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?{})", args.len()));
        }
        if params.later {
            conditions.push("i.id IN (SELECT item_id FROM later)".into());
        }
        if let Some(stars) = params.min_rating.filter(|s| (1..=5).contains(s)) {
            args.push(SqlValue::Integer(stars));
            conditions.push(format!("i.rating >= ?{}", args.len()));
        }
        // Digital: files in the library; Online: imported from a link and played online (D-029).
        match params.ownership.as_deref() {
            Some("digital") => conditions.push("EXISTS (SELECT 1 FROM versions v WHERE v.item_id = i.id AND v.kind = 'digital')".into()),
            Some("online") => conditions.push("EXISTS (SELECT 1 FROM online_sources o WHERE o.item_id = i.id AND o.downloaded = 0)".into()),
            _ => {}
        }
        let filter = if conditions.is_empty() { String::new() } else { format!(" WHERE {}", conditions.join(" AND ")) };
        let counted = args.len();
        let custom = match (params.sort.as_deref(), &params.custom) {
            (Some("custom"), Some(view)) => {
                args.push(SqlValue::Text(view.clone()));
                Some(format!("(SELECT co.position FROM custom_order co WHERE co.view = ?{} AND co.item_id = i.id)", args.len()))
            }
            _ => None,
        };
        let order = match params.sort.as_deref() {
            // Arranged items first, in their order; the rest after them by title.
            Some("custom") if custom.is_some() => {
                let position = custom.unwrap();
                format!("{position} IS NULL, {position}, i.sort_title, i.id")
            }
            None | Some("relevance") if search.is_some() => "f.rank".to_string(),
            // In Later, "Recently added" means added to Later (D-062).
            Some("added") if params.later => "(SELECT l.added_at FROM later l WHERE l.item_id = i.id) DESC, i.id DESC".to_string(),
            Some("added") => "i.added_at DESC, i.id DESC".to_string(),
            Some("opened") => "i.last_opened_at IS NULL, i.last_opened_at DESC, i.id DESC".to_string(),
            Some("year") => "i.year IS NULL, i.year DESC, i.sort_title".to_string(),
            // Your rating, best first; unrated last (D-049).
            Some("rating") => "i.rating IS NULL, i.rating DESC, i.sort_title, i.id".to_string(),
            // Photos by the date they were taken (D-033); anything else by when it was added.
            Some("takenDesc") => format!("{TAKEN_SORT} DESC, i.id DESC"),
            Some("takenAsc") => format!("{TAKEN_SORT}, i.id"),
            Some("creator") => format!("{CREATOR_SORT} IS NULL, {CREATOR_SORT}, i.sort_title"),
            // Items without a known length come last either way.
            Some("durationAsc") => format!("{DURATION_SORT} IS NULL, {DURATION_SORT}, i.sort_title, i.id"),
            Some("durationDesc") => format!("{DURATION_SORT} IS NULL, {DURATION_SORT} DESC, i.sort_title, i.id"),
            _ => "i.sort_title, i.id".to_string(),
        };
        Self { joins, filter, args, counted, order }
    }
}

fn query(conn: &Connection, params: &QueryParams) -> AppResult<QueryResult> {
    let started = Instant::now();
        let params = params;
    let QueryParts { joins, filter, args, counted, order } = QueryParts::new(params);
    let total: i64 = conn.query_row(
        &format!("SELECT count(*) FROM items i{joins}{filter}"),
        params_from_iter(args[..counted].iter()),
        |row| row.get(0),
    )?;
    // Page over the ids first so deep offsets never compute card details for skipped rows.
    let limit = params.limit.clamp(1, 500);
    let offset = params.offset.max(0);
    let page = ids(
        conn,
        &format!("SELECT i.id FROM items i{joins}{filter} ORDER BY {order} LIMIT {limit} OFFSET {offset}"),
        &args,
    )?;
    let items = cards_by_ids(conn, &page)?;
    Ok(QueryResult { total, offset, items, elapsed_ms: started.elapsed().as_secs_f64() * 1000.0 })
}

// ---------------------------------------------------------------------------------------------
// Custom order

/// Saves a view's hand-arranged order. The order is kept per view; ids are stored in the given order.
/// Saves a view's custom order. Positive ids are items; negative ids are collections placed among
/// them (D-036), `-id` being the collection. An order of items alone (the Arrange dialog) leaves the
/// collections' places as they were.
pub fn set_custom_order(conn: &mut Connection, view: &str, ids: &[i64]) -> AppResult<()> {
    let view = view.trim();
    if view.is_empty() || view.len() > 100 {
        return Err(AppError::msg("unknown view"));
    }
    let with_collections = ids.iter().any(|id| *id < 0);
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM custom_order WHERE view = ?1", [view])?;
    if with_collections {
        tx.execute("DELETE FROM custom_order_collections WHERE view = ?1", [view])?;
    }
    {
        let mut insert = tx.prepare("INSERT OR IGNORE INTO custom_order (view, item_id, position) SELECT ?1, id, ?3 FROM items WHERE id = ?2")?;
        let mut place = tx.prepare("INSERT OR IGNORE INTO custom_order_collections (view, collection_id, position) SELECT ?1, id, ?3 FROM collections WHERE id = ?2")?;
        for (position, id) in ids.iter().enumerate() {
            if *id > 0 {
                insert.execute(params![view, id, position as i64])?;
            } else if *id < 0 {
                place.execute(params![view, -id, position as i64])?;
            }
        }
    }
    tx.commit()?;
    Ok(())
}

/// Where the given collections stand among a view's items in its custom order (D-036): for each,
/// its index in the combined list. Collections never placed come first, in the order given; placed
/// ones go between the items by position; items never arranged come last.
#[tauri::command]
pub async fn custom_order_slots(state: State<'_, AppState>, params: QueryParams, collections: Vec<i64>) -> AppResult<Vec<(i64, i64)>> {
    with_library(&state, move |library| library.db.with(|conn| custom_slots(conn, &params, &collections)))
        .await
}

pub fn custom_slots(conn: &Connection, params: &QueryParams, collections: &[i64]) -> AppResult<Vec<(i64, i64)>> {
    let Some(view) = params.custom.clone().filter(|_| params.sort.as_deref() == Some("custom")) else {
        return Ok(collections.iter().enumerate().map(|(i, id)| (*id, i as i64)).collect());
    };
    let mut placed: Vec<(i64, i64)> = Vec::new();
    let mut unplaced: Vec<i64> = Vec::new();
    {
        let mut stmt = conn.prepare("SELECT position FROM custom_order_collections WHERE view = ?1 AND collection_id = ?2")?;
        for id in collections {
            // The view's cards carry collections as negative ids.
            match stmt.query_row(params![view, id.abs()], |row| row.get::<_, i64>(0)).optional()? {
                Some(position) => placed.push((*id, position)),
                None => unplaced.push(*id),
            }
        }
    }
    placed.sort_by_key(|(_, position)| *position);
    let QueryParts { joins, filter, args, counted, .. } = QueryParts::new(params);
    let mut args: Vec<SqlValue> = args[..counted].to_vec();
    args.push(SqlValue::Text(view));
    let view_arg = args.len();
    args.push(SqlValue::Integer(0));
    let below_arg = args.len();
    let glue = if filter.trim().is_empty() { " WHERE " } else { " AND " };
    let sql = format!(
        "SELECT count(*) FROM items i{joins}{filter}{glue}(SELECT co.position FROM custom_order co WHERE co.view = ?{view_arg} AND co.item_id = i.id) < ?{below_arg}"
    );
    let mut stmt = conn.prepare(&sql)?;
    let mut slots: Vec<(i64, i64)> = unplaced.iter().enumerate().map(|(i, id)| (*id, i as i64)).collect();
    for (k, (id, position)) in placed.iter().enumerate() {
        args[below_arg - 1] = SqlValue::Integer(*position);
        let items_before: i64 = stmt.query_row(params_from_iter(args.iter()), |row| row.get(0))?;
        slots.push((*id, unplaced.len() as i64 + k as i64 + items_before));
    }
    Ok(slots)
}

#[tauri::command]
pub async fn custom_order_set(state: State<'_, AppState>, view: String, ids: Vec<i64>) -> AppResult<()> {
    with_library(&state, move |library| library.db.with(|conn| set_custom_order(conn, &view, &ids))).await
}

/// Cards for some ids, in that order (the "Arrange" list loads them as it scrolls).
#[tauri::command]
pub async fn items_cards(state: State<'_, AppState>, ids: Vec<i64>) -> AppResult<Vec<ItemCard>> {
    with_library(&state, move |library| library.db.with(|conn| cards_by_ids(conn, &ids[..ids.len().min(500)]))).await
}

// ---------------------------------------------------------------------------------------------
// Blurbs for the detailed view (Phase 5)

/// What the detailed view shows under a title: the start of its description, its tags, and a few
/// facts such as "320 pages" or "12 tracks · 48 min".
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Blurb {
    pub id: i64,
    pub description: Option<String>,
    pub tags: Vec<String>,
    pub facts: Vec<String>,
}

const BLURB_CHARS: usize = 420;

/// "1 h 52 min", "48 min" or "3 min".
pub fn length_label(seconds: f64) -> Option<String> {
    if !(seconds >= 30.0) {
        return None;
    }
    let minutes = (seconds / 60.0).round() as i64;
    Some(if minutes >= 60 { format!("{} h {} min", minutes / 60, minutes % 60) } else { format!("{minutes} min") })
}

fn blurb_facts(handler: &str, metadata: &Value, parts: i64, parts_kind: Option<&str>) -> Vec<String> {
    let text = |key: &str| match metadata.get(key) {
        Some(Value::String(s)) if !s.trim().is_empty() => Some(s.trim().to_string()),
        Some(Value::Number(n)) => Some(n.to_string()),
        _ => None,
    };
    let number = |key: &str| metadata.get(key).and_then(|v| v.as_f64().or_else(|| v.as_str().and_then(|s| s.parse().ok())));
    let mut facts = Vec::new();
    match handler {
        "book" | "comic" => {
            if let Some(series) = text("series") {
                facts.push(match text("volume") {
                    Some(volume) => format!("{series} · Vol. {volume}"),
                    None => series,
                });
            }
            if let Some(pages) = number("pageCount").filter(|p| *p > 0.0) {
                facts.push(format!("{} pages", pages as i64));
            }
            if let Some(publisher) = text("publisher") {
                facts.push(publisher);
            }
        }
        "video" => {
            if parts_kind == Some("episode") && parts > 0 {
                facts.push(format!("{parts} episode{}", if parts == 1 { "" } else { "s" }));
            } else if let Some(length) = number("durationSec").and_then(length_label) {
                facts.push(length);
            }
            if let Some(height) = number("height").filter(|h| *h > 0.0) {
                facts.push(match height as i64 {
                    h if h >= 2000 => "4K".into(),
                    h => format!("{h}p"),
                });
            }
        }
        "audio" => {
            // A track (D-027): its length and the album it came from.
            if let Some(length) = number("durationSec").and_then(length_label) {
                facts.push(length);
            }
            if let Some(album) = text("album") {
                facts.push(album);
            }
            if let Some(genre) = text("genre") {
                facts.push(genre);
            }
        }
        _ => {}
    }
    facts
}

pub fn blurbs(conn: &Connection, ids: &[i64]) -> AppResult<Vec<Blurb>> {
    let mut out = Vec::with_capacity(ids.len());
    let mut item = conn.prepare(
        "SELECT i.description, i.metadata, c.handler, \
           (SELECT count(*) FROM parts p WHERE p.item_id = i.id), \
           (SELECT p.kind FROM parts p WHERE p.item_id = i.id LIMIT 1) \
         FROM items i JOIN categories c ON c.id = i.category_id WHERE i.id = ?1",
    )?;
    let mut tags = conn.prepare("SELECT t.name FROM item_tags it JOIN tags t ON t.id = it.tag_id WHERE it.item_id = ?1 ORDER BY t.name COLLATE NOCASE")?;
    for &id in ids.iter().take(200) {
        let row = item
            .query_row([id], |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, Option<String>>(4)?,
                ))
            })
            .optional()?;
        let Some((description, metadata, handler, parts, parts_kind)) = row else { continue };
        let metadata: Value = serde_json::from_str(&metadata).unwrap_or(Value::Null);
        let description = description.map(|d| d.split_whitespace().collect::<Vec<_>>().join(" ")).filter(|d| !d.is_empty()).map(|d| {
            if d.chars().count() <= BLURB_CHARS {
                d
            } else {
                let cut: String = d.chars().take(BLURB_CHARS).collect();
                format!("{}…", cut.trim_end())
            }
        });
        out.push(Blurb {
            id,
            description,
            tags: tags.query_map([id], |row| row.get(0))?.collect::<Result<_, _>>()?,
            facts: blurb_facts(&handler, &metadata, parts, parts_kind.as_deref()),
        });
    }
    Ok(out)
}

#[tauri::command]
pub async fn items_blurbs(state: State<'_, AppState>, ids: Vec<i64>) -> AppResult<Vec<Blurb>> {
    with_library(&state, move |library| library.db.with(|conn| blurbs(conn, &ids))).await
}

// ---------------------------------------------------------------------------------------------
// Dashboard

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Totals {
    pub items: i64,
    pub physical: i64,
    pub digital: i64,
    pub missing_files: i64,
}

/// Artwork shown in a home tile's collage.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TileCover {
    pub key: String,
    pub color: Option<String>,
    pub handler: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Dashboard {
    pub featured: Option<ItemCard>,
    pub continue_items: Vec<ItemCard>,
    /// Films and series in progress (Phase 3).
    pub continue_watching: Vec<ItemCard>,
    /// The next volume of series lately finished (D-050).
    pub next_volumes: Vec<ItemCard>,
    /// What's in Later, newest first (D-062).
    pub later: Vec<ItemCard>,
    /// "Because you liked …" (D-064): an item you rated well or marked favorite lately, and
    /// others of your library like it that you haven't finished.
    pub because: Option<Because>,
    pub recent: Vec<ItemCard>,
    pub recently_opened: Vec<ItemCard>,
    pub favorites: Vec<ItemCard>,
    pub categories: Vec<Category>,
    pub totals: Totals,
    /// Up to three recent covers per category key, plus `all` and `favorites`.
    pub tile_covers: HashMap<String, Vec<TileCover>>,
}

fn tile_covers(conn: &Connection) -> AppResult<HashMap<String, Vec<TileCover>>> {
    let cover = |row: &Row<'_>| -> rusqlite::Result<(String, TileCover)> {
        Ok((row.get(0)?, TileCover { key: row.get(1)?, color: row.get(2)?, handler: row.get(3)? }))
    };
    let mut tiles: HashMap<String, Vec<TileCover>> = HashMap::new();
    let mut newest_per_category: Vec<TileCover> = Vec::new();
    let mut stmt = conn.prepare(
        "SELECT c.key, r.cover_key, r.cover_color, c.handler, r.n FROM \
           (SELECT category_id, cover_key, cover_color, added_at, id, \
              row_number() OVER (PARTITION BY category_id ORDER BY added_at DESC, id DESC) AS n \
            FROM items WHERE cover_key IS NOT NULL) r \
         JOIN categories c ON c.id = r.category_id WHERE r.n <= 3 ORDER BY r.added_at DESC, r.id DESC",
    )?;
    for row in stmt.query_map([], |row| Ok((cover(row)?, row.get::<_, i64>(4)?)))? {
        let ((category, tile), n) = row?;
        if n == 1 && newest_per_category.len() < 3 {
            newest_per_category.push(tile.clone());
        }
        tiles.entry(category).or_default().push(tile);
    }
    // "Everything" shows one cover from each of the most recently used categories.
    tiles.insert("all".into(), newest_per_category);
    let favorites = conn
        .prepare(
            "SELECT 'favorites', i.cover_key, i.cover_color, c.handler FROM items i JOIN categories c ON c.id = i.category_id \
             WHERE i.is_favorite = 1 AND i.cover_key IS NOT NULL ORDER BY i.updated_at DESC, i.id DESC LIMIT 3",
        )?
        .query_map([], cover)?
        .map(|row| row.map(|(_, tile)| tile))
        .collect::<Result<_, _>>()?;
    tiles.insert("favorites".into(), favorites);
    Ok(tiles)
}

/// "Featured today" (Phase 5): one item with artwork, picked anew each local day and the same all
/// day. Items not yet finished come first.
fn featured_of_the_day(conn: &Connection) -> AppResult<Vec<i64>> {
    let day: i64 = conn.query_row("SELECT CAST(julianday('now', 'localtime') AS INTEGER)", [], |row| row.get(0))?;
    for finished in [false, true] {
        let candidates = ids(
            conn,
            &format!(
                "SELECT i.id FROM items i WHERE i.cover_key IS NOT NULL AND EXISTS (SELECT 1 FROM progress pr                  WHERE pr.item_id = i.id AND pr.part_id = 0 AND pr.completed = 1) = {finished} ORDER BY i.id"
            ),
            &[],
        )?;
        if !candidates.is_empty() {
            // SplitMix64 of the day, so consecutive days land far apart.
            let mut z = (day as u64).wrapping_add(0x9E37_79B9_7F4A_7C15);
            z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
            z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
            z ^= z >> 31;
            return Ok(vec![candidates[(z % candidates.len() as u64) as usize]]);
        }
    }
    Ok(Vec::new())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Because {
    pub seed: ItemCard,
    pub items: Vec<ItemCard>,
}

/// Items like `seed` in your own library (D-064), best first: the same series, people, tags,
/// genre or collection, in the same category; finished ones and the seed itself left out.
pub fn similar(conn: &Connection, seed: i64, limit: i64) -> AppResult<Vec<i64>> {
    ids(
        conn,
        &format!(
            "WITH s AS (SELECT id, category_id, collection_id, lower(coalesce(json_extract(metadata, '$.series'), '')) AS series, \
               lower(coalesce(json_extract(metadata, '$.genre'), '')) AS genre FROM items WHERE id = ?1) \
             SELECT i.id FROM items i, s WHERE i.id <> s.id AND i.category_id = s.category_id \
               AND NOT EXISTS (SELECT 1 FROM progress pr WHERE pr.item_id = i.id AND pr.part_id = 0 AND pr.completed = 1) \
             ORDER BY ( \
               (s.series <> '' AND lower(coalesce(json_extract(i.metadata, '$.series'), '')) = s.series) * 4 + \
               (SELECT count(*) FROM item_people a JOIN item_people b ON a.person_id = b.person_id WHERE a.item_id = i.id AND b.item_id = s.id) * 3 + \
               (SELECT count(*) FROM item_tags a JOIN item_tags b ON a.tag_id = b.tag_id WHERE a.item_id = i.id AND b.item_id = s.id) * 2 + \
               (s.genre <> '' AND lower(coalesce(json_extract(i.metadata, '$.genre'), '')) = s.genre) * 2 + \
               (s.collection_id IS NOT NULL AND i.collection_id = s.collection_id) * 1 \
             ) DESC, i.rating IS NULL, i.rating DESC, i.added_at DESC LIMIT {limit}"
        ),
        &[SqlValue::Integer(seed)],
    )
    .and_then(|found| {
        // Only items that share something with the seed.
        let mut keep = Vec::new();
        for id in found {
            let shared: i64 = conn.query_row(
                "SELECT (SELECT count(*) FROM item_people a JOIN item_people b ON a.person_id = b.person_id WHERE a.item_id = ?1 AND b.item_id = ?2) + \
                        (SELECT count(*) FROM item_tags a JOIN item_tags b ON a.tag_id = b.tag_id WHERE a.item_id = ?1 AND b.item_id = ?2) + \
                        (SELECT count(*) FROM items x, items y WHERE x.id = ?1 AND y.id = ?2 AND ( \
                           (trim(coalesce(json_extract(x.metadata, '$.series'), '')) <> '' AND lower(json_extract(x.metadata, '$.series')) = lower(json_extract(y.metadata, '$.series'))) OR \
                           (trim(coalesce(json_extract(x.metadata, '$.genre'), '')) <> '' AND lower(json_extract(x.metadata, '$.genre')) = lower(json_extract(y.metadata, '$.genre'))) OR \
                           (x.collection_id IS NOT NULL AND x.collection_id = y.collection_id)))",
                params![id, seed],
                |row| row.get(0),
            )?;
            if shared > 0 {
                keep.push(id);
            }
        }
        Ok(keep)
    })
}

fn because(conn: &Connection) -> AppResult<Option<Because>> {
    let seeds = ids(
        conn,
        "SELECT id FROM items WHERE rating >= 4 OR is_favorite = 1 ORDER BY updated_at DESC LIMIT 12",
        &[],
    )?;
    for seed in seeds {
        let found = similar(conn, seed, 12)?;
        if found.len() >= 2 {
            let Some(card) = cards_by_ids(conn, &[seed])?.into_iter().next() else { continue };
            return Ok(Some(Because { seed: card, items: cards_by_ids(conn, &found)? }));
        }
    }
    Ok(None)
}

/// What to offer to continue when the app opens (D-068): the book, comic, film or series left
/// halfway most lately, or the game played most lately, whichever is newer, from the last week.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum Resume {
    Item { card: ItemCard },
    Game { id: i64, title: String },
}

pub fn resume(conn: &Connection) -> AppResult<Option<Resume>> {
    let item: Option<(i64, String)> = conn
        .query_row(
            "SELECT pr.item_id, pr.updated_at FROM progress pr JOIN items i ON i.id = pr.item_id JOIN categories c ON c.id = i.category_id              WHERE pr.part_id = 0 AND pr.fraction > 0.01 AND pr.completed = 0 AND c.handler IN ('book', 'comic', 'video')                AND pr.updated_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 days')              ORDER BY pr.updated_at DESC LIMIT 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .ok();
    let game: Option<(i64, String, String)> = conn
        .query_row(
            "SELECT id, title, last_played_at FROM arcade_games WHERE hidden = 0 AND missing = 0 AND last_played_at IS NOT NULL                AND last_played_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 days') ORDER BY last_played_at DESC LIMIT 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .ok();
    match (item, game) {
        (Some((_, at)), Some((id, title, played))) if played > at => Ok(Some(Resume::Game { id, title })),
        (Some((id, _)), _) => Ok(cards_by_ids(conn, &[id])?.into_iter().next().map(|card| Resume::Item { card })),
        (None, Some((id, title, _))) => Ok(Some(Resume::Game { id, title })),
        (None, None) => Ok(None),
    }
}

#[tauri::command]
pub async fn resume_get(state: State<'_, AppState>) -> AppResult<Option<Resume>> {
    with_library(&state, |library| library.db.with(|conn| resume(conn))).await
}

#[tauri::command]
pub async fn dashboard_get(state: State<'_, AppState>) -> AppResult<Dashboard> {
    with_library(&state, |library| {
        library.db.with(|conn| {
            let featured_id = featured_of_the_day(conn)?;
            // Reading and watching are offered apart: books and comics here, video below.
            let in_progress = |video: bool| {
                ids(
                    conn,
                    &format!(
                        "SELECT pr.item_id FROM progress pr JOIN items i ON i.id = pr.item_id JOIN categories c ON c.id = i.category_id \
                         WHERE pr.part_id = 0 AND pr.fraction > 0.01 AND pr.completed = 0 AND (c.handler = 'video') = {video} AND c.key <> 'videos' \
                         ORDER BY pr.updated_at DESC LIMIT 12"
                    ),
                    &[],
                )
            };
            let continue_ids = in_progress(false)?;
            let watching_ids = in_progress(true)?;
            let recent_ids = ids(conn, "SELECT id FROM items ORDER BY added_at DESC, id DESC LIMIT 18", &[])?;
            let opened_ids = ids(
                conn,
                "SELECT id FROM items WHERE last_opened_at IS NOT NULL ORDER BY last_opened_at DESC, id DESC LIMIT 18",
                &[],
            )?;
            let favorite_ids =
                ids(conn, "SELECT id FROM items WHERE is_favorite = 1 ORDER BY updated_at DESC LIMIT 18", &[])?;
            let count = |sql: &str| conn.query_row(sql, [], |row| row.get::<_, i64>(0));
            Ok(Dashboard {
                featured: cards_by_ids(conn, &featured_id)?.into_iter().next(),
                continue_items: cards_by_ids(conn, &continue_ids)?,
                continue_watching: cards_by_ids(conn, &watching_ids)?,
                next_volumes: cards_by_ids(conn, &crate::series::next_after_finished(conn, 8)?)?,
                later: cards_by_ids(conn, &ids(conn, "SELECT item_id FROM later ORDER BY added_at DESC LIMIT 18", &[])?)?,
                because: because(conn)?,
                recent: cards_by_ids(conn, &recent_ids)?,
                recently_opened: cards_by_ids(conn, &opened_ids)?,
                favorites: cards_by_ids(conn, &favorite_ids)?,
                categories: categories(conn)?,
                totals: Totals {
                    items: count("SELECT count(*) FROM items")?,
                    physical: count("SELECT count(DISTINCT item_id) FROM versions WHERE kind = 'physical'")?,
                    digital: count("SELECT count(DISTINCT item_id) FROM versions WHERE kind = 'digital'")?,
                    missing_files: count("SELECT count(*) FROM files WHERE status <> 'ok'")?,
                },
                tile_covers: tile_covers(conn)?,
            })
        })
    })
    .await
}

// ---------------------------------------------------------------------------------------------
// Item details

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Person {
    pub id: i64,
    pub name: String,
    pub role: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileInfo {
    pub id: i64,
    pub path: String,
    pub storage: String,
    pub size: Option<i64>,
    pub status: String,
    pub mime: Option<String>,
    pub part_id: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionInfo {
    pub id: i64,
    pub kind: String,
    pub label: Option<String>,
    pub format: Option<String>,
    pub edition: Option<String>,
    pub condition: Option<String>,
    pub location: Option<String>,
    pub acquired_at: Option<String>,
    pub notes: Option<String>,
    pub files: Vec<FileInfo>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PartInfo {
    pub id: i64,
    pub kind: String,
    pub number: Option<f64>,
    pub title: Option<String>,
    pub duration_ms: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemDetail {
    pub id: i64,
    pub category: String,
    pub category_name: String,
    pub handler: String,
    pub title: String,
    pub subtitle: Option<String>,
    pub year: Option<i64>,
    pub description: Option<String>,
    pub cover_key: Option<String>,
    pub cover_color: Option<String>,
    pub is_favorite: bool,
    pub metadata: Value,
    pub added_at: String,
    pub updated_at: String,
    pub people: Vec<Person>,
    pub versions: Vec<VersionInfo>,
    pub parts: Vec<PartInfo>,
    pub tags: Vec<NamedRef>,
    /// The collections it sits in, from the category root down (empty when it has none).
    pub collection_path: Vec<NamedRef>,
    pub progress: Option<f64>,
    /// Where it was imported from, if from a link (D-028).
    pub online: Option<crate::online::OnlineSource>,
    /// The user's own rating, 1-5 stars, and note (D-049).
    pub rating: Option<i64>,
    pub note: Option<String>,
    /// In Later (D-062).
    pub in_later: bool,
}

#[tauri::command]
pub async fn item_get(state: State<'_, AppState>, id: i64) -> AppResult<ItemDetail> {
    with_library(&state, move |library| library.db.with(|conn| item_detail(conn, library, id))).await
}

fn item_detail(conn: &Connection, library: &Library, id: i64) -> AppResult<ItemDetail> {
    let (collection, mut detail) = conn
        .query_row(
            "SELECT i.id, c.key, c.name, c.handler, i.title, i.subtitle, i.year, i.description, i.cover_key, \
             i.cover_color, i.is_favorite, i.metadata, i.added_at, i.updated_at, \
             (SELECT pr.fraction FROM progress pr WHERE pr.item_id = i.id AND pr.part_id = 0), i.collection_id, i.rating, i.note, \
             EXISTS (SELECT 1 FROM later l WHERE l.item_id = i.id) \
             FROM items i JOIN categories c ON c.id = i.category_id WHERE i.id = ?1",
            [id],
            |row| {
                let metadata: String = row.get(11)?;
                let collection: Option<i64> = row.get(15)?;
                Ok((collection, ItemDetail {
                    id: row.get(0)?,
                    category: row.get(1)?,
                    category_name: row.get(2)?,
                    handler: row.get(3)?,
                    title: row.get(4)?,
                    subtitle: row.get(5)?,
                    year: row.get(6)?,
                    description: row.get(7)?,
                    cover_key: row.get(8)?,
                    cover_color: row.get(9)?,
                    is_favorite: row.get::<_, i64>(10)? != 0,
                    metadata: serde_json::from_str(&metadata).unwrap_or(Value::Null),
                    added_at: row.get(12)?,
                    updated_at: row.get(13)?,
                    progress: row.get(14)?,
                    people: Vec::new(),
                    versions: Vec::new(),
                    parts: Vec::new(),
                    tags: Vec::new(),
                    collection_path: Vec::new(),
                    online: None,
                    rating: row.get(16)?,
                    note: row.get(17)?,
                    in_later: row.get(18)?,
                }))
            },
        )
        .optional()?
        .ok_or_else(|| AppError::msg("This item no longer exists."))?;
    if let Some(collection) = collection {
        detail.collection_path = crate::organize::collection_path(conn, collection)?;
    }
    detail.online = crate::online::source(conn, id)?;

    detail.people = conn
        .prepare(
            "SELECT p.id, p.name, ip.role FROM item_people ip JOIN people p ON p.id = ip.person_id \
             WHERE ip.item_id = ?1 ORDER BY ip.position",
        )?
        .query_map([id], |row| Ok(Person { id: row.get(0)?, name: row.get(1)?, role: row.get(2)? }))?
        .collect::<Result<_, _>>()?;

    detail.parts = conn
        .prepare("SELECT id, kind, number, title, duration_ms FROM parts WHERE item_id = ?1 ORDER BY position")?
        .query_map([id], |row| {
            Ok(PartInfo { id: row.get(0)?, kind: row.get(1)?, number: row.get(2)?, title: row.get(3)?, duration_ms: row.get(4)? })
        })?
        .collect::<Result<_, _>>()?;

    detail.tags = conn
        .prepare("SELECT t.id, t.name FROM item_tags it JOIN tags t ON t.id = it.tag_id WHERE it.item_id = ?1 ORDER BY t.name COLLATE NOCASE")?
        .query_map([id], |row| Ok(NamedRef { id: row.get(0)?, name: row.get(1)? }))?
        .collect::<Result<_, _>>()?;

    let mut versions: Vec<VersionInfo> = conn
        .prepare(
            "SELECT id, kind, label, format, edition, condition, location, acquired_at, notes FROM versions \
             WHERE item_id = ?1 ORDER BY kind DESC, is_primary DESC, id",
        )?
        .query_map([id], |row| {
            Ok(VersionInfo {
                id: row.get(0)?,
                kind: row.get(1)?,
                label: row.get(2)?,
                format: row.get(3)?,
                edition: row.get(4)?,
                condition: row.get(5)?,
                location: row.get(6)?,
                acquired_at: row.get(7)?,
                notes: row.get(8)?,
                files: Vec::new(),
            })
        })?
        .collect::<Result<_, _>>()?;
    let mut files_stmt = conn.prepare(
        "SELECT id, path, storage, size, status, mime, part_id FROM files WHERE version_id = ?1 ORDER BY position",
    )?;
    for version in &mut versions {
        version.files = files_stmt
            .query_map([version.id], |row| {
                let path: String = row.get(1)?;
                let storage: String = row.get(2)?;
                Ok(FileInfo {
                    id: row.get(0)?,
                    path: library.folder.resolve(&path, &storage).display().to_string(),
                    storage,
                    size: row.get(3)?,
                    status: row.get(4)?,
                    mime: row.get(5)?,
                    part_id: row.get(6)?,
                })
            })?
            .collect::<Result<_, _>>()?;
    }
    detail.versions = versions;
    Ok(detail)
}

// ---------------------------------------------------------------------------------------------
// Edits

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersonInput {
    pub name: String,
    pub role: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemEdit {
    pub title: String,
    pub subtitle: Option<String>,
    pub year: Option<i64>,
    pub description: Option<String>,
    pub category: String,
    #[serde(default)]
    pub people: Vec<PersonInput>,
    #[serde(default)]
    pub metadata: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionInput {
    pub id: Option<i64>,
    #[serde(default)]
    pub item_id: i64,
    pub kind: String,
    pub label: Option<String>,
    pub format: Option<String>,
    pub edition: Option<String>,
    pub condition: Option<String>,
    pub location: Option<String>,
    pub acquired_at: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewItem {
    pub item: ItemEdit,
    pub physical: Option<VersionInput>,
}

fn set_people(conn: &Connection, item_id: i64, people: &[PersonInput]) -> AppResult<()> {
    conn.execute("DELETE FROM item_people WHERE item_id = ?1", [item_id])?;
    for (position, person) in people.iter().filter(|p| !p.name.trim().is_empty()).enumerate() {
        let person_id = upsert_person(conn, &person.name)?;
        conn.execute(
            "INSERT OR IGNORE INTO item_people (item_id, person_id, role, position) VALUES (?1, ?2, ?3, ?4)",
            params![item_id, person_id, person.role.trim(), position as i64],
        )?;
    }
    Ok(())
}

fn write_item(conn: &Connection, item_id: Option<i64>, edit: &ItemEdit) -> AppResult<i64> {
    let title = edit.title.trim();
    if title.is_empty() {
        return Err(AppError::msg("A title is required."));
    }
    let category = category_id(conn, &edit.category)?;
    let metadata = if edit.metadata.is_object() { edit.metadata.to_string() } else { "{}".to_string() };
    let subtitle = clean(edit.subtitle.clone());
    let description = clean(edit.description.clone());
    let id = match item_id {
        Some(id) => {
            conn.execute(
                "UPDATE items SET title = ?2, sort_title = ?3, subtitle = ?4, year = ?5, description = ?6, \
                 collection_id = CASE WHEN (SELECT k.category_id FROM collections k WHERE k.id = items.collection_id) = ?7 \
                   THEN collection_id END, \
                 category_id = ?7, metadata = ?8, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?1",
                params![id, title, sort_key(title), subtitle, edit.year, description, category, metadata],
            )?;
            id
        }
        None => {
            conn.execute(
                "INSERT INTO items (category_id, title, sort_title, subtitle, year, description, metadata) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![category, title, sort_key(title), subtitle, edit.year, description, metadata],
            )?;
            conn.last_insert_rowid()
        }
    };
    // Movies & Series covers are always vertical (D-027).
    conn.execute(
        "UPDATE items SET metadata = json_remove(metadata, '$.coverShape') WHERE id = ?1          AND json_extract(metadata, '$.coverShape') = 'landscape' AND category_id = (SELECT id FROM categories WHERE key = 'video')",
        [id],
    )?;
    set_people(conn, id, &edit.people)?;
    reindex(conn, id)?;
    Ok(id)
}

#[tauri::command]
pub async fn item_update(state: State<'_, AppState>, id: i64, edit: ItemEdit) -> AppResult<()> {
    with_library(&state, move |library| {
        library.db.with(|conn| {
            let tx = conn.transaction()?;
            write_item(&tx, Some(id), &edit)?;
            tx.commit()?;
            Ok(())
        })
    })
    .await
}

/// Catalogs an item, typically one owned only physically so far.
#[tauri::command]
pub async fn item_create(state: State<'_, AppState>, item: NewItem) -> AppResult<i64> {
    with_library(&state, move |library| {
        library.db.with(|conn| {
            let tx = conn.transaction()?;
            let id = write_item(&tx, None, &item.item)?;
            if let Some(mut physical) = item.physical {
                physical.item_id = id;
                physical.kind = "physical".into();
                save_version(&tx, &physical)?;
            }
            tx.commit()?;
            Ok(id)
        })
    })
    .await
}

#[tauri::command]
pub async fn item_set_favorite(state: State<'_, AppState>, id: i64, favorite: bool) -> AppResult<()> {
    with_library(&state, move |library| {
        library.db.with(|conn| {
            conn.execute(
                "UPDATE items SET is_favorite = ?2, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?1",
                params![id, favorite],
            )?;
            conn.execute("UPDATE parts SET is_favorite = ?2 WHERE item_id = ?1 AND kind = 'track'", params![id, favorite])?;
            Ok(())
        })
    })
    .await
}

/// Puts an item in Later, or takes it out (D-062); returns whether it's in now.
#[tauri::command]
pub async fn later_set(state: State<'_, AppState>, ids: Vec<i64>, later: bool) -> AppResult<()> {
    with_library(&state, move |library| {
        library.db.with(|conn| {
            let tx = conn.transaction()?;
            for id in &ids {
                if later {
                    tx.execute("INSERT OR IGNORE INTO later (item_id) SELECT id FROM items WHERE id = ?1", [id])?;
                } else {
                    tx.execute("DELETE FROM later WHERE item_id = ?1", [id])?;
                }
            }
            tx.commit()?;
            Ok(())
        })
    })
    .await
}

/// The user's rating (1-5 stars, or none) and note for an item (D-049).
#[tauri::command]
pub async fn item_set_review(state: State<'_, AppState>, id: i64, rating: Option<i64>, note: Option<String>) -> AppResult<()> {
    let rating = rating.filter(|r| (1..=5).contains(r));
    let note = note.map(|n| n.trim().to_string()).filter(|n| !n.is_empty()).map(|n| n.chars().take(10_000).collect::<String>());
    with_library(&state, move |library| {
        library.db.with(|conn| {
            conn.execute(
                "UPDATE items SET rating = ?2, note = ?3, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?1",
                params![id, rating, note],
            )?;
            Ok(())
        })
    })
    .await
}

/// Replaces an item's artwork with an image file the user picked.
#[tauri::command]
pub async fn item_set_cover(state: State<'_, AppState>, id: i64, path: String) -> AppResult<()> {
    with_library(&state, move |library| {
        let bytes = std::fs::read(&path).map_err(|e| AppError::msg(format!("could not read {path}: {e}")))?;
        let art = artwork::store(&library.folder, &bytes)?;
        library.db.with(|conn| {
            conn.execute(
                "UPDATE items SET cover_key = ?2, cover_color = ?3, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?1",
                params![id, art.key, art.color],
            )?;
            Ok(())
        })
    })
    .await
}

/// The same picked image as the artwork of several items at once.
#[tauri::command]
pub async fn items_set_cover(state: State<'_, AppState>, ids: Vec<i64>, path: String) -> AppResult<()> {
    with_library(&state, move |library| {
        let bytes = std::fs::read(&path).map_err(|e| AppError::msg(format!("could not read {path}: {e}")))?;
        let art = artwork::store(&library.folder, &bytes)?;
        library.db.with(|conn| {
            let tx = conn.transaction()?;
            for id in &ids {
                tx.execute(
                    "UPDATE items SET cover_key = ?2, cover_color = ?3, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?1",
                    params![id, art.key, art.color],
                )?;
            }
            tx.commit()?;
            Ok(())
        })
    })
    .await
}

/// A background picture for a film or series page (`metadata.backdropKey`); `None` goes back to
/// the blurred cover.
#[tauri::command]
pub async fn item_set_backdrop(state: State<'_, AppState>, id: i64, path: Option<String>) -> AppResult<()> {
    with_library(&state, move |library| {
        let key = match path {
            Some(path) => {
                let bytes = std::fs::read(&path).map_err(|e| AppError::msg(format!("could not read {path}: {e}")))?;
                Some(artwork::store(&library.folder, &bytes)?.key)
            }
            None => None,
        };
        library.db.with(|conn| {
            conn.execute(
                "UPDATE items SET metadata = CASE WHEN ?2 IS NULL THEN json_remove(metadata, '$.backdropKey') \
                 ELSE json_set(metadata, '$.backdropKey', ?2) END, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?1",
                params![id, key],
            )?;
            Ok(())
        })
    })
    .await
}

fn save_version(conn: &Connection, input: &VersionInput) -> AppResult<i64> {
    let values = (
        clean(input.label.clone()),
        clean(input.format.clone()),
        clean(input.edition.clone()),
        clean(input.condition.clone()),
        clean(input.location.clone()),
        clean(input.acquired_at.clone()),
        clean(input.notes.clone()),
    );
    let id = match input.id {
        Some(id) => {
            conn.execute(
                "UPDATE versions SET label = ?2, format = ?3, edition = ?4, condition = ?5, location = ?6, \
                 acquired_at = ?7, notes = ?8 WHERE id = ?1",
                params![id, values.0, values.1, values.2, values.3, values.4, values.5, values.6],
            )?;
            id
        }
        None => {
            if input.kind != "physical" {
                return Err(AppError::msg("Digital copies are added by importing files."));
            }
            conn.execute(
                "INSERT INTO versions (item_id, kind, label, format, edition, condition, location, acquired_at, notes) \
                 VALUES (?1, 'physical', ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![input.item_id, values.0, values.1, values.2, values.3, values.4, values.5, values.6],
            )?;
            conn.last_insert_rowid()
        }
    };
    conn.execute(
        "UPDATE items SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = (SELECT item_id FROM versions WHERE id = ?1)",
        [id],
    )?;
    Ok(id)
}

#[tauri::command]
pub async fn version_save(state: State<'_, AppState>, version: VersionInput) -> AppResult<i64> {
    with_library(&state, move |library| library.db.with(|conn| save_version(conn, &version))).await
}

/// Removes a copy from the catalog. For digital copies this forgets the file records; the files
/// themselves are never touched here.
#[tauri::command]
pub async fn version_delete(state: State<'_, AppState>, id: i64) -> AppResult<()> {
    with_library(&state, move |library| {
        library.db.with(|conn| {
            conn.execute("DELETE FROM versions WHERE id = ?1", [id])?;
            Ok(())
        })
    })
    .await
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveReport {
    pub removed: usize,
    pub trashed: usize,
    pub errors: Vec<String>,
}

/// Removes items from the library. Files are left alone unless `trash_managed_copies` is set,
/// which the UI only sends after explicit confirmation; even then, only copies inside the library
/// folder are touched, and they go to the Recycle Bin (D-009).
#[tauri::command]
pub async fn item_remove(state: State<'_, AppState>, ids: Vec<i64>, trash_managed_copies: bool) -> AppResult<RemoveReport> {
    with_library(&state, move |library| {
        let managed: Vec<std::path::PathBuf> = library.db.with(|conn| {
            let tx = conn.transaction()?;
            let mut paths = Vec::new();
            {
                let mut select = tx.prepare(
                    "SELECT f.path FROM files f JOIN versions v ON v.id = f.version_id \
                     WHERE v.item_id = ?1 AND f.storage = 'managed'",
                )?;
                for id in &ids {
                    let rows: Vec<String> = select.query_map([id], |row| row.get(0))?.collect::<Result<_, _>>()?;
                    paths.extend(rows.into_iter().map(|p| library.folder.resolve(&p, "managed")));
                    tx.execute("DELETE FROM items_fts WHERE rowid = ?1", [id])?;
                    tx.execute("DELETE FROM items WHERE id = ?1", [id])?;
                }
            }
            tx.commit()?;
            Ok(paths)
        })?;
        let mut report = RemoveReport { removed: ids.len(), trashed: 0, errors: Vec::new() };
        if trash_managed_copies {
            for path in managed.iter().filter(|p| p.starts_with(&library.folder.root) && p.exists()) {
                match trash::delete(path) {
                    Ok(()) => report.trashed += 1,
                    Err(e) => report.errors.push(format!("{}: {e}", path.display())),
                }
            }
        }
        Ok(report)
    })
    .await
}

#[tauri::command]
pub async fn file_reveal(state: State<'_, AppState>, id: i64) -> AppResult<()> {
    with_library(&state, move |library| {
        let (path, storage): (String, String) = library.db.with(|conn| {
            Ok(conn.query_row("SELECT path, storage FROM files WHERE id = ?1", [id], |row| Ok((row.get(0)?, row.get(1)?)))?)
        })?;
        files::reveal(&library.folder.resolve(&path, &storage))
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn collections_take_places_among_items_in_a_custom_order() {
        let mut conn = crate::db::memory();
        let books: i64 = conn.query_row("SELECT id FROM categories WHERE key = 'books'", [], |r| r.get(0)).unwrap();
        for (id, title) in [(1, "A"), (2, "B"), (3, "C")] {
            conn.execute("INSERT INTO items (id, category_id, title, sort_title) VALUES (?1, ?2, ?3, ?3)", params![id, books, title]).unwrap();
        }
        for (id, name) in [(10, "X"), (11, "Y")] {
            conn.execute("INSERT INTO collections (id, category_id, name, sort_name) VALUES (?1, ?2, ?3, ?3)", params![id, books, name]).unwrap();
        }
        let params = QueryParams { category: Some("books".into()), sort: Some("custom".into()), custom: Some("books".into()), ..Default::default() };
        // Never placed: collections first, as before.
        assert_eq!(custom_slots(&conn, &params, &[-10, -11]).unwrap(), [(-10, 0), (-11, 1)]);
        // X between A and B, Y after C.
        set_custom_order(&mut conn, "books", &[1, -10, 2, 3, -11]).unwrap();
        assert_eq!(custom_slots(&conn, &params, &[-10, -11]).unwrap(), [(-10, 1), (-11, 4)]);
        // An order of items alone keeps the collections' places.
        set_custom_order(&mut conn, "books", &[3, 2, 1]).unwrap();
        let items: Vec<i64> = conn.prepare("SELECT item_id FROM custom_order WHERE view = 'books' ORDER BY position").unwrap().query_map([], |r| r.get(0)).unwrap().collect::<Result<_, _>>().unwrap();
        assert_eq!(items, [3, 2, 1]);
        let kept: i64 = conn.query_row("SELECT count(*) FROM custom_order_collections WHERE view = 'books'", [], |r| r.get(0)).unwrap();
        assert_eq!(kept, 2);
    }

    #[test]
    fn fts_query_prefixes_each_word_and_drops_syntax() {
        assert_eq!(fts_query("Moby  dick").as_deref(), Some("\"moby\"* \"dick\"*"));
        assert_eq!(fts_query("\"a\" OR b*").as_deref(), Some("\"a\"* \"or\"* \"b\"*"));
        assert_eq!(fts_query("  -- "), None);
    }

    #[test]
    fn sort_keys_ignore_leading_articles() {
        assert_eq!(sort_key("The Time Machine"), "time machine");
        assert_eq!(sort_key("An Iliad"), "iliad");
        assert_eq!(sort_key("Theater"), "theater");
        assert_eq!(person_sort_name("Mary Wollstonecraft Shelley"), "Shelley, Mary Wollstonecraft");
    }

    #[test]
    fn custom_order_keeps_arranged_items_first_per_view() {
        let mut conn = crate::db::memory();
        let add = |title: &str| {
            conn.execute(
                "INSERT INTO items (category_id, title, sort_title) VALUES ((SELECT id FROM categories WHERE key = 'books'), ?1, ?2)",
                params![title, sort_key(title)],
            )
            .unwrap();
            conn.last_insert_rowid()
        };
        let (a, b, c, d) = (add("Alpha"), add("Bravo"), add("Charlie"), add("Delta"));
        let titles = |conn: &Connection, view: &str| -> Vec<String> {
            let params = QueryParams { category: Some("books".into()), sort: Some("custom".into()), custom: Some(view.into()), limit: 50, ..Default::default() };
            query(conn, &params).unwrap().items.into_iter().map(|card| card.title).collect()
        };
        // Nothing arranged yet: by title.
        assert_eq!(titles(&conn, "books"), ["Alpha", "Bravo", "Charlie", "Delta"]);
        set_custom_order(&mut conn, "books", &[c, a]).unwrap();
        assert_eq!(titles(&conn, "books"), ["Charlie", "Alpha", "Bravo", "Delta"]);
        // Another view keeps its own order; arranging again replaces the old one.
        assert_eq!(titles(&conn, "all"), ["Alpha", "Bravo", "Charlie", "Delta"]);
        set_custom_order(&mut conn, "books", &[d, b, c, a]).unwrap();
        assert_eq!(titles(&conn, "books"), ["Delta", "Bravo", "Charlie", "Alpha"]);
        // Items that are gone are skipped.
        set_custom_order(&mut conn, "books", &[b, 999]).unwrap();
        assert_eq!(titles(&conn, "books")[0], "Bravo");
        assert!(set_custom_order(&mut conn, " ", &[a]).is_err());
        // A cover shape set on an item shows on its card; shapes only go where they fit (D-027).
        conn.execute("INSERT INTO items (category_id, title, sort_title) VALUES ((SELECT id FROM categories WHERE key = 'music'), 'Song', 'song')", []).unwrap();
        let song = conn.last_insert_rowid();
        conn.execute("INSERT INTO items (category_id, title, sort_title) VALUES ((SELECT id FROM categories WHERE key = 'video'), 'Film', 'film')", []).unwrap();
        let film = conn.last_insert_rowid();
        let shape = |conn: &Connection, id: i64| cards_by_ids(conn, &[id]).unwrap()[0].cover_shape.clone();
        let set = |conn: &mut Connection, ids: &[i64], to: Option<&str>| {
            crate::organize::apply_bulk(conn, ids, &[crate::organize::BulkOp::SetCoverShape { shape: to.map(String::from) }]).unwrap()
        };
        // A CD shape for a book and a song together, or a horizontal Movies & Series cover, is refused.
        let refused = |conn: &mut Connection, ids: &[i64], to: &str| {
            crate::organize::apply_bulk(conn, ids, &[crate::organize::BulkOp::SetCoverShape { shape: Some(to.into()) }]).is_err()
        };
        assert!(refused(&mut conn, &[a, song], "disc"));
        assert!(refused(&mut conn, &[film], "landscape"));
        set(&mut conn, &[song], Some("disc"));
        assert_eq!((shape(&conn, a), shape(&conn, song).as_deref(), shape(&conn, film)), (None, Some("disc"), None));
        set(&mut conn, &[song], None);
        assert_eq!(shape(&conn, song), None);
        assert!(crate::organize::apply_bulk(&mut conn, &[a], &[crate::organize::BulkOp::SetCoverShape { shape: Some("star".into()) }]).is_err());
    }
    #[test]
    fn resume_offers_the_newest_unfinished_thing() {
        let conn = crate::db::memory();
        assert!(resume(&conn).unwrap().is_none());
        conn.execute("INSERT INTO items (category_id, title, sort_title) VALUES ((SELECT id FROM categories WHERE key = 'books'), 'Dune', 'dune')", []).unwrap();
        conn.execute("INSERT INTO progress (item_id, part_id, fraction, updated_at) VALUES (1, 0, 0.4, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hours'))", []).unwrap();
        assert!(matches!(resume(&conn).unwrap(), Some(Resume::Item { card }) if card.id == 1));
        conn.execute("INSERT INTO arcade_games (path, platform, title, sort_title, last_played_at) VALUES ('/g.iso', 'wii', 'Game', 'game', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))", []).unwrap();
        assert!(matches!(resume(&conn).unwrap(), Some(Resume::Game { title, .. }) if title == "Game"), "the game is newer");
        conn.execute("UPDATE arcade_games SET last_played_at = '2000-01-01T00:00:00.000Z'", []).unwrap();
        conn.execute("UPDATE progress SET completed = 1", []).unwrap();
        assert!(resume(&conn).unwrap().is_none(), "finished, and the game is too old");
    }

    #[test]
    fn similar_items_share_people_or_series() {
        let conn = crate::db::memory();
        let books = "(SELECT id FROM categories WHERE key = 'books')";
        for (title, series) in [("Dune", "Dune"), ("Dune Messiah", "Dune"), ("Other", ""), ("By her", "")] {
            conn.execute(&format!("INSERT INTO items (category_id, title, sort_title, metadata) VALUES ({books}, ?1, ?1, json_object('series', ?2))"), params![title, series]).unwrap();
        }
        conn.execute("INSERT INTO people (name, sort_name) VALUES ('Ann', 'ann')", []).unwrap();
        let ann = conn.last_insert_rowid();
        for item in [1, 4] {
            conn.execute("INSERT INTO item_people (item_id, person_id, role, position) VALUES (?1, ?2, 'author', 0)", params![item, ann]).unwrap();
        }
        let found = similar(&conn, 1, 10).unwrap();
        assert!(found.contains(&2), "same series");
        assert!(found.contains(&4), "same author");
        assert!(!found.contains(&3), "nothing shared");
    }

}

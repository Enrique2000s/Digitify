//! The user's own categories and custom fields (D-004, D-005), and the order and visibility of
//! all categories. Built-in categories can be renamed, given another icon or custom fields,
//! hidden and reordered, but not deleted or switched to another kind of media.

use rusqlite::{params, params_from_iter, types::Value as SqlValue, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::State;

use crate::error::{AppError, AppResult};
use crate::library::{category_id, reindex, with_library};
use crate::organize::clean_name;
use crate::AppState;

/// Icon names the UI can draw (see `components/common.tsx`).
pub const ICONS: &[&str] = &[
    "book", "comic", "manga", "film", "music", "palette", "folder", "gamepad", "disc", "camera", "tv", "newspaper",
    "graduation", "map", "puzzle", "mic", "image", "sparkles", "trophy", "box", "play",
];
const HANDLERS: &[&str] = &["book", "comic", "video", "audio", "generic"];
const FIELD_KINDS: &[&str] = &["text", "longtext", "number", "date", "rating", "boolean", "choice", "url"];
/// Library scopes that are not categories (`/library/all`, `/library/favorites`).
const RESERVED_KEYS: &[&str] = &["all", "favorites"];

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldDef {
    /// Where the value lives: `metadata.custom[key]` on each item.
    pub key: String,
    pub label: String,
    pub kind: String,
    /// For `choice` fields.
    pub choices: Vec<String>,
}

pub fn fields_for(conn: &Connection, category_id: i64) -> AppResult<Vec<FieldDef>> {
    let rows = conn
        .prepare("SELECT key, label, kind, options FROM field_definitions WHERE category_id = ?1 ORDER BY sort_order, id")?
        .query_map([category_id], |row| {
            let options: String = row.get(3)?;
            let choices = serde_json::from_str::<Value>(&options)
                .ok()
                .and_then(|options| options.get("choices").and_then(Value::as_array).cloned())
                .unwrap_or_default()
                .into_iter()
                .filter_map(|choice| choice.as_str().map(str::to_string))
                .collect();
            Ok(FieldDef { key: row.get(0)?, label: row.get(1)?, kind: row.get(2)?, choices })
        })?
        .collect::<Result<_, _>>()?;
    Ok(rows)
}

/// A URL-safe key from a name: "Vinyl & Cassettes" → "vinyl-cassettes", "Películas" → "peliculas".
pub fn slug(text: &str, fallback: &str) -> String {
    let mut slug = String::new();
    for c in text.chars().flat_map(char::to_lowercase) {
        let c = match c {
            'á' | 'à' | 'ä' | 'â' | 'ã' | 'å' => 'a',
            'é' | 'è' | 'ë' | 'ê' => 'e',
            'í' | 'ì' | 'ï' | 'î' => 'i',
            'ó' | 'ò' | 'ö' | 'ô' | 'õ' | 'ø' => 'o',
            'ú' | 'ù' | 'ü' | 'û' => 'u',
            'ñ' => 'n',
            'ç' => 'c',
            other => other,
        };
        if c.is_ascii_alphanumeric() {
            slug.push(c);
        } else if !slug.is_empty() && !slug.ends_with('-') {
            slug.push('-');
        }
    }
    let slug: String = slug.trim_end_matches('-').chars().take(40).collect();
    let slug = slug.trim_end_matches('-').to_string();
    if slug.is_empty() { fallback.to_string() } else { slug }
}

/// `base`, or `base-2`, `base-3`… whichever `taken` says is free.
fn unique(base: &str, taken: impl Fn(&str) -> AppResult<bool>) -> AppResult<String> {
    if !taken(base)? {
        return Ok(base.to_string());
    }
    for n in 2.. {
        let candidate = format!("{base}-{n}");
        if !taken(&candidate)? {
            return Ok(candidate);
        }
    }
    unreachable!()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldInput {
    /// Present for fields that already exist, so their values stay attached.
    pub key: Option<String>,
    pub label: String,
    pub kind: String,
    #[serde(default)]
    pub choices: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryInput {
    pub name: String,
    pub icon: String,
    /// The kind of media, only when creating: a category's kind never changes afterwards.
    pub handler: Option<String>,
    /// `ltr` or `rtl`, for comics.
    pub reading_direction: Option<String>,
    #[serde(default)]
    pub fields: Vec<FieldInput>,
}

fn checked_name(conn: &Connection, name: &str, except: Option<i64>) -> AppResult<String> {
    let name = clean_name(name, 40).ok_or_else(|| AppError::msg("A category needs a name."))?;
    let taken: bool = conn.query_row(
        "SELECT EXISTS (SELECT 1 FROM categories WHERE name = ?1 COLLATE NOCASE AND id IS NOT ?2)",
        params![name, except],
        |row| row.get(0),
    )?;
    if taken {
        return Err(AppError::msg(format!("There's already a category called “{name}”.")));
    }
    Ok(name)
}

fn checked_icon(icon: &str) -> &str {
    if ICONS.contains(&icon) { icon } else { "folder" }
}

fn save_fields(conn: &Connection, category: i64, fields: &[FieldInput]) -> AppResult<()> {
    if fields.len() > 30 {
        return Err(AppError::msg("A category can have up to 30 custom fields."));
    }
    let existing: Vec<String> = fields_for(conn, category)?.into_iter().map(|field| field.key).collect();
    let mut kept: Vec<String> = Vec::new();
    for (position, field) in fields.iter().enumerate() {
        let label = clean_name(&field.label, 40).ok_or_else(|| AppError::msg("Every custom field needs a name."))?;
        if !FIELD_KINDS.contains(&field.kind.as_str()) {
            return Err(AppError::msg(format!("Unknown field type “{}”.", field.kind)));
        }
        let mut choices: Vec<String> = Vec::new();
        for choice in field.choices.iter().filter_map(|choice| clean_name(choice, 60)) {
            if !choices.iter().any(|c| c.eq_ignore_ascii_case(&choice)) {
                choices.push(choice);
            }
        }
        if field.kind == "choice" && choices.is_empty() {
            return Err(AppError::msg(format!("“{label}” needs at least one choice.")));
        }
        let key = match &field.key {
            Some(key) if existing.contains(key) && !kept.contains(key) => key.clone(),
            _ => unique(&slug(&label, "field"), |candidate| {
                Ok(existing.iter().chain(kept.iter()).any(|key| key == candidate))
            })?,
        };
        conn.execute(
            "INSERT INTO field_definitions (category_id, key, label, kind, options, sort_order) VALUES (?1, ?2, ?3, ?4, ?5, ?6) \
             ON CONFLICT(category_id, key) DO UPDATE SET label = excluded.label, kind = excluded.kind, \
             options = excluded.options, sort_order = excluded.sort_order",
            params![category, key, label, field.kind, json!({ "choices": choices }).to_string(), position as i64],
        )?;
        kept.push(key);
    }
    // Values of removed fields stay in each item's metadata, so restoring a field brings them back.
    let mut args: Vec<SqlValue> = vec![SqlValue::Integer(category)];
    args.extend(kept.iter().cloned().map(SqlValue::Text));
    let keep = if kept.is_empty() { String::new() } else { format!(" AND key NOT IN ({})", vec!["?"; kept.len()].join(",")) };
    conn.execute(&format!("DELETE FROM field_definitions WHERE category_id = ?1{keep}"), params_from_iter(args.iter()))?;
    Ok(())
}

fn reading_direction(input: &CategoryInput) -> &str {
    if input.reading_direction.as_deref() == Some("rtl") { "rtl" } else { "ltr" }
}

#[tauri::command]
pub async fn category_create(state: State<'_, AppState>, category: CategoryInput) -> AppResult<String> {
    with_library(&state, move |library| library.db.with(|conn| create(conn, &category))).await
}

pub fn create(conn: &mut Connection, input: &CategoryInput) -> AppResult<String> {
    let tx = conn.transaction()?;
    let name = checked_name(&tx, &input.name, None)?;
    let handler = input.handler.as_deref().filter(|h| HANDLERS.contains(h)).ok_or_else(|| AppError::msg("Choose what kind of media it holds."))?;
    let key = unique(&slug(&name, "category"), |candidate| {
        if RESERVED_KEYS.contains(&candidate) {
            return Ok(true);
        }
        Ok(tx.query_row("SELECT EXISTS (SELECT 1 FROM categories WHERE key = ?1)", [candidate], |row| row.get(0))?)
    })?;
    let settings = if handler == "comic" { json!({ "readingDirection": reading_direction(input) }) } else { json!({}) };
    tx.execute(
        "INSERT INTO categories (key, name, icon, handler, sort_order, settings) \
         VALUES (?1, ?2, ?3, ?4, (SELECT COALESCE(max(sort_order), 0) + 1 FROM categories), ?5)",
        params![key, name, checked_icon(&input.icon), handler, settings.to_string()],
    )?;
    save_fields(&tx, tx.last_insert_rowid(), &input.fields)?;
    tx.commit()?;
    Ok(key)
}

#[tauri::command]
pub async fn category_update(state: State<'_, AppState>, key: String, category: CategoryInput) -> AppResult<()> {
    with_library(&state, move |library| library.db.with(|conn| update(conn, &key, &category))).await
}

pub fn update(conn: &mut Connection, key: &str, input: &CategoryInput) -> AppResult<()> {
    let tx = conn.transaction()?;
    let id = category_id(&tx, key)?;
    let (old_name, handler): (String, String) =
        tx.query_row("SELECT name, handler FROM categories WHERE id = ?1", [id], |row| Ok((row.get(0)?, row.get(1)?)))?;
    let name = checked_name(&tx, &input.name, Some(id))?;
    tx.execute("UPDATE categories SET name = ?2, icon = ?3 WHERE id = ?1", params![id, name, checked_icon(&input.icon)])?;
    if handler == "comic" {
        tx.execute(
            "UPDATE categories SET settings = json_set(settings, '$.readingDirection', ?2) WHERE id = ?1",
            params![id, reading_direction(input)],
        )?;
    }
    save_fields(&tx, id, &input.fields)?;
    if name != old_name {
        // The category name is part of each item's search entry.
        let ids: Vec<i64> = tx.prepare("SELECT id FROM items WHERE category_id = ?1")?.query_map([id], |row| row.get(0))?.collect::<Result<_, _>>()?;
        for item in ids {
            reindex(&tx, item)?;
        }
    }
    tx.commit()?;
    Ok(())
}

/// Deletes one of the user's categories. Its items and collections move to `move_to` first.
#[tauri::command]
pub async fn category_delete(state: State<'_, AppState>, key: String, move_to: Option<String>) -> AppResult<()> {
    with_library(&state, move |library| library.db.with(|conn| delete(conn, &key, move_to.as_deref()))).await
}

pub fn delete(conn: &mut Connection, key: &str, move_to: Option<&str>) -> AppResult<()> {
    let tx = conn.transaction()?;
    let (id, builtin): (i64, bool) = tx
        .query_row("SELECT id, is_builtin FROM categories WHERE key = ?1", [key], |row| Ok((row.get(0)?, row.get::<_, i64>(1)? != 0)))
        .optional()?
        .ok_or_else(|| AppError::msg("That category no longer exists."))?;
    if builtin {
        return Err(AppError::msg("Built-in categories can't be deleted, but you can hide them."));
    }
    let items: Vec<i64> = tx.prepare("SELECT id FROM items WHERE category_id = ?1")?.query_map([id], |row| row.get(0))?.collect::<Result<_, _>>()?;
    if !items.is_empty() {
        let target = move_to.ok_or_else(|| AppError::msg(format!("Choose where its {} items should go.", items.len())))?;
        let target = category_id(&tx, target)?;
        if target == id {
            return Err(AppError::msg("Choose a different category for its items."));
        }
        tx.execute("UPDATE collections SET category_id = ?2 WHERE category_id = ?1", params![id, target])?;
        tx.execute("UPDATE items SET category_id = ?2 WHERE category_id = ?1", params![id, target])?;
        for item in &items {
            reindex(&tx, *item)?;
        }
    }
    tx.execute("DELETE FROM categories WHERE id = ?1", [id])?;
    tx.commit()?;
    Ok(())
}

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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use crate::library::{categories, sort_key};

    fn input(name: &str, handler: Option<&str>, fields: Vec<FieldInput>) -> CategoryInput {
        CategoryInput { name: name.into(), icon: "gamepad".into(), handler: handler.map(str::to_string), reading_direction: None, fields }
    }

    fn field(key: Option<&str>, label: &str, kind: &str, choices: &[&str]) -> FieldInput {
        FieldInput { key: key.map(str::to_string), label: label.into(), kind: kind.into(), choices: choices.iter().map(|c| c.to_string()).collect() }
    }

    #[test]
    fn slugs_are_url_safe() {
        assert_eq!(slug("Vinyl & Cassettes", "x"), "vinyl-cassettes");
        assert_eq!(slug("  Películas de niñez ", "x"), "peliculas-de-ninez");
        assert_eq!(slug("ゲーム", "category"), "category");
    }

    #[test]
    fn custom_categories_keep_field_keys_and_move_items_when_deleted() {
        let mut conn = db::memory();
        let key = create(
            &mut conn,
            &input("Board Games", Some("generic"), vec![field(None, "Players", "number", &[]), field(None, "Box condition", "choice", &["Mint", "Worn", "mint"])]),
        )
        .unwrap();
        assert_eq!(key, "board-games");
        assert_eq!(create(&mut conn, &input("board games", Some("generic"), vec![])).unwrap_err().to_string(), "There's already a category called “board games”.");
        assert_eq!(create(&mut conn, &input("All", Some("generic"), vec![])).unwrap(), "all-2");

        let found = categories(&conn).unwrap().into_iter().find(|c| c.key == key).unwrap();
        assert_eq!(found.fields.iter().map(|f| f.key.as_str()).collect::<Vec<_>>(), ["players", "box-condition"]);
        assert_eq!(found.fields[1].choices, ["Mint", "Worn"]);

        // Renaming a field keeps its key; a new field with the same label gets a fresh one.
        update(&mut conn, &key, &input("Tabletop", None, vec![field(Some("players"), "Number of players", "number", &[]), field(None, "Players", "text", &[])])).unwrap();
        let found = categories(&conn).unwrap().into_iter().find(|c| c.key == key).unwrap();
        assert_eq!(found.name, "Tabletop");
        assert_eq!(found.fields.iter().map(|f| (f.key.as_str(), f.label.as_str())).collect::<Vec<_>>(), [("players", "Number of players"), ("players-2", "Players")]);

        conn.execute(
            "INSERT INTO items (category_id, title, sort_title) VALUES ((SELECT id FROM categories WHERE key = ?1), 'Catan', ?2)",
            params![key, sort_key("Catan")],
        )
        .unwrap();
        assert!(delete(&mut conn, &key, None).is_err());
        assert!(delete(&mut conn, "books", None).is_err());
        delete(&mut conn, &key, Some("books")).unwrap();
        let home: String = conn.query_row("SELECT c.key FROM items i JOIN categories c ON c.id = i.category_id WHERE i.title = 'Catan'", [], |row| row.get(0)).unwrap();
        assert_eq!(home, "books");
    }
}

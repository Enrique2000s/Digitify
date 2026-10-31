//! Smart shelves (Phase 5, D-023): shelves that fill themselves from rules such as "Manga, not
//! started" or "added in the last 30 days". The rules live in the shelf's `settings` as
//! `{"rules": …}` and turn into one SQL condition on `items i`, with every value bound.

use rusqlite::types::Value as SqlValue;
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::error::{AppError, AppResult};
use crate::library::{with_library, CREATOR_SORT};
use crate::AppState;

pub const MAX_CONDITIONS: usize = 20;
const MAX_LIMIT: i64 = 10_000;

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SmartRules {
    /// Any one condition is enough (otherwise every condition must match).
    pub any: bool,
    pub conditions: Vec<Condition>,
    /// Keep only this many: the first ones in `sort` order ("the 20 most recently added").
    pub limit: Option<i64>,
    /// The shelf's order: `title` (default), `added`, `opened`, `year` or `creator`.
    pub sort: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Condition {
    pub field: String,
    pub op: String,
    #[serde(default)]
    pub value: String,
    /// The end of a "between" range.
    #[serde(default)]
    pub value2: Option<String>,
}

const PHYSICAL: &str = "EXISTS (SELECT 1 FROM versions v WHERE v.item_id = i.id AND v.kind = 'physical')";
const DIGITAL: &str = "EXISTS (SELECT 1 FROM versions v WHERE v.item_id = i.id AND v.kind = 'digital')";
const STARTED: &str = "EXISTS (SELECT 1 FROM progress pr WHERE pr.item_id = i.id AND pr.part_id = 0 AND (pr.fraction > 0.01 OR pr.completed = 1))";

fn bind(args: &mut Vec<SqlValue>, value: SqlValue) -> String {
    args.push(value);
    format!("?{}", args.len())
}

/// `%text%` (or `text%`) for LIKE, with LIKE's own characters escaped.
fn like(text: &str, prefix: bool) -> String {
    let escaped = text.trim().replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_");
    if prefix {
        format!("{escaped}%")
    } else {
        format!("%{escaped}%")
    }
}

fn number(text: &str, what: &str) -> AppResult<i64> {
    text.trim().parse::<i64>().map_err(|_| AppError::msg(format!("“{}” isn't a {what}.", text.trim())))
}

fn days(text: &str) -> AppResult<String> {
    let n = number(text, "number of days")?;
    if !(1..=36_500).contains(&n) {
        return Err(AppError::msg("The number of days must be between 1 and 36,500."));
    }
    Ok(format!("-{n} days"))
}

fn text(value: &str, what: &str) -> AppResult<String> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > 200 {
        return Err(AppError::msg(format!("A rule about the {what} needs something to look for.")));
    }
    Ok(value.to_string())
}

/// One condition as SQL. Unknown fields or operators, and values that don't fit, are errors.
fn condition(c: &Condition, args: &mut Vec<SqlValue>) -> AppResult<String> {
    let negate = |sql: String, not: bool| if not { format!("NOT {sql}") } else { sql };
    Ok(match (c.field.as_str(), c.op.as_str()) {
        ("category", op @ ("is" | "isNot")) => {
            let key = bind(args, SqlValue::Text(text(&c.value, "category")?));
            negate(format!("(i.category_id IN (SELECT id FROM categories WHERE key = {key}))"), op == "isNot")
        }
        ("type", op @ ("is" | "isNot")) => {
            if !["book", "comic", "video", "audio"].contains(&c.value.as_str()) {
                return Err(AppError::msg("That isn't a kind of media."));
            }
            let handler = bind(args, SqlValue::Text(c.value.clone()));
            negate(format!("(i.category_id IN (SELECT id FROM categories WHERE handler = {handler}))"), op == "isNot")
        }
        ("tag", op @ ("has" | "hasNot")) => {
            let name = bind(args, SqlValue::Text(text(&c.value, "tag")?));
            negate(
                format!("EXISTS (SELECT 1 FROM item_tags it JOIN tags t ON t.id = it.tag_id WHERE it.item_id = i.id AND t.name = {name} COLLATE NOCASE)"),
                op == "hasNot",
            )
        }
        ("year", "is" | "before" | "after") => {
            let year = bind(args, SqlValue::Integer(number(&c.value, "year")?));
            let op = match c.op.as_str() {
                "is" => "=",
                "before" => "<",
                _ => ">",
            };
            format!("(i.year {op} {year})")
        }
        ("year", "between") => {
            let from = number(&c.value, "year")?;
            let to = number(c.value2.as_deref().unwrap_or_default(), "year")?;
            let (from, to) = (from.min(to), from.max(to));
            let (from, to) = (bind(args, SqlValue::Integer(from)), bind(args, SqlValue::Integer(to)));
            format!("(i.year BETWEEN {from} AND {to})")
        }
        ("creator", op @ ("contains" | "notContains")) => {
            let pattern = bind(args, SqlValue::Text(like(&text(&c.value, "creator")?, false)));
            negate(
                format!("EXISTS (SELECT 1 FROM item_people ip JOIN people p ON p.id = ip.person_id WHERE ip.item_id = i.id AND p.name LIKE {pattern} ESCAPE '\\')"),
                op == "notContains",
            )
        }
        ("title", op @ ("contains" | "startsWith" | "notContains")) => {
            let pattern = bind(args, SqlValue::Text(like(&text(&c.value, "title")?, op == "startsWith")));
            negate(format!("(i.title LIKE {pattern} ESCAPE '\\')"), op == "notContains")
        }
        ("format", op @ ("is" | "isNot")) => {
            let format = bind(args, SqlValue::Text(text(&c.value, "format")?.to_lowercase()));
            negate(format!("EXISTS (SELECT 1 FROM versions v WHERE v.item_id = i.id AND lower(v.format) = {format})"), op == "isNot")
        }
        ("favorite", "is") => match c.value.as_str() {
            "yes" => "(i.is_favorite = 1)".into(),
            "no" => "(i.is_favorite = 0)".into(),
            _ => return Err(AppError::msg("A favorites rule is either yes or no.")),
        },
        ("progress", "is") => match c.value.as_str() {
            "notStarted" => format!("NOT {STARTED}"),
            "inProgress" => "EXISTS (SELECT 1 FROM progress pr WHERE pr.item_id = i.id AND pr.part_id = 0 AND pr.fraction > 0.01 AND pr.completed = 0)".into(),
            "finished" => "EXISTS (SELECT 1 FROM progress pr WHERE pr.item_id = i.id AND pr.part_id = 0 AND pr.completed = 1)".into(),
            _ => return Err(AppError::msg("That isn't a reading or watching state.")),
        },
        ("added", op @ ("withinDays" | "olderThanDays")) => {
            let since = bind(args, SqlValue::Text(days(&c.value)?));
            let cmp = if op == "withinDays" { ">=" } else { "<" };
            format!("(i.added_at {cmp} strftime('%Y-%m-%dT%H:%M:%fZ', 'now', {since}))")
        }
        ("opened", "withinDays") => {
            let since = bind(args, SqlValue::Text(days(&c.value)?));
            format!("(i.last_opened_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', {since}))")
        }
        ("opened", "never") => "(i.last_opened_at IS NULL)".into(),
        ("ownership", "is") => match c.value.as_str() {
            "physical" => PHYSICAL.into(),
            "digital" => DIGITAL.into(),
            "physicalOnly" => format!("({PHYSICAL} AND NOT {DIGITAL})"),
            "digitalOnly" => format!("({DIGITAL} AND NOT {PHYSICAL})"),
            _ => return Err(AppError::msg("That isn't a kind of ownership.")),
        },
        ("collection", op @ ("in" | "notIn")) => {
            let id = bind(args, SqlValue::Integer(number(&c.value, "collection")?));
            negate(
                format!(
                    "(i.collection_id IS NOT NULL AND i.collection_id IN (WITH RECURSIVE subtree(id) AS (SELECT {id} UNION ALL \
                     SELECT c.id FROM collections c JOIN subtree s ON c.parent_id = s.id) SELECT id FROM subtree))"
                ),
                op == "notIn",
            )
        }
        _ => return Err(AppError::msg(format!("Digitify doesn't know the rule “{} {}”.", c.field, c.op))),
    })
}

/// The ORDER BY for a smart shelf's sort.
pub fn order(sort: Option<&str>) -> String {
    match sort {
        Some("added") => "i.added_at DESC, i.id DESC".into(),
        Some("opened") => "i.last_opened_at IS NULL, i.last_opened_at DESC, i.id DESC".into(),
        Some("year") => "i.year IS NULL, i.year DESC, i.sort_title".into(),
        Some("creator") => format!("{CREATOR_SORT} IS NULL, {CREATOR_SORT}, i.sort_title"),
        _ => "i.sort_title, i.id".into(),
    }
}

impl SmartRules {
    /// Checks every rule, so a saved shelf always works.
    pub fn validate(&self) -> AppResult<()> {
        if self.conditions.len() > MAX_CONDITIONS {
            return Err(AppError::msg(format!("A smart shelf can have up to {MAX_CONDITIONS} rules.")));
        }
        if let Some(limit) = self.limit {
            if !(1..=MAX_LIMIT).contains(&limit) {
                return Err(AppError::msg("“Only the first …” must be between 1 and 10,000."));
            }
        }
        if !matches!(self.sort.as_deref(), None | Some("title" | "added" | "opened" | "year" | "creator")) {
            return Err(AppError::msg("That isn't a way to sort."));
        }
        let mut args = Vec::new();
        for c in &self.conditions {
            condition(c, &mut args)?;
        }
        Ok(())
    }

    /// The SQL condition on `items i`, binding its values after those already in `args`. A rule that
    /// no longer makes sense matches nothing rather than everything.
    pub fn sql(&self, args: &mut Vec<SqlValue>) -> String {
        let parts: Vec<String> = self.conditions.iter().map(|c| condition(c, args).unwrap_or_else(|_| "0".into())).collect();
        let combined = if parts.is_empty() { "1".to_string() } else { parts.join(if self.any { " OR " } else { " AND " }) };
        match self.limit.filter(|limit| *limit > 0) {
            Some(limit) => format!(
                "i.id IN (SELECT i.id FROM items i WHERE ({combined}) ORDER BY {} LIMIT {})",
                order(self.sort.as_deref()),
                limit.min(MAX_LIMIT)
            ),
            None => format!("({combined})"),
        }
    }
}

/// A shelf's rules, if it's a smart shelf.
pub fn rules_of(conn: &Connection, shelf: i64) -> AppResult<Option<SmartRules>> {
    let settings: Option<String> = conn.query_row("SELECT settings FROM shelves WHERE id = ?1", [shelf], |row| row.get(0)).optional()?;
    Ok(settings.and_then(|s| parse(&s)))
}

pub fn parse(settings: &str) -> Option<SmartRules> {
    serde_json::from_str::<serde_json::Value>(settings).ok()?.get("rules").and_then(|rules| serde_json::from_value(rules.clone()).ok())
}

/// How many items rules match, for the editor's live count. Errors explain a rule that doesn't fit.
pub fn count(conn: &Connection, rules: &SmartRules) -> AppResult<i64> {
    rules.validate()?;
    let mut args = Vec::new();
    let sql = rules.sql(&mut args);
    Ok(conn.query_row(&format!("SELECT count(*) FROM items i WHERE {sql}"), rusqlite::params_from_iter(args.iter()), |row| row.get(0))?)
}

#[tauri::command]
pub async fn smart_count(state: State<'_, AppState>, rules: SmartRules) -> AppResult<i64> {
    with_library(&state, move |library| library.db.with(|conn| count(conn, &rules))).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use rusqlite::params;

    fn item(conn: &Connection, category: &str, title: &str, year: Option<i64>) -> i64 {
        conn.execute(
            "INSERT INTO items (category_id, title, sort_title, year) VALUES ((SELECT id FROM categories WHERE key = ?1), ?2, ?2, ?3)",
            params![category, title, year],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    fn rule(field: &str, op: &str, value: &str) -> Condition {
        Condition { field: field.into(), op: op.into(), value: value.into(), value2: None }
    }

    fn matching(conn: &Connection, rules: &SmartRules) -> Vec<String> {
        let mut args = Vec::new();
        let sql = rules.sql(&mut args);
        conn.prepare(&format!("SELECT i.title FROM items i WHERE {sql} ORDER BY {}", order(rules.sort.as_deref())))
            .unwrap()
            .query_map(rusqlite::params_from_iter(args.iter()), |row| row.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap()
    }

    #[test]
    fn rules_select_items() {
        let conn = db::memory();
        let a = item(&conn, "manga", "Akira", Some(1982));
        let b = item(&conn, "manga", "Berserk", Some(1989));
        let c = item(&conn, "books", "Dune", Some(1965));
        item(&conn, "video", "Alien", Some(1979));
        conn.execute("UPDATE items SET is_favorite = 1 WHERE id = ?1", [c]).unwrap();
        conn.execute("INSERT INTO tags (name) VALUES ('Classic')", []).unwrap();
        conn.execute("INSERT INTO item_tags (item_id, tag_id) VALUES (?1, 1), (?2, 1)", params![a, c]).unwrap();
        conn.execute("INSERT INTO progress (item_id, part_id, fraction, completed) VALUES (?1, 0, 0.4, 0)", [b]).unwrap();
        conn.execute("INSERT INTO versions (item_id, kind, format) VALUES (?1, 'physical', 'Paperback')", [c]).unwrap();

        let all = |conditions: Vec<Condition>| SmartRules { conditions, ..Default::default() };
        assert_eq!(matching(&conn, &all(vec![rule("category", "is", "manga")])), ["Akira", "Berserk"]);
        assert_eq!(matching(&conn, &all(vec![rule("category", "isNot", "manga"), rule("year", "before", "1970")])), ["Dune"]);
        assert_eq!(matching(&conn, &all(vec![rule("tag", "has", "classic")])), ["Akira", "Dune"]);
        assert_eq!(matching(&conn, &all(vec![rule("progress", "is", "inProgress")])), ["Berserk"]);
        assert_eq!(matching(&conn, &all(vec![rule("progress", "is", "notStarted"), rule("type", "is", "comic")])), ["Akira"]);
        assert_eq!(matching(&conn, &all(vec![rule("favorite", "is", "yes")])), ["Dune"]);
        assert_eq!(matching(&conn, &all(vec![rule("format", "is", "paperback")])), ["Dune"]);
        assert_eq!(matching(&conn, &all(vec![rule("ownership", "is", "physicalOnly")])), ["Dune"]);
        assert_eq!(matching(&conn, &all(vec![rule("title", "startsWith", "A")])), ["Akira", "Alien"]);
        assert_eq!(matching(&conn, &all(vec![rule("added", "withinDays", "7")])).len(), 4);
        assert_eq!(matching(&conn, &all(vec![rule("opened", "never", "")])).len(), 4);
        let between = Condition { value2: Some("1975".into()), ..rule("year", "between", "1985") };
        assert_eq!(matching(&conn, &all(vec![between])), ["Akira", "Alien"]);
        // Any one rule, a limit and an order.
        let any = SmartRules { any: true, conditions: vec![rule("year", "is", "1965"), rule("year", "is", "1989")], ..Default::default() };
        assert_eq!(matching(&conn, &any), ["Berserk", "Dune"]);
        let newest = SmartRules { limit: Some(2), sort: Some("year".into()), ..Default::default() };
        assert_eq!(matching(&conn, &newest), ["Berserk", "Akira"]);
        // No rules: everything.
        assert_eq!(matching(&conn, &SmartRules::default()).len(), 4);
    }

    #[test]
    fn values_are_bound_and_checked() {
        let conn = db::memory();
        item(&conn, "books", "100% Pure_Fiction", None);
        item(&conn, "books", "100 Pure Fiction", None);
        let rules = SmartRules { conditions: vec![rule("title", "contains", "100% Pure_")], ..Default::default() };
        assert_eq!(matching(&conn, &rules), ["100% Pure_Fiction"]);
        let quote = SmartRules { conditions: vec![rule("title", "contains", "'); DROP TABLE items; --")], ..Default::default() };
        assert!(matching(&conn, &quote).is_empty());
        assert_eq!(count(&conn, &SmartRules::default()).unwrap(), 2);
        for bad in [rule("year", "is", "soon"), rule("added", "withinDays", "0"), rule("colour", "is", "red"), rule("title", "contains", "  ")] {
            assert!(SmartRules { conditions: vec![bad], ..Default::default() }.validate().is_err());
        }
        assert!(SmartRules { limit: Some(0), ..Default::default() }.validate().is_err());
        // A stored rule that no longer fits matches nothing.
        let broken = SmartRules { conditions: vec![rule("year", "is", "soon")], ..Default::default() };
        assert!(matching(&conn, &broken).is_empty());
        assert_eq!(parse(r#"{"rules":{"conditions":[],"limit":3}}"#).unwrap().limit, Some(3));
        assert!(parse("{}").is_none());
    }
}

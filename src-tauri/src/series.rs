//! Series navigation (Phase 2, D-019): the volumes of a series in reading order, so a reader can
//! go on to the next one and an item page can show the others. A series is the items of one
//! category sharing a `series` name; items without one follow their collection.

use std::cmp::Ordering;

use rusqlite::types::Value as SqlValue;
use rusqlite::OptionalExtension;
use serde::Serialize;
use tauri::State;

use crate::error::AppResult;
use crate::files::natural_cmp;
use crate::library::with_library;
use crate::AppState;

const MAX_ENTRIES: i64 = 1000;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeriesEntry {
    pub id: i64,
    pub title: String,
    pub cover_key: Option<String>,
    /// "Vol. 3" or "#12", when the item has a number.
    pub label: Option<String>,
    pub progress: Option<f64>,
    pub completed: bool,
    /// A picture's own proportions (width / height), so an album's photos keep their shape (D-178).
    pub aspect: Option<f64>,
    /// Its file's format ("gif", "jpg"…), so a GIF moves in the row too (D-178).
    pub format: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Series {
    pub name: String,
    pub entries: Vec<SeriesEntry>,
    /// Where the asked-for item sits in `entries`.
    pub index: usize,
}

/// A number from metadata stored as text ("03", "3.5") or as a number.
fn numeric(value: &SqlValue) -> Option<f64> {
    match value {
        SqlValue::Integer(n) => Some(*n as f64),
        SqlValue::Real(n) => Some(*n),
        SqlValue::Text(text) => text.trim().parse().ok(),
        _ => None,
    }
}

fn shown(value: f64) -> String {
    if value.fract() == 0.0 {
        format!("{value:.0}")
    } else {
        value.to_string()
    }
}

struct Row {
    entry: SeriesEntry,
    volume: Option<f64>,
    number: Option<f64>,
    sort_title: String,
}

fn order(a: &Row, b: &Row) -> Ordering {
    let by = |x: Option<f64>, y: Option<f64>| match (x, y) {
        (Some(x), Some(y)) => x.total_cmp(&y),
        (Some(_), None) => Ordering::Less,
        (None, Some(_)) => Ordering::Greater,
        (None, None) => Ordering::Equal,
    };
    by(a.volume, b.volume).then_with(|| by(a.number, b.number)).then_with(|| natural_cmp(&a.sort_title, &b.sort_title))
}

#[tauri::command]
pub async fn series_get(state: State<'_, AppState>, id: i64) -> AppResult<Option<Series>> {
    with_library(&state, move |library| {
        library.db.with(|conn| {
            let Some((category, collection, series)) = conn
                .query_row(
                    "SELECT category_id, collection_id, json_extract(metadata, '$.series') FROM items WHERE id = ?1",
                    [id],
                    |row| Ok((row.get::<_, i64>(0)?, row.get::<_, Option<i64>>(1)?, row.get::<_, Option<String>>(2)?)),
                )
                .optional()?
            else {
                return Ok(None);
            };
            let select = "SELECT i.id, i.title, i.sort_title, i.cover_key, json_extract(i.metadata, '$.volume'), \
                          json_extract(i.metadata, '$.number'), pr.fraction, pr.completed, \
                          (SELECT max(0.4, min(2.6, CAST(json_extract(i.metadata, '$.width') AS REAL) / json_extract(i.metadata, '$.height'))) \
                           WHERE json_extract(i.metadata, '$.height') > 0 AND json_extract(i.metadata, '$.width') > 0), \
                          (SELECT lower(v.format) FROM versions v WHERE v.item_id = i.id AND v.format IS NOT NULL LIMIT 1) \
                          FROM items i LEFT JOIN progress pr ON pr.item_id = i.id AND pr.part_id = 0";
            let (name, sql, key): (String, String, SqlValue) = match (series.filter(|s| !s.trim().is_empty()), collection) {
                (Some(series), _) => (
                    series.clone(),
                    format!("{select} WHERE i.category_id = {category} AND lower(json_extract(i.metadata, '$.series')) = lower(?1) LIMIT {MAX_ENTRIES}"),
                    SqlValue::Text(series),
                ),
                (None, Some(collection)) => (
                    conn.query_row("SELECT name FROM collections WHERE id = ?1", [collection], |row| row.get(0))?,
                    format!("{select} WHERE i.collection_id = ?1 LIMIT {MAX_ENTRIES}"),
                    SqlValue::Integer(collection),
                ),
                (None, None) => return Ok(None),
            };
            let mut rows: Vec<Row> = conn
                .prepare(&sql)?
                .query_map([key], |row| {
                    let volume = numeric(&row.get::<_, SqlValue>(4)?);
                    let number = numeric(&row.get::<_, SqlValue>(5)?);
                    let label = volume.map(|v| format!("Vol. {}", shown(v))).or_else(|| number.map(|n| format!("#{}", shown(n))));
                    Ok(Row {
                        entry: SeriesEntry {
                            id: row.get(0)?,
                            title: row.get(1)?,
                            cover_key: row.get(3)?,
                            label,
                            progress: row.get(6)?,
                            completed: row.get::<_, Option<bool>>(7)?.unwrap_or(false),
                            aspect: row.get(8)?,
                            format: row.get(9)?,
                        },
                        volume,
                        number,
                        sort_title: row.get(2)?,
                    })
                })?
                .collect::<Result<_, _>>()?;
            if rows.len() < 2 {
                return Ok(None);
            }
            rows.sort_by(order);
            let entries: Vec<SeriesEntry> = rows.into_iter().map(|row| row.entry).collect();
            let index = entries.iter().position(|entry| entry.id == id).unwrap_or(0);
            Ok(Some(Series { name, entries, index }))
        })
    })
    .await
}

/// The next volume of each series lately finished (D-050, Home's Up next): for the series of the
/// items finished most recently, the first volume after the finished one that isn't finished or
/// started yet (started ones are already in Pick up where you left off). Newest first, at most `limit`.
pub fn next_after_finished(conn: &rusqlite::Connection, limit: usize) -> AppResult<Vec<i64>> {
    let finished: Vec<(i64, i64, String)> = conn
        .prepare(
            "SELECT i.id, i.category_id, json_extract(i.metadata, '$.series') FROM progress pr JOIN items i ON i.id = pr.item_id \
             WHERE pr.part_id = 0 AND pr.completed = 1 AND trim(coalesce(json_extract(i.metadata, '$.series'), '')) <> '' \
             ORDER BY pr.updated_at DESC LIMIT 60",
        )?
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
        .collect::<Result<_, _>>()?;
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for (id, category, series) in finished {
        if out.len() >= limit || !seen.insert((category, series.to_lowercase())) {
            continue;
        }
        let mut rows: Vec<Row> = conn
            .prepare(&format!(
                "SELECT i.id, i.title, i.sort_title, i.cover_key, json_extract(i.metadata, '$.volume'), json_extract(i.metadata, '$.number'), \
                 pr.fraction, pr.completed, NULL, NULL FROM items i LEFT JOIN progress pr ON pr.item_id = i.id AND pr.part_id = 0 \
                 WHERE i.category_id = ?1 AND lower(json_extract(i.metadata, '$.series')) = lower(?2) LIMIT {MAX_ENTRIES}"
            ))?
            .query_map(rusqlite::params![category, series], |row| {
                Ok(Row {
                    entry: SeriesEntry {
                        id: row.get(0)?,
                        title: row.get(1)?,
                        cover_key: row.get(3)?,
                        label: None,
                        progress: row.get(6)?,
                        completed: row.get::<_, Option<bool>>(7)?.unwrap_or(false),
                        aspect: row.get(8)?,
                        format: row.get(9)?,
                    },
                    volume: numeric(&row.get::<_, SqlValue>(4)?),
                    number: numeric(&row.get::<_, SqlValue>(5)?),
                    sort_title: row.get(2)?,
                })
            })?
            .collect::<Result<_, _>>()?;
        rows.sort_by(order);
        let Some(at) = rows.iter().position(|r| r.entry.id == id) else { continue };
        if let Some(next) = rows[at + 1..].iter().find(|r| !r.entry.completed) {
            if next.entry.progress.unwrap_or(0.0) <= 0.01 {
                out.push(next.entry.id);
            }
        }
    }
    Ok(out)
}

/// A series and its number from a comic's file name, when the name marks one: "Saga Vol. 2",
/// "Saga v02", "Saga #12", "Saga Ch. 5", or a zero-padded number ("Saga 001"). A bare number
/// without padding ("Catch 22") isn't taken as one. Returns the series, the metadata key
/// (`volume` or `number`) and the number.
pub fn from_name(title: &str) -> Option<(String, &'static str, String)> {
    let words: Vec<&str> = title.split_whitespace().collect();
    let (&last, rest) = words.split_last()?;
    let digits = |text: &str| !text.is_empty() && text.chars().all(|c| c.is_ascii_digit() || c == '.') && text.chars().next().is_some_and(|c| c.is_ascii_digit());
    let lower = last.to_lowercase();
    let (series_words, key, number) = if let Some(n) = last.strip_prefix('#').filter(|n| digits(n)) {
        (rest, "number", n)
    } else if lower.starts_with('v') && digits(&last[1..]) {
        (rest, "volume", &last[1..])
    } else if digits(last) {
        let (previous, before) = rest.split_last().map(|(p, b)| (p.to_lowercase(), b)).unwrap_or_default();
        match previous.trim_end_matches('.') {
            "vol" | "volume" | "tomo" | "book" => (before, "volume", last),
            "no" | "issue" | "ch" | "chapter" | "cap" => (before, "number", last),
            _ if last.starts_with('0') && last.len() >= 2 => (rest, "number", last),
            _ => return None,
        }
    } else {
        return None;
    };
    let series = series_words.join(" ");
    let series = series.trim_end_matches(|c: char| matches!(c, '-' | '–' | '—' | ',' | ':' | '_') || c.is_whitespace());
    if series.is_empty() {
        return None;
    }
    let number = number.trim_start_matches('0');
    let number = if number.is_empty() || number.starts_with('.') { format!("0{number}") } else { number.to_string() };
    Some((series.to_string(), key, number))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn series_come_from_marked_names() {
        let parse = |t: &str| from_name(t).map(|(s, k, n)| format!("{s}|{k}|{n}"));
        assert_eq!(parse("Night Market Tales 01").as_deref(), Some("Night Market Tales|number|1"));
        assert_eq!(parse("Saga Vol. 2").as_deref(), Some("Saga|volume|2"));
        assert_eq!(parse("Saga v03").as_deref(), Some("Saga|volume|3"));
        assert_eq!(parse("Saga - #12").as_deref(), Some("Saga|number|12"));
        assert_eq!(parse("One Piece Ch. 1001").as_deref(), Some("One Piece|number|1001"));
        assert_eq!(parse("Akira Tomo 000").as_deref(), Some("Akira|volume|0"));
        assert_eq!(parse("Catch 22"), None);
        assert_eq!(parse("01"), None);
        assert_eq!(parse("Watchmen"), None);
    }

    #[test]
    fn volumes_sort_before_unnumbered_items() {
        let row = |title: &str, volume: Option<f64>| Row {
            entry: SeriesEntry { id: 0, title: title.into(), cover_key: None, label: None, progress: None, completed: false, aspect: None, format: None },
            volume,
            number: None,
            sort_title: title.to_lowercase(),
        };
        let mut rows = vec![row("Extras", None), row("Ten", Some(10.0)), row("Two", Some(2.0))];
        rows.sort_by(order);
        assert_eq!(rows.iter().map(|r| r.entry.title.as_str()).collect::<Vec<_>>(), vec!["Two", "Ten", "Extras"]);
    }
}

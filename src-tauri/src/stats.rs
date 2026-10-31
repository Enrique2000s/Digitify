//! Statistics for Home (Phase 5, D-023): time spent reading, watching and listening (recorded
//! by the readers and players while they're in use), what was finished, the most played artists,
//! and the library's make-up. Everything is computed from this library alone.

use rusqlite::{params, Connection};
use serde::Serialize;
use tauri::State;

use crate::error::{AppError, AppResult};
use crate::library::with_library;
use crate::AppState;

/// The most one report may add: readers and players report about every 30 seconds.
const MAX_REPORT_SECONDS: i64 = 600;

#[derive(Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Time {
    pub read: i64,
    pub watch: i64,
    pub listen: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Day {
    pub day: String,
    #[serde(flatten)]
    pub time: Time,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NamedCount {
    pub key: String,
    pub name: String,
    pub count: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    /// Seconds this calendar month and year.
    pub month: Time,
    pub year: Time,
    /// The first day anything was recorded.
    pub since: Option<String>,
    /// The last 14 days, oldest first, including days with nothing.
    pub days: Vec<Day>,
    pub finished_month: i64,
    pub finished_year: i64,
    pub in_progress: i64,
    pub plays_month: i64,
    /// Most played artists this year.
    pub top_artists: Vec<NamedCount>,
    /// Items per category, largest first.
    pub categories: Vec<NamedCount>,
}

/// Adds time spent with an item today (local date).
pub fn add(conn: &Connection, item: i64, kind: &str, seconds: i64) -> AppResult<()> {
    if !matches!(kind, "read" | "watch" | "listen") {
        return Err(AppError::msg("unknown kind of activity"));
    }
    let seconds = seconds.clamp(0, MAX_REPORT_SECONDS);
    if seconds == 0 {
        return Ok(());
    }
    conn.execute(
        "INSERT INTO activity (day, item_id, kind, seconds) SELECT date('now', 'localtime'), id, ?2, ?3 FROM items WHERE id = ?1 \
         ON CONFLICT (day, item_id, kind) DO UPDATE SET seconds = seconds + excluded.seconds",
        params![item, kind, seconds],
    )?;
    Ok(())
}

#[tauri::command]
pub async fn activity_add(state: State<'_, AppState>, item: i64, kind: String, seconds: i64) -> AppResult<()> {
    with_library(&state, move |library| library.db.with(|conn| add(conn, item, &kind, seconds))).await
}

fn time_since(conn: &Connection, start: &str) -> AppResult<Time> {
    Ok(conn.query_row(
        &format!(
            "SELECT coalesce(sum(CASE kind WHEN 'read' THEN seconds END), 0), coalesce(sum(CASE kind WHEN 'watch' THEN seconds END), 0), \
             coalesce(sum(CASE kind WHEN 'listen' THEN seconds END), 0) FROM activity WHERE day >= {start}"
        ),
        [],
        |row| Ok(Time { read: row.get(0)?, watch: row.get(1)?, listen: row.get(2)? }),
    )?)
}

pub fn stats(conn: &Connection) -> AppResult<Stats> {
    const MONTH: &str = "strftime('%Y-%m-01', 'now', 'localtime')";
    const YEAR: &str = "strftime('%Y-01-01', 'now', 'localtime')";
    // Progress times are stored in UTC; these are the local month's and year's starts in UTC.
    const MONTH_UTC: &str = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now', 'localtime', 'start of month', 'utc')";
    const YEAR_UTC: &str = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now', 'localtime', 'start of year', 'utc')";
    let count = |sql: &str| conn.query_row(sql, [], |row| row.get::<_, i64>(0));

    let days = conn
        .prepare(
            "WITH RECURSIVE d(day, n) AS (SELECT date('now', 'localtime'), 0 UNION ALL SELECT date(day, '-1 day'), n + 1 FROM d WHERE n < 13) \
             SELECT d.day, coalesce(sum(CASE a.kind WHEN 'read' THEN a.seconds END), 0), coalesce(sum(CASE a.kind WHEN 'watch' THEN a.seconds END), 0), \
             coalesce(sum(CASE a.kind WHEN 'listen' THEN a.seconds END), 0) FROM d LEFT JOIN activity a ON a.day = d.day GROUP BY d.day ORDER BY d.day",
        )?
        .query_map([], |row| Ok(Day { day: row.get(0)?, time: Time { read: row.get(1)?, watch: row.get(2)?, listen: row.get(3)? } }))?
        .collect::<Result<_, _>>()?;
    let top_artists = conn
        .prepare(&format!(
            "SELECT artist, count(*) AS n FROM (SELECT coalesce(json_extract(p.metadata, '$.artist'), \
               (SELECT pe.name FROM item_people ip JOIN people pe ON pe.id = ip.person_id WHERE ip.item_id = p.item_id AND ip.role = 'artist' \
                ORDER BY ip.position LIMIT 1)) AS artist FROM plays pl JOIN parts p ON p.id = pl.part_id WHERE pl.played_at >= {YEAR_UTC}) \
             WHERE artist IS NOT NULL GROUP BY artist ORDER BY n DESC, artist LIMIT 5"
        ))?
        .query_map([], |row| Ok(NamedCount { key: row.get(0)?, name: row.get(0)?, count: row.get(1)? }))?
        .collect::<Result<_, _>>()?;
    let categories = conn
        .prepare(
            "SELECT c.key, c.name, count(i.id) AS n FROM categories c JOIN items i ON i.category_id = c.id \
             GROUP BY c.id HAVING n > 0 ORDER BY n DESC, c.sort_order",
        )?
        .query_map([], |row| Ok(NamedCount { key: row.get(0)?, name: row.get(1)?, count: row.get(2)? }))?
        .collect::<Result<_, _>>()?;
    Ok(Stats {
        month: time_since(conn, MONTH)?,
        year: time_since(conn, YEAR)?,
        since: conn.query_row("SELECT min(day) FROM activity", [], |row| row.get(0))?,
        days,
        finished_month: count(&format!("SELECT count(*) FROM progress WHERE part_id = 0 AND completed = 1 AND updated_at >= {MONTH_UTC}"))?,
        finished_year: count(&format!("SELECT count(*) FROM progress WHERE part_id = 0 AND completed = 1 AND updated_at >= {YEAR_UTC}"))?,
        in_progress: count("SELECT count(*) FROM progress WHERE part_id = 0 AND completed = 0 AND fraction > 0.01")?,
        plays_month: count(&format!("SELECT count(*) FROM plays WHERE played_at >= {MONTH_UTC}"))?,
        top_artists,
        categories,
    })
}

#[tauri::command]
pub async fn library_stats(state: State<'_, AppState>) -> AppResult<Stats> {
    with_library(&state, |library| library.db.with(|conn| stats(conn))).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    #[test]
    fn activity_adds_up_per_day_and_kind() {
        let conn = db::memory();
        conn.execute("INSERT INTO items (category_id, title, sort_title) VALUES ((SELECT id FROM categories WHERE key = 'books'), 'Dune', 'Dune')", [])
            .unwrap();
        let id = conn.last_insert_rowid();
        add(&conn, id, "read", 30).unwrap();
        add(&conn, id, "read", 45).unwrap();
        add(&conn, id, "listen", 5000).unwrap(); // one report can't add more than ten minutes
        add(&conn, id + 1, "read", 30).unwrap(); // an item that isn't there adds nothing
        assert!(add(&conn, id, "sleep", 30).is_err());
        let stats = stats(&conn).unwrap();
        assert_eq!(stats.month, Time { read: 75, watch: 0, listen: 600 });
        assert_eq!(stats.year, stats.month);
        assert_eq!(stats.days.len(), 14);
        assert_eq!(stats.days.last().unwrap().time.read, 75);
        assert!(stats.days[..13].iter().all(|d| d.time == Time::default()));
        assert_eq!(stats.categories.len(), 1);
        assert_eq!(stats.categories[0].count, 1);
        assert!(stats.since.is_some());
    }
}

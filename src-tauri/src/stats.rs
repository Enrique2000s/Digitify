//! Statistics for Home (Phase 5, D-023): time spent reading, watching and listening (recorded
//! by the readers and players while they're in use) and playing (Arcade's games, D-041), what was
//! finished, the most played artists and games, and the library's make-up. Everything is computed
//! from this library alone.

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
    pub play: i64,
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
    /// Most played games this year, by minutes played.
    pub top_games: Vec<NamedCount>,
    /// Items per category, largest first.
    pub categories: Vec<NamedCount>,
    /// Days in a row with any reading, watching, listening or playing, up to today (or up to
    /// yesterday, until something is done today), and the longest such run (D-052).
    pub streak: i64,
    pub best_streak: i64,
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

/// Every kind of activity, as `day, kind, seconds` rows: the library's and Arcade's.
const ALL_ACTIVITY: &str = "(SELECT day, kind, seconds FROM activity UNION ALL SELECT day, 'play', seconds FROM arcade_activity)";

fn time_since(conn: &Connection, start: &str) -> AppResult<Time> {
    Ok(conn.query_row(
        &format!(
            "SELECT coalesce(sum(CASE kind WHEN 'read' THEN seconds END), 0), coalesce(sum(CASE kind WHEN 'watch' THEN seconds END), 0), \
             coalesce(sum(CASE kind WHEN 'listen' THEN seconds END), 0), coalesce(sum(CASE kind WHEN 'play' THEN seconds END), 0) \
             FROM {ALL_ACTIVITY} WHERE day >= {start}"
        ),
        [],
        |row| Ok(Time { read: row.get(0)?, watch: row.get(1)?, listen: row.get(2)?, play: row.get(3)? }),
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
        .prepare(&format!(
            "WITH RECURSIVE d(day, n) AS (SELECT date('now', 'localtime'), 0 UNION ALL SELECT date(day, '-1 day'), n + 1 FROM d WHERE n < 13) \
             SELECT d.day, coalesce(sum(CASE a.kind WHEN 'read' THEN a.seconds END), 0), coalesce(sum(CASE a.kind WHEN 'watch' THEN a.seconds END), 0), \
             coalesce(sum(CASE a.kind WHEN 'listen' THEN a.seconds END), 0), coalesce(sum(CASE a.kind WHEN 'play' THEN a.seconds END), 0) \
             FROM d LEFT JOIN {ALL_ACTIVITY} a ON a.day = d.day GROUP BY d.day ORDER BY d.day"
        ))?
        .query_map([], |row| Ok(Day { day: row.get(0)?, time: Time { read: row.get(1)?, watch: row.get(2)?, listen: row.get(3)?, play: row.get(4)? } }))?
        .collect::<Result<_, _>>()?;
    let top_games = conn
        .prepare(
            "SELECT g.id, g.title, sum(a.seconds) / 60 AS minutes FROM arcade_activity a JOIN arcade_games g ON g.id = a.game_id \
             WHERE a.day >= strftime('%Y-01-01', 'now', 'localtime') GROUP BY g.id HAVING minutes > 0 ORDER BY minutes DESC, g.sort_title LIMIT 5",
        )?
        .query_map([], |row| Ok(NamedCount { key: row.get::<_, i64>(0)?.to_string(), name: row.get(1)?, count: row.get(2)? }))?
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
    let mut categories: Vec<NamedCount> = conn
        .prepare(
            "SELECT c.key, c.name, count(i.id) AS n FROM categories c JOIN items i ON i.category_id = c.id \
             GROUP BY c.id HAVING n > 0 ORDER BY n DESC, c.sort_order",
        )?
        .query_map([], |row| Ok(NamedCount { key: row.get(0)?, name: row.get(1)?, count: row.get(2)? }))?
        .collect::<Result<_, _>>()?;
    // Arcade's games, among the library's categories (D-041).
    let games = count("SELECT count(*) FROM arcade_games WHERE hidden = 0 AND missing = 0")?;
    if games > 0 {
        categories.push(NamedCount { key: "arcade".into(), name: "Games".into(), count: games });
        categories.sort_by(|a, b| b.count.cmp(&a.count));
    }
    let (streak, best_streak) = streaks(conn)?;
    Ok(Stats {
        streak,
        best_streak,
        month: time_since(conn, MONTH)?,
        year: time_since(conn, YEAR)?,
        since: conn.query_row(&format!("SELECT min(day) FROM {ALL_ACTIVITY}"), [], |row| row.get(0))?,
        days,
        finished_month: count(&format!("SELECT count(*) FROM progress WHERE part_id = 0 AND completed = 1 AND updated_at >= {MONTH_UTC}"))?,
        finished_year: count(&format!("SELECT count(*) FROM progress WHERE part_id = 0 AND completed = 1 AND updated_at >= {YEAR_UTC}"))?,
        in_progress: count("SELECT count(*) FROM progress WHERE part_id = 0 AND completed = 0 AND fraction > 0.01")?,
        plays_month: count(&format!("SELECT count(*) FROM plays WHERE played_at >= {MONTH_UTC}"))?,
        top_artists,
        top_games,
        categories,
    })
}

/// The current streak and the best one (D-052), from the days anything was recorded.
fn streaks(conn: &Connection) -> AppResult<(i64, i64)> {
    // Days as day numbers (julianday), newest first.
    let days: Vec<i64> = conn
        .prepare(&format!("SELECT DISTINCT CAST(julianday(day) AS INTEGER) FROM {ALL_ACTIVITY} WHERE seconds > 0 ORDER BY 1 DESC"))?
        .query_map([], |row| row.get(0))?
        .collect::<Result<_, _>>()?;
    let today: i64 = conn.query_row("SELECT CAST(julianday(date('now', 'localtime')) AS INTEGER)", [], |row| row.get(0))?;
    Ok(streak_runs(&days, today))
}

/// From day numbers (newest first): the run ending today or yesterday, and the longest run.
fn streak_runs(days: &[i64], today: i64) -> (i64, i64) {
    let mut best = 0;
    let mut run = 0;
    let mut previous: Option<i64> = None;
    let mut current = 0;
    let mut current_done = false;
    for &day in days {
        run = if previous == Some(day + 1) { run + 1 } else { 1 };
        best = best.max(run);
        if !current_done {
            if (previous.is_none() && (day == today || day == today - 1)) || (previous == Some(day + 1) && current > 0) {
                current = run;
            } else {
                current_done = true;
            }
        }
        previous = Some(day);
    }
    (current, best)
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
    fn streaks_count_days_in_a_row() {
        assert_eq!(streak_runs(&[], 100), (0, 0));
        assert_eq!(streak_runs(&[100, 99, 98, 90, 89], 100), (3, 3));
        assert_eq!(streak_runs(&[99, 98], 100), (2, 2)); // nothing yet today: yesterday's run still counts
        assert_eq!(streak_runs(&[97, 96, 95, 94], 100), (0, 4)); // broken
        assert_eq!(streak_runs(&[100, 95, 94, 93, 92], 100), (1, 4));
    }

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
        assert_eq!(stats.month, Time { read: 75, watch: 0, listen: 600, play: 0 });
        assert_eq!(stats.year, stats.month);
        assert_eq!(stats.days.len(), 14);
        assert_eq!(stats.days.last().unwrap().time.read, 75);
        assert!(stats.days[..13].iter().all(|d| d.time == Time::default()));
        // Arcade's play time counts too (D-041).
        conn.execute("INSERT INTO arcade_games (path, platform, title, sort_title) VALUES ('/g.iso', 'wii', 'Zelda', 'zelda')", []).unwrap();
        let game = conn.last_insert_rowid();
        conn.execute("INSERT INTO arcade_activity (day, game_id, seconds) VALUES (date('now', 'localtime'), ?1, 1800)", [game]).unwrap();
        let stats = super::stats(&conn).unwrap();
        assert_eq!(stats.month.play, 1800);
        assert_eq!(stats.days.last().unwrap().time.play, 1800);
        assert_eq!(stats.top_games.iter().map(|g| (g.name.as_str(), g.count)).collect::<Vec<_>>(), [("Zelda", 30)]);
        assert!(stats.categories.iter().any(|c| c.key == "arcade" && c.count == 1));
        assert_eq!(stats.categories.len(), 2); // Books and Games
        assert_eq!(stats.categories[0].count, 1);
        assert!(stats.since.is_some());
    }
}

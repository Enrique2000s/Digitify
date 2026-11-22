//! Your year, achievements and the activity calendar (D-065…D-067), all from this library's own
//! records: the time spent reading, watching, listening and playing, what was finished and added.

use rusqlite::{params, Connection};
use serde::Serialize;
use tauri::State;

use crate::error::AppResult;
use crate::library::with_library;
use crate::stats::NamedCount;
use crate::AppState;

/// Every kind of activity as `day, kind, seconds` rows: the library's and Arcade's.
use crate::stats::{top_artists_sql, ALL_ACTIVITY as ALL};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarDay {
    pub day: String,
    pub seconds: i64,
}

/// Seconds of activity per day of `year` (only days with some).
pub fn calendar(conn: &Connection, year: i64) -> AppResult<Vec<CalendarDay>> {
    Ok(conn
        .prepare(&format!("SELECT day, sum(seconds) FROM {ALL} WHERE substr(day, 1, 4) = ?1 GROUP BY day HAVING sum(seconds) > 0 ORDER BY day"))?
        .query_map([year.to_string()], |row| Ok(CalendarDay { day: row.get(0)?, seconds: row.get(1)? }))?
        .collect::<Result<_, _>>()?)
}

#[tauri::command]
pub async fn activity_calendar(state: State<'_, AppState>, year: i64) -> AppResult<Vec<CalendarDay>> {
    with_library(&state, move |library| library.db.with(|conn| calendar(conn, year))).await
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct YearReview {
    pub year: i64,
    /// Seconds of each activity.
    pub read: i64,
    pub watch: i64,
    pub listen: i64,
    pub play: i64,
    pub finished: i64,
    pub added: i64,
    pub days_active: i64,
    pub longest_streak: i64,
    /// The month (1-12) with the most time, and its seconds.
    pub best_month: Option<(i64, i64)>,
    /// The busiest day and its seconds.
    pub best_day: Option<(String, i64)>,
    /// Minutes played per game, most first.
    pub top_games: Vec<NamedCount>,
    /// Minutes spent per item read, watched or listened to, most first.
    pub top_items: Vec<NamedCount>,
    pub top_artists: Vec<NamedCount>,
}

pub fn review(conn: &Connection, year: i64) -> AppResult<YearReview> {
    let y = year.to_string();
    let kind = |k: &str| -> AppResult<i64> {
        Ok(conn.query_row(&format!("SELECT coalesce(sum(seconds), 0) FROM {ALL} WHERE kind = ?1 AND substr(day, 1, 4) = ?2"), params![k, y], |row| row.get(0))?)
    };
    let days = calendar(conn, year)?;
    let julian: Vec<i64> = days
        .iter()
        .filter_map(|d| conn.query_row("SELECT CAST(julianday(?1) AS INTEGER)", [&d.day], |row| row.get::<_, i64>(0)).ok())
        .collect();
    let mut longest = 0;
    let mut run = 0;
    for (i, day) in julian.iter().enumerate() {
        run = if i > 0 && julian[i - 1] + 1 == *day { run + 1 } else { 1 };
        longest = longest.max(run);
    }
    let best_day = days.iter().max_by_key(|d| d.seconds).map(|d| (d.day.clone(), d.seconds));
    let best_month = conn
        .query_row(
            &format!("SELECT CAST(substr(day, 6, 2) AS INTEGER), sum(seconds) AS s FROM {ALL} WHERE substr(day, 1, 4) = ?1 GROUP BY 1 ORDER BY s DESC LIMIT 1"),
            [&y],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
        )
        .ok();
    let named = |sql: &str| -> AppResult<Vec<NamedCount>> {
        Ok(conn
            .prepare(sql)?
            .query_map([&y], |row| Ok(NamedCount { key: row.get::<_, i64>(0)?.to_string(), name: row.get(1)?, count: row.get(2)? }))?
            .collect::<Result<_, _>>()?)
    };
    let top_games = named(
        "SELECT g.id, g.title, sum(a.seconds) / 60 AS m FROM arcade_activity a JOIN arcade_games g ON g.id = a.game_id \
         WHERE substr(a.day, 1, 4) = ?1 GROUP BY g.id HAVING m > 0 ORDER BY m DESC LIMIT 5",
    )?;
    let top_items = named(
        "SELECT i.id, i.title, sum(a.seconds) / 60 AS m FROM activity a JOIN items i ON i.id = a.item_id \
         WHERE substr(a.day, 1, 4) = ?1 GROUP BY i.id HAVING m > 0 ORDER BY m DESC LIMIT 5",
    )?;
    let top_artists = conn
        .prepare(&top_artists_sql("substr(pl.played_at, 1, 4) = ?1", 5))?
        .query_map([&y], |row| Ok(NamedCount { key: row.get(0)?, name: row.get(0)?, count: row.get(1)? }))?
        .collect::<Result<_, _>>()?;
    Ok(YearReview {
        year,
        read: kind("read")?,
        watch: kind("watch")?,
        listen: kind("listen")?,
        play: kind("play")?,
        finished: conn.query_row("SELECT count(*) FROM progress WHERE part_id = 0 AND completed = 1 AND substr(updated_at, 1, 4) = ?1", [&y], |row| row.get(0))?,
        added: conn.query_row("SELECT count(*) FROM items WHERE substr(added_at, 1, 4) = ?1", [&y], |row| row.get(0))?,
        days_active: days.len() as i64,
        longest_streak: longest,
        best_month,
        best_day,
        top_games,
        top_items,
        top_artists,
    })
}

#[tauri::command]
pub async fn year_review(state: State<'_, AppState>, year: i64) -> AppResult<YearReview> {
    with_library(&state, move |library| library.db.with(|conn| review(conn, year))).await
}

// ---------------------------------------------------------------------------------------------
// Your week (D-164): the last seven days, today included, beside the seven before them

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeekReview {
    /// The first and last day (local dates).
    pub start: String,
    pub end: String,
    /// Seconds of each activity.
    pub read: i64,
    pub watch: i64,
    pub listen: i64,
    pub play: i64,
    /// All the time of the seven days before.
    pub previous: i64,
    pub days_active: i64,
    /// Each day's seconds, oldest first.
    pub days: Vec<CalendarDay>,
    pub finished: i64,
    pub added: i64,
    /// Different games played, items read, watched or listened to, and tracks played.
    pub games: i64,
    pub items: i64,
    pub tracks: i64,
    pub best_day: Option<(String, i64)>,
    /// Minutes played per game, minutes per item, plays per artist; most first.
    pub top_games: Vec<NamedCount>,
    pub top_items: Vec<NamedCount>,
    pub top_artists: Vec<NamedCount>,
}

pub fn week(conn: &Connection) -> AppResult<WeekReview> {
    let (start, end, before): (String, String, String) = conn.query_row(
        "SELECT date('now', 'localtime', '-6 days'), date('now', 'localtime'), date('now', 'localtime', '-13 days')",
        [],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
    )?;
    let kind = |k: &str| -> AppResult<i64> {
        Ok(conn.query_row(&format!("SELECT coalesce(sum(seconds), 0) FROM {ALL} WHERE kind = ?1 AND day BETWEEN ?2 AND ?3"), params![k, start, end], |row| row.get(0))?)
    };
    let days: Vec<CalendarDay> = conn
        .prepare(&format!(
            "WITH RECURSIVE d(day) AS (SELECT ?1 UNION ALL SELECT date(day, '+1 day') FROM d WHERE day < ?2) \
             SELECT d.day, coalesce(sum(a.seconds), 0) FROM d LEFT JOIN {ALL} a ON a.day = d.day GROUP BY d.day ORDER BY d.day"
        ))?
        .query_map(params![start, end], |row| Ok(CalendarDay { day: row.get(0)?, seconds: row.get(1)? }))?
        .collect::<Result<_, _>>()?;
    let count = |sql: &str| -> AppResult<i64> { Ok(conn.query_row(sql, params![start, end], |row| row.get(0))?) };
    let named = |sql: &str| -> AppResult<Vec<NamedCount>> {
        Ok(conn
            .prepare(sql)?
            .query_map(params![start, end], |row| Ok(NamedCount { key: row.get::<_, i64>(0)?.to_string(), name: row.get(1)?, count: row.get(2)? }))?
            .collect::<Result<_, _>>()?)
    };
    // Plays, additions and finishes are kept in UTC: compared by their local day.
    let top_artists = conn
        .prepare(&top_artists_sql("date(pl.played_at, 'localtime') BETWEEN ?1 AND ?2", 3))?
        .query_map(params![start, end], |row| Ok(NamedCount { key: row.get(0)?, name: row.get(0)?, count: row.get(1)? }))?
        .collect::<Result<_, _>>()?;
    let previous = conn.query_row(&format!("SELECT coalesce(sum(seconds), 0) FROM {ALL} WHERE day >= ?1 AND day < ?2"), params![before, start], |row| row.get(0))?;
    Ok(WeekReview {
        read: kind("read")?,
        watch: kind("watch")?,
        listen: kind("listen")?,
        play: kind("play")?,
        previous,
        days_active: days.iter().filter(|d| d.seconds > 0).count() as i64,
        best_day: days.iter().filter(|d| d.seconds > 0).max_by_key(|d| d.seconds).map(|d| (d.day.clone(), d.seconds)),
        days,
        finished: count("SELECT count(*) FROM progress WHERE part_id = 0 AND completed = 1 AND date(updated_at, 'localtime') BETWEEN ?1 AND ?2")?,
        added: count("SELECT count(*) FROM items WHERE date(added_at, 'localtime') BETWEEN ?1 AND ?2")?,
        games: count("SELECT count(DISTINCT game_id) FROM arcade_activity WHERE day BETWEEN ?1 AND ?2 AND seconds > 0")?,
        items: count("SELECT count(DISTINCT item_id) FROM activity WHERE day BETWEEN ?1 AND ?2 AND seconds > 0")?,
        tracks: count("SELECT count(*) FROM plays WHERE date(played_at, 'localtime') BETWEEN ?1 AND ?2")?,
        top_games: named(
            "SELECT g.id, g.title, sum(a.seconds) / 60 AS m FROM arcade_activity a JOIN arcade_games g ON g.id = a.game_id \
             WHERE a.day BETWEEN ?1 AND ?2 GROUP BY g.id HAVING m > 0 ORDER BY m DESC LIMIT 3",
        )?,
        top_items: named(
            "SELECT i.id, i.title, sum(a.seconds) / 60 AS m FROM activity a JOIN items i ON i.id = a.item_id \
             WHERE a.day BETWEEN ?1 AND ?2 GROUP BY i.id HAVING m > 0 ORDER BY m DESC LIMIT 3",
        )?,
        top_artists,
        start,
        end,
    })
}

#[tauri::command]
pub async fn week_review(state: State<'_, AppState>) -> AppResult<WeekReview> {
    with_library(&state, |library| library.db.with(|conn| week(conn))).await
}

// ---------------------------------------------------------------------------------------------
// Achievements

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Achievement {
    pub key: String,
    pub title: String,
    pub description: String,
    pub progress: i64,
    pub goal: i64,
    pub unlocked_at: Option<String>,
    /// Unlocked just now, by this check (for the notice).
    pub new: bool,
}

/// What each achievement counts, with its steps: (key prefix, title, what it counts as
/// "plural|singular", SQL, steps).
const LADDERS: &[(&str, &str, &str, &str, &[i64])] = &[
    ("finished", "Finisher", "things finished (books, comics, films, series…)|thing finished (a book, comic, film, series…)", "SELECT count(*) FROM progress WHERE part_id = 0 AND completed = 1", &[1, 10, 50, 100, 250]),
    ("read", "Bookworm", "hours of reading|hour of reading", "SELECT coalesce(sum(seconds), 0) / 3600 FROM activity WHERE kind = 'read'", &[1, 10, 50, 100]),
    ("watch", "Cinephile", "hours of watching|hour of watching", "SELECT coalesce(sum(seconds), 0) / 3600 FROM activity WHERE kind = 'watch'", &[1, 10, 50, 100, 250]),
    ("listen", "Audiophile", "hours of listening|hour of listening", "SELECT coalesce(sum(seconds), 0) / 3600 FROM activity WHERE kind = 'listen'", &[1, 10, 50, 100]),
    ("play", "Player", "hours played in Arcade|hour played in Arcade", "SELECT (coalesce((SELECT sum(play_seconds + extra_seconds) FROM arcade_games), 0)) / 3600", &[1, 10, 50, 100, 500]),
    ("library", "Collector", "items in the library|item in the library", "SELECT count(*) FROM items", &[10, 100, 500, 1000, 5000]),
    ("games", "Arcade regular", "games played|game played", "SELECT count(*) FROM arcade_games WHERE play_count > 0", &[1, 10, 25, 50]),
    ("rated", "Critic", "items and games rated|item or game rated", "SELECT (SELECT count(*) FROM items WHERE rating IS NOT NULL) + (SELECT count(*) FROM arcade_games WHERE rating IS NOT NULL)", &[1, 10, 50]),
];

/// The achievements, unlocking (and remembering) the ones just reached.
pub fn achievements(conn: &Connection) -> AppResult<Vec<Achievement>> {
    let days: Vec<i64> = conn
        .prepare(&format!("SELECT DISTINCT CAST(julianday(day) AS INTEGER) FROM {ALL} WHERE seconds > 0 ORDER BY 1"))?
        .query_map([], |row| row.get(0))?
        .collect::<Result<_, _>>()?;
    let mut best = 0;
    let mut run = 0;
    for (i, d) in days.iter().enumerate() {
        run = if i > 0 && days[i - 1] + 1 == *d { run + 1 } else { 1 };
        best = best.max(run);
    }
    let mut ladders: Vec<(String, String, String, i64, Vec<i64>)> =
        LADDERS.iter().map(|(k, t, what, sql, steps)| -> AppResult<_> { Ok((k.to_string(), t.to_string(), what.to_string(), conn.query_row(sql, [], |row| row.get::<_, i64>(0))?, steps.to_vec())) }).collect::<AppResult<_>>()?;
    ladders.push(("streak".into(), "On a roll".into(), "days in a row".into(), best, vec![3, 7, 30, 100, 365]));
    let mut out = Vec::new();
    for (key, title, what, value, steps) in ladders {
        for (level, goal) in steps.iter().enumerate() {
            let id = format!("{key}-{goal}");
            let mut unlocked: Option<String> = conn.query_row("SELECT unlocked_at FROM achievements WHERE key = ?1", [&id], |row| row.get(0)).ok();
            let mut new = false;
            if unlocked.is_none() && value >= *goal {
                conn.execute("INSERT OR IGNORE INTO achievements (key) VALUES (?1)", [&id])?;
                unlocked = conn.query_row("SELECT unlocked_at FROM achievements WHERE key = ?1", [&id], |row| row.get(0)).ok();
                new = true;
            }
            let roman = ["I", "II", "III", "IV", "V"][level.min(4)];
            out.push(Achievement {
                key: id,
                title: format!("{title} {roman}"),
                description: {
                    let (many, one) = what.split_once('|').unwrap_or((&what, &what));
                    format!("{goal} {}", if *goal == 1 { one } else { many })
                },
                progress: value.min(*goal),
                goal: *goal,
                unlocked_at: unlocked,
                new,
            });
        }
    }
    Ok(out)
}

#[tauri::command]
pub async fn achievements_list(state: State<'_, AppState>) -> AppResult<Vec<Achievement>> {
    with_library(&state, |library| library.db.with(|conn| achievements(conn))).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    #[test]
    fn the_week_has_seven_days_and_its_time() {
        let conn = db::memory();
        conn.execute("INSERT INTO items (category_id, title, sort_title) VALUES ((SELECT id FROM categories WHERE key = 'books'), 'Dune', 'dune')", []).unwrap();
        conn.execute("INSERT INTO activity (day, item_id, kind, seconds) VALUES (date('now', 'localtime'), 1, 'read', 600), (date('now', 'localtime', '-3 days'), 1, 'read', 300), (date('now', 'localtime', '-9 days'), 1, 'read', 900)", []).unwrap();
        let w = week(&conn).unwrap();
        assert_eq!(w.days.len(), 7);
        assert_eq!(w.read, 900);
        assert_eq!(w.previous, 900);
        assert_eq!(w.days_active, 2);
        assert_eq!(w.items, 1);
        assert_eq!(w.top_items[0].name, "Dune");
        assert_eq!(w.top_items[0].count, 15);
    }

    #[test]
    fn achievements_unlock_once_and_the_year_adds_up() {
        let conn = db::memory();
        conn.execute("INSERT INTO items (category_id, title, sort_title) VALUES ((SELECT id FROM categories WHERE key = 'books'), 'Dune', 'dune')", []).unwrap();
        conn.execute("INSERT INTO activity (day, item_id, kind, seconds) VALUES (date('now', 'localtime'), 1, 'read', 4000)", []).unwrap();
        let first = achievements(&conn).unwrap();
        let read = first.iter().find(|a| a.key == "read-1").unwrap();
        assert!(read.new && read.unlocked_at.is_some());
        assert_eq!(read.description, "1 hour of reading");
        assert_eq!(first.iter().find(|a| a.key == "read-10").unwrap().description, "10 hours of reading");
        let second = achievements(&conn).unwrap();
        assert!(!second.iter().find(|a| a.key == "read-1").unwrap().new, "unlocked only once");
        assert!(second.iter().find(|a| a.key == "read-10").unwrap().unlocked_at.is_none());
        let year: i64 = conn.query_row("SELECT CAST(strftime('%Y', 'now', 'localtime') AS INTEGER)", [], |row| row.get(0)).unwrap();
        let review = review(&conn, year).unwrap();
        assert_eq!(review.read, 4000);
        assert_eq!(review.days_active, 1);
        assert_eq!(review.top_items[0].name, "Dune");
    }
}

//! Watching (Phase 3): films and series episodes in the video player (player.rs), resuming where
//! they stopped, and what has been watched. A series' own progress row (part 0) sums up its
//! episodes, so it shows in "Pick up where you left off" and "Continue watching" (D-018).

use std::path::{Path, PathBuf};

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use tauri::{AppHandle, Manager, State, WebviewWindow};

use crate::error::{AppError, AppResult};
use crate::library::{blocking, with_library};
use crate::player::{self, PlayerState};
use crate::{pages, AppState, Library};

const VIDEO_EXTENSIONS: &[&str] = &["mp4", "m4v", "mkv", "mov", "avi", "webm", "wmv", "mpg", "mpeg", "ts", "m2ts", "ogv", "flv"];
/// Watched once this much has been seen; the end credits don't need to be sat through.
const WATCHED_AT: f64 = 0.92;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Episode {
    pub id: i64,
    pub season: Option<i64>,
    pub number: Option<f64>,
    pub title: Option<String>,
    pub duration_ms: Option<i64>,
    pub progress: f64,
    pub completed: bool,
    /// Where it stopped, in seconds.
    pub seconds: Option<f64>,
}

impl Episode {
    /// "S1 · E3 · The Fog".
    fn label(&self) -> String {
        let number = self.number.map(|n| if n.fract() == 0.0 { format!("{n:.0}") } else { n.to_string() }).unwrap_or_default();
        let mut parts = Vec::new();
        if let Some(season) = self.season {
            parts.push(format!("S{season}"));
        }
        parts.push(format!("E{number}"));
        if let Some(title) = self.title.as_deref().filter(|t| !t.is_empty()) {
            parts.push(title.to_string());
        }
        parts.join(" · ")
    }
}

fn episodes(conn: &Connection, item: i64) -> AppResult<Vec<Episode>> {
    let episodes = conn
        .prepare(
            "SELECT p.id, json_extract(p.metadata, '$.season'), p.number, p.title, p.duration_ms, pr.fraction, pr.completed, \
             json_extract(pr.locator, '$.seconds') \
             FROM parts p LEFT JOIN progress pr ON pr.item_id = p.item_id AND pr.part_id = p.id \
             WHERE p.item_id = ?1 AND p.kind = 'episode' \
             ORDER BY coalesce(json_extract(p.metadata, '$.season'), 0), p.number, p.position",
        )?
        .query_map([item], |row| {
            Ok(Episode {
                id: row.get(0)?,
                season: row.get(1)?,
                number: row.get(2)?,
                title: row.get(3)?,
                duration_ms: row.get(4)?,
                progress: row.get::<_, Option<f64>>(5)?.unwrap_or(0.0),
                completed: row.get::<_, Option<bool>>(6)?.unwrap_or(false),
                seconds: row.get(7)?,
            })
        })?
        .collect::<Result<_, _>>()?;
    Ok(episodes)
}

/// A series' episodes in order, with where each one stopped.
#[tauri::command]
pub async fn episodes_list(state: State<'_, AppState>, id: i64) -> AppResult<Vec<Episode>> {
    with_library(&state, move |library| library.db.with(|conn| episodes(conn, id))).await
}

/// What the player opened.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchTarget {
    pub item_id: i64,
    pub part_id: Option<i64>,
    pub title: String,
    /// The episode, for series ("S1 · E3 · The Fog").
    pub episode: Option<String>,
    /// Where playback starts, in seconds: where it stopped last time, or 0.
    pub start: f64,
    pub previous: Option<i64>,
    pub next: Option<i64>,
    pub next_label: Option<String>,
}

/// The episode to play when none is asked for: the one being watched, else the first not yet seen.
fn next_up(conn: &Connection, item: i64, list: &[Episode]) -> AppResult<Option<Episode>> {
    let last: Option<i64> = conn
        .query_row(
            "SELECT part_id FROM progress WHERE item_id = ?1 AND part_id <> 0 ORDER BY updated_at DESC LIMIT 1",
            [item],
            |row| row.get(0),
        )
        .optional()?;
    let last_index = last.and_then(|id| list.iter().position(|e| e.id == id));
    Ok(match last_index {
        Some(index) if !list[index].completed => Some(list[index].clone()),
        Some(index) => list[index + 1..].iter().find(|e| !e.completed).or_else(|| list.iter().find(|e| !e.completed)).cloned(),
        None => list.iter().find(|e| !e.completed).cloned(),
    }
    .or_else(|| list.first().cloned()))
}

fn video_file(library: &Library, conn: &Connection, item: i64, part: Option<i64>) -> AppResult<PathBuf> {
    let rows: Vec<(String, String, String)> = conn
        .prepare(
            "SELECT f.path, f.storage, f.status FROM files f JOIN versions v ON v.id = f.version_id \
             WHERE v.item_id = ?1 AND v.kind = 'digital' AND (?2 IS NULL OR f.part_id = ?2) \
             ORDER BY v.is_primary DESC, v.id, f.position",
        )?
        .query_map(params![item, part], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
        .collect::<Result<_, _>>()?;
    let is_video = |path: &str| {
        Path::new(path).extension().and_then(|e| e.to_str()).is_some_and(|e| VIDEO_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
    };
    let (path, storage, status) = rows
        .into_iter()
        .find(|(path, _, _)| is_video(path))
        .ok_or_else(|| AppError::msg("There's no video file to play yet. Use “Files” under Your copies to add one."))?;
    let path = library.folder.resolve(&path, &storage);
    if status != "ok" || !path.exists() {
        return Err(AppError::msg(pages::MISSING_FILES));
    }
    Ok(path)
}

fn resolve(library: &Library, item: i64, part: Option<i64>) -> AppResult<(WatchTarget, PathBuf)> {
    library.db.with(|conn| {
        let title: String = conn
            .query_row("SELECT title FROM items WHERE id = ?1", [item], |row| row.get(0))
            .optional()?
            .ok_or_else(|| AppError::msg("This item no longer exists."))?;
        let list = episodes(conn, item)?;
        let episode = match part {
            Some(id) => Some(list.iter().find(|e| e.id == id).cloned().ok_or_else(|| AppError::msg("That episode no longer exists."))?),
            None if list.is_empty() => None,
            None => next_up(conn, item, &list)?,
        };
        let part_id = episode.as_ref().map(|e| e.id);
        let path = video_file(library, conn, item, part_id)?;
        let (seconds, completed): (Option<f64>, bool) = conn
            .query_row(
                "SELECT json_extract(locator, '$.seconds'), completed FROM progress WHERE item_id = ?1 AND part_id = ?2",
                params![item, part_id.unwrap_or(0)],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?
            .unwrap_or((None, false));
        let start = match seconds {
            Some(seconds) if !completed && seconds >= 10.0 => seconds - 2.0,
            _ => 0.0,
        };
        let index = episode.as_ref().and_then(|e| list.iter().position(|x| x.id == e.id));
        let next = index.and_then(|i| list.get(i + 1));
        conn.execute("UPDATE items SET last_opened_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?1", [item])?;
        Ok((
            WatchTarget {
                item_id: item,
                part_id,
                title,
                episode: episode.as_ref().map(Episode::label),
                start,
                previous: index.filter(|&i| i > 0).map(|i| list[i - 1].id),
                next: next.map(|e| e.id),
                next_label: next.map(Episode::label),
            },
            path,
        ))
    })
}

/// Opens a film, or an episode of a series (the next one to watch when `part` is empty).
#[tauri::command]
pub async fn watch_open(
    app: AppHandle,
    window: WebviewWindow,
    player: State<'_, PlayerState>,
    id: i64,
    part: Option<i64>,
    volume: f64,
) -> AppResult<WatchTarget> {
    let library = app.state::<AppState>().library()?;
    let (target, path) = blocking(move || resolve(&library, id, part)).await?;
    player::start(&app, &window, &player, &path, target.start, volume).await?;
    Ok(target)
}

fn save(conn: &Connection, item: i64, part: i64, seconds: Option<f64>, fraction: f64, completed: bool) -> AppResult<()> {
    let locator = seconds.map(|s| serde_json::json!({ "seconds": (s * 10.0).round() / 10.0 }).to_string());
    conn.execute(
        "INSERT INTO progress (item_id, part_id, locator, fraction, completed, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) \
         ON CONFLICT(item_id, part_id) DO UPDATE SET locator = excluded.locator, fraction = excluded.fraction, \
         completed = excluded.completed, updated_at = excluded.updated_at",
        params![item, part, locator, fraction.clamp(0.0, 1.0), completed],
    )?;
    Ok(())
}

/// Sums a series' episodes up in its own progress row: how much has been watched, and done once
/// every episode is.
fn summarize(conn: &Connection, item: i64) -> AppResult<()> {
    let list = episodes(conn, item)?;
    if list.is_empty() {
        return Ok(());
    }
    if list.iter().all(|e| e.progress <= 0.0 && !e.completed) {
        conn.execute("DELETE FROM progress WHERE item_id = ?1 AND part_id = 0", [item])?;
        return Ok(());
    }
    let watched: f64 = list.iter().map(|e| if e.completed { 1.0 } else { e.progress }).sum();
    let done = list.iter().all(|e| e.completed);
    save(conn, item, 0, None, watched / list.len() as f64, done)
}

/// Remembers where a film or episode is; past 92% it counts as watched.
#[tauri::command]
pub async fn watch_progress_save(state: State<'_, AppState>, id: i64, part: Option<i64>, seconds: f64, duration: f64) -> AppResult<()> {
    if !seconds.is_finite() || !duration.is_finite() || duration <= 0.0 {
        return Ok(());
    }
    let fraction = (seconds / duration).clamp(0.0, 1.0);
    with_library(&state, move |library| {
        library.db.with(|conn| {
            save(conn, id, part.unwrap_or(0), Some(seconds.max(0.0)), fraction, fraction >= WATCHED_AT)?;
            if part.is_some() {
                summarize(conn, id)?;
            }
            Ok(())
        })
    })
    .await
}

/// Marks a film or an episode watched or unwatched by hand; for a whole series, every episode.
#[tauri::command]
pub async fn watch_mark(state: State<'_, AppState>, id: i64, part: Option<i64>, watched: bool) -> AppResult<()> {
    with_library(&state, move |library| {
        library.db.with(|conn| {
            let list = episodes(conn, id)?;
            let targets: Vec<i64> = match part {
                Some(part) => vec![part],
                None if !list.is_empty() => list.iter().map(|e| e.id).collect(),
                None => vec![0],
            };
            for target in targets {
                if watched {
                    save(conn, id, target, None, 1.0, true)?;
                } else {
                    conn.execute("DELETE FROM progress WHERE item_id = ?1 AND part_id = ?2", params![id, target])?;
                }
            }
            if !list.is_empty() {
                summarize(conn, id)?;
            }
            Ok(())
        })
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn library_with_series() -> Connection {
        let conn = crate::db::memory();
        conn.execute("INSERT INTO items (id, category_id, title, sort_title) VALUES (1, (SELECT id FROM categories WHERE key = 'video'), 'Show', 'show')", []).unwrap();
        for (id, season, number) in [(11, 1, 1.0), (12, 1, 2.0), (21, 2, 1.0)] {
            conn.execute(
                "INSERT INTO parts (id, item_id, kind, number, title, metadata) VALUES (?1, 1, 'episode', ?2, 'x', json_object('season', ?3))",
                params![id, number, season],
            )
            .unwrap();
        }
        conn
    }

    #[test]
    fn series_progress_sums_up_episodes() {
        let conn = library_with_series();
        save(&conn, 1, 11, Some(100.0), 1.0, true).unwrap();
        save(&conn, 1, 12, Some(50.0), 0.5, false).unwrap();
        summarize(&conn, 1).unwrap();
        let (fraction, completed): (f64, bool) = conn.query_row("SELECT fraction, completed FROM progress WHERE item_id = 1 AND part_id = 0", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert!((fraction - 0.5).abs() < 1e-9);
        assert!(!completed);
    }

    #[test]
    fn next_up_continues_the_series() {
        let conn = library_with_series();
        let list = episodes(&conn, 1).unwrap();
        assert_eq!(list.iter().map(|e| e.id).collect::<Vec<_>>(), vec![11, 12, 21]);
        assert_eq!(next_up(&conn, 1, &list).unwrap().map(|e| e.id), Some(11));
        save(&conn, 1, 11, None, 1.0, true).unwrap();
        let list = episodes(&conn, 1).unwrap();
        assert_eq!(next_up(&conn, 1, &list).unwrap().map(|e| e.id), Some(12));
        assert_eq!(list[2].label(), "S2 · E1 · x");
    }
}

//! Videos into Movies & Series (D-135): videos already in Videos become movies, or the episodes of
//! a series (a new one, or one already there). Items otherwise stay in their category (D-126);
//! this is the one way across, and only for videos with a file (not online items).

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::State;

use crate::error::{AppError, AppResult};
use crate::library::{category_id, reindex, sort_key, with_library};
use crate::AppState;

const NOW: &str = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

/// A series in Movies & Series, to add episodes to.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FilmSeries {
    pub id: i64,
    pub title: String,
    pub cover_key: Option<String>,
    pub episodes: i64,
    /// The highest season it has (1 when its episodes have none).
    pub last_season: i64,
}

#[tauri::command]
pub async fn films_series(state: State<'_, AppState>) -> AppResult<Vec<FilmSeries>> {
    with_library(&state, |library| {
        library.db.with(|conn| {
            let rows = conn
                .prepare(
                    "SELECT i.id, i.title, i.cover_key, \
                       (SELECT count(*) FROM parts p WHERE p.item_id = i.id AND p.kind = 'episode'), \
                       coalesce((SELECT max(json_extract(p.metadata, '$.season')) FROM parts p WHERE p.item_id = i.id AND p.kind = 'episode'), 1) \
                     FROM items i JOIN categories c ON c.id = i.category_id \
                     WHERE c.key = 'video' AND json_extract(i.metadata, '$.kind') = 'series' ORDER BY i.sort_title",
                )?
                .query_map([], |row| Ok(FilmSeries { id: row.get(0)?, title: row.get(1)?, cover_key: row.get(2)?, episodes: row.get(3)?, last_season: row.get(4)? }))?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(rows)
        })
    })
    .await
}

/// Where videos go as a series: a new one by name, or one already in Movies & Series.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SeriesTarget {
    pub existing: Option<i64>,
    pub name: Option<String>,
    /// The season they belong to; episodes are numbered on from the last one in it.
    pub season: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToFilms {
    /// Videos, in the order they go in (a series' episode order).
    pub ids: Vec<i64>,
    /// None: each video becomes a movie.
    pub series: Option<SeriesTarget>,
}

/// Moves videos from Videos into Movies & Series. Returns the items they became (the movies, or
/// the one series).
#[tauri::command]
pub async fn videos_to_films(state: State<'_, AppState>, request: ToFilms) -> AppResult<Vec<i64>> {
    with_library(&state, move |library| library.db.with(|conn| to_films(conn, &request))).await
}

pub fn to_films(conn: &mut Connection, request: &ToFilms) -> AppResult<Vec<i64>> {
    if request.ids.is_empty() {
        return Err(AppError::msg("Pick at least one video."));
    }
    let tx = conn.transaction()?;
    let videos = category_id(&tx, "videos")?;
    let films = category_id(&tx, "video")?;
    for id in &request.ids {
        let (category, files): (i64, i64) = tx
            .query_row(
                "SELECT i.category_id, (SELECT count(*) FROM files f JOIN versions v ON v.id = f.version_id WHERE v.item_id = i.id) FROM items i WHERE i.id = ?1",
                [id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?
            .ok_or_else(|| AppError::msg("One of the videos isn't in the library anymore."))?;
        if category != videos {
            return Err(AppError::msg("Only videos in Videos can go to Movies & Series."));
        }
        if files == 0 {
            return Err(AppError::msg("Online videos have no file to watch here; download them first."));
        }
    }
    let result = match &request.series {
        None => {
            for id in &request.ids {
                // Movies & Series' covers are vertical (D-027); collections belong to Videos.
                tx.execute(
                    &format!("UPDATE items SET category_id = ?2, collection_id = NULL, metadata = json_remove(metadata, '$.coverShape'), updated_at = {NOW} WHERE id = ?1"),
                    params![id, films],
                )?;
                reindex(&tx, *id)?;
            }
            request.ids.clone()
        }
        Some(target) => vec![into_series(&tx, films, &request.ids, target)?],
    };
    tx.commit()?;
    Ok(result)
}

/// The videos become episodes of a series, in their order: their files move to the series, and the
/// video items go.
fn into_series(tx: &Connection, films: i64, ids: &[i64], target: &SeriesTarget) -> AppResult<i64> {
    let season = target.season.unwrap_or(1).clamp(0, 999);
    let series = match target.existing {
        Some(id) => {
            let fits: bool = tx
                .query_row("SELECT category_id = ?2 AND json_extract(metadata, '$.kind') = 'series' FROM items WHERE id = ?1", params![id, films], |row| row.get(0))
                .optional()?
                .unwrap_or(false);
            if !fits {
                return Err(AppError::msg("That series isn't in Movies & Series anymore."));
            }
            id
        }
        None => {
            let name = target.name.as_deref().map(str::trim).filter(|n| !n.is_empty()).ok_or_else(|| AppError::msg("Give the series a name."))?;
            let name: String = name.chars().take(200).collect();
            // The first video's picture is the series' cover until another is chosen.
            let (cover, color): (Option<String>, Option<String>) = tx.query_row("SELECT cover_key, cover_color FROM items WHERE id = ?1", [ids[0]], |row| Ok((row.get(0)?, row.get(1)?)))?;
            tx.execute(
                "INSERT INTO items (category_id, title, sort_title, cover_key, cover_color, metadata) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![films, name, sort_key(&name), cover, color, json!({ "kind": "series", "seasons": 1 }).to_string()],
            )?;
            tx.last_insert_rowid()
        }
    };
    // Its digital version, made with the first video's format when it has none.
    let version: i64 = match tx
        .query_row("SELECT id FROM versions WHERE item_id = ?1 AND kind = 'digital' ORDER BY is_primary DESC, id LIMIT 1", [series], |row| row.get(0))
        .optional()?
    {
        Some(version) => version,
        None => {
            let format: Option<String> = tx
                .query_row("SELECT format FROM versions WHERE item_id = ?1 AND kind = 'digital' ORDER BY is_primary DESC, id LIMIT 1", [ids[0]], |row| row.get(0))
                .optional()?
                .flatten();
            tx.execute("INSERT INTO versions (item_id, kind, format, is_primary) VALUES (?1, 'digital', ?2, 1)", params![series, format])?;
            tx.last_insert_rowid()
        }
    };
    let (mut number, mut position): (f64, i64) = tx.query_row(
        "SELECT coalesce(max(CASE WHEN coalesce(json_extract(metadata, '$.season'), 1) = ?2 THEN number END), 0), coalesce(max(position), -1) \
         FROM parts WHERE item_id = ?1 AND kind = 'episode'",
        params![series, season],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    for id in ids {
        number = number.floor() + 1.0;
        position += 1;
        let (title, duration): (String, Option<f64>) = tx.query_row("SELECT title, json_extract(metadata, '$.durationSec') FROM items WHERE id = ?1", [id], |row| Ok((row.get(0)?, row.get(1)?)))?;
        tx.execute(
            "INSERT INTO parts (item_id, kind, number, title, duration_ms, position, metadata) VALUES (?1, 'episode', ?2, ?3, ?4, ?5, ?6)",
            params![series, number, title, duration.map(|s| (s * 1000.0).round() as i64), position, json!({ "season": season }).to_string()],
        )?;
        let part = tx.last_insert_rowid();
        tx.execute(
            "UPDATE files SET version_id = ?2, part_id = ?3, position = ?4 WHERE version_id IN (SELECT id FROM versions WHERE item_id = ?1)",
            params![id, version, part, position],
        )?;
        tx.execute("DELETE FROM items_fts WHERE rowid = ?1", [id])?;
        tx.execute("DELETE FROM items WHERE id = ?1", [id])?;
    }
    tx.execute(
        &format!(
            "UPDATE items SET metadata = json_set(metadata, '$.seasons', \
               (SELECT count(DISTINCT coalesce(json_extract(p.metadata, '$.season'), 1)) FROM parts p WHERE p.item_id = items.id AND p.kind = 'episode')), \
             updated_at = {NOW} WHERE id = ?1"
        ),
        [series],
    )?;
    reindex(tx, series)?;
    Ok(series)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn library() -> Connection {
        crate::db::memory()
    }

    fn video(conn: &Connection, title: &str, duration: f64) -> i64 {
        let videos = category_id(conn, "videos").unwrap();
        conn.execute(
            "INSERT INTO items (category_id, title, sort_title, metadata) VALUES (?1, ?2, ?2, ?3)",
            params![videos, title, json!({ "durationSec": duration, "coverShape": "landscape" }).to_string()],
        )
        .unwrap();
        let item = conn.last_insert_rowid();
        conn.execute("INSERT INTO versions (item_id, kind, format, is_primary) VALUES (?1, 'digital', 'mp4', 1)", [item]).unwrap();
        let version = conn.last_insert_rowid();
        conn.execute("INSERT INTO files (version_id, position, path, storage, size, status) VALUES (?1, 0, ?2, 'referenced', 10, 'ok')", params![version, format!("C:/v/{title}.mp4")]).unwrap();
        item
    }

    #[test]
    fn videos_become_movies_or_episodes() {
        let mut conn = library();
        let films = category_id(&conn, "video").unwrap();
        let movie = video(&conn, "Short Film", 600.0);
        assert_eq!(to_films(&mut conn, &ToFilms { ids: vec![movie], series: None }).unwrap(), vec![movie]);
        let (category, shape): (i64, Option<String>) = conn.query_row("SELECT category_id, json_extract(metadata, '$.coverShape') FROM items WHERE id = ?1", [movie], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!((category, shape), (films, None));
        // Once in Movies & Series, it can't be moved again this way.
        assert!(to_films(&mut conn, &ToFilms { ids: vec![movie], series: None }).is_err());

        let (one, two) = (video(&conn, "Pilot", 1500.0), video(&conn, "Second", 1400.0));
        let target = SeriesTarget { existing: None, name: Some("My Show".into()), season: Some(1) };
        let series = to_films(&mut conn, &ToFilms { ids: vec![one, two], series: Some(target) }).unwrap()[0];
        let episodes: Vec<(f64, String, i64)> = conn
            .prepare("SELECT number, title, duration_ms FROM parts WHERE item_id = ?1 AND kind = 'episode' ORDER BY position")
            .unwrap()
            .query_map([series], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(episodes, vec![(1.0, "Pilot".into(), 1_500_000), (2.0, "Second".into(), 1_400_000)]);
        let files: i64 = conn.query_row("SELECT count(*) FROM files f JOIN versions v ON v.id = f.version_id WHERE v.item_id = ?1 AND f.part_id IS NOT NULL", [series], |r| r.get(0)).unwrap();
        assert_eq!(files, 2);
        let left: i64 = conn.query_row("SELECT count(*) FROM items WHERE id IN (?1, ?2)", params![one, two], |r| r.get(0)).unwrap();
        assert_eq!(left, 0, "the videos became episodes");

        // More episodes join the same series, numbered on; a new season starts at 1.
        let three = video(&conn, "Third", 1300.0);
        to_films(&mut conn, &ToFilms { ids: vec![three], series: Some(SeriesTarget { existing: Some(series), name: None, season: Some(1) }) }).unwrap();
        let four = video(&conn, "New Season", 1300.0);
        to_films(&mut conn, &ToFilms { ids: vec![four], series: Some(SeriesTarget { existing: Some(series), name: None, season: Some(2) }) }).unwrap();
        let numbers: Vec<(i64, f64)> = conn
            .prepare("SELECT json_extract(metadata, '$.season'), number FROM parts WHERE item_id = ?1 ORDER BY position")
            .unwrap()
            .query_map([series], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(numbers, vec![(1, 1.0), (1, 2.0), (1, 3.0), (2, 1.0)]);
        let seasons: i64 = conn.query_row("SELECT json_extract(metadata, '$.seasons') FROM items WHERE id = ?1", [series], |r| r.get(0)).unwrap();
        assert_eq!(seasons, 2);
    }
}

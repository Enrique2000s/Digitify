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
                // Movies & Series show their own default shape (horizontal unless set, D-174); collections belong to Videos.
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

// ---------------------------------------------------------------------------------------------
// Editing a series (D-174): its episodes' order, adding and removing episodes, their thumbnails.

/// How many seasons a series has, kept in its metadata.
fn count_seasons(tx: &Connection, series: i64) -> rusqlite::Result<()> {
    tx.execute(
        &format!(
            "UPDATE items SET metadata = json_set(metadata, '$.seasons', \
               (SELECT count(DISTINCT coalesce(json_extract(p.metadata, '$.season'), 1)) FROM parts p WHERE p.item_id = items.id AND p.kind = 'episode')), \
             updated_at = {NOW} WHERE id = ?1"
        ),
        [series],
    )?;
    Ok(())
}

/// A series' episodes in a new order: their positions follow it, and each season's episodes are
/// numbered 1, 2, 3… in it.
#[tauri::command]
pub async fn episodes_arrange(state: State<'_, AppState>, id: i64, order: Vec<i64>) -> AppResult<()> {
    with_library(&state, move |library| library.db.with(|conn| arrange(conn, id, &order))).await
}

pub fn arrange(conn: &mut Connection, series: i64, order: &[i64]) -> AppResult<()> {
    let tx = conn.transaction()?;
    let seasons: Vec<(i64, i64)> = tx
        .prepare("SELECT id, coalesce(json_extract(metadata, '$.season'), 1) FROM parts WHERE item_id = ?1 AND kind = 'episode'")?
        .query_map([series], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect::<Result<_, _>>()?;
    let mut seen = std::collections::HashSet::new();
    if order.len() != seasons.len() || !order.iter().all(|part| seen.insert(*part) && seasons.iter().any(|(id, _)| id == part)) {
        return Err(AppError::msg("The series' episodes changed meanwhile; open it again."));
    }
    let mut numbers: std::collections::HashMap<i64, f64> = std::collections::HashMap::new();
    for (position, part) in order.iter().enumerate() {
        let season = seasons.iter().find(|(id, _)| id == part).map_or(1, |(_, season)| *season);
        let number = numbers.entry(season).or_insert(0.0);
        *number += 1.0;
        tx.execute("UPDATE parts SET position = ?2, number = ?3 WHERE id = ?1", params![part, position as i64, *number])?;
        tx.execute("UPDATE files SET position = ?2 WHERE part_id = ?1", params![part, position as i64])?;
    }
    tx.execute(&format!("UPDATE items SET updated_at = {NOW} WHERE id = ?1"), [series])?;
    tx.commit()?;
    Ok(())
}

/// Takes an episode out of its series: it becomes a video of its own in Videos, with its file,
/// its title and its thumbnail as its cover. Gives the new video's id.
#[tauri::command]
pub async fn episode_remove(state: State<'_, AppState>, id: i64, part: i64) -> AppResult<i64> {
    with_library(&state, move |library| library.db.with(|conn| remove_episode(conn, id, part))).await
}

pub fn remove_episode(conn: &mut Connection, series: i64, part: i64) -> AppResult<i64> {
    let tx = conn.transaction()?;
    let (title, number, duration, thumb): (Option<String>, Option<f64>, Option<i64>, Option<String>) = tx
        .query_row(
            "SELECT title, number, duration_ms, json_extract(metadata, '$.thumb') FROM parts WHERE id = ?1 AND item_id = ?2 AND kind = 'episode'",
            params![part, series],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()?
        .ok_or_else(|| AppError::msg("That episode isn't in this series anymore."))?;
    let series_title: String = tx.query_row("SELECT title FROM items WHERE id = ?1", [series], |row| row.get(0))?;
    let title = title.filter(|t| !t.trim().is_empty()).unwrap_or_else(|| match number {
        Some(n) if n.fract() == 0.0 => format!("{series_title} · Episode {n:.0}"),
        _ => format!("{series_title} · Episode"),
    });
    let format: Option<String> = tx
        .query_row("SELECT v.format FROM files f JOIN versions v ON v.id = f.version_id WHERE f.part_id = ?1 LIMIT 1", [part], |row| row.get(0))
        .optional()?
        .flatten();
    let videos = category_id(&tx, "videos")?;
    let metadata = match duration {
        Some(ms) => json!({ "durationSec": ms as f64 / 1000.0 }),
        None => json!({}),
    };
    tx.execute(
        "INSERT INTO items (category_id, title, sort_title, cover_key, metadata) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![videos, title, sort_key(&title), thumb, metadata.to_string()],
    )?;
    let video = tx.last_insert_rowid();
    tx.execute("INSERT INTO versions (item_id, kind, format, is_primary) VALUES (?1, 'digital', ?2, 1)", params![video, format])?;
    let version = tx.last_insert_rowid();
    tx.execute("UPDATE files SET version_id = ?2, part_id = NULL, position = 0 WHERE part_id = ?1", params![part, version])?;
    tx.execute("DELETE FROM progress WHERE item_id = ?1 AND part_id = ?2", params![series, part])?;
    tx.execute("DELETE FROM parts WHERE id = ?1", [part])?;
    count_seasons(&tx, series)?;
    reindex(&tx, series)?;
    reindex(&tx, video)?;
    tx.commit()?;
    Ok(video)
}

/// Video files as new episodes at the end of a season of a series: added to the library as Videos
/// are (kept where they are or copied in), then joined to the series.
#[tauri::command]
pub async fn series_add_files(state: State<'_, AppState>, id: i64, paths: Vec<String>, season: Option<i64>, mode: crate::import::ImportMode) -> AppResult<()> {
    with_library(&state, move |library| {
        let paths: Vec<std::path::PathBuf> = paths.iter().map(std::path::PathBuf::from).collect();
        let ids = crate::import::import_videos(library, &paths, mode)?;
        if ids.is_empty() {
            return Ok(());
        }
        library.db.with(|conn| to_films(conn, &ToFilms { ids, series: Some(SeriesTarget { existing: Some(id), name: None, season }) })).map(|_| ())
    })
    .await
}

/// A picture of the user's as an episode's thumbnail, or none to go back to a frame of it.
#[tauri::command]
pub async fn episode_set_thumb(state: State<'_, AppState>, part: i64, path: Option<String>) -> AppResult<()> {
    with_library(&state, move |library| {
        let art = match &path {
            Some(path) => {
                let bytes = std::fs::read(path).map_err(|e| AppError::msg(format!("Couldn't read {path}: {e}")))?;
                Some(crate::artwork::store(&library.folder, &bytes)?)
            }
            None => None,
        };
        library.db.with(|conn| {
            let changed = match &art {
                Some(art) => conn.execute(
                    "UPDATE parts SET metadata = json_set(metadata, '$.thumb', ?2, '$.thumbOwn', 1) WHERE id = ?1 AND kind = 'episode'",
                    params![part, art.key],
                )?,
                None => conn.execute("UPDATE parts SET metadata = json_remove(metadata, '$.thumb', '$.thumbOwn') WHERE id = ?1 AND kind = 'episode'", [part])?,
            };
            if changed == 0 {
                return Err(AppError::msg("That episode isn't in the library anymore."));
            }
            Ok(())
        })
    })
    .await
}

/// Gives each episode of a series without a thumbnail a frame of it (15% in, at most two minutes),
/// one at a time and outside the database lock. Returns how many were made.
#[tauri::command]
pub async fn episode_thumbs_fill(state: State<'_, AppState>, id: i64) -> AppResult<usize> {
    with_library(&state, move |library| {
        let wanted: Vec<(i64, Option<i64>, std::path::PathBuf)> = library.db.with(|conn| {
            let list = crate::watch::episodes(conn, id)?;
            Ok(list
                .into_iter()
                .filter(|e| e.thumb.is_none())
                .filter_map(|e| crate::watch::video_file(library, conn, id, Some(e.id)).ok().map(|path| (e.id, e.duration_ms, path)))
                .collect())
        })?;
        let mut made = 0;
        for (part, duration, path) in wanted {
            let at = duration.map_or(20.0, |ms| (ms as f64 / 1000.0 * 0.15).clamp(1.0, 120.0));
            let Some(frame) = crate::formats::video_frame(&path, at).or_else(|| crate::formats::video_frame(&path, 1.0)) else { continue };
            let Ok(art) = crate::artwork::store(&library.folder, &frame) else { continue };
            library.db.with(|conn| {
                conn.execute(
                    "UPDATE parts SET metadata = json_set(metadata, '$.thumb', ?2) WHERE id = ?1 AND json_extract(metadata, '$.thumb') IS NULL",
                    params![part, art.key],
                )?;
                Ok(())
            })?;
            made += 1;
        }
        Ok(made)
    })
    .await
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

    fn episodes(conn: &Connection, series: i64) -> Vec<(String, i64, f64)> {
        conn.prepare("SELECT title, coalesce(json_extract(metadata, '$.season'), 1), number FROM parts WHERE item_id = ?1 AND kind = 'episode' ORDER BY position")
            .unwrap()
            .query_map([series], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap()
    }

    #[test]
    fn a_series_is_reordered_and_an_episode_leaves_for_videos() {
        let mut conn = library();
        let (a, b, c) = (video(&conn, "A", 100.0), video(&conn, "B", 200.0), video(&conn, "C", 300.0));
        let series = to_films(&mut conn, &ToFilms { ids: vec![a, b, c], series: Some(SeriesTarget { existing: None, name: Some("Show".into()), season: Some(1) }) }).unwrap()[0];
        let d = video(&conn, "D", 400.0);
        to_films(&mut conn, &ToFilms { ids: vec![d], series: Some(SeriesTarget { existing: Some(series), name: None, season: Some(2) }) }).unwrap();
        let parts: Vec<i64> = conn.prepare("SELECT id FROM parts WHERE item_id = ?1 ORDER BY position").unwrap().query_map([series], |r| r.get(0)).unwrap().collect::<Result<_, _>>().unwrap();

        // C first: each season numbered in the new order.
        arrange(&mut conn, series, &[parts[2], parts[0], parts[3], parts[1]]).unwrap();
        assert_eq!(
            episodes(&conn, series),
            vec![("C".into(), 1, 1.0), ("A".into(), 1, 2.0), ("D".into(), 2, 1.0), ("B".into(), 1, 3.0)]
        );
        // An order that leaves an episode out, or repeats one, is refused.
        assert!(arrange(&mut conn, series, &[parts[0], parts[1], parts[2]]).is_err());
        assert!(arrange(&mut conn, series, &[parts[0], parts[0], parts[1], parts[2]]).is_err());

        // D leaves: a video of its own in Videos with its file and its thumbnail; season 2 is gone.
        conn.execute("UPDATE parts SET metadata = json_set(metadata, '$.thumb', 'abc') WHERE id = ?1", [parts[3]]).unwrap();
        let video_id = remove_episode(&mut conn, series, parts[3]).unwrap();
        let (category, title, cover, files): (String, String, Option<String>, i64) = conn
            .query_row(
                "SELECT c.key, i.title, i.cover_key, (SELECT count(*) FROM files f JOIN versions v ON v.id = f.version_id WHERE v.item_id = i.id AND f.part_id IS NULL) \
                 FROM items i JOIN categories c ON c.id = i.category_id WHERE i.id = ?1",
                [video_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap();
        assert_eq!((category.as_str(), title.as_str(), cover.as_deref(), files), ("videos", "D", Some("abc"), 1));
        assert_eq!(episodes(&conn, series).len(), 3);
        let seasons: i64 = conn.query_row("SELECT json_extract(metadata, '$.seasons') FROM items WHERE id = ?1", [series], |r| r.get(0)).unwrap();
        assert_eq!(seasons, 1);
        // It can come back as an episode, as any video can.
        to_films(&mut conn, &ToFilms { ids: vec![video_id], series: Some(SeriesTarget { existing: Some(series), name: None, season: Some(1) }) }).unwrap();
        assert_eq!(episodes(&conn, series).last().unwrap(), &("D".to_string(), 1, 4.0));
        assert!(remove_episode(&mut conn, series, 999_999).is_err(), "no such episode");
    }
}

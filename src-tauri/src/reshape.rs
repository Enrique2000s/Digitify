//! Data changes a schema migration needs that SQL alone can't make: they run in the migration's
//! transaction, right after its script.

use rusqlite::{params, Connection};

use crate::error::AppResult;
use crate::library::{reindex, sort_key, upsert_person};

/// Runs the Rust half of migration `version`, if it has one.
pub fn after(conn: &Connection, version: i64) -> AppResult<()> {
    if version == 7 {
        d027(conn)?;
    }
    Ok(())
}

/// D-027: the new category order, loose videos into Videos, and every track its own item.
fn d027(conn: &Connection) -> AppResult<()> {
    order_categories(conn)?;
    move_loose_videos(conn)?;
    split_albums(conn)?;
    Ok(())
}

/// Music, Videos, Movies & Series, Books, Comics, Manga, then custom categories as they were. An
/// order the owner arranged themself is kept, with Videos placed right after Movies & Series.
fn order_categories(conn: &Connection) -> AppResult<()> {
    let builtins: String = conn.query_row(
        "SELECT group_concat(key, ',') FROM (SELECT key FROM categories WHERE is_builtin = 1 AND key <> 'videos' ORDER BY sort_order, id)",
        [],
        |row| row.get(0),
    )?;
    if builtins == "books,comics,manga,video,music" {
        for (position, key) in ["music", "videos", "video", "books", "comics", "manga"].iter().enumerate() {
            conn.execute("UPDATE categories SET sort_order = ?2 WHERE key = ?1", params![key, position as i64 + 1])?;
        }
        conn.execute("UPDATE categories SET sort_order = sort_order + 6 WHERE is_builtin = 0", [])?;
    } else {
        conn.execute("UPDATE categories SET sort_order = sort_order * 2 WHERE key <> 'videos'", [])?;
        conn.execute("UPDATE categories SET sort_order = (SELECT sort_order + 1 FROM categories WHERE key = 'video') WHERE key = 'videos'", [])?;
    }
    Ok(())
}

/// Videos that aren't a series, have no year and sit in no collection were never films: they move
/// to Videos. Movies & Series keeps only vertical covers.
fn move_loose_videos(conn: &Connection) -> AppResult<()> {
    conn.execute(
        "UPDATE items SET category_id = (SELECT id FROM categories WHERE key = 'videos') \
         WHERE category_id = (SELECT id FROM categories WHERE key = 'video') AND year IS NULL AND collection_id IS NULL \
         AND coalesce(json_extract(metadata, '$.kind'), '') <> 'series'",
        [],
    )?;
    conn.execute(
        "UPDATE items SET metadata = json_remove(metadata, '$.coverShape') \
         WHERE category_id = (SELECT id FROM categories WHERE key = 'video') AND json_extract(metadata, '$.coverShape') = 'landscape'",
        [],
    )?;
    let moved: Vec<i64> = conn
        .prepare("SELECT id FROM items WHERE category_id = (SELECT id FROM categories WHERE key = 'videos')")?
        .query_map([], |row| row.get(0))?
        .collect::<Result<_, _>>()?;
    for id in moved {
        reindex(conn, id)?;
    }
    Ok(())
}

/// Each track of an album becomes an item of its own, with the album's cover, people, tags,
/// shelves and favorite mark, and its own file. The part (and so playlists, favorites and plays)
/// stays the same row; the album's name is kept as a detail of each track.
fn split_albums(conn: &Connection) -> AppResult<()> {
    let albums: Vec<i64> = conn
        .prepare(
            "SELECT i.id FROM items i JOIN categories c ON c.id = i.category_id \
             WHERE c.handler = 'audio' AND EXISTS (SELECT 1 FROM parts p WHERE p.item_id = i.id AND p.kind = 'track')",
        )?
        .query_map([], |row| row.get(0))?
        .collect::<Result<_, _>>()?;
    for album in albums {
        let tracks: Vec<(i64, Option<String>, Option<i64>, Option<f64>, Option<String>, bool)> = conn
            .prepare(
                "SELECT id, title, duration_ms, number, json_extract(metadata, '$.artist'), is_favorite FROM parts \
                 WHERE item_id = ?1 AND kind = 'track' ORDER BY position, number, id",
            )?
            .query_map([album], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?)))?
            .collect::<Result<_, _>>()?;
        for (index, (part, title, duration_ms, number, artist, favorite)) in tracks.into_iter().enumerate() {
            let item = if index == 0 { album } else { copy_item(conn, album, part)? };
            let title = title.filter(|t| !t.trim().is_empty()).unwrap_or(conn.query_row("SELECT title FROM items WHERE id = ?1", [item], |row| row.get(0))?);
            conn.execute(
                "UPDATE items SET title = ?2, sort_title = ?3, is_favorite = (is_favorite OR ?4), \
                 metadata = json_remove(json_set(metadata, '$.durationSec', ?5, '$.trackNumber', ?6), '$.discCount') WHERE id = ?1",
                params![item, title, sort_key(&title), favorite, duration_ms.map(|ms| ms / 1000), number],
            )?;
            if let Some(artist) = artist.filter(|a| !a.trim().is_empty()) {
                conn.execute("DELETE FROM item_people WHERE item_id = ?1 AND role = 'artist'", [item])?;
                let person = upsert_person(conn, &artist)?;
                conn.execute("INSERT INTO item_people (item_id, person_id, role, position) VALUES (?1, ?2, 'artist', 0)", params![item, person])?;
            }
            conn.execute(
                "UPDATE parts SET metadata = json_remove(metadata, '$.artist'), \
                 is_favorite = (SELECT is_favorite FROM items WHERE id = ?2) WHERE id = ?1",
                params![part, item],
            )?;
            reindex(conn, item)?;
        }
    }
    Ok(())
}

/// A new item like `album` holding only `part`: its file moves to a copy of the album's version.
fn copy_item(conn: &Connection, album: i64, part: i64) -> AppResult<i64> {
    conn.execute(
        "INSERT INTO items (category_id, collection_id, title, sort_title, subtitle, year, description, position, cover_key, \
         cover_color, is_favorite, rating, metadata, added_at, updated_at, last_opened_at) \
         SELECT category_id, collection_id, title, sort_title, subtitle, year, description, position, cover_key, \
         cover_color, is_favorite, rating, metadata, added_at, updated_at, last_opened_at FROM items WHERE id = ?1",
        [album],
    )?;
    let item = conn.last_insert_rowid();
    conn.execute("INSERT INTO item_people (item_id, person_id, role, position) SELECT ?2, person_id, role, position FROM item_people WHERE item_id = ?1", params![album, item])?;
    conn.execute("INSERT INTO item_tags (item_id, tag_id) SELECT ?2, tag_id FROM item_tags WHERE item_id = ?1", params![album, item])?;
    conn.execute(
        "INSERT INTO shelf_items (shelf_id, item_id, position, added_at) SELECT shelf_id, ?2, position, added_at FROM shelf_items WHERE item_id = ?1",
        params![album, item],
    )?;
    let versions: Vec<i64> = conn
        .prepare("SELECT DISTINCT version_id FROM files WHERE part_id = ?1")?
        .query_map([part], |row| row.get(0))?
        .collect::<Result<_, _>>()?;
    for version in versions {
        conn.execute(
            "INSERT INTO versions (item_id, kind, label, format, edition, condition, location, acquired_at, notes, is_primary, metadata) \
             SELECT ?2, kind, label, format, edition, condition, location, acquired_at, notes, is_primary, metadata FROM versions WHERE id = ?1",
            params![version, item],
        )?;
        let copy = conn.last_insert_rowid();
        conn.execute("UPDATE files SET version_id = ?3, position = 0 WHERE version_id = ?1 AND part_id = ?2", params![version, part, copy])?;
    }
    conn.execute("UPDATE parts SET item_id = ?2, position = 0 WHERE id = ?1", params![part, item])?;
    conn.execute("UPDATE progress SET item_id = ?2 WHERE item_id = ?1 AND part_id = ?3", params![album, item, part])?;
    Ok(item)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn albums_become_tracks_and_loose_videos_move() {
        let conn = crate::db::memory();
        // The migrations already ran on an empty library; run the reshaping again on some data.
        conn.execute("INSERT INTO items (id, category_id, title, sort_title, cover_key, is_favorite, metadata) VALUES (1, (SELECT id FROM categories WHERE key = 'music'), 'Album', 'album', 'abc', 0, '{\"album\":\"Album\",\"discCount\":1}')", []).unwrap();
        conn.execute("INSERT INTO people (id, name, sort_name) VALUES (1, 'Band', 'Band')", []).unwrap();
        conn.execute("INSERT INTO item_people (item_id, person_id, role, position) VALUES (1, 1, 'artist', 0)", []).unwrap();
        conn.execute("INSERT INTO versions (id, item_id, kind, format, is_primary) VALUES (1, 1, 'digital', 'mp3', 1)", []).unwrap();
        for (id, title, artist, favorite) in [(1, "One", None, 0), (2, "Two", Some("Guest"), 1)] {
            let metadata = artist.map(|a| format!("{{\"artist\":\"{a}\"}}")).unwrap_or("{}".into());
            conn.execute("INSERT INTO parts (id, item_id, kind, number, title, duration_ms, position, metadata, is_favorite) VALUES (?1, 1, 'track', ?1, ?2, 61000, ?1, ?3, ?4)", params![id, title, metadata, favorite]).unwrap();
            conn.execute("INSERT INTO files (version_id, part_id, position, path, storage) VALUES (1, ?1, ?1, ?2, 'referenced')", params![id, format!("C:/m/{title}.mp3")]).unwrap();
        }
        conn.execute("INSERT INTO playlists (id, name) VALUES (1, 'Mix')", []).unwrap();
        conn.execute("INSERT INTO playlist_tracks (playlist_id, part_id, position) VALUES (1, 2, 0)", []).unwrap();
        conn.execute("INSERT INTO items (id, category_id, title, sort_title) VALUES (10, (SELECT id FROM categories WHERE key = 'video'), 'Clip', 'clip')", []).unwrap();
        conn.execute("INSERT INTO items (id, category_id, title, sort_title, year) VALUES (11, (SELECT id FROM categories WHERE key = 'video'), 'Film', 'film', 1999)", []).unwrap();

        move_loose_videos(&conn).unwrap();
        split_albums(&conn).unwrap();

        let rows: Vec<(i64, String, String, bool, Option<String>)> = conn
            .prepare(
                "SELECT i.id, i.title, (SELECT pe.name FROM item_people ip JOIN people pe ON pe.id = ip.person_id WHERE ip.item_id = i.id), \
                 i.is_favorite, i.cover_key FROM items i JOIN categories c ON c.id = i.category_id WHERE c.key = 'music' ORDER BY i.id",
            )
            .unwrap()
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!((rows[0].1.as_str(), rows[0].2.as_str(), rows[0].3), ("One", "Band", false));
        assert_eq!((rows[1].1.as_str(), rows[1].2.as_str(), rows[1].3), ("Two", "Guest", true));
        assert_eq!(rows[1].4.as_deref(), Some("abc"));
        // The second track's file and playlist entry followed it.
        let file_item: i64 = conn.query_row("SELECT v.item_id FROM files f JOIN versions v ON v.id = f.version_id WHERE f.part_id = 2", [], |row| row.get(0)).unwrap();
        assert_eq!(file_item, rows[1].0);
        let in_playlist: i64 = conn.query_row("SELECT p.item_id FROM playlist_tracks pt JOIN parts p ON p.id = pt.part_id", [], |row| row.get(0)).unwrap();
        assert_eq!(in_playlist, rows[1].0);
        let album: String = conn.query_row("SELECT json_extract(metadata, '$.album') FROM items WHERE id = ?1", [rows[1].0], |row| row.get(0)).unwrap();
        assert_eq!(album, "Album");
        let key = |id: i64| conn.query_row("SELECT c.key FROM items i JOIN categories c ON c.id = i.category_id WHERE i.id = ?1", [id], |row| row.get::<_, String>(0)).unwrap();
        assert_eq!(key(10), "videos");
        assert_eq!(key(11), "video");
    }

    #[test]
    fn the_new_category_order() {
        let conn = crate::db::memory();
        let keys: Vec<String> = conn.prepare("SELECT key FROM categories ORDER BY sort_order").unwrap().query_map([], |row| row.get(0)).unwrap().collect::<Result<_, _>>().unwrap();
        assert_eq!(keys, ["music", "videos", "video", "books", "comics", "manga"]);
    }
}

//! Library check (D-057): the files that can't be found where they were, and the same file in
//! more than one item (matched by content), to review in one place.

use serde::Serialize;
use tauri::State;

use crate::error::AppResult;
use crate::library::with_library;
use crate::AppState;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckedFile {
    pub item_id: i64,
    pub title: String,
    pub category: String,
    pub path: String,
    pub size: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryCheck {
    /// Files not found at their saved place (a drive unplugged, moved, renamed or deleted).
    pub missing: Vec<CheckedFile>,
    /// Groups of two or more items holding the same file content.
    pub duplicates: Vec<Vec<CheckedFile>>,
}

pub fn check(conn: &rusqlite::Connection) -> AppResult<LibraryCheck> {
    let file = |row: &rusqlite::Row<'_>| -> rusqlite::Result<CheckedFile> {
        Ok(CheckedFile { item_id: row.get(0)?, title: row.get(1)?, category: row.get(2)?, path: row.get(3)?, size: row.get(4)? })
    };
    let missing = conn
        .prepare(
            "SELECT i.id, i.title, c.name, f.path, f.size FROM files f JOIN versions v ON v.id = f.version_id JOIN items i ON i.id = v.item_id \
             JOIN categories c ON c.id = i.category_id WHERE f.status <> 'ok' ORDER BY i.sort_title, f.path LIMIT 2000",
        )?
        .query_map([], file)?
        .collect::<Result<Vec<_>, _>>()?;
    // The same content (quick hash and size) in different items.
    let rows: Vec<(String, CheckedFile)> = conn
        .prepare(
            "SELECT f.quick_hash || ':' || f.size, i.id, i.title, c.name, f.path, f.size FROM files f JOIN versions v ON v.id = f.version_id \
             JOIN items i ON i.id = v.item_id JOIN categories c ON c.id = i.category_id \
             WHERE f.quick_hash IS NOT NULL AND f.size > 0 AND (f.quick_hash, f.size) IN ( \
               SELECT f2.quick_hash, f2.size FROM files f2 JOIN versions v2 ON v2.id = f2.version_id \
               WHERE f2.quick_hash IS NOT NULL GROUP BY f2.quick_hash, f2.size HAVING count(DISTINCT v2.item_id) > 1) \
             ORDER BY 1, i.sort_title LIMIT 2000",
        )?
        .query_map([], |row| {
            Ok((row.get(0)?, CheckedFile { item_id: row.get(1)?, title: row.get(2)?, category: row.get(3)?, path: row.get(4)?, size: row.get(5)? }))
        })?
        .collect::<Result<_, _>>()?;
    let mut duplicates: Vec<Vec<CheckedFile>> = Vec::new();
    let mut last = String::new();
    for (key, file) in rows {
        if key != last || duplicates.is_empty() {
            duplicates.push(Vec::new());
            last = key;
        }
        duplicates.last_mut().unwrap().push(file);
    }
    duplicates.retain(|group| group.len() > 1);
    Ok(LibraryCheck { missing, duplicates })
}

#[tauri::command]
pub async fn library_check(state: State<'_, AppState>) -> AppResult<LibraryCheck> {
    with_library(&state, |library| library.db.with(|conn| check(conn))).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    #[test]
    fn finds_missing_files_and_duplicates() {
        let conn = db::memory();
        let books = "(SELECT id FROM categories WHERE key = 'books')";
        for (title, path, hash, status) in [("Dune", "/a/dune.epub", "h1", "ok"), ("Dune copy", "/b/dune.epub", "h1", "ok"), ("Gone", "/c/gone.pdf", "h2", "missing")] {
            conn.execute(&format!("INSERT INTO items (category_id, title, sort_title) VALUES ({books}, ?1, ?1)"), [title]).unwrap();
            let item = conn.last_insert_rowid();
            conn.execute("INSERT INTO versions (item_id, kind) VALUES (?1, 'digital')", [item]).unwrap();
            let version = conn.last_insert_rowid();
            conn.execute(
                "INSERT INTO files (version_id, path, storage, size, quick_hash, status) VALUES (?1, ?2, 'referenced', 100, ?3, ?4)",
                rusqlite::params![version, path, hash, status],
            )
            .unwrap();
        }
        let report = check(&conn).unwrap();
        assert_eq!(report.missing.iter().map(|f| f.title.as_str()).collect::<Vec<_>>(), ["Gone"]);
        assert_eq!(report.duplicates.len(), 1);
        assert_eq!(report.duplicates[0].len(), 2);
    }
}

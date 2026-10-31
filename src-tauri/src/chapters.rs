//! Chapters inside page-based books (D-019). They are detected from the folders inside a comic
//! archive or among a book's image files, or come from a PDF's outline. Once the reader marks,
//! renames or removes a chapter, the item's chapters are stored as parts and detection stops.

use std::path::{Component, Path};

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager, State};

use crate::error::{AppError, AppResult};
use crate::library::{blocking, with_library};
use crate::pages::{PageEngine, Source};
use crate::{pdf, AppState, Library};

const MAX_CHAPTERS: usize = 2000;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Chapter {
    pub title: String,
    /// The page the chapter starts on, from 0.
    pub page: usize,
    /// Nesting in a PDF outline; detected and edited chapters are all 0.
    #[serde(default)]
    pub depth: u8,
}

/// Where each folder's pages start, when a book's pages span two or more folders. `folders` holds
/// each page's folder path in reading order; the folders all pages share are ignored.
fn by_folder(folders: &[Vec<String>]) -> Vec<Chapter> {
    let Some(first) = folders.first() else {
        return Vec::new();
    };
    let common = folders.iter().fold(first.len(), |common, folder| {
        common.min(folder.len()).min(first.iter().zip(folder).take_while(|(a, b)| a == b).count())
    });
    let mut chapters: Vec<Chapter> = Vec::new();
    let mut previous: Option<&String> = None;
    for (page, folder) in folders.iter().enumerate() {
        let key = folder.get(common);
        if key != previous {
            if let Some(name) = key {
                chapters.push(Chapter { title: name.clone(), page, depth: 0 });
            }
            previous = key;
        }
    }
    let distinct = chapters.iter().map(|c| &c.title).collect::<std::collections::HashSet<_>>().len();
    if distinct < 2 {
        return Vec::new();
    }
    chapters
}

fn components(path: &Path) -> Vec<String> {
    path.components()
        .filter_map(|c| match c {
            Component::Normal(part) => Some(part.to_string_lossy().into_owned()),
            _ => None,
        })
        .collect()
}

/// Chapters found in a book's own structure.
pub fn detect(source: &Source) -> Vec<Chapter> {
    match source {
        Source::Archive { entries, .. } => {
            let folders: Vec<Vec<String>> = entries
                .iter()
                .map(|name| {
                    let mut parts: Vec<String> = name.split('/').map(str::to_string).collect();
                    parts.pop();
                    parts
                })
                .collect();
            by_folder(&folders)
        }
        Source::Images(paths) => {
            let folders: Vec<Vec<String>> = paths.iter().map(|path| path.parent().map(components).unwrap_or_default()).collect();
            by_folder(&folders)
        }
        Source::Pdf(path) => pdf::outline(path).unwrap_or_else(|e| {
            log::warn!("could not read the outline of {}: {e}", path.display());
            Vec::new()
        }),
    }
}

fn custom(conn: &Connection, item: i64) -> AppResult<Option<Vec<Chapter>>> {
    let metadata: Option<String> = conn.query_row("SELECT metadata FROM items WHERE id = ?1", [item], |row| row.get(0)).optional()?;
    let edited = metadata
        .and_then(|json| serde_json::from_str::<Value>(&json).ok())
        .and_then(|value| value.get("chaptersEdited").and_then(Value::as_bool))
        .unwrap_or(false);
    if !edited {
        return Ok(None);
    }
    let chapters = conn
        .prepare("SELECT title, number, metadata FROM parts WHERE item_id = ?1 AND kind = 'chapter' ORDER BY number, position")?
        .query_map([item], |row| {
            let metadata: String = row.get(2)?;
            let depth = serde_json::from_str::<Value>(&metadata).ok().and_then(|m| m.get("depth").and_then(Value::as_u64)).unwrap_or(0);
            Ok(Chapter { title: row.get::<_, Option<String>>(0)?.unwrap_or_default(), page: row.get::<_, f64>(1)? as usize, depth: depth.min(8) as u8 })
        })?
        .collect::<Result<_, _>>()?;
    Ok(Some(chapters))
}

/// An item's chapters: the reader's own, or those detected in its book.
pub fn for_item(library: &Library, item: i64, detected: &[Chapter]) -> AppResult<Vec<Chapter>> {
    Ok(library.db.with(|conn| custom(conn, item))?.unwrap_or_else(|| detected.to_vec()))
}

/// Chapters of an item's first page-based copy, for the item page.
#[tauri::command]
pub async fn chapters_get(app: AppHandle, id: i64) -> AppResult<Vec<Chapter>> {
    blocking(move || {
        let library = app.state::<AppState>().library()?;
        if let Some(chapters) = library.db.with(|conn| custom(conn, id))? {
            return Ok(chapters);
        }
        let versions: Vec<i64> = library.db.with(|conn| {
            let versions = conn
                .prepare("SELECT id FROM versions WHERE item_id = ?1 AND kind = 'digital' ORDER BY is_primary DESC, id")?
                .query_map([id], |row| row.get(0))?
                .collect::<Result<_, _>>()?;
            Ok(versions)
        })?;
        let engine = app.state::<PageEngine>();
        Ok(versions.into_iter().find_map(|version| engine.book(&library, version).ok()).map(|book| book.chapters.clone()).unwrap_or_default())
    })
    .await
}

fn clean(chapters: Vec<Chapter>) -> AppResult<Vec<Chapter>> {
    if chapters.len() > MAX_CHAPTERS {
        return Err(AppError::msg("That's more chapters than a book can hold."));
    }
    let mut chapters: Vec<Chapter> = chapters
        .into_iter()
        .map(|chapter| Chapter {
            title: chapter.title.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(200).collect(),
            page: chapter.page,
            depth: chapter.depth.min(8),
        })
        .collect();
    chapters.sort_by_key(|chapter| chapter.page);
    Ok(chapters)
}

/// Replaces an item's chapters with the reader's own (marked, renamed or removed).
#[tauri::command]
pub async fn chapters_set(state: State<'_, AppState>, id: i64, chapters: Vec<Chapter>) -> AppResult<()> {
    let chapters = clean(chapters)?;
    with_library(&state, move |library| {
        library.db.with(|conn| {
            let tx = conn.transaction()?;
            tx.execute("DELETE FROM parts WHERE item_id = ?1 AND kind = 'chapter'", [id])?;
            for (position, chapter) in chapters.iter().enumerate() {
                tx.execute(
                    "INSERT INTO parts (item_id, kind, number, title, position, metadata) VALUES (?1, 'chapter', ?2, ?3, ?4, ?5)",
                    params![id, chapter.page as f64, chapter.title, position as i64, serde_json::json!({ "depth": chapter.depth }).to_string()],
                )?;
            }
            tx.execute("UPDATE items SET metadata = json_set(metadata, '$.chaptersEdited', json('true')) WHERE id = ?1", [id])?;
            tx.commit()?;
            Ok(())
        })
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn folders(names: &[&str]) -> Vec<Vec<String>> {
        names.iter().map(|name| name.split('/').filter(|p| !p.is_empty()).map(str::to_string).collect()).collect()
    }

    #[test]
    fn chapters_follow_folders() {
        let chapters = by_folder(&folders(&["Vol 1/Ch 1", "Vol 1/Ch 1", "Vol 1/Ch 2", "Vol 1/Ch 2", "Vol 1/Ch 3"]));
        assert_eq!(chapters.iter().map(|c| (c.title.as_str(), c.page)).collect::<Vec<_>>(), vec![("Ch 1", 0), ("Ch 2", 2), ("Ch 3", 4)]);
        // Pages before the first chapter folder (a cover) aren't a chapter.
        let chapters = by_folder(&folders(&["", "Ch 1", "Ch 2"]));
        assert_eq!(chapters.iter().map(|c| c.page).collect::<Vec<_>>(), vec![1, 2]);
        // One folder is no chapters at all.
        assert!(by_folder(&folders(&["Vol 1", "Vol 1"])).is_empty());
        assert!(by_folder(&[]).is_empty());
    }

    #[test]
    fn edits_are_cleaned_and_sorted() {
        let chapters = clean(vec![
            Chapter { title: "  Two \n ".into(), page: 9, depth: 0 },
            Chapter { title: "One".into(), page: 2, depth: 20 },
        ])
        .unwrap();
        assert_eq!(chapters[0], Chapter { title: "One".into(), page: 2, depth: 8 });
        assert_eq!(chapters[1].title, "Two");
    }
}

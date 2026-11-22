//! The image-set book builder (Phase 2): small previews of images picked for a new book, and
//! putting an image book's pages in a new order. Creating the book itself is `import::book_from_images`.

use std::collections::HashSet;
use std::io::Cursor;
use std::path::Path;

use rayon::prelude::*;
use rusqlite::{params, OptionalExtension};
use tauri::State;

use crate::error::{AppError, AppResult};
use crate::library::{blocking, with_library};
use crate::AppState;

const IMAGE_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "webp", "gif", "bmp", "tif", "tiff"];

fn is_image(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| IMAGE_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
}

/// A small JPEG of an image as a data URL, or `None` when it can't be read.
fn preview(path: &Path) -> Option<String> {
    if !is_image(path) || !path.is_file() {
        return None;
    }
    let image = image::open(path).ok()?.thumbnail(240, 360);
    let mut bytes = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut Cursor::new(&mut bytes), 80).encode_image(&image.to_rgb8()).ok()?;
    Some(format!("data:image/jpeg;base64,{}", crate::tools::base64(&bytes)))
}

/// Previews of images picked for a new book, in the same order (`null` for unreadable ones).
#[tauri::command]
pub async fn image_previews(paths: Vec<String>) -> AppResult<Vec<Option<String>>> {
    if paths.len() > 200 {
        return Err(AppError::msg("Ask for at most 200 previews at a time."));
    }
    blocking(move || Ok(paths.par_iter().map(|path| preview(Path::new(path))).collect())).await
}

/// Puts an image book's pages in a new order. Pages left out are taken out of the book and their
/// files stay where they are, except that copies Digitify made go to the Recycle Bin when the
/// reader asks with `trash_removed` (D-009).
#[tauri::command]
pub async fn pages_arrange(state: State<'_, AppState>, version: i64, files: Vec<i64>, trash_removed: bool) -> AppResult<()> {
    with_library(&state, move |library| {
        let (item, rows) = library.db.with(|conn| {
            let item: i64 = conn
                .query_row("SELECT item_id FROM versions WHERE id = ?1 AND kind = 'digital'", [version], |row| row.get(0))
                .optional()?
                .ok_or_else(|| AppError::msg("That copy no longer exists."))?;
            let rows: Vec<(i64, String, String)> = conn
                .prepare("SELECT id, path, storage FROM files WHERE version_id = ?1")?
                .query_map([version], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
                .collect::<Result<_, _>>()?;
            Ok((item, rows))
        })?;
        if rows.iter().any(|(_, path, _)| !is_image(Path::new(path))) {
            return Err(AppError::msg("Only books made of images can have their pages arranged."));
        }
        let known: HashSet<i64> = rows.iter().map(|(id, _, _)| *id).collect();
        let kept: HashSet<i64> = files.iter().copied().collect();
        if files.is_empty() || kept.len() != files.len() || !kept.is_subset(&known) {
            return Err(AppError::msg("Those pages don't match this book."));
        }
        let removed: Vec<&(i64, String, String)> = rows.iter().filter(|(id, _, _)| !kept.contains(id)).collect();
        library.db.with(|conn| {
            let tx = conn.transaction()?;
            for (position, id) in files.iter().enumerate() {
                tx.execute("UPDATE files SET position = ?2 WHERE id = ?1", params![id, position as i64])?;
            }
            for (id, _, _) in &removed {
                tx.execute("DELETE FROM files WHERE id = ?1", [id])?;
            }
            tx.execute(
                "UPDATE items SET metadata = json_set(metadata, '$.pageCount', ?2), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?1",
                params![item, files.len() as i64],
            )?;
            tx.commit()?;
            Ok(())
        })?;
        for (_, path, _) in removed.iter().filter(|(_, _, storage)| trash_removed && storage == "managed") {
            let path = library.folder.resolve(path, "managed");
            if let Err(e) = trash::delete(&path) {
                log::warn!("could not move {} to the Recycle Bin: {e}", path.display());
            }
        }
        Ok(())
    })
    .await
}

#[cfg(test)]
mod tests {
    #[test]
    fn base64_matches_the_standard() {
        assert_eq!(crate::tools::base64(b""), "");
        assert_eq!(crate::tools::base64(b"f"), "Zg==");
        assert_eq!(crate::tools::base64(b"fo"), "Zm8=");
        assert_eq!(crate::tools::base64(b"foo"), "Zm9v");
        assert_eq!(crate::tools::base64(b"foobar"), "Zm9vYmFy");
    }
}

//! The page engine (Phase 2): comic archives, folders of scans or photos, and PDFs as numbered
//! pages that the reader shows one or two at a time, or as a continuous strip. Pages are served as
//! images from `/page/<version>/<index>?w=<width>`, scaled down when the reader doesn't need full
//! size, so huge scans never reach the WebView at full resolution.

use std::collections::hash_map::DefaultHasher;
use std::collections::VecDeque;
use std::hash::{Hash, Hasher};
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use image::{imageops::FilterType, DynamicImage};
use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager, State};

use crate::error::{AppError, AppResult};
use crate::library::{blocking, with_library};
use crate::chapters::{self, Chapter};
use crate::{archives, ebooks, pdf, AppState, Library};

const IMAGE_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "webp", "gif", "bmp", "tif", "tiff"];
const BOOKS_KEPT: usize = 4;
const RENDERED_BYTES: usize = 128 * 1024 * 1024;

pub(crate) const MISSING_FILES: &str =
    "Some of this item's files can't be found. If they're on a drive that isn't connected, connect it; if they moved, use “Find moved files…” on Home.";

#[derive(Debug)]
pub enum Source {
    /// A folder of scans or photos: one file per page.
    Images(Vec<PathBuf>),
    /// A comic archive (CBZ, CBR, CB7, CBT) and its image entries in reading order.
    Archive { path: PathBuf, format: archives::Format, entries: Vec<String> },
    Pdf(PathBuf),
}

pub struct Book {
    /// Identifies the files the book was opened from; a relink or restore changes it.
    pub signature: u64,
    pub source: Source,
    /// Pixel sizes (points for PDFs); the reader needs proportions before pages load.
    pub sizes: Vec<(u32, u32)>,
    /// Chapters found in the book itself (folders, a PDF outline).
    pub chapters: Vec<Chapter>,
}

pub struct Page {
    pub bytes: Vec<u8>,
    pub mime: &'static str,
}

/// Open books and recently served pages, shared by the commands and the media protocol.
#[derive(Default)]
pub struct PageEngine {
    books: Mutex<VecDeque<Arc<Book>>>,
    /// Recently served pages by (book signature, page, width), newest first.
    rendered: Mutex<VecDeque<((u64, usize, u32), Arc<Page>)>>,
}

fn extension(path: &Path) -> String {
    path.extension().and_then(|e| e.to_str()).unwrap_or_default().to_ascii_lowercase()
}

/// Why a copy can't be shown page by page, in words for the reader screen.
fn unsupported(paths: &[PathBuf]) -> AppError {
    let ext = paths.first().map(|p| extension(p)).unwrap_or_default();
    AppError::msg(match ext.as_str() {
        "epub" | "mobi" | "azw" | "azw3" | "fb2" => "Ebooks open in the ebook reader, not page by page.",
        _ => "This copy isn't something Digitify can show page by page yet.",
    })
}

/// A copy's files as a page source, if it is one.
pub fn classify(paths: &[PathBuf]) -> AppResult<Source> {
    match paths {
        [] => Err(AppError::msg("This copy has no files.")),
        [path] => match extension(path).as_str() {
            "cbz" | "cbr" | "cb7" | "cbt" | "zip" | "rar" | "7z" | "tar" => {
                let format = archives::detect(path)?;
                let entries = archives::pages(&archives::entries(path, format)?);
                if entries.is_empty() {
                    return Err(AppError::msg("This archive has no pages."));
                }
                Ok(Source::Archive { path: path.clone(), format, entries })
            }
            "pdf" => Ok(Source::Pdf(path.clone())),
            ext if IMAGE_EXTENSIONS.contains(&ext) => Ok(Source::Images(paths.to_vec())),
            _ => Err(unsupported(paths)),
        },
        _ if paths.iter().all(|p| IMAGE_EXTENSIONS.contains(&extension(p).as_str())) => Ok(Source::Images(paths.to_vec())),
        _ => Err(unsupported(paths)),
    }
}

fn sizes(source: &Source) -> AppResult<Vec<(u32, u32)>> {
    const UNKNOWN: (u32, u32) = (1000, 1500);
    let dimensions = |size: imagesize::ImageSize| (size.width as u32, size.height as u32);
    Ok(match source {
        Source::Images(paths) => paths.iter().map(|p| imagesize::size(p).map(dimensions).unwrap_or(UNKNOWN)).collect(),
        Source::Archive { path, format: archives::Format::Zip, entries } => entries
            .iter()
            .map(|name| {
                // Image headers come first; read the whole entry only when they don't.
                let head = archives::read_head(path, archives::Format::Zip, name, 256 * 1024).ok();
                head.and_then(|bytes| imagesize::blob_size(&bytes).ok())
                    .or_else(|| archives::read(path, archives::Format::Zip, name).ok().and_then(|bytes| imagesize::blob_size(&bytes).ok()))
                    .map(dimensions)
                    .unwrap_or(UNKNOWN)
            })
            .collect(),
        Source::Archive { path, format, entries } => {
            // RAR, 7z and TAR have no cheap random access: measure every page in one pass.
            let mut found = std::collections::HashMap::new();
            archives::each(path, *format, |name| entries.iter().any(|e| e == name), |name, bytes| {
                found.insert(name.to_string(), imagesize::blob_size(&bytes).map(dimensions).unwrap_or(UNKNOWN));
                true
            })?;
            entries.iter().map(|name| found.get(name).copied().unwrap_or(UNKNOWN)).collect()
        }
        Source::Pdf(path) => pdf::page_sizes(path)?,
    })
}

/// Requested widths are rounded up to steps of 400 px so nearby sizes share cached pages.
fn bucket(width: u32) -> u32 {
    width.clamp(400, 4000).div_ceil(400) * 400
}

fn jpeg(image: &DynamicImage) -> AppResult<Page> {
    let mut bytes = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut Cursor::new(&mut bytes), 90)
        .encode_image(&image.to_rgb8())
        .map_err(|e| AppError::msg(format!("could not encode the page: {e}")))?;
    Ok(Page { bytes, mime: "image/jpeg" })
}

/// An image page: the original file when it is small enough and the WebView can show it, or a
/// scaled-down JPEG.
fn image_page(bytes: Vec<u8>, name: &str, width: Option<u32>) -> AppResult<Page> {
    let mime = match extension(Path::new(name)).as_str() {
        "jpg" | "jpeg" => Some("image/jpeg"),
        "png" => Some("image/png"),
        "webp" => Some("image/webp"),
        "gif" => Some("image/gif"),
        "bmp" => Some("image/bmp"),
        _ => None,
    };
    let oversized = match (width, imagesize::blob_size(&bytes)) {
        (Some(width), Ok(size)) => size.width as u32 > width + width / 4,
        _ => false,
    };
    if let (Some(mime), false) = (mime, oversized) {
        return Ok(Page { bytes, mime });
    }
    let image = image::load_from_memory(&bytes).map_err(|e| AppError::msg(format!("This page can't be read: {e}")))?;
    let image = match width {
        Some(width) if image.width() > width => image.resize(width, u32::MAX, FilterType::Triangle),
        _ => image,
    };
    jpeg(&image)
}

fn render(book: &Book, index: usize, width: Option<u32>) -> AppResult<Page> {
    let missing = || AppError::msg("No such page.");
    match &book.source {
        Source::Images(paths) => {
            let path = paths.get(index).ok_or_else(missing)?;
            image_page(std::fs::read(path)?, &path.to_string_lossy(), width)
        }
        Source::Archive { path, format, entries } => {
            let name = entries.get(index).ok_or_else(missing)?;
            image_page(archives::read(path, *format, name)?, name, width)
        }
        Source::Pdf(path) => jpeg(&pdf::render(path, index, width.unwrap_or(1600))?),
    }
}

impl PageEngine {
    /// The page source behind a digital copy. Opened books are kept while their files stay the same.
    pub fn book(&self, library: &Library, version: i64) -> AppResult<Arc<Book>> {
        let rows: Vec<(String, String, String)> = library.db.with(|conn| {
            let rows = conn
                .prepare("SELECT path, storage, status FROM files WHERE version_id = ?1 ORDER BY position, id")?
                .query_map([version], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
                .collect::<Result<_, _>>()?;
            Ok(rows)
        })?;
        let paths: Vec<PathBuf> = rows.iter().map(|(path, storage, _)| library.folder.resolve(path, storage)).collect();
        let signature = {
            let mut hasher = DefaultHasher::new();
            (version, &paths).hash(&mut hasher);
            hasher.finish()
        };
        if let Some(book) = self.books.lock().ok().and_then(|books| books.iter().find(|book| book.signature == signature).cloned()) {
            return Ok(book);
        }
        if rows.iter().zip(&paths).any(|((_, _, status), path)| status != "ok" || !path.exists()) {
            return Err(AppError::msg(MISSING_FILES));
        }
        let source = classify(&paths)?;
        let book = Arc::new(Book { signature, sizes: sizes(&source)?, chapters: chapters::detect(&source), source });
        if let Ok(mut books) = self.books.lock() {
            books.push_front(book.clone());
            books.truncate(BOOKS_KEPT);
        }
        Ok(book)
    }

    /// One page as an image, at least `width` pixels wide when given (bucketed).
    pub fn page(&self, library: &Library, version: i64, index: usize, width: Option<u32>) -> AppResult<Arc<Page>> {
        let width = width.map(bucket);
        let book = self.book(library, version)?;
        let key = (book.signature, index, width.unwrap_or(0));
        if let Some(page) = self.rendered.lock().ok().and_then(|cache| cache.iter().find(|(k, _)| *k == key).map(|(_, page)| page.clone())) {
            return Ok(page);
        }
        let page = Arc::new(render(&book, index, width)?);
        if let Ok(mut cache) = self.rendered.lock() {
            cache.push_front((key, page.clone()));
            let mut total = 0;
            cache.retain(|(_, page)| {
                total += page.bytes.len();
                total <= RENDERED_BYTES
            });
        }
        Ok(page)
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageSize {
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReaderBook {
    pub item_id: i64,
    pub version_id: i64,
    pub title: String,
    /// `ltr`, or `rtl` for manga.
    pub direction: String,
    pub pages: Vec<PageSize>,
    /// The page to start on: where reading stopped last time.
    pub position: usize,
    pub chapters: Vec<Chapter>,
}

/// What `reader_open` found: pages for the page reader, or an ebook for the ebook reader.
#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Opened {
    Pages(ReaderBook),
    Ebook(ebooks::Ebook),
}

/// Opens an item for reading: its first digital copy that is an ebook or can be shown page by page.
#[tauri::command]
pub async fn reader_open(app: AppHandle, id: i64) -> AppResult<Opened> {
    blocking(move || {
        let library = app.state::<AppState>().library()?;
        let engine = app.state::<PageEngine>();
        open_book(&library, &engine, id)
    })
    .await
}

fn open_book(library: &Library, engine: &PageEngine, id: i64) -> AppResult<Opened> {
    let (title, direction, versions, locator) = library.db.with(|conn| {
        let (title, metadata, settings): (String, String, String) = conn
            .query_row(
                "SELECT i.title, i.metadata, c.settings FROM items i JOIN categories c ON c.id = i.category_id WHERE i.id = ?1",
                [id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()?
            .ok_or_else(|| AppError::msg("This item no longer exists."))?;
        // The item's own direction wins over its category's.
        let direction = [metadata, settings]
            .iter()
            .filter_map(|json| serde_json::from_str::<Value>(json).ok())
            .find_map(|value| value.get("readingDirection").and_then(Value::as_str).map(str::to_string))
            .filter(|direction| direction == "rtl")
            .unwrap_or_else(|| "ltr".into());
        let versions: Vec<i64> = conn
            .prepare("SELECT id FROM versions WHERE item_id = ?1 AND kind = 'digital' ORDER BY is_primary DESC, id")?
            .query_map([id], |row| row.get(0))?
            .collect::<Result<_, _>>()?;
        let locator: Option<String> = conn
            .query_row("SELECT locator FROM progress WHERE item_id = ?1 AND part_id = 0", [id], |row| row.get(0))
            .optional()?
            .flatten();
        Ok((title, direction, versions, locator))
    })?;
    if versions.is_empty() {
        return Err(AppError::msg("There are no digital files to read yet. Use “Files” under Your copies to add a scan, an ebook or a PDF."));
    }
    let locator = locator.and_then(|locator| serde_json::from_str::<Value>(&locator).ok());
    let mut failure = None;
    let mut opened = None;
    for version in versions {
        let found = ebooks::file(library, version).and_then(|ebook| match ebook {
            Some(path) => ebooks::open(id, version, title.clone(), &path, locator.as_ref()).map(Opened::Ebook),
            None => engine.book(library, version).map(|book| {
                let position = locator
                    .as_ref()
                    .and_then(|locator| locator.get("page").and_then(Value::as_u64))
                    .map(|page| (page as usize).min(book.sizes.len().saturating_sub(1)))
                    .unwrap_or(0);
                Opened::Pages(ReaderBook {
                    item_id: id,
                    version_id: version,
                    title: title.clone(),
                    direction: direction.clone(),
                    pages: book.sizes.iter().map(|&(width, height)| PageSize { width, height }).collect(),
                    position,
                    chapters: Vec::new(),
                })
            }),
        });
        match found {
            Ok(book) => {
                opened = Some(book);
                break;
            }
            Err(e) => failure = failure.or(Some(e)),
        }
    }
    let mut opened = opened.ok_or_else(|| failure.unwrap_or_else(|| AppError::msg("Nothing to read.")))?;
    if let Opened::Pages(book) = &mut opened {
        let detected = engine.book(library, book.version_id)?.chapters.clone();
        book.chapters = chapters::for_item(library, id, &detected)?;
    }
    library.db.with(|conn| {
        conn.execute("UPDATE items SET last_opened_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?1", [id])?;
        Ok(())
    })?;
    Ok(opened)
}

/// Remembers the page reached; the last page counts as finished.
#[tauri::command]
pub async fn progress_save(state: State<'_, AppState>, id: i64, page: usize, pages: usize) -> AppResult<()> {
    let pages = pages.max(1);
    let page = page.min(pages - 1);
    with_library(&state, move |library| {
        library.db.with(|conn| {
            conn.execute(
                "INSERT INTO progress (item_id, part_id, locator, fraction, completed, updated_at) \
                 VALUES (?1, 0, ?2, ?3, ?4, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) \
                 ON CONFLICT(item_id, part_id) DO UPDATE SET locator = excluded.locator, fraction = excluded.fraction, \
                 completed = excluded.completed, updated_at = excluded.updated_at",
                params![id, serde_json::json!({ "page": page }).to_string(), (page + 1) as f64 / pages as f64, page + 1 >= pages],
            )?;
            Ok(())
        })
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn widths_are_bucketed() {
        assert_eq!(bucket(1), 400);
        assert_eq!(bucket(401), 800);
        assert_eq!(bucket(1600), 1600);
        assert_eq!(bucket(9999), 4000);
    }

    #[test]
    fn copies_are_classified() {
        let p = |s: &str| PathBuf::from(s);
        assert!(matches!(classify(&[p("a.pdf")]), Ok(Source::Pdf(_))));
        assert!(matches!(classify(&[p("1.jpg"), p("2.PNG")]), Ok(Source::Images(_))));
        assert!(classify(&[p("a.epub")]).unwrap_err().to_string().contains("ebook reader"));
        assert!(classify(&[p("1.jpg"), p("notes.txt")]).is_err());
    }
}

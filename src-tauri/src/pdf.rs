//! PDF access through PDFium (D-013): page sizes, page rendering and document details. PDFium is
//! loaded from `pdfium.dll` the first time a PDF is needed; pdfium-render serializes all calls.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use image::DynamicImage;
use pdfium_render::prelude::*;

use crate::chapters::Chapter;
use crate::error::{AppError, AppResult};
use crate::formats::year_of;

static PDFIUM: OnceLock<Result<Pdfium, String>> = OnceLock::new();

/// `pdfium.dll`: next to the app (installed), or in `src-tauri/binaries` for builds run from the
/// source tree.
fn library_path() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    std::iter::once(dir.join("pdfium.dll"))
        .chain(dir.ancestors().take(5).map(|ancestor| ancestor.join("src-tauri").join("binaries").join("pdfium.dll")))
        .find(|candidate| candidate.exists())
}

fn pdfium() -> AppResult<&'static Pdfium> {
    PDFIUM
        .get_or_init(|| {
            let path = library_path().ok_or_else(|| "pdfium.dll is missing from the installation".to_string())?;
            let bindings = Pdfium::bind_to_library(&path).map_err(|e| format!("could not load PDFium: {e}"))?;
            Ok(Pdfium::new(bindings))
        })
        .as_ref()
        .map_err(|e| AppError::msg(e.clone()))
}

fn open<'a>(pdfium: &'a Pdfium, path: &Path) -> AppResult<PdfDocument<'a>> {
    pdfium.load_pdf_from_file(path, None).map_err(|e| match e {
        PdfiumError::PdfiumLibraryInternalError(PdfiumInternalError::PasswordError) => {
            AppError::msg("This PDF is protected by a password, so it can't be opened.")
        }
        other => AppError::msg(format!("This PDF can't be opened: {other}")),
    })
}

/// Each page's size in points (1/72 inch), in order.
pub fn page_sizes(path: &Path) -> AppResult<Vec<(u32, u32)>> {
    let pdfium = pdfium()?;
    let document = open(pdfium, path)?;
    let pages = document.pages();
    let mut sizes = Vec::with_capacity(pages.len() as usize);
    for index in 0..pages.len() {
        let size = pages.page_size(index).map(|rect| (rect.width().value.round() as u32, rect.height().value.round() as u32));
        sizes.push(size.unwrap_or((612, 792)));
    }
    Ok(sizes)
}

/// The PDF's outline as chapters: each entry's title, the page it leads to and its nesting, up to
/// 500 entries and three levels.
pub fn outline(path: &Path) -> AppResult<Vec<Chapter>> {
    fn walk(first: Option<PdfBookmark<'_>>, depth: u8, out: &mut Vec<Chapter>) {
        let mut current = first;
        while let Some(bookmark) = current {
            if out.len() >= 500 {
                return;
            }
            let page = match bookmark.destination() {
                Some(destination) => destination.page_index().ok(),
                None => match bookmark.action() {
                    Some(action) => action
                        .as_local_destination_action()
                        .and_then(|local| local.destination().ok())
                        .and_then(|destination| destination.page_index().ok()),
                    None => None,
                },
            };
            if let (Some(title), Some(page)) = (bookmark.title(), page) {
                let title = title.split_whitespace().collect::<Vec<_>>().join(" ");
                if !title.is_empty() {
                    out.push(Chapter { title, page: page as usize, depth });
                }
            }
            if depth < 2 {
                walk(bookmark.first_child(), depth + 1, out);
            }
            current = bookmark.next_sibling();
        }
    }
    let pdfium = pdfium()?;
    let document = open(pdfium, path)?;
    let mut chapters = Vec::new();
    walk(document.bookmarks().root(), 0, &mut chapters);
    Ok(chapters)
}

/// Renders one page `width` pixels wide.
pub fn render(path: &Path, index: usize, width: u32) -> AppResult<DynamicImage> {
    let pdfium = pdfium()?;
    let document = open(pdfium, path)?;
    let index = PdfPageIndex::try_from(index).map_err(|_| AppError::msg("No such page."))?;
    let page = document.pages().get(index).map_err(|_| AppError::msg("No such page."))?;
    let config = PdfRenderConfig::new().set_target_width(width as Pixels).render_form_data(true);
    let bitmap = page.render_with_config(&config).map_err(|e| AppError::msg(format!("could not draw the page: {e}")))?;
    bitmap.as_image().map_err(|e| AppError::msg(format!("could not draw the page: {e}")))
}

#[derive(Debug, Default)]
pub struct PdfInfo {
    pub title: Option<String>,
    pub author: Option<String>,
    pub year: Option<i64>,
    pub pages: usize,
    /// The first page as a JPEG, for cover artwork.
    pub cover: Option<Vec<u8>>,
}

/// Titles that tools put in PDFs by default rather than a real title.
fn real_title(title: &str) -> bool {
    let lower = title.trim().to_lowercase();
    !(lower.is_empty()
        || lower.starts_with("untitled")
        || lower.starts_with("microsoft word")
        || lower.starts_with("microsoft powerpoint")
        || lower.starts_with("document")
        || [".doc", ".docx", ".pdf", ".odt", ".tex", ".indd", ".qxd"].iter().any(|ext| lower.ends_with(ext)))
}

/// Title, author, creation year, page count and a cover from the first page.
pub fn read_info(path: &Path, cover_width: u32) -> AppResult<PdfInfo> {
    let pdfium = pdfium()?;
    let document = open(pdfium, path)?;
    let metadata = document.metadata();
    let tag = |kind| {
        metadata
            .get(kind)
            .map(|tag| tag.value().trim().to_string())
            .filter(|value| !value.is_empty())
    };
    let mut info = PdfInfo {
        title: tag(PdfDocumentMetadataTagType::Title).filter(|title| real_title(title)),
        author: tag(PdfDocumentMetadataTagType::Author),
        year: tag(PdfDocumentMetadataTagType::CreationDate).and_then(|date| year_of(date.trim_start_matches("D:"))),
        pages: document.pages().len() as usize,
        cover: None,
    };
    if info.pages > 0 {
        let config = PdfRenderConfig::new().set_target_width(cover_width as Pixels);
        let image = document.pages().get(0).ok().and_then(|page| {
            let bitmap = page.render_with_config(&config).ok()?;
            bitmap.as_image().ok()
        });
        info.cover = image.and_then(|image| {
            let mut bytes = Vec::new();
            image::codecs::jpeg::JpegEncoder::new_with_quality(&mut std::io::Cursor::new(&mut bytes), 90)
                .encode_image(&image.to_rgb8())
                .ok()
                .map(|_| bytes)
        });
    }
    Ok(info)
}

#[cfg(test)]
mod tests {
    use super::real_title;

    #[test]
    fn placeholder_titles_are_ignored() {
        assert!(real_title("The Cartographer's Notebook"));
        assert!(!real_title("Microsoft Word - draft3.docx"));
        assert!(!real_title("untitled"));
        assert!(!real_title("scan_0001.pdf"));
    }
}

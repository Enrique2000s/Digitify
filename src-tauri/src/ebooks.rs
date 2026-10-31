//! Ebooks (D-014): EPUB, MOBI, AZW3 and FB2 are laid out in the WebView by foliate-js, which
//! reads the file from `/book/<version>`. This side finds a copy's ebook file, refuses books with
//! copy protection (Digitify never removes DRM), and remembers where reading stopped.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use rusqlite::params;
use serde::Serialize;
use tauri::State;
use zip::ZipArchive;

use crate::error::{AppError, AppResult};
use crate::library::with_library;
use crate::{formats, pages, AppState, Library};

pub const EXTENSIONS: &[&str] = &["epub", "mobi", "azw", "azw3", "fb2"];

/// Font obfuscation, which the EPUB standard defines for embedded fonts, isn't copy protection.
const FONT_OBFUSCATION: &[&str] = &["http://www.idpf.org/2008/embedding", "http://ns.adobe.com/pdf/enc#RC"];

const PROTECTED: &str = "This book is copy-protected (DRM). Digitify doesn't remove copy protection, so it can only be read with the app or device it was bought for. DRM-free copies open normally.";

fn extension(path: &Path) -> String {
    path.extension().and_then(|e| e.to_str()).unwrap_or_default().to_ascii_lowercase()
}

pub fn is_ebook(path: &Path) -> bool {
    EXTENSIONS.contains(&extension(path).as_str())
}

pub fn mime_type(path: &Path) -> &'static str {
    match extension(path).as_str() {
        "epub" => "application/epub+zip",
        "fb2" => "application/x-fictionbook+xml",
        _ => "application/x-mobipocket-ebook",
    }
}

/// The ebook behind a digital copy, or `None` when the copy isn't a single ebook file.
pub fn file(library: &Library, version: i64) -> AppResult<Option<PathBuf>> {
    let rows: Vec<(String, String, String)> = library.db.with(|conn| {
        let rows = conn
            .prepare("SELECT path, storage, status FROM files WHERE version_id = ?1 ORDER BY position, id")?
            .query_map([version], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
            .collect::<Result<_, _>>()?;
        Ok(rows)
    })?;
    let [(path, storage, status)] = rows.as_slice() else {
        return Ok(None);
    };
    let path = library.folder.resolve(path, storage);
    if !is_ebook(&path) {
        return Ok(None);
    }
    if status != "ok" || !path.exists() {
        return Err(AppError::msg(pages::MISSING_FILES));
    }
    Ok(Some(path))
}

/// Refuses books whose contents are encrypted (Adobe, Readium LCP, Apple, Kindle and similar DRM).
/// Damaged or unknown files pass: the reader explains those when it can't open them.
pub fn check_protection(path: &Path) -> AppResult<()> {
    let protected = match extension(path).as_str() {
        "epub" => epub_protected(path),
        "mobi" | "azw" | "azw3" => palm_protected(path),
        _ => false,
    };
    if protected {
        return Err(AppError::msg(PROTECTED));
    }
    Ok(())
}

/// EPUB DRM lists the encrypted chapters in META-INF/encryption.xml.
fn epub_protected(path: &Path) -> bool {
    let Some(text) = File::open(path)
        .ok()
        .and_then(|file| ZipArchive::new(file).ok())
        .and_then(|mut zip| formats::read_entry(&mut zip, "META-INF/encryption.xml"))
        .and_then(|bytes| String::from_utf8(bytes).ok())
    else {
        return false;
    };
    let Some(doc) = formats::parse_xml(&text) else {
        return false;
    };
    doc.descendants()
        .filter(|node| node.tag_name().name() == "EncryptionMethod")
        .any(|node| !FONT_OBFUSCATION.contains(&node.attribute("Algorithm").unwrap_or_default()))
}

/// MOBI and AZW3 books are Palm databases whose first record says how the text is encrypted;
/// newer Kindle downloads (KFX) start with a DRM container instead.
fn palm_protected(path: &Path) -> bool {
    let read = || -> std::io::Result<bool> {
        let mut file = File::open(path)?;
        let mut header = [0u8; 82];
        file.read_exact(&mut header)?;
        if header.starts_with(b"\xEADRMION") {
            return Ok(true);
        }
        if &header[60..68] != b"BOOKMOBI" {
            return Ok(false);
        }
        let first_record = u32::from_be_bytes([header[78], header[79], header[80], header[81]]);
        let mut palmdoc = [0u8; 14];
        file.seek(SeekFrom::Start(first_record.into()))?;
        file.read_exact(&mut palmdoc)?;
        Ok(u16::from_be_bytes([palmdoc[12], palmdoc[13]]) != 0)
    };
    read().unwrap_or(false)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Ebook {
    pub item_id: i64,
    pub version_id: i64,
    pub title: String,
    /// The file's name; the reader tells some formats apart by it.
    pub file_name: String,
    /// Where reading stopped last time: an EPUB CFI, which foliate-js also uses for the other formats.
    pub position: Option<String>,
}

pub fn open(item_id: i64, version_id: i64, title: String, path: &Path, locator: Option<&serde_json::Value>) -> AppResult<Ebook> {
    check_protection(path)?;
    Ok(Ebook {
        item_id,
        version_id,
        title,
        file_name: path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default(),
        position: locator.and_then(|locator| locator.get("cfi")).and_then(|cfi| cfi.as_str()).map(str::to_string),
    })
}

/// Remembers where reading stopped in an ebook: its CFI and how far through the book it is.
#[tauri::command]
pub async fn ebook_progress_save(state: State<'_, AppState>, id: i64, cfi: String, fraction: f64, finished: bool) -> AppResult<()> {
    if cfi.len() > 4096 || !cfi.starts_with("epubcfi(") {
        return Err(AppError::msg("That isn't a reading position."));
    }
    let fraction = if fraction.is_finite() { fraction.clamp(0.0, 1.0) } else { 0.0 };
    with_library(&state, move |library| {
        library.db.with(|conn| {
            conn.execute(
                "INSERT INTO progress (item_id, part_id, locator, fraction, completed, updated_at) \
                 VALUES (?1, 0, ?2, ?3, ?4, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) \
                 ON CONFLICT(item_id, part_id) DO UPDATE SET locator = excluded.locator, fraction = excluded.fraction, \
                 completed = excluded.completed, updated_at = excluded.updated_at",
                params![id, serde_json::json!({ "cfi": cfi }).to_string(), fraction, finished],
            )?;
            Ok(())
        })
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("digitify-ebooks-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir.join(name)
    }

    fn epub(name: &str, algorithms: &[&str]) -> PathBuf {
        let path = temp(name);
        let mut zip = zip::ZipWriter::new(File::create(&path).unwrap());
        let options = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
        zip.start_file("mimetype", options).unwrap();
        zip.write_all(b"application/epub+zip").unwrap();
        if !algorithms.is_empty() {
            let entries: String = algorithms
                .iter()
                .enumerate()
                .map(|(i, algorithm)| {
                    format!(
                        r#"<enc:EncryptedData><enc:EncryptionMethod Algorithm="{algorithm}"/><enc:CipherData><enc:CipherReference URI="OEBPS/{i}"/></enc:CipherData></enc:EncryptedData>"#
                    )
                })
                .collect();
            zip.start_file("META-INF/encryption.xml", options).unwrap();
            write!(zip, r#"<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#">{entries}</encryption>"#).unwrap();
        }
        zip.finish().unwrap();
        path
    }

    fn mobi(name: &str, encryption: u16) -> PathBuf {
        let mut bytes = vec![0u8; 78];
        bytes[60..68].copy_from_slice(b"BOOKMOBI");
        bytes.extend_from_slice(&88u32.to_be_bytes()); // first record's offset
        bytes.extend_from_slice(&[0; 6]);
        let mut palmdoc = [0u8; 16];
        palmdoc[12..14].copy_from_slice(&encryption.to_be_bytes());
        bytes.extend_from_slice(&palmdoc);
        let path = temp(name);
        std::fs::write(&path, bytes).unwrap();
        path
    }

    #[test]
    fn drm_is_recognized() {
        assert!(check_protection(&epub("plain.epub", &[])).is_ok());
        assert!(check_protection(&epub("fonts.epub", &["http://www.idpf.org/2008/embedding", "http://ns.adobe.com/pdf/enc#RC"])).is_ok());
        let adobe = epub("adobe.epub", &["http://www.idpf.org/2008/embedding", "http://www.w3.org/2001/04/xmlenc#aes128-cbc"]);
        assert!(check_protection(&adobe).unwrap_err().to_string().contains("DRM"));
        assert!(check_protection(&mobi("plain.azw3", 0)).is_ok());
        assert!(check_protection(&mobi("kindle.azw", 2)).is_err());
        assert!(check_protection(&temp("missing.mobi")).is_ok());
    }

    #[test]
    fn ebook_files_are_recognized() {
        assert!(is_ebook(Path::new("Book.EPUB")));
        assert!(is_ebook(Path::new("a.azw3")));
        assert!(!is_ebook(Path::new("a.pdf")));
        assert_eq!(mime_type(Path::new("a.fb2")), "application/x-fictionbook+xml");
    }
}

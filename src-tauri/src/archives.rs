//! Comic archives (D-017): ZIP (CBZ), RAR (CBR), 7z (CB7) and TAR (CBT). The format comes from the
//! file's first bytes, not its extension, so a RAR named `.cbz` still opens.

use std::fs::File;
use std::io::Read;
use std::path::Path;

use sevenz_rust2::{ArchiveReader, Password};

use crate::error::{AppError, AppResult};
use crate::files::natural_cmp;

/// Largest entry read into memory (a page, or ComicInfo.xml).
const MAX_ENTRY: u64 = 64 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Format {
    Zip,
    Rar,
    SevenZ,
    Tar,
}

fn unreadable(e: impl std::fmt::Display) -> AppError {
    AppError::msg(format!("This archive can't be read: {e}"))
}

/// The archive format, from the file's first bytes.
pub fn detect(path: &Path) -> AppResult<Format> {
    let mut head = [0u8; 512];
    let mut file = File::open(path)?;
    let mut filled = 0;
    while filled < head.len() {
        let read = file.read(&mut head[filled..])?;
        if read == 0 {
            break;
        }
        filled += read;
    }
    let head = &head[..filled];
    if head.starts_with(b"PK\x03\x04") || head.starts_with(b"PK\x05\x06") {
        Ok(Format::Zip)
    } else if head.starts_with(b"Rar!\x1a\x07") {
        Ok(Format::Rar)
    } else if head.starts_with(b"7z\xbc\xaf\x27\x1c") {
        Ok(Format::SevenZ)
    } else if head.len() >= 262 && &head[257..262] == b"ustar" {
        Ok(Format::Tar)
    } else {
        Err(AppError::msg("This isn't an archive Digitify can open (ZIP, RAR, 7z or TAR)."))
    }
}

/// Entry names use forward slashes whatever the archive stored, without a leading "./" (archives
/// made with `tar -cf comic.cbt .` have one).
fn normalized(name: &str) -> String {
    let name = name.replace('\\', "/");
    let mut rest = name.as_str();
    while let Some(stripped) = rest.strip_prefix("./") {
        rest = stripped;
    }
    rest.to_string()
}

/// File entries, in archive order.
pub fn entries(path: &Path, format: Format) -> AppResult<Vec<String>> {
    match format {
        Format::Zip => {
            let archive = zip::ZipArchive::new(File::open(path)?).map_err(unreadable)?;
            Ok(archive.file_names().filter_map(Result::ok).filter(|name| !name.ends_with('/')).map(|name| name.into_owned()).collect())
        }
        Format::Rar => {
            let mut names = Vec::new();
            for header in unrar::Archive::new(path).open_for_listing().map_err(unreadable)? {
                let header = header.map_err(unreadable)?;
                if header.is_file() {
                    names.push(normalized(&header.filename.to_string_lossy()));
                }
            }
            Ok(names)
        }
        Format::SevenZ => {
            let reader = ArchiveReader::open(path, Password::empty()).map_err(unreadable)?;
            Ok(reader.archive().files.iter().filter(|entry| !entry.is_directory() && entry.has_stream()).map(|entry| normalized(entry.name())).collect())
        }
        Format::Tar => {
            let mut archive = tar::Archive::new(File::open(path)?);
            let mut names = Vec::new();
            for entry in archive.entries().map_err(unreadable)? {
                let entry = entry.map_err(unreadable)?;
                if entry.header().entry_type().is_file() {
                    names.push(normalized(&entry.path().map_err(unreadable)?.to_string_lossy()));
                }
            }
            Ok(names)
        }
    }
}

fn take_all(mut reader: impl Read) -> AppResult<Vec<u8>> {
    let mut bytes = Vec::new();
    reader.by_ref().take(MAX_ENTRY).read_to_end(&mut bytes)?;
    Ok(bytes)
}

/// One entry's bytes.
pub fn read(path: &Path, format: Format, name: &str) -> AppResult<Vec<u8>> {
    let missing = || AppError::msg(format!("“{name}” isn't in this archive anymore."));
    match format {
        Format::Zip => {
            let mut archive = zip::ZipArchive::new(File::open(path)?).map_err(unreadable)?;
            let entry = archive.by_name(name).map_err(|_| missing())?;
            take_all(entry)
        }
        Format::Rar => {
            let mut archive = unrar::Archive::new(path).open_for_processing().map_err(unreadable)?;
            while let Some(header) = archive.read_header().map_err(unreadable)? {
                archive = if header.entry().is_file() && normalized(&header.entry().filename.to_string_lossy()) == name {
                    return Ok(header.read().map_err(unreadable)?.0);
                } else {
                    header.skip().map_err(unreadable)?
                };
            }
            Err(missing())
        }
        Format::SevenZ => {
            let mut reader = ArchiveReader::open(path, Password::empty()).map_err(unreadable)?;
            let stored = reader.archive().files.iter().find(|entry| normalized(entry.name()) == name).map(|entry| entry.name().to_string()).ok_or_else(missing)?;
            reader.read_file(&stored).map_err(unreadable)
        }
        Format::Tar => {
            let mut archive = tar::Archive::new(File::open(path)?);
            for entry in archive.entries().map_err(unreadable)? {
                let entry = entry.map_err(unreadable)?;
                if normalized(&entry.path().map_err(unreadable)?.to_string_lossy()) == name {
                    return take_all(entry);
                }
            }
            Err(missing())
        }
    }
}

/// The first `limit` bytes of an entry: enough for image headers. Cheap for ZIP and TAR only;
/// other formats read the whole entry.
pub fn read_head(path: &Path, format: Format, name: &str, limit: u64) -> AppResult<Vec<u8>> {
    match format {
        Format::Zip => {
            let mut archive = zip::ZipArchive::new(File::open(path)?).map_err(unreadable)?;
            let entry = archive.by_name(name).map_err(unreadable)?;
            let mut bytes = Vec::new();
            entry.take(limit).read_to_end(&mut bytes)?;
            Ok(bytes)
        }
        _ => read(path, format, name),
    }
}

/// Visits every file entry in one pass (the fast way through solid RAR and 7z archives) and
/// stops when `visit` returns false. `wanted` decides which entries are read at all.
pub fn each(path: &Path, format: Format, wanted: impl Fn(&str) -> bool, mut visit: impl FnMut(&str, Vec<u8>) -> bool) -> AppResult<()> {
    match format {
        Format::Zip => {
            let mut archive = zip::ZipArchive::new(File::open(path)?).map_err(unreadable)?;
            for index in 0..archive.len() {
                let entry = archive.by_index(index).map_err(unreadable)?;
                let name = entry.name().map_err(unreadable)?.into_owned();
                if entry.is_file() && wanted(&name) && !visit(&name, take_all(entry)?) {
                    break;
                }
            }
        }
        Format::Rar => {
            let mut archive = unrar::Archive::new(path).open_for_processing().map_err(unreadable)?;
            while let Some(header) = archive.read_header().map_err(unreadable)? {
                let name = normalized(&header.entry().filename.to_string_lossy());
                archive = if header.entry().is_file() && wanted(&name) {
                    let (bytes, rest) = header.read().map_err(unreadable)?;
                    if !visit(&name, bytes) {
                        break;
                    }
                    rest
                } else {
                    header.skip().map_err(unreadable)?
                };
            }
        }
        Format::SevenZ => {
            let mut reader = ArchiveReader::open(path, Password::empty()).map_err(unreadable)?;
            let mut failure = None;
            reader
                .for_each_entries(|entry, data| {
                    let name = normalized(entry.name());
                    if entry.is_directory() || !wanted(&name) {
                        // Solid blocks must still be read through to reach later entries.
                        std::io::copy(data, &mut std::io::sink())?;
                        return Ok(true);
                    }
                    let mut bytes = Vec::new();
                    data.read_to_end(&mut bytes)?;
                    Ok(visit(&name, bytes))
                })
                .unwrap_or_else(|e| failure = Some(e));
            if let Some(e) = failure {
                return Err(unreadable(e));
            }
        }
        Format::Tar => {
            let mut archive = tar::Archive::new(File::open(path)?);
            for entry in archive.entries().map_err(unreadable)? {
                let entry = entry.map_err(unreadable)?;
                let name = normalized(&entry.path().map_err(unreadable)?.to_string_lossy());
                if entry.header().entry_type().is_file() && wanted(&name) && !visit(&name, take_all(entry)?) {
                    break;
                }
            }
        }
    }
    Ok(())
}

const IMAGE_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "webp", "gif", "bmp", "tif", "tiff"];

pub fn is_image(name: &str) -> bool {
    Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|ext| IMAGE_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()))
}

/// Image entries in reading order, without folders' hidden files or macOS metadata.
pub fn pages(entries: &[String]) -> Vec<String> {
    let mut pages: Vec<String> = entries
        .iter()
        .filter(|name| !name.starts_with("__MACOSX/") && !name.split('/').any(|part| part.starts_with('.')) && is_image(name))
        .cloned()
        .collect();
    pages.sort_by(|a, b| natural_cmp(&a.to_lowercase(), &b.to_lowercase()));
    pages
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use std::io::Write;

    fn crc32(bytes: &[u8]) -> u32 {
        let mut crc = !0u32;
        for &byte in bytes {
            crc ^= byte as u32;
            for _ in 0..8 {
                crc = if crc & 1 != 0 { (crc >> 1) ^ 0xEDB8_8320 } else { crc >> 1 };
            }
        }
        !crc
    }

    /// A RAR 4 archive with stored (uncompressed) files, written by hand: the format allows it,
    /// and no RAR compressor is needed (or allowed by the UnRAR license).
    pub fn stored_rar(files: &[(&str, &[u8])]) -> Vec<u8> {
        let block = |kind: u8, flags: u16, body: &[u8]| {
            let mut header = vec![kind];
            header.extend(flags.to_le_bytes());
            header.extend(((body.len() + 7) as u16).to_le_bytes());
            header.extend(body);
            let mut out = ((crc32(&header) & 0xFFFF) as u16).to_le_bytes().to_vec();
            out.extend(header);
            out
        };
        let mut rar = b"Rar!\x1a\x07\x00".to_vec();
        rar.extend(block(0x73, 0, &[0u8; 6]));
        for (name, data) in files {
            let mut body = Vec::new();
            body.extend((data.len() as u32).to_le_bytes()); // packed size
            body.extend((data.len() as u32).to_le_bytes()); // unpacked size
            body.push(2); // Windows
            body.extend(crc32(data).to_le_bytes());
            body.extend(0x5C21_0000u32.to_le_bytes()); // 2026-01-01, DOS time
            body.push(20); // version needed: 2.0
            body.push(0x30); // method: store
            body.extend((name.len() as u16).to_le_bytes());
            body.extend(0x20u32.to_le_bytes()); // archive attribute
            body.extend(name.as_bytes());
            rar.extend(block(0x74, 0x8000, &body));
            rar.extend(*data);
        }
        rar.extend(block(0x7b, 0x4000, &[]));
        rar
    }

    fn temp(name: &str, bytes: &[u8]) -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!("digitify-test-{}-{name}", std::process::id()));
        File::create(&path).unwrap().write_all(bytes).unwrap();
        path
    }

    #[test]
    fn rar_archives_list_and_read_by_contents() {
        // Named .cbz on purpose: the format comes from the contents.
        let path = temp("rar.cbz", &stored_rar(&[("Pages\\10.jpg", b"ten"), ("Pages\\2.jpg", b"two"), ("ComicInfo.xml", b"<ComicInfo/>")]));
        assert_eq!(detect(&path).unwrap(), Format::Rar);
        let names = entries(&path, Format::Rar).unwrap();
        assert_eq!(pages(&names), ["Pages/2.jpg", "Pages/10.jpg"]);
        assert_eq!(read(&path, Format::Rar, "Pages/10.jpg").unwrap(), b"ten");
        let mut seen = Vec::new();
        each(&path, Format::Rar, is_image, |name, bytes| {
            seen.push((name.to_string(), bytes));
            true
        })
        .unwrap();
        assert_eq!(seen.len(), 2);
        std::fs::remove_file(path).ok();
    }

    #[test]
    fn tar_archives_list_and_read() {
        let mut builder = tar::Builder::new(Vec::new());
        for (name, data) in [("b/2.png", b"two".as_slice()), ("b/1.png", b"one".as_slice())] {
            let mut header = tar::Header::new_ustar();
            header.set_size(data.len() as u64);
            header.set_mode(0o644);
            header.set_cksum();
            builder.append_data(&mut header, name, data).unwrap();
        }
        let path = temp("t.cbt", &builder.into_inner().unwrap());
        assert_eq!(detect(&path).unwrap(), Format::Tar);
        assert_eq!(pages(&entries(&path, Format::Tar).unwrap()), ["b/1.png", "b/2.png"]);
        assert_eq!(read(&path, Format::Tar, "b/2.png").unwrap(), b"two");
        std::fs::remove_file(path).ok();
    }

    #[test]
    fn unknown_files_are_refused() {
        let path = temp("x.cbr", b"not an archive at all");
        assert!(detect(&path).is_err());
        std::fs::remove_file(path).ok();
    }
}

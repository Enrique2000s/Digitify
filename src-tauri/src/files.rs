//! File helpers: fingerprints, volume ids, safe names, natural ordering and missing-file checks.

use std::cmp::Ordering;
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{self, Read, Seek, SeekFrom};
#[cfg(windows)]
use std::os::windows::ffi::OsStrExt;
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::UNIX_EPOCH;

use rusqlite::params;
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use walkdir::WalkDir;

use crate::error::{AppError, AppResult};
use crate::{AppState, Library};

const SAMPLE: u64 = 64 * 1024;

/// Fast content fingerprint for duplicate detection: BLAKE3 over the size plus 64 KB samples from
/// the start, middle and end. Hashing whole multi-gigabyte rips would make imports crawl.
pub fn quick_hash(path: &Path, size: u64) -> io::Result<String> {
    let mut file = File::open(path)?;
    let mut hasher = blake3::Hasher::new();
    hasher.update(&size.to_le_bytes());
    let mut buffer = vec![0u8; SAMPLE as usize];
    let mut offsets = vec![0, size.saturating_sub(SAMPLE) / 2, size.saturating_sub(SAMPLE)];
    offsets.dedup();
    for offset in offsets {
        file.seek(SeekFrom::Start(offset))?;
        let mut filled = 0;
        while filled < buffer.len() {
            let n = file.read(&mut buffer[filled..])?;
            if n == 0 {
                break;
            }
            filled += n;
        }
        hasher.update(&buffer[..filled]);
    }
    Ok(hasher.finalize().to_hex()[..32].to_string())
}

pub fn modified_unix(metadata: &fs::Metadata) -> Option<i64> {
    let since = metadata.modified().ok()?.duration_since(UNIX_EPOCH).ok()?;
    Some(since.as_secs() as i64)
}

/// The id of the file system holding `path` (its UUID, else its device number). Lets moved
/// external drives be recognized even when they're mounted somewhere else.
#[cfg(target_os = "linux")]
pub fn volume_serial(path: &Path) -> Option<String> {
    let path = fs::canonicalize(path).ok()?;
    // The mount holding the path: the longest mount point it's under.
    let mounts = fs::read_to_string("/proc/self/mounts").ok()?;
    let source = mounts
        .lines()
        .filter_map(|line| {
            let mut fields = line.split_whitespace();
            let source = fields.next()?;
            let target = fields.next()?.replace("\\040", " ");
            path.starts_with(&target).then(|| (target.len(), source.to_string()))
        })
        .max_by_key(|(length, _)| *length)
        .map(|(_, source)| source)?;
    let device = fs::canonicalize(&source).ok();
    if let (Some(device), Ok(entries)) = (&device, fs::read_dir("/dev/disk/by-uuid")) {
        for entry in entries.filter_map(Result::ok) {
            if fs::canonicalize(entry.path()).ok().as_ref() == Some(device) {
                return Some(entry.file_name().to_string_lossy().into_owned());
            }
        }
    }
    use std::os::unix::fs::MetadataExt;
    fs::metadata(&path).ok().map(|m| format!("dev{:X}", m.dev()))
}

/// Serial number of the volume holding `path`. Lets moved external drives be recognized even when
/// their drive letter changes.
#[cfg(windows)]
pub fn volume_serial(path: &Path) -> Option<String> {
    use windows_sys::Win32::Storage::FileSystem::{GetVolumeInformationW, GetVolumePathNameW};
    let wide: Vec<u16> = path.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    let mut root = [0u16; 261];
    let mut serial = 0u32;
    unsafe {
        if GetVolumePathNameW(wide.as_ptr(), root.as_mut_ptr(), root.len() as u32) == 0 {
            return None;
        }
        let ok = GetVolumeInformationW(
            root.as_ptr(),
            std::ptr::null_mut(),
            0,
            &mut serial,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            0,
        );
        (ok != 0).then(|| format!("{serial:08X}"))
    }
}

/// Makes `name` safe as a single Windows path component.
pub fn safe_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if c.is_control() || r#"<>:"/\|?*"#.contains(c) { '_' } else { c })
        .collect();
    let trimmed = cleaned.trim().trim_end_matches(['.', ' ']);
    let mut result: String = trimmed.chars().take(120).collect();
    if result.is_empty() {
        result = "Untitled".into();
    }
    const RESERVED: &[&str] = &["CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "LPT1", "LPT2", "LPT3"];
    if RESERVED.iter().any(|reserved| result.eq_ignore_ascii_case(reserved)) {
        result.push('_');
    }
    result
}

/// `dir/name`, or `dir/name (2).ext`, `(3)`… when that file already exists.
pub fn unique_path(dir: &Path, name: &str) -> PathBuf {
    let candidate = dir.join(name);
    if !candidate.exists() {
        return candidate;
    }
    let path = Path::new(name);
    let stem = path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let extension = path.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    (2..)
        .map(|n| dir.join(format!("{stem} ({n}){extension}")))
        .find(|candidate| !candidate.exists())
        .expect("an unused file name exists")
}

/// Orders "page2" before "page10", ignoring case.
pub fn natural_cmp(a: &str, b: &str) -> Ordering {
    let (mut x, mut y) = (a.chars().peekable(), b.chars().peekable());
    loop {
        match (x.peek().copied(), y.peek().copied()) {
            (None, None) => return Ordering::Equal,
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (Some(c1), Some(c2)) if c1.is_ascii_digit() && c2.is_ascii_digit() => {
                let mut n1 = String::new();
                while let Some(c) = x.next_if(char::is_ascii_digit) {
                    n1.push(c);
                }
                let mut n2 = String::new();
                while let Some(c) = y.next_if(char::is_ascii_digit) {
                    n2.push(c);
                }
                let (t1, t2) = (n1.trim_start_matches('0'), n2.trim_start_matches('0'));
                let order = t1.len().cmp(&t2.len()).then_with(|| t1.cmp(t2));
                if order != Ordering::Equal {
                    return order;
                }
            }
            (Some(c1), Some(c2)) => {
                let order = c1.to_lowercase().cmp(c2.to_lowercase());
                if order != Ordering::Equal {
                    return order;
                }
                x.next();
                y.next();
            }
        }
    }
}

/// Opens File Explorer with `path` selected (on Linux, the file manager on its folder).
pub fn reveal(path: &Path) -> AppResult<()> {
    if !path.exists() {
        return Err(AppError::msg(format!("{} no longer exists", path.display())));
    }
    #[cfg(windows)]
    return Command::new("explorer")
        .raw_arg(format!("/select,\"{}\"", path.display()))
        .spawn()
        .map(|_| ())
        .map_err(|e| AppError::msg(format!("could not open File Explorer: {e}")));
    #[cfg(not(windows))]
    {
        let folder = if path.is_dir() { path } else { path.parent().unwrap_or(path) };
        Command::new("xdg-open")
            .arg(folder)
            .spawn()
            .map(|_| ())
            .map_err(|e| AppError::msg(format!("could not open the file manager: {e}")))
    }
}

/// Marks files as missing (or found again). Returns how many statuses changed.
pub fn check_missing(library: &Library) -> AppResult<usize> {
    let files: Vec<(i64, String, String, String)> = library.db.with(|conn| {
        let mut stmt = conn.prepare("SELECT id, path, storage, status FROM files")?;
        let rows = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)))?
            .collect::<Result<_, _>>()?;
        Ok(rows)
    })?;
    let changes: Vec<(i64, &str)> = files
        .iter()
        .filter_map(|(id, path, storage, status)| {
            let now = if library.folder.resolve(path, storage).exists() { "ok" } else { "missing" };
            (now != status).then_some((*id, now))
        })
        .collect();
    if !changes.is_empty() {
        library.db.with(|conn| {
            let tx = conn.transaction()?;
            {
                let mut update = tx.prepare(
                    "UPDATE files SET status = ?2, \
                     last_seen_at = CASE WHEN ?2 = 'ok' THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ELSE last_seen_at END \
                     WHERE id = ?1",
                )?;
                for (id, status) in &changes {
                    update.execute(params![id, status])?;
                }
            }
            tx.commit()?;
            Ok(())
        })?;
    }
    Ok(changes.len())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelinkReport {
    pub missing: usize,
    pub found: usize,
}

/// Finds missing files that were moved or renamed: walks `folder` and matches files by size and
/// fingerprint, so a file is only relinked when its content is the same.
pub fn relink(library: &Library, folder: &Path) -> AppResult<RelinkReport> {
    let missing: Vec<(i64, i64, String)> = library.db.with(|conn| {
        let mut stmt = conn.prepare(
            "SELECT id, size, quick_hash FROM files \
             WHERE status <> 'ok' AND storage = 'referenced' AND size IS NOT NULL AND quick_hash IS NOT NULL",
        )?;
        let rows = stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?.collect::<Result<_, _>>()?;
        Ok(rows)
    })?;
    let mut wanted: HashMap<u64, Vec<(i64, String)>> = HashMap::new();
    for (id, size, hash) in &missing {
        wanted.entry(*size as u64).or_default().push((*id, hash.clone()));
    }

    let mut found: Vec<(i64, PathBuf)> = Vec::new();
    for entry in WalkDir::new(folder).follow_links(false).into_iter().filter_map(Result::ok) {
        if wanted.is_empty() {
            break;
        }
        if !entry.file_type().is_file() {
            continue;
        }
        let Ok(metadata) = entry.metadata() else { continue };
        let size = metadata.len();
        let Some(candidates) = wanted.get_mut(&size) else { continue };
        let Ok(hash) = quick_hash(entry.path(), size) else { continue };
        if let Some(position) = candidates.iter().position(|(_, wanted_hash)| *wanted_hash == hash) {
            let (id, _) = candidates.remove(position);
            if candidates.is_empty() {
                wanted.remove(&size);
            }
            found.push((id, entry.into_path()));
        }
    }

    if !found.is_empty() {
        library.db.with(|conn| {
            let tx = conn.transaction()?;
            {
                let mut update = tx.prepare(
                    "UPDATE files SET path = ?2, volume_id = ?3, status = 'ok', \
                     last_seen_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?1",
                )?;
                for (id, path) in &found {
                    update.execute(params![id, path.display().to_string(), volume_serial(path)])?;
                }
            }
            tx.commit()?;
            Ok(())
        })?;
    }
    log::info!("relink in {}: {} of {} missing files found", folder.display(), found.len(), missing.len());
    Ok(RelinkReport { missing: missing.len(), found: found.len() })
}

#[tauri::command]
pub async fn files_relink(app: AppHandle, state: State<'_, AppState>, folder: String) -> AppResult<RelinkReport> {
    let library = state.library()?;
    let report = crate::library::blocking(move || relink(&library, Path::new(&folder))).await?;
    if report.found > 0 {
        let _ = app.emit("library-changed", ());
    }
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn natural_order_compares_numbers_by_value() {
        let mut names = vec!["page10.jpg", "page2.jpg", "Page1.jpg", "page02b.jpg"];
        names.sort_by(|a, b| natural_cmp(a, b));
        assert_eq!(names, ["Page1.jpg", "page2.jpg", "page02b.jpg", "page10.jpg"]);
    }

    #[test]
    fn safe_names_strip_reserved_characters() {
        assert_eq!(safe_name("AC/DC: Live?"), "AC_DC_ Live_");
        assert_eq!(safe_name("  ..  "), "Untitled");
        assert_eq!(safe_name("con"), "con_");
    }
}

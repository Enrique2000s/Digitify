//! Hover previews for Videos (D-179): a short silent clip of a video, played over its cover while
//! it's hovered (or selected in Big Picture), as video sites do. It's three 2-second moments from
//! across the video (one stretch of up to 6 seconds for a short one), at most 480 px, as WebM (VP8:
//! the LGPL FFmpeg Digitify ships can write it, and both web views play it). Made the first time
//! it's asked for, one at a time, and kept in the library's cache: `<item>-<key>.webm`, the key
//! following the file (its path, size and date), so a changed file gets a new clip.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::OptionalExtension;
use tauri::State;

use crate::error::{AppError, AppResult};
use crate::library::with_library;
use crate::{tools, AppState, Library};

/// One clip is made at a time, so hovering along a row doesn't start a crowd of FFmpegs.
static MAKING: Mutex<()> = Mutex::new(());

/// How long each moment lasts, in seconds, and the most a short video's single stretch lasts.
const MOMENT: f64 = 2.0;
const SHORT: f64 = 6.0;

/// Where a video's clip is (or will be) and its key, when it's a video in Videos with its file here.
pub fn clip_of(library: &Library, item: i64) -> AppResult<Option<(PathBuf, String, PathBuf, Option<f64>)>> {
    let found = library.db.with(|conn| {
        let row: Option<Option<f64>> = conn
            .query_row(
                "SELECT CAST(json_extract(i.metadata, '$.durationSec') AS REAL) FROM items i JOIN categories c ON c.id = i.category_id \
                 WHERE i.id = ?1 AND c.key = 'videos'",
                [item],
                |row| row.get(0),
            )
            .optional()?;
        let Some(duration) = row else { return Ok(None) };
        Ok(crate::watch::video_file(library, conn, item, None).ok().map(|source| (source, duration)))
    })?;
    let Some((source, duration)) = found else { return Ok(None) };
    let Ok(meta) = std::fs::metadata(&source) else { return Ok(None) };
    let modified = meta.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map_or(0, |d| d.as_secs());
    let mut hasher = blake3::Hasher::new();
    hasher.update(source.to_string_lossy().as_bytes());
    hasher.update(&meta.len().to_le_bytes());
    hasher.update(&modified.to_le_bytes());
    let key = hasher.finalize().to_hex()[..16].to_string();
    let clip = library.folder.previews_dir().join(format!("{item}-{key}.webm"));
    Ok(Some((clip, key, source, duration)))
}

/// The moments a clip is made of, as (start, length) in seconds: three from across a video long
/// enough (15%, 45% and 75% in), or one stretch from the start of a short one or one of unknown length.
pub fn moments(duration: Option<f64>) -> Vec<(f64, f64)> {
    match duration.filter(|d| d.is_finite() && *d > 0.0) {
        Some(d) if d >= 12.0 => [0.15, 0.45, 0.75].iter().map(|f| ((d * f * 100.0).round() / 100.0, MOMENT)).collect(),
        Some(d) => vec![(0.0, d.min(SHORT))],
        None => vec![(0.0, SHORT)],
    }
}

/// FFmpeg's arguments for a clip of `source` made of `moments`, written to `out`.
fn ffmpeg_args(source: &Path, moments: &[(f64, f64)], out: &Path) -> Vec<std::ffi::OsString> {
    let mut args: Vec<std::ffi::OsString> = ["-hide_banner", "-loglevel", "error", "-y"].iter().map(Into::into).collect();
    for (start, length) in moments {
        for arg in ["-ss".to_string(), format!("{start:.2}"), "-t".to_string(), format!("{length:.2}"), "-i".to_string()] {
            args.push(arg.into());
        }
        args.push(source.as_os_str().to_owned());
    }
    // Each moment the same size and pace, then one after another.
    let shape = "scale=480:480:force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2,setsar=1,fps=24,format=yuv420p";
    let mut filter: String = (0..moments.len()).map(|i| format!("[{i}:v:0]{shape}[m{i}];")).collect();
    filter += &(0..moments.len()).map(|i| format!("[m{i}]")).collect::<String>();
    filter += &format!("concat=n={}:v=1:a=0[v]", moments.len());
    for arg in ["-filter_complex", &filter, "-map", "[v]", "-an", "-c:v", "libvpx", "-deadline", "realtime", "-cpu-used", "8", "-b:v", "700k", "-crf", "20", "-auto-alt-ref", "0", "-f", "webm"] {
        args.push(arg.into());
    }
    args.push(out.as_os_str().to_owned());
    args
}

/// Makes a video's clip if it hasn't one yet. Returns its key (for the address it's played from),
/// or nothing when there's no clip to have: not a video in Videos, its file isn't here, or FFmpeg
/// couldn't read it.
#[tauri::command]
pub async fn video_preview(state: State<'_, AppState>, id: i64) -> AppResult<Option<String>> {
    with_library(&state, move |library| {
        let Some((clip, key, source, duration)) = clip_of(library, id)? else { return Ok(None) };
        if clip.is_file() {
            return Ok(Some(key));
        }
        let _one_at_a_time = MAKING.lock().unwrap_or_else(|e| e.into_inner());
        if clip.is_file() {
            return Ok(Some(key));
        }
        let ffmpeg = tools::find("ffmpeg").ok_or_else(|| AppError::msg("FFmpeg isn't available, so videos have no previews."))?;
        let dir = library.folder.previews_dir();
        std::fs::create_dir_all(&dir)?;
        let part = dir.join(format!("{id}-{key}.part"));
        let output = tools::command(&ffmpeg).args(ffmpeg_args(&source, &moments(duration), &part)).output()?;
        let made = output.status.success() && std::fs::metadata(&part).is_ok_and(|m| m.len() > 0);
        if !made {
            let _ = std::fs::remove_file(&part);
            log::warn!("no preview for video {id}: {}", String::from_utf8_lossy(&output.stderr).trim());
            return Ok(None);
        }
        std::fs::rename(&part, &clip)?;
        // The clip of an earlier file of this video goes.
        let mine = format!("{id}-");
        if let Ok(entries) = std::fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.starts_with(&mine) && entry.path() != clip {
                    let _ = std::fs::remove_file(entry.path());
                }
            }
        }
        Ok(Some(key))
    })
    .await
}

/// Clips of videos no longer in Videos go (run with the startup's maintenance). Returns how many.
pub fn prune(library: &Library) -> AppResult<usize> {
    let dir = library.folder.previews_dir();
    let Ok(entries) = std::fs::read_dir(&dir) else { return Ok(0) };
    let kept: std::collections::HashSet<i64> = library.db.with(|conn| {
        let ids = conn
            .prepare("SELECT i.id FROM items i JOIN categories c ON c.id = i.category_id WHERE c.key = 'videos'")?
            .query_map([], |row| row.get(0))?
            .collect::<Result<_, _>>()?;
        Ok(ids)
    })?;
    let mut removed = 0;
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let item = name.split('-').next().and_then(|id| id.parse::<i64>().ok());
        if item.is_none_or(|id| !kept.contains(&id)) || name.ends_with(".part") {
            if std::fs::remove_file(entry.path()).is_ok() {
                removed += 1;
            }
        }
    }
    Ok(removed)
}

/// The file type a clip is served as.
pub const MIME: &str = "video/webm";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_clip_is_three_moments_or_one_stretch() {
        assert_eq!(moments(Some(100.0)), vec![(15.0, 2.0), (45.0, 2.0), (75.0, 2.0)]);
        assert_eq!(moments(Some(8.0)), vec![(0.0, 6.0)]);
        assert_eq!(moments(Some(3.5)), vec![(0.0, 3.5)]);
        assert_eq!(moments(None), vec![(0.0, 6.0)]);
        assert_eq!(moments(Some(f64::NAN)), vec![(0.0, 6.0)]);
    }

    #[test]
    fn ffmpeg_reads_each_moment_and_joins_them() {
        let args: Vec<String> = ffmpeg_args(Path::new("v.mkv"), &moments(Some(100.0)), Path::new("out.part")).into_iter().map(|a| a.to_string_lossy().to_string()).collect();
        assert_eq!(args.iter().filter(|a| *a == "-i").count(), 3);
        let filter = &args[args.iter().position(|a| a == "-filter_complex").unwrap() + 1];
        assert!(filter.ends_with("[m0][m1][m2]concat=n=3:v=1:a=0[v]"), "{filter}");
        assert!(args.contains(&"-an".to_string()) && args.contains(&"libvpx".to_string()));
        assert_eq!(args.last().unwrap(), "out.part");
    }
}

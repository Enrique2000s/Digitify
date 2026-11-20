//! Downloading from YouTube and other sites with yt-dlp (D-133). Digitify ships yt-dlp's official
//! build and Deno, which runs the JavaScript yt-dlp needs for YouTube. Settings › Online services
//! can update yt-dlp into the config folder, and that copy is used while it's newer than the one
//! the app ships. yt-dlp never signs in anywhere, and media protected with DRM is never downloaded
//! (D-007): yt-dlp refuses it, and Digitify says so.

use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

use super::http;
use crate::error::{AppError, AppResult};

const EXE: &str = if cfg!(windows) { "yt-dlp.exe" } else { "yt-dlp" };
const DENO: &str = if cfg!(windows) { "deno.exe" } else { "deno" };
/// yt-dlp's release file for this system, for updates.
const ASSET: &str = if cfg!(windows) { "yt-dlp.exe" } else { "yt-dlp_linux" };
const RELEASES: &str = "https://github.com/yt-dlp/yt-dlp/releases";
/// The most entries listed for one playlist or channel.
pub const MAX_ENTRIES: usize = 500;

/// How a download is made (chosen in Import from URL and remembered there).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Quality {
    /// "best", or the tallest picture wanted: "2160", "1440", "1080", "720", "480".
    pub video: String,
    /// "mkv" or "mp4".
    pub container: String,
    /// "mp3", "m4a" or "original" (the site's own sound, usually Opus).
    pub audio: String,
}

impl Default for Quality {
    fn default() -> Self {
        Quality { video: "best".into(), container: "mkv".into(), audio: "mp3".into() }
    }
}

impl Quality {
    /// yt-dlp's options for it: a video with its sound, or the sound alone.
    fn args(&self, audio: bool) -> Vec<String> {
        let mut args: Vec<String> = Vec::new();
        if audio {
            let m4a = self.audio == "m4a";
            args.extend(["-f".into(), if m4a { "ba[ext=m4a]/ba/b".into() } else { "ba/b".into() }, "-x".into()]);
            if matches!(self.audio.as_str(), "mp3" | "m4a") {
                args.extend(["--audio-format".into(), self.audio.clone(), "--audio-quality".into(), "0".into()]);
            }
            args.push("--embed-thumbnail".into());
        } else {
            let container = if self.container == "mp4" { "mp4" } else { "mkv" };
            args.extend(["-f".into(), "bv*+ba/b".into()]);
            // Prefers the tallest picture up to the one chosen (or the smallest above it, if that's all
            // there is); MP4 also prefers streams that fit in it.
            let mut sort: Vec<String> = Vec::new();
            if let Ok(height) = self.video.parse::<u32>() {
                sort.push(format!("res:{height}"));
            }
            if container == "mp4" {
                sort.push("ext:mp4:m4a".into());
            }
            if !sort.is_empty() {
                args.extend(["-S".into(), sort.join(",")]);
            }
            args.extend(["--merge-output-format".into(), container.into(), "--remux-video".into(), container.into()]);
        }
        args
    }
}

/// The yt-dlp Digitify runs, with the helpers it's given.
pub struct YtDlp {
    exe: PathBuf,
    deno: Option<PathBuf>,
    ffmpeg: Option<PathBuf>,
    cache: PathBuf,
    pub version: String,
    /// The copy updated from Settings rather than the one the app ships.
    pub updated: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub available: bool,
    pub version: Option<String>,
    pub shipped_version: Option<String>,
    pub updated: bool,
    pub deno: bool,
    pub ffmpeg: bool,
}

/// The folder of the yt-dlp the app ships: next to the app (Windows), among the Linux packages'
/// resources (`../lib/Digitify/yt-dlp`), or `tools/yt-dlp` for builds run from the source tree.
fn shipped_dir() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    [dir.join("yt-dlp"), dir.join("../lib/Digitify/yt-dlp"), dir.join("../lib/digitify/yt-dlp")]
        .into_iter()
        .chain(dir.ancestors().take(5).map(|ancestor| ancestor.join("tools").join("yt-dlp")))
        .find(|candidate| candidate.join(EXE).is_file())
}

fn own_dir(config: &Path) -> PathBuf {
    config.join("tools").join("yt-dlp")
}

fn read_version(dir: &Path) -> String {
    std::fs::read_to_string(dir.join("yt-dlp.version")).map(|v| v.trim().to_string()).unwrap_or_default()
}

/// "2026.10.26" → [2026, 10, 26], for comparing yt-dlp's date versions.
fn version_parts(version: &str) -> Vec<u64> {
    version.split('.').map(|part| part.parse().unwrap_or(0)).collect()
}

/// A program the app ships, made runnable: a Linux package that lost the files' permission to run
/// gets a runnable copy in the config folder.
fn runnable(path: &Path, config: &Path) -> Option<PathBuf> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(path).ok()?.permissions().mode();
        if mode & 0o111 == 0 {
            let copy = config.join("tools").join("shipped").join(path.file_name()?);
            let fresh = std::fs::metadata(&copy).ok().map(|m| m.len()) == std::fs::metadata(path).ok().map(|m| m.len());
            if !fresh {
                std::fs::create_dir_all(copy.parent()?).ok()?;
                std::fs::copy(path, &copy).ok()?;
            }
            std::fs::set_permissions(&copy, std::fs::Permissions::from_mode(0o755)).ok()?;
            return Some(copy);
        }
    }
    #[cfg(not(unix))]
    let _ = config;
    Some(path.to_path_buf())
}

/// The yt-dlp to run: the copy updated from Settings while it's newer than the shipped one.
pub fn locate(config: &Path) -> Option<YtDlp> {
    let shipped = shipped_dir();
    let shipped_version = shipped.as_deref().map(read_version).unwrap_or_default();
    let own = own_dir(config);
    let own_version = read_version(&own);
    let use_own = own.join(EXE).is_file() && (shipped.is_none() || version_parts(&own_version) > version_parts(&shipped_version));
    let (exe, version) = if use_own {
        (own.join(EXE), own_version)
    } else {
        (runnable(&shipped.as_ref()?.join(EXE), config)?, shipped_version)
    };
    let deno = shipped.as_ref().map(|dir| dir.join(DENO)).filter(|p| p.is_file()).and_then(|p| runnable(&p, config));
    Some(YtDlp { exe, deno, ffmpeg: crate::tools::find("ffmpeg"), cache: config.join("cache").join("yt-dlp"), version, updated: use_own })
}

pub fn status(config: &Path) -> Status {
    let shipped_version = shipped_dir().as_deref().map(read_version).filter(|v| !v.is_empty());
    match locate(config) {
        Some(tool) => Status {
            available: true,
            version: Some(tool.version.clone()).filter(|v| !v.is_empty()),
            shipped_version,
            updated: tool.updated,
            deno: tool.deno.is_some(),
            ffmpeg: tool.ffmpeg.is_some(),
        },
        None => Status { available: false, version: None, shipped_version, updated: false, deno: false, ffmpeg: crate::tools::find("ffmpeg").is_some() },
    }
}

/// What a running yt-dlp printed, line by line, from either of its outputs.
enum Line {
    Out(String),
    Err(String),
}

/// Stops yt-dlp and what it started (its own unpacked program, FFmpeg, Deno).
fn stop(child: &mut Child) {
    #[cfg(windows)]
    {
        let _ = crate::tools::command(Path::new("taskkill")).args(["/PID", &child.id().to_string(), "/T", "/F"]).stdout(Stdio::null()).stderr(Stdio::null()).status();
    }
    #[cfg(target_os = "linux")]
    unsafe {
        // It runs in a process group of its own (see `spawn`).
        libc::kill(-(child.id() as i32), libc::SIGTERM);
    }
    let _ = child.kill();
    let _ = child.wait();
}

impl YtDlp {
    fn command(&self) -> Command {
        let mut command = crate::tools::command(&self.exe);
        command
            .args(["--ignore-config", "--no-update", "--no-color", "--encoding", "utf-8", "--socket-timeout", "30"])
            // Sites yt-dlp knows; never a guess at any web page.
            .args(["--use-extractors", "default,-generic"])
            .arg("--cache-dir")
            .arg(&self.cache)
            .env("PYTHONIOENCODING", "utf-8")
            .env("PYTHONUTF8", "1");
        if let Some(deno) = &self.deno {
            let mut runtime = std::ffi::OsString::from("deno:");
            runtime.push(deno);
            command.arg("--js-runtimes").arg(runtime);
        }
        if let Some(ffmpeg) = &self.ffmpeg {
            command.arg("--ffmpeg-location").arg(ffmpeg);
        }
        command
    }

    /// Starts yt-dlp with its outputs read line by line on two threads.
    fn spawn(&self, mut command: Command) -> AppResult<(Child, mpsc::Receiver<Line>)> {
        command.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
        #[cfg(target_os = "linux")]
        {
            use std::os::unix::process::CommandExt;
            command.process_group(0);
        }
        let mut child = command.spawn().map_err(|e| AppError::msg(format!("yt-dlp couldn't start: {e}")))?;
        let (send, lines) = mpsc::channel();
        if let Some(out) = child.stdout.take() {
            let send = send.clone();
            std::thread::spawn(move || {
                for line in BufReader::new(out).lines().map_while(Result::ok) {
                    let _ = send.send(Line::Out(line));
                }
            });
        }
        if let Some(err) = child.stderr.take() {
            std::thread::spawn(move || {
                for line in BufReader::new(err).lines().map_while(Result::ok) {
                    let _ = send.send(Line::Err(line));
                }
            });
        }
        Ok((child, lines))
    }

    /// What a link holds, as yt-dlp's JSON: one video, or a playlist's entries without looking
    /// into each (up to `MAX_ENTRIES`).
    pub fn inspect(&self, url: &str) -> AppResult<Value> {
        let mut command = self.command();
        command.args(["-J", "--flat-playlist", "--no-warnings", "-I"]).arg(format!(":{MAX_ENTRIES}")).arg("--").arg(url);
        let (mut child, lines) = self.spawn(command)?;
        let (mut out, mut err) = (String::new(), String::new());
        let deadline = Instant::now() + Duration::from_secs(180);
        loop {
            match lines.recv_timeout(Duration::from_millis(250)) {
                Ok(Line::Out(line)) => {
                    out.push_str(&line);
                    out.push('\n');
                }
                Ok(Line::Err(line)) => {
                    err.push_str(&line);
                    err.push('\n');
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
                Err(mpsc::RecvTimeoutError::Timeout) if Instant::now() > deadline => {
                    stop(&mut child);
                    return Err(AppError::msg("The site took too long to answer. Try again later."));
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
            }
        }
        let status = child.wait()?;
        match serde_json::from_str::<Value>(out.trim()) {
            Ok(info) if status.success() || info.is_object() => Ok(info),
            _ => {
                log::warn!("yt-dlp couldn't read {url} ({status}): {}", err.trim().replace('\n', " | "));
                Err(AppError::msg(explain(&err)))
            }
        }
    }

    /// Downloads one video or song into `work` (a folder of its own), with progress from 0 to 1,
    /// stopping when cancelled. Returns the file and the cover yt-dlp saved for it.
    pub fn download(&self, url: &str, audio: bool, quality: &Quality, work: &Path, cancel: &AtomicBool, progress: &mut dyn FnMut(f64)) -> AppResult<(PathBuf, Option<PathBuf>)> {
        std::fs::create_dir_all(work)?;
        std::fs::create_dir_all(&self.cache).ok();
        let mut command = self.command();
        command
            .args(["--no-playlist", "--newline", "--progress", "--embed-metadata", "--write-thumbnail", "--convert-thumbnails", "jpg"])
            .args(["--progress-template", "download:DLP-P %(info.format_id)s %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s"])
            .args(["--print", "before_dl:DLP-F %(format_id)s", "--print", "after_move:DLP-D %(filepath)s"])
            .arg("-o")
            .arg(work.join("media.%(ext)s"))
            .arg("-o")
            .arg({
                let mut template = std::ffi::OsString::from("thumbnail:");
                template.push(work.join("cover.%(ext)s"));
                template
            })
            .args(quality.args(audio))
            .arg("--")
            .arg(url);
        let (mut child, lines) = self.spawn(command)?;
        let mut formats: Vec<String> = Vec::new();
        let mut file: Option<PathBuf> = None;
        let mut errors = String::new();
        // The last things it said, for the log when it fails.
        let mut said: std::collections::VecDeque<String> = std::collections::VecDeque::new();
        loop {
            if cancel.load(Ordering::Relaxed) {
                stop(&mut child);
                return Err(AppError::msg("cancelled"));
            }
            match lines.recv_timeout(Duration::from_millis(200)) {
                Ok(Line::Out(line)) => {
                    if let Some(ids) = line.strip_prefix("DLP-F ") {
                        formats = ids.trim().split('+').map(str::to_string).collect();
                    } else if let Some(rest) = line.strip_prefix("DLP-P ") {
                        let mut fields = rest.split_whitespace();
                        let format = fields.next().unwrap_or_default();
                        let number = |value: Option<&str>| value.and_then(|v| v.parse::<f64>().ok()).filter(|v| *v > 0.0);
                        let done = number(fields.next());
                        let (total, estimate) = (number(fields.next()), number(fields.next()));
                        if let (Some(done), Some(total)) = (done, total.or(estimate)) {
                            let stages = formats.len().max(1) as f64;
                            let stage = formats.iter().position(|f| f == format).unwrap_or(0) as f64;
                            progress(((stage + (done / total).min(1.0)) / stages * 0.95).min(0.95));
                        }
                    } else if let Some(path) = line.strip_prefix("DLP-D ") {
                        file = Some(PathBuf::from(path.trim()));
                        progress(0.97);
                    }
                }
                Ok(Line::Err(line)) => {
                    if line.starts_with("ERROR:") {
                        errors.push_str(&line);
                        errors.push('\n');
                    }
                    if said.len() == 20 {
                        said.pop_front();
                    }
                    said.push_back(line);
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
                Err(mpsc::RecvTimeoutError::Timeout) => {}
            }
        }
        let status = child.wait()?;
        if !status.success() {
            log::warn!("yt-dlp couldn't download {url} ({status}): {}", Vec::from(said).join(" | "));
            return Err(AppError::msg(explain(&errors)));
        }
        // The file yt-dlp named, else the one media file it left in the folder.
        let file = file.filter(|f| f.is_file()).or_else(|| {
            std::fs::read_dir(work).ok()?.filter_map(Result::ok).map(|e| e.path()).find(|p| {
                p.file_stem().is_some_and(|s| s == "media") && p.extension().and_then(|e| e.to_str()).and_then(super::link::media_of_extension).is_some()
            })
        });
        let file = file.ok_or_else(|| AppError::msg("yt-dlp finished without leaving a file."))?;
        // yt-dlp moves the picture to its own name last of all.
        let cover = [work.join("cover.jpg"), work.join("media.jpg")].into_iter().find(|p| p.is_file());
        Ok((file, cover))
    }
}

/// What yt-dlp's error means, for the person importing.
pub fn explain(stderr: &str) -> String {
    let line = stderr.lines().rev().find(|l| l.starts_with("ERROR:")).or_else(|| stderr.lines().rev().find(|l| !l.trim().is_empty())).unwrap_or("").trim();
    let lower = line.to_ascii_lowercase();
    let has = |words: &[&str]| words.iter().any(|w| lower.contains(w));
    if has(&["drm"]) {
        "It's protected with DRM, so Digitify doesn't download it.".into()
    } else if has(&["confirm your age", "age-restricted", "age restricted", "inappropriate for some users"]) {
        "It's age-restricted: the site asks to sign in for it, and Digitify doesn't sign in.".into()
    } else if has(&["logged-in", "logged in", "account credentials", "--cookies", "login required", "sign in to view"]) {
        "The site asks to sign in for it, and Digitify doesn't sign in.".into()
    } else if has(&["not a bot"]) {
        "YouTube is asking to confirm this isn't a bot. Try again in a while.".into()
    } else if has(&["members-only", "join this channel", "members only"]) {
        "It's for the channel's members only.".into()
    } else if has(&["private video", "is private"]) {
        "It's private.".into()
    } else if has(&["premiere", "will begin", "live event will", "is upcoming"]) {
        "It isn't out yet.".into()
    } else if has(&["requested format is not available"]) {
        "The site changed how it serves its media. Update yt-dlp in Settings › Online services, then retry.".into()
    } else if has(&["unsupported url", "no suitable extractor"]) {
        "Digitify can't find anything to download at that link.".into()
    } else if has(&["video unavailable", "is unavailable", "not available", "has been removed", "no longer available", "does not exist", "http error 404", "this video has been"]) {
        "It isn't available: removed, private or blocked in your region.".into()
    } else if has(&["http error 429", "too many requests", "rate-limit", "rate limit"]) {
        "The site asks to slow down. Try again in a while.".into()
    } else if has(&["getaddrinfo", "name or service not known", "failed to resolve", "timed out", "connection refused", "network is unreachable", "no address associated", "connection reset"]) {
        "Couldn't reach the site. Check your internet connection and try again.".into()
    } else if has(&["http error 403", "requested format is not available", "signature", "nsig", "player response", "unable to extract", "js challenge", "javascript runtime"]) {
        "The site changed how it serves its media. Update yt-dlp in Settings › Online services, then retry.".into()
    } else if line.is_empty() {
        "yt-dlp stopped without saying why. Retry, or update it in Settings › Online services.".into()
    } else {
        let detail: String = line.trim_start_matches("ERROR:").trim().chars().take(240).collect();
        format!("yt-dlp couldn't get it: {detail}")
    }
}

/// Whether a failed download may work on a second try: not when the video is gone, private,
/// behind a sign-in, protected or not out yet.
pub fn worth_retrying(message: &str) -> bool {
    message.contains("changed how it serves") || message.contains("Couldn't reach") || message.contains("stopped without saying") || message.starts_with("yt-dlp couldn't get it")
}

/// Updates yt-dlp to its newest release, into the config folder: the release's own SHA-256 list is
/// checked against the file before it's used. Returns the version now in use.
pub fn update(config: &Path) -> AppResult<String> {
    let latest = http::json("GitHub", http::get("https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest")?.set("Accept", "application/vnd.github+json"))?;
    let tag = latest["tag_name"]
        .as_str()
        .map(str::to_string)
        .filter(|t| !t.is_empty() && t.chars().all(|c| c.is_ascii_digit() || c == '.'))
        .ok_or_else(|| AppError::msg("GitHub didn't say which yt-dlp is the newest."))?;
    let sums = http::send("GitHub", http::get(&format!("{RELEASES}/download/{tag}/SHA2-256SUMS"))?, None)?;
    let list = sums.into_string().map_err(|_| AppError::msg("GitHub sent an answer Digitify couldn't read."))?;
    let expected = list
        .lines()
        .find_map(|line| {
            let (hash, name) = line.split_once(char::is_whitespace)?;
            (name.trim().trim_start_matches('*') == ASSET).then(|| hash.trim().to_ascii_lowercase())
        })
        .ok_or_else(|| AppError::msg("yt-dlp's newest release doesn't list a file for this system."))?;
    if locate(config).is_some_and(|tool| version_parts(&tool.version) >= version_parts(&tag)) {
        return Ok(tag);
    }
    let dir = own_dir(config);
    std::fs::create_dir_all(&dir)?;
    let partial = dir.join(format!("{EXE}.part"));
    let response = http::send("GitHub", http::get(&format!("{RELEASES}/download/{tag}/{ASSET}"))?.timeout(Duration::from_secs(15 * 60)), None)?;
    let outcome = (|| -> AppResult<()> {
        let mut reader = response.into_reader().take(300 * 1024 * 1024);
        let mut out = std::io::BufWriter::new(std::fs::File::create(&partial)?);
        let mut hasher = Sha256::new();
        let mut buffer = vec![0u8; 64 * 1024];
        loop {
            let read = reader.read(&mut buffer).map_err(|_| AppError::msg("The connection to GitHub dropped. Try again."))?;
            if read == 0 {
                break;
            }
            hasher.update(&buffer[..read]);
            out.write_all(&buffer[..read])?;
        }
        out.flush()?;
        let actual: String = hasher.finalize().iter().map(|b| format!("{b:02x}")).collect();
        if actual != expected {
            return Err(AppError::msg("The downloaded yt-dlp didn't match its checksum, so it wasn't used."));
        }
        Ok(())
    })();
    if let Err(e) = outcome {
        let _ = std::fs::remove_file(&partial);
        return Err(e);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&partial, std::fs::Permissions::from_mode(0o755))?;
    }
    std::fs::rename(&partial, dir.join(EXE)).map_err(|e| AppError::msg(format!("yt-dlp couldn't be replaced (is a download running?): {e}")))?;
    std::fs::write(dir.join("yt-dlp.version"), &tag)?;
    Ok(tag)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn options_for_each_choice() {
        let q = |video: &str, container: &str, audio: &str| Quality { video: video.into(), container: container.into(), audio: audio.into() };
        let joined = |args: Vec<String>| args.join(" ");
        assert_eq!(joined(q("best", "mkv", "mp3").args(false)), "-f bv*+ba/b --merge-output-format mkv --remux-video mkv");
        assert_eq!(joined(q("1080", "mp4", "mp3").args(false)), "-f bv*+ba/b -S res:1080,ext:mp4:m4a --merge-output-format mp4 --remux-video mp4");
        assert_eq!(joined(q("720", "mkv", "mp3").args(true)), "-f ba/b -x --audio-format mp3 --audio-quality 0 --embed-thumbnail");
        assert_eq!(joined(q("best", "mkv", "m4a").args(true)), "-f ba[ext=m4a]/ba/b -x --audio-format m4a --audio-quality 0 --embed-thumbnail");
        assert_eq!(joined(q("best", "mkv", "original").args(true)), "-f ba/b -x --embed-thumbnail");
        assert!(version_parts("2026.11.2") > version_parts("2026.10.26"));
        assert!(version_parts("2026.10.26.1") > version_parts("2026.10.26"));
    }

    #[test]
    fn errors_are_explained() {
        assert!(explain("ERROR: [youtube] abc: Sign in to confirm your age. This video may be inappropriate for some users.").contains("age-restricted"));
        assert!(explain("ERROR: [youtube] abc: Video unavailable. This video has been removed by the uploader").contains("isn't available"));
        assert!(explain("ERROR: [youtube] abc: Private video. Sign in if you've been granted access").contains("private"));
        assert!(explain("ERROR: This video is DRM protected").contains("DRM"));
        assert!(explain("ERROR: [youtube] aaaaaaaaaaa: This video is unavailable").contains("isn't available"));
        assert!(explain("ERROR: Unsupported URL: https://example.com/").contains("can't find anything"));
        assert!(explain("ERROR: No suitable extractor found for URL https://example.com/page.html").contains("can't find anything"));
        assert!(explain("ERROR: [vimeo] 1: The web client only works when logged-in. Use --cookies").contains("sign in"));
        assert!(explain("ERROR: unable to download video data: HTTP Error 403: Forbidden").contains("Update yt-dlp"));
    }
}

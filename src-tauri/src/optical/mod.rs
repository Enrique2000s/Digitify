//! Optical discs (Phase 4, D-022): the drives and what's in them, audio CDs (play straight from
//! the disc, rip with verification, import as an album), DVDs and Blu-rays (titles, chapters and
//! languages; play and import unprotected ones as MKV), data discs (browse and import), and
//! cataloging any disc in one click. Protected discs are detected and refused (D-007).
//!
//! `DIGITIFY_FAKE_DRIVES=<folder>` adds simulated drives for testing without hardware: each
//! subfolder named by a letter is a drive, and its contents are the disc (empty: no disc).

pub mod bluray;
pub mod cd;
pub mod dvd;
// The drives themselves: Windows' and Linux's calls behind one interface (`drive_io`).
#[cfg(target_os = "linux")]
mod linux;
#[cfg(windows)]
mod win;
#[cfg(target_os = "linux")]
use linux as drive_io;
#[cfg(windows)]
use win as drive_io;

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};

use crate::error::{AppError, AppResult};
use crate::library::blocking;
use crate::player::{self, PlayerState};
use crate::{files, import, tools, AppState};
use cd::{CdText, SectorSource};

const PROTECTED: &str = "This disc is copy-protected, so Digitify can't play or import it (it never works around protection). You can still catalog it as a physical item.";

/// A simulated disc's audio: its tracks and CD-Text, with the sectors in `audio.bin` next to it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FakeAudioCd {
    pub tracks: Vec<cd::Track>,
    #[serde(default)]
    pub text: CdText,
}

#[derive(Debug, Clone)]
enum Drive {
    Real(char),
    Fake(char, PathBuf),
}

impl Drive {
    fn letter(&self) -> char {
        match self {
            Drive::Real(l) | Drive::Fake(l, _) => *l,
        }
    }

    fn root(&self) -> PathBuf {
        match self {
            #[cfg(windows)]
            Drive::Real(l) => PathBuf::from(format!("{l}:\\")),
            #[cfg(target_os = "linux")]
            Drive::Real(l) => drive_io::root(*l),
            Drive::Fake(_, path) => path.clone(),
        }
    }

    fn has_media(&self) -> bool {
        match self {
            Drive::Real(l) => drive_io::Device::open(*l).map(|d| d.has_media()).unwrap_or(false),
            Drive::Fake(_, path) => std::fs::read_dir(path).map(|mut e| e.next().is_some()).unwrap_or(false),
        }
    }

    /// Changes whenever a different disc is in the drive.
    fn signature(&self) -> String {
        if !self.has_media() {
            return String::new();
        }
        match self {
            Drive::Real(l) => match drive_io::volume(*l) {
                Some((label, serial)) => format!("{label}:{serial:08X}"),
                None => drive_io::Device::open(*l).and_then(|d| d.read_toc()).map(|toc| format!("toc:{}", blake3::hash(&toc).to_hex())).unwrap_or_default(),
            },
            // Every file and its size: a simulated disc can be written into its folder while
            // Digitify runs, which a real disc never does.
            Drive::Fake(_, path) => {
                let mut names: Vec<String> = walkdir::WalkDir::new(path)
                    .into_iter()
                    .filter_map(Result::ok)
                    .map(|e| format!("{}:{}", e.path().strip_prefix(path).unwrap_or(e.path()).display(), e.metadata().map(|m| m.len()).unwrap_or(0)))
                    .collect();
                names.sort();
                format!("fake:{}", blake3::hash(names.join("|").as_bytes()).to_hex())
            }
        }
    }

    fn fake_audio(&self) -> Option<FakeAudioCd> {
        match self {
            Drive::Fake(_, path) => std::fs::read_to_string(path.join("audio-cd.json")).ok().and_then(|text| serde_json::from_str(&text).ok()),
            Drive::Real(_) => None,
        }
    }

    fn sectors(&self) -> AppResult<Box<dyn SectorSource>> {
        Ok(match self {
            Drive::Real(l) => Box::new(drive_io::Device::open(*l)?),
            Drive::Fake(_, path) => Box::new(cd::ImageSource(std::fs::File::open(path.join("audio.bin"))?)),
        })
    }
}

fn drives() -> Vec<Drive> {
    let mut list: Vec<Drive> = drive_io::optical_letters().into_iter().map(Drive::Real).collect();
    if let Some(root) = std::env::var_os("DIGITIFY_FAKE_DRIVES").map(PathBuf::from) {
        if let Ok(entries) = std::fs::read_dir(&root) {
            let mut fakes: Vec<Drive> = entries
                .filter_map(Result::ok)
                .filter(|e| e.path().is_dir())
                .filter_map(|e| {
                    let name = e.file_name().to_string_lossy().to_uppercase();
                    let letter = name.chars().next().filter(|c| c.is_ascii_alphabetic() && name.len() == 1)?;
                    Some(Drive::Fake(letter, e.path()))
                })
                .collect();
            fakes.sort_by_key(Drive::letter);
            list.extend(fakes);
        }
    }
    list
}

fn find(letter: &str) -> AppResult<Drive> {
    drives()
        .into_iter()
        .find(|d| d.letter().to_string().eq_ignore_ascii_case(letter))
        .ok_or_else(|| AppError::msg(format!("There's no disc drive {letter}: any more.")))
}

// ---------------------------------------------------------------------------------------------
// What's in a drive

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Media {
    /// `audio`, `dvd`, `bluray`, `data`, or `unknown` (blank or unreadable).
    pub kind: &'static str,
    pub label: Option<String>,
    /// `CSS`, `AACS` or `BD+` when the disc is protected (D-007).
    pub protection: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveInfo {
    pub letter: String,
    pub name: Option<String>,
    pub media: Option<Media>,
    /// A simulated drive (testing).
    pub simulated: bool,
}

/// Turns a volume label such as "MY_HOLIDAY_2019" into "My Holiday 2019".
fn pretty_label(label: &str) -> String {
    label
        .replace('_', " ")
        .split_whitespace()
        .map(|word| {
            let lower = word.to_lowercase();
            let mut chars = lower.chars();
            chars.next().map(|c| c.to_uppercase().chain(chars).collect()).unwrap_or_default()
        })
        .collect::<Vec<String>>()
        .join(" ")
}

fn audio_disc(drive: &Drive) -> AppResult<FakeAudioCd> {
    if let Some(fake) = drive.fake_audio() {
        return Ok(fake);
    }
    let Drive::Real(letter) = drive else { return Err(AppError::msg("This isn't an audio CD.")) };
    let device = drive_io::Device::open(*letter)?;
    let tracks = cd::parse_toc(&device.read_toc()?);
    if !tracks.iter().any(|t| t.audio) {
        return Err(AppError::msg("This disc has no audio tracks."));
    }
    let text = device.read_cd_text().map(|raw| cd::parse_cd_text(&raw)).unwrap_or_default();
    Ok(FakeAudioCd { tracks, text })
}

fn dvd_protected(drive: &Drive) -> bool {
    if let Drive::Real(letter) = drive {
        if let Some(kind) = drive_io::Device::open(*letter).ok().and_then(|d| d.dvd_protection()) {
            return kind != 0;
        }
    }
    // Without the drive's answer, look at the first title set's sectors.
    let video_ts = drive.root().join("VIDEO_TS");
    (1..=9).map(|n| video_ts.join(format!("VTS_01_{n}.VOB"))).find(|p| p.exists()).is_some_and(|vob| dvd::scrambled(&vob))
}

fn classify(drive: &Drive) -> Option<Media> {
    if !drive.has_media() {
        return None;
    }
    let root = drive.root();
    let volume = match drive {
        Drive::Real(l) => drive_io::volume(*l).map(|(label, _)| label),
        Drive::Fake(_, path) => path.file_name().map(|n| n.to_string_lossy().into_owned()),
    };
    let label = volume.clone().filter(|l| !l.trim().is_empty() && l.len() > 1).map(|l| pretty_label(&l));
    if let Some(fake) = drive.fake_audio() {
        return Some(Media { kind: "audio", label: fake.text.album.clone().or(Some("Audio CD".into())), protection: None });
    }
    if root.join("VIDEO_TS").join("VIDEO_TS.IFO").exists() || root.join("VIDEO_TS").join("VIDEO_TS.BUP").exists() {
        return Some(Media { kind: "dvd", label, protection: dvd_protected(drive).then(|| "CSS".into()) });
    }
    if root.join("BDMV").is_dir() {
        return Some(Media { kind: "bluray", label, protection: bluray::protection(&root).map(str::to_string) });
    }
    if let Drive::Real(letter) = drive {
        if let Ok(toc) = drive_io::Device::open(*letter).and_then(|d| d.read_toc()) {
            let tracks = cd::parse_toc(&toc);
            if tracks.first().is_some_and(|t| t.audio) {
                let album = drive_io::Device::open(*letter).ok().and_then(|d| d.read_cd_text()).and_then(|raw| cd::parse_cd_text(&raw).album);
                return Some(Media { kind: "audio", label: album.or(Some("Audio CD".into())), protection: None });
            }
        }
    }
    Some(Media { kind: if volume.is_some() { "data" } else { "unknown" }, label, protection: None })
}

/// The drive service's memory: what each disc was found to be, and running jobs.
#[derive(Default)]
pub struct OpticalState {
    classified: Mutex<HashMap<String, Option<Media>>>,
    jobs: Mutex<HashMap<u64, Arc<AtomicBool>>>,
    next_job: AtomicU64,
}

fn describe(state: &OpticalState, drive: &Drive) -> DriveInfo {
    let key = format!("{}|{}", drive.letter(), drive.signature());
    let cached = state.classified.lock().ok().and_then(|cache| cache.get(&key).cloned());
    let media = cached.unwrap_or_else(|| {
        let media = classify(drive);
        if let Ok(mut cache) = state.classified.lock() {
            cache.insert(key, media.clone());
        }
        media
    });
    let name = match drive {
        Drive::Real(l) => drive_io::Device::open(*l).ok().and_then(|d| d.product()),
        Drive::Fake(..) => Some("Simulated drive".into()),
    };
    DriveInfo { letter: drive.letter().to_string(), name, media, simulated: matches!(drive, Drive::Fake(..)) }
}

#[tauri::command]
pub async fn drives_list(app: AppHandle) -> AppResult<Vec<DriveInfo>> {
    blocking(move || {
        let state = app.state::<OpticalState>();
        Ok(drives().iter().map(|drive| describe(&state, drive)).collect())
    })
    .await
}

#[tauri::command]
pub async fn drive_eject(letter: String) -> AppResult<()> {
    blocking(move || match find(&letter)? {
        Drive::Real(l) => drive_io::Device::open(l)?.eject().map_err(|e| AppError::msg(format!("The drive didn't eject: {e}"))),
        Drive::Fake(..) => Ok(()),
    })
    .await
}

/// Watches the drives: emits `drives-changed` when a drive appears or goes, or a disc is inserted
/// or taken out. Checks every 2 seconds; asking a drive whether it holds a disc is cheap.
pub fn watch(app: AppHandle) {
    std::thread::spawn(move || {
        let mut last = String::new();
        loop {
            let now: String = drives().iter().map(|d| format!("{}={};", d.letter(), d.signature())).collect();
            if now != last {
                if !last.is_empty() {
                    log::info!("disc drives changed: {now}");
                }
                last = now;
                let _ = app.emit("drives-changed", ());
            }
            std::thread::sleep(Duration::from_secs(2));
        }
    });
}

// ---------------------------------------------------------------------------------------------
// Contents

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioTrack {
    pub number: u32,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub seconds: f64,
    pub audio: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub name: String,
    pub path: String,
    pub dir: bool,
    pub size: u64,
}

#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Contents {
    Audio { album: Option<String>, artist: Option<String>, tracks: Vec<AudioTrack> },
    Dvd { titles: Vec<dvd::DvdTitle> },
    Bluray { titles: Vec<bluray::BlurayTitle> },
    /// A data disc's folder: `root` is where the disc is, `path` the folder shown within it.
    Data { root: String, path: String, entries: Vec<Entry> },
    Protected { disc: String, protection: String, message: String },
    Empty,
}

fn audio_contents(disc: &FakeAudioCd) -> Contents {
    let of = |list: &[(u32, String)], n: u32| list.iter().find(|(t, _)| *t == n).map(|(_, v)| v.clone());
    Contents::Audio {
        album: disc.text.album.clone(),
        artist: disc.text.artist.clone(),
        tracks: disc
            .tracks
            .iter()
            .map(|t| AudioTrack { number: t.number, title: of(&disc.text.titles, t.number), artist: of(&disc.text.performers, t.number), seconds: t.seconds(), audio: t.audio })
            .collect(),
    }
}

/// A folder within a data disc, refusing anything outside it.
fn within(root: &Path, relative: &str) -> AppResult<PathBuf> {
    let relative = Path::new(relative);
    if relative.components().any(|c| !matches!(c, std::path::Component::Normal(_))) {
        return Err(AppError::msg("That folder isn't on the disc."));
    }
    Ok(root.join(relative))
}

#[tauri::command]
pub async fn disc_contents(app: AppHandle, letter: String, path: Option<String>) -> AppResult<Contents> {
    blocking(move || {
        let drive = find(&letter)?;
        let state = app.state::<OpticalState>();
        let Some(media) = describe(&state, &drive).media else { return Ok(Contents::Empty) };
        if let Some(protection) = media.protection {
            return Ok(Contents::Protected { disc: media.kind.into(), protection, message: PROTECTED.into() });
        }
        let root = drive.root();
        Ok(match media.kind {
            "audio" => audio_contents(&audio_disc(&drive)?),
            "dvd" => Contents::Dvd { titles: dvd::titles(&root.join("VIDEO_TS")).ok_or_else(|| AppError::msg("This DVD's titles can't be read."))? },
            "bluray" => Contents::Bluray { titles: bluray::titles(&root).ok_or_else(|| AppError::msg("This Blu-ray's titles can't be read."))? },
            "data" => {
                let relative = path.unwrap_or_default();
                let folder = within(&root, &relative)?;
                let mut entries: Vec<Entry> = std::fs::read_dir(&folder)?
                    .filter_map(Result::ok)
                    .map(|e| {
                        let meta = e.metadata().ok();
                        let name = e.file_name().to_string_lossy().into_owned();
                        Entry {
                            path: Path::new(&relative).join(&name).to_string_lossy().into_owned(),
                            dir: meta.as_ref().is_some_and(|m| m.is_dir()),
                            size: meta.map(|m| m.len()).unwrap_or(0),
                            name,
                        }
                    })
                    .collect();
                entries.sort_by(|a, b| b.dir.cmp(&a.dir).then_with(|| files::natural_cmp(&a.name, &b.name)));
                Contents::Data { root: root.to_string_lossy().into_owned(), path: relative, entries }
            }
            _ => Contents::Empty,
        })
    })
    .await
}

// ---------------------------------------------------------------------------------------------
// Playing

/// A DVD or Blu-ray title's streams in order, and its chapters.
fn video_title(drive: &Drive, title: u32) -> AppResult<(Vec<PathBuf>, f64, Vec<f64>, String)> {
    let root = drive.root();
    let label = classify(drive).and_then(|m| m.label).unwrap_or_else(|| "Disc".into());
    if root.join("VIDEO_TS").is_dir() {
        if dvd_protected(drive) {
            return Err(AppError::msg(PROTECTED));
        }
        let titles = dvd::titles(&root.join("VIDEO_TS")).unwrap_or_default();
        let found = titles.into_iter().find(|t| t.number == title).ok_or_else(|| AppError::msg("That title isn't on the disc."))?;
        if found.vobs.is_empty() {
            return Err(AppError::msg("This title's video files are missing from the disc."));
        }
        return Ok((found.vobs, found.seconds, found.chapters, label));
    }
    if bluray::protection(&root).is_some() {
        return Err(AppError::msg(PROTECTED));
    }
    let found = bluray::titles(&root).unwrap_or_default().into_iter().find(|t| t.number == title).ok_or_else(|| AppError::msg("That title isn't on the disc."))?;
    Ok((found.clips, found.seconds, found.chapters, label))
}

/// A title's chapters as an FFmetadata file, which mpv reads with --chapters-file.
fn chapters_file(dir: &Path, chapters: &[f64], seconds: f64) -> AppResult<PathBuf> {
    let path = dir.join(format!("digitify-chapters-{}.ffmeta", std::process::id()));
    std::fs::write(&path, ffmetadata(chapters, seconds))?;
    Ok(path)
}

/// mpv's EDL: the streams played one after another as a single title.
fn edl(streams: &[PathBuf]) -> String {
    let parts: Vec<String> = streams.iter().map(|p| {
        let path = p.to_string_lossy();
        format!("%{}%{}", path.len(), path)
    }).collect();
    format!("edl://{}", parts.join(";"))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscTarget {
    pub title: String,
    pub episode: String,
}

/// Plays a DVD or Blu-ray title from the disc in the video player.
#[tauri::command]
pub async fn disc_play(app: AppHandle, window: WebviewWindow, player: State<'_, PlayerState>, letter: String, title: u32, volume: f64) -> AppResult<DiscTarget> {
    let (streams, seconds, chapters, label) = blocking(move || video_title(&find(&letter)?, title)).await?;
    let chapters_path = chapters_file(&std::env::temp_dir(), &chapters, seconds)?;
    let source = edl(&streams);
    player::start_with(&app, &window, &player, &source, 0.0, volume, &[format!("--chapters-file={}", chapters_path.display())]).await?;
    Ok(DiscTarget { title: label, episode: format!("Title {title}") })
}

// ---------------------------------------------------------------------------------------------
// Audio CDs straight from the disc

/// Part of a CD track as a WAV file, for `/cd/<letter>/<track>`: bytes `start..=end` of the
/// whole file (header included), at most 1 MiB, and the whole file's length.
pub fn cd_stream(letter: &str, track: u32, range: Option<(u64, u64)>) -> AppResult<(Vec<u8>, u64)> {
    let drive = find(letter)?;
    let disc = audio_disc(&drive)?;
    let track = disc.tracks.into_iter().find(|t| t.number == track && t.audio).ok_or_else(|| AppError::msg("No such track."))?;
    let data = track.sectors as u64 * drive_io::SECTOR as u64;
    let total = 44 + data;
    let (start, end) = range.unwrap_or((0, total - 1));
    let end = end.min(total - 1).min(start + 1024 * 1024 - 1);
    let mut out = Vec::with_capacity((end - start + 1) as usize);
    let header = cd::wav_header(data as u32);
    if start < 44 {
        out.extend_from_slice(&header[start as usize..(end + 1).min(44) as usize]);
    }
    if end >= 44 {
        let from = start.max(44) - 44;
        let to = end - 44;
        let first = (from / drive_io::SECTOR as u64) as u32;
        let last = (to / drive_io::SECTOR as u64) as u32;
        let mut source = drive.sectors()?;
        let mut sector = first;
        let mut pcm = Vec::new();
        while sector <= last {
            let count = (last - sector + 1).min(cd::BLOCK);
            pcm.extend(source.read(track.start + sector, count)?);
            sector += count;
        }
        let skip = (from - first as u64 * drive_io::SECTOR as u64) as usize;
        out.extend_from_slice(&pcm[skip..skip + (to - from + 1) as usize]);
    }
    Ok((out, total))
}

// ---------------------------------------------------------------------------------------------
// Jobs: ripping and importing

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobProgress {
    pub id: u64,
    pub letter: String,
    /// `rip` or `import`.
    pub kind: &'static str,
    /// `reading`, `encoding`, `importing`, `done`, `failed` or `cancelled`.
    pub phase: &'static str,
    /// 0–1 over the whole job.
    pub fraction: f64,
    pub current: Option<String>,
    pub warnings: Vec<String>,
    pub error: Option<String>,
    pub item_id: Option<i64>,
}

fn start_job(app: &AppHandle, letter: &str, kind: &'static str, work: impl FnOnce(&mut dyn FnMut(&JobProgress), &AtomicBool, &mut JobProgress) -> AppResult<Option<i64>> + Send + 'static) -> u64 {
    let state = app.state::<OpticalState>();
    let id = state.next_job.fetch_add(1, Ordering::Relaxed) + 1;
    let cancel = Arc::new(AtomicBool::new(false));
    if let Ok(mut jobs) = state.jobs.lock() {
        jobs.insert(id, cancel.clone());
    }
    let app = app.clone();
    let letter = letter.to_string();
    std::thread::spawn(move || {
        let mut progress = JobProgress { id, letter, kind, phase: "reading", ..JobProgress::default() };
        let events = app.clone();
        let mut emit = move |p: &JobProgress| {
            let _ = events.emit("disc-job", p);
        };
        emit(&progress);
        match work(&mut emit, &cancel, &mut progress) {
            Ok(item) => {
                progress.phase = "done";
                progress.fraction = 1.0;
                progress.item_id = item;
                let _ = app.emit("library-changed", ());
            }
            Err(_) if cancel.load(Ordering::Relaxed) => progress.phase = "cancelled",
            Err(e) => {
                log::warn!("disc job {id} failed: {e}");
                progress.phase = "failed";
                progress.error = Some(e.to_string());
            }
        }
        progress.current = None;
        emit(&progress);
        if let Ok(mut jobs) = app.state::<OpticalState>().jobs.lock() {
            jobs.remove(&id);
        }
    });
    id
}

#[tauri::command]
pub fn disc_job_cancel(state: State<'_, OpticalState>, id: u64) {
    if let Some(flag) = state.jobs.lock().ok().and_then(|jobs| jobs.get(&id).cloned()) {
        flag.store(true, Ordering::Relaxed);
    }
}

fn ffmpeg() -> AppResult<PathBuf> {
    tools::find("ffmpeg").ok_or_else(|| AppError::msg("FFmpeg is missing from the installation."))
}

/// What to rip from an audio CD, with the names to give it (CD-Text or typed in).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RipRequest {
    pub tracks: Vec<u32>,
    pub album: String,
    pub artist: Option<String>,
    pub year: Option<i64>,
    /// Track titles by track number.
    pub titles: HashMap<u32, String>,
    /// `flac` or `wav`.
    pub format: String,
}

/// Rips CD tracks (verified, D-022) into the library's music folder, tags them, and imports them
/// as an album.
#[tauri::command]
pub fn cd_rip(app: AppHandle, letter: String, request: RipRequest) -> AppResult<u64> {
    let library = app.state::<AppState>().library()?;
    let flac = match request.format.as_str() {
        "flac" => true,
        "wav" => false,
        _ => return Err(AppError::msg("Rip to FLAC or WAV.")),
    };
    let album = request.album.split_whitespace().collect::<Vec<_>>().join(" ");
    if album.is_empty() {
        return Err(AppError::msg("Give the album a name."));
    }
    let drive = find(&letter)?;
    Ok(start_job(&app, &letter, "rip", move |emit, cancel, progress| {
        let disc = audio_disc(&drive)?;
        let tracks: Vec<cd::Track> = disc.tracks.iter().filter(|t| t.audio && request.tracks.contains(&t.number)).cloned().collect();
        if tracks.is_empty() {
            return Err(AppError::msg("Choose at least one audio track."));
        }
        let category: String = library.db.with(|conn| Ok(conn.query_row("SELECT name FROM categories WHERE key = 'music'", [], |r| r.get(0))?))?;
        let folder_name = match &request.artist {
            Some(artist) if !artist.trim().is_empty() => format!("{} - {album}", artist.trim()),
            _ => album.clone(),
        };
        let dir = files::unique_path(&library.folder.media_dir().join(files::safe_name(&category)), &files::safe_name(&folder_name));
        std::fs::create_dir_all(&dir)?;
        let result = (|| -> AppResult<Option<i64>> {
            let ffmpeg = ffmpeg()?;
            let mut source = drive.sectors()?;
            let total = tracks.len() as f64;
            for (index, track) in tracks.iter().enumerate() {
                let title = request.titles.get(&track.number).map(|t| t.trim().to_string()).filter(|t| !t.is_empty()).unwrap_or_else(|| format!("Track {}", track.number));
                progress.current = Some(format!("{:02} · {title}", track.number));
                progress.phase = "reading";
                emit(progress);
                let raw = dir.join(format!("{:02} {}.rip.wav", track.number, files::safe_name(&title)));
                let mut last = std::time::Instant::now();
                let verification = cd::rip_track(source.as_mut(), track, &raw, |f| {
                    if last.elapsed() > Duration::from_millis(400) {
                        last = std::time::Instant::now();
                        progress.fraction = (index as f64 + f * 0.9) / total;
                        emit(progress);
                    }
                    !cancel.load(Ordering::Relaxed)
                })
                .map_err(|e| AppError::msg(format!("Track {} couldn't be read: {e}", track.number)))?;
                if verification.unverified > 0 {
                    progress.warnings.push(format!("Track {}: {} part(s) never read the same twice; they may have clicks.", track.number, verification.unverified));
                }
                progress.phase = "encoding";
                progress.fraction = (index as f64 + 0.92) / total;
                emit(progress);
                let out = dir.join(format!("{:02} {}.{}", track.number, files::safe_name(&title), if flac { "flac" } else { "wav" }));
                let mut command = tools::command(&ffmpeg);
                command.args(["-y", "-hide_banner", "-loglevel", "error", "-i"]).arg(&raw);
                command.args(if flac { ["-c:a", "flac"] } else { ["-c:a", "copy"] });
                for (key, value) in [
                    ("title", Some(title.clone())),
                    ("album", Some(album.clone())),
                    ("artist", request.artist.clone()),
                    ("album_artist", request.artist.clone()),
                    ("track", Some(format!("{}/{}", track.number, disc.tracks.iter().filter(|t| t.audio).count()))),
                    ("date", request.year.map(|y| y.to_string())),
                ] {
                    if let Some(value) = value.filter(|v| !v.is_empty()) {
                        command.arg("-metadata").arg(format!("{key}={value}"));
                    }
                }
                let status = command.arg(&out).status()?;
                let _ = std::fs::remove_file(&raw);
                if !status.success() {
                    return Err(AppError::msg(format!("Track {} couldn't be encoded.", track.number)));
                }
            }
            progress.phase = "importing";
            progress.current = None;
            emit(progress);
            let ids = import::import_in_place(&library, &[dir.clone()])?;
            Ok(ids.first().copied())
        })();
        if result.is_err() {
            // Nothing half-ripped is left behind; these are files this job made.
            let _ = std::fs::remove_dir_all(&dir);
        }
        result
    }))
}

fn ffmetadata(chapters: &[f64], seconds: f64) -> String {
    let mut text = String::from(";FFMETADATA1\n");
    for (i, &start) in chapters.iter().enumerate() {
        let end = chapters.get(i + 1).copied().unwrap_or(seconds);
        text.push_str(&format!("[CHAPTER]\nTIMEBASE=1/1000\nSTART={}\nEND={}\ntitle=Chapter {}\n", (start * 1000.0) as u64, (end * 1000.0) as u64, i + 1));
    }
    text
}

/// Copies a DVD or Blu-ray title into the library as an MKV with its chapters (no re-encoding),
/// then imports it.
#[tauri::command]
pub fn disc_import(app: AppHandle, letter: String, title: u32) -> AppResult<u64> {
    let library = app.state::<AppState>().library()?;
    let drive = find(&letter)?;
    let (streams, seconds, chapters, label) = video_title(&drive, title)?;
    Ok(start_job(&app, &letter, "import", move |emit, cancel, progress| {
        let category: String = library.db.with(|conn| Ok(conn.query_row("SELECT name FROM categories WHERE key = 'video'", [], |r| r.get(0))?))?;
        let dir = library.folder.media_dir().join(files::safe_name(&category));
        std::fs::create_dir_all(&dir)?;
        let out = files::unique_path(&dir, &files::safe_name(&format!("{label} (Title {title}).mkv")));
        let work = std::env::temp_dir().join(format!("digitify-disc-{}-{}", std::process::id(), progress.id));
        std::fs::create_dir_all(&work)?;
        let metadata = work.join("chapters.txt");
        std::fs::write(&metadata, ffmetadata(&chapters, seconds))?;
        let mut command = tools::command(&ffmpeg()?);
        command.args(["-y", "-hide_banner", "-loglevel", "error", "-nostats", "-progress", "pipe:1"]);
        let is_dvd = streams.first().is_some_and(|p| p.extension().is_some_and(|e| e.eq_ignore_ascii_case("vob")));
        if is_dvd {
            let joined: Vec<String> = streams.iter().map(|p| p.to_string_lossy().into_owned()).collect();
            command.args(["-fflags", "+genpts", "-i"]).arg(format!("concat:{}", joined.join("|")));
        } else {
            let list = work.join("clips.txt");
            let text: String = streams.iter().map(|p| format!("file '{}'\n", p.to_string_lossy().replace('\'', "'\\''"))).collect();
            std::fs::write(&list, text)?;
            command.args(["-f", "concat", "-safe", "0", "-i"]).arg(&list);
        }
        command.arg("-i").arg(&metadata);
        command.args(["-map", "0:v:0", "-map", "0:a?", "-map", "0:s?", "-map_chapters", "1", "-c", "copy", "-f", "matroska"]).arg(&out);
        command.stdout(Stdio::piped()).stderr(Stdio::piped());
        progress.current = Some(format!("Title {title}"));
        emit(progress);
        let mut child = command.spawn()?;
        let stdout = child.stdout.take().ok_or_else(|| AppError::msg("FFmpeg didn't start."))?;
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if cancel.load(Ordering::Relaxed) {
                let _ = child.kill();
                break;
            }
            if let Some(us) = line.strip_prefix("out_time_us=").and_then(|v| v.trim().parse::<f64>().ok()) {
                progress.fraction = (us / 1_000_000.0 / seconds.max(1.0)).clamp(0.0, 0.97);
                emit(progress);
            }
        }
        let status = child.wait()?;
        let mut errors = String::new();
        if let Some(mut stderr) = child.stderr.take() {
            let _ = stderr.read_to_string(&mut errors);
        }
        let _ = std::fs::remove_dir_all(&work);
        if cancel.load(Ordering::Relaxed) || !status.success() {
            let _ = std::fs::remove_file(&out);
            if cancel.load(Ordering::Relaxed) {
                return Err(AppError::msg("cancelled"));
            }
            return Err(AppError::msg(format!("The title couldn't be copied: {}", errors.lines().last().unwrap_or("FFmpeg failed"))));
        }
        progress.phase = "importing";
        emit(progress);
        let ids = import::import_in_place(&library, &[out])?;
        // A title from a disc is a film: in Movies & Series, with the disc's format (D-029).
        if let Some(&item) = ids.first() {
            let format = if is_dvd { "dvd" } else { "bluray" };
            library.db.with(|conn| {
                conn.execute(
                    "UPDATE items SET category_id = (SELECT id FROM categories WHERE key = 'video'), \
                     metadata = json_set(metadata, '$.discFormat', ?2) WHERE id = ?1",
                    params![item, format],
                )?;
                crate::library::reindex(conn, item)?;
                Ok(())
            })?;
        }
        Ok(ids.first().copied())
    }))
}

// ---------------------------------------------------------------------------------------------
// Sample discs (testing without a drive)

/// Writes the structure files of simulated discs into the fake-drives folder: a DVD's IFOs, a
/// Blu-ray's playlist, and an audio CD's table of contents, CD-Text and generated audio. The video
/// streams (VOB, M2TS) are made with FFmpeg by the test scripts. Only with DIGITIFY_FAKE_DRIVES.
#[tauri::command]
pub fn dev_write_sample_discs() -> AppResult<String> {
    let root = std::env::var_os("DIGITIFY_FAKE_DRIVES").map(PathBuf::from).ok_or_else(|| AppError::msg("DIGITIFY_FAKE_DRIVES is not set."))?;
    // R: a DVD with two titles; S: a Blu-ray; T: an audio CD; U: a protected DVD; V: a data disc; W: empty.
    dvd::sample::write(
        &root.join("R").join("VIDEO_TS"),
        &[
            dvd::sample::Title { chapters: vec![4, 4, 4], audio: vec!["en", "es"], subtitles: vec!["en"] },
            dvd::sample::Title { chapters: vec![6], audio: vec!["en"], subtitles: vec![] },
        ],
    )?;
    let bdmv = root.join("S").join("BDMV");
    std::fs::create_dir_all(bdmv.join("PLAYLIST"))?;
    std::fs::create_dir_all(bdmv.join("STREAM"))?;
    std::fs::write(bdmv.join("index.bdmv"), b"INDX0200")?;
    bluray::sample::write(&bdmv.join("PLAYLIST").join("00800.mpls"), &[("00001", 12), ("00002", 12)], &[0, 12], &["eng", "spa"], &["eng"])?;
    let cd_dir = root.join("T");
    std::fs::create_dir_all(&cd_dir)?;
    let mut bin = std::fs::File::create(cd_dir.join("audio.bin"))?;
    let mut tracks = Vec::new();
    let mut start = 0;
    for (number, (hz, seconds)) in [(330.0f64, 6u32), (440.0, 5), (550.0, 4)].iter().enumerate() {
        let sectors = seconds * 75;
        let samples = sectors as usize * drive_io::SECTOR / 4;
        let mut pcm = Vec::with_capacity(samples * 4);
        for i in 0..samples {
            let value = ((i as f64 / 44_100.0 * hz * std::f64::consts::TAU).sin() * 9000.0) as i16;
            pcm.extend_from_slice(&value.to_le_bytes());
            pcm.extend_from_slice(&value.to_le_bytes());
        }
        bin.write_all(&pcm)?;
        tracks.push(cd::Track { number: number as u32 + 1, start, sectors, audio: true });
        start += sectors;
    }
    let text = CdText {
        album: Some("Harbor Songs".into()),
        artist: Some("The Lighthouse Keepers".into()),
        titles: vec![(1, "Low Tide".into()), (2, "Fog Bell".into()), (3, "Last Ferry Home".into())],
        performers: vec![],
    };
    std::fs::write(cd_dir.join("audio-cd.json"), serde_json::to_string_pretty(&FakeAudioCd { tracks, text }).map_err(|e| AppError::msg(e.to_string()))?)?;
    let protected = root.join("U").join("VIDEO_TS");
    dvd::sample::write(&protected, &[dvd::sample::Title { chapters: vec![30], audio: vec!["en"], subtitles: vec![] }])?;
    let mut pack = vec![0u8; 2048];
    pack[..4].copy_from_slice(&[0, 0, 1, 0xBA]);
    pack[13] = 0xF8;
    pack[14..21].copy_from_slice(&[0, 0, 1, 0xE0, 0x07, 0xEC, 0x90]);
    std::fs::write(protected.join("VTS_01_1.VOB"), pack.repeat(4))?;
    std::fs::create_dir_all(root.join("W"))?;
    Ok(root.display().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn labels_read_well() {
        assert_eq!(pretty_label("MY_HOLIDAY_2019"), "My Holiday 2019");
        assert_eq!(pretty_label("  summer  trip "), "Summer Trip");
    }

    #[test]
    #[cfg(windows)]
    fn data_disc_paths_stay_on_the_disc() {
        let root = Path::new(r"E:\");
        assert!(within(root, r"Photos\2019").is_ok());
        assert!(within(root, r"..\Windows").is_err());
        assert!(within(root, r"C:\Windows").is_err());
    }

    #[test]
    #[cfg(windows)]
    fn edl_and_chapters() {
        let streams = [PathBuf::from(r"E:\VIDEO_TS\VTS_01_1.VOB"), PathBuf::from(r"E:\VIDEO_TS\VTS_01_2.VOB")];
        assert_eq!(edl(&streams), r"edl://%24%E:\VIDEO_TS\VTS_01_1.VOB;%24%E:\VIDEO_TS\VTS_01_2.VOB");
        let text = ffmetadata(&[0.0, 90.5], 200.0);
        assert!(text.contains("START=90500\nEND=200000\ntitle=Chapter 2"));
    }
}

//! Importing files and folders into the library, in the background with progress events.
//!
//! 1. Scan: expand the picked paths into candidates (one per book, comic, video, photo, series
//!    or track; D-027: no music albums). Photos go to Pictures, a picked folder and its subfolders
//!    becoming albums (D-033); a folder of images becomes a book only when a book or comic
//!    category is picked (or through the image-set book builder).
//! 2. For each candidate, in parallel: fingerprint its files, drop files already in the library,
//!    read embedded metadata and artwork.
//! 3. Save: copy into the library folder if asked, then record the item, its digital version, its
//!    parts (tracks, pages) and files.

use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use rayon::prelude::*;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use tauri::{AppHandle, Emitter, Manager, State};
use walkdir::WalkDir;

use crate::error::{AppError, AppResult};
use crate::files::{self, natural_cmp};
use crate::formats::{self, year_of};
use crate::library::{reindex, sort_key, upsert_person};
use crate::episodes::{self, EpisodeName};
use crate::{artwork, pdf, pictures, series, AppState, Library};

#[derive(Default)]
pub struct ImportManager {
    next_id: AtomicU64,
    jobs: Mutex<HashMap<u64, Arc<AtomicBool>>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ImportMode {
    /// Register files where they are.
    Reference,
    /// Copy files into the library folder's `media` directory.
    Copy,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportRequest {
    pub paths: Vec<String>,
    pub mode: ImportMode,
    /// Put what this category can hold into it instead of detecting one per file.
    pub category: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportProgress {
    pub job_id: u64,
    /// `scanning`, `importing`, `done`, `cancelled` or `failed`.
    pub phase: &'static str,
    pub total: usize,
    pub processed: usize,
    pub imported: usize,
    pub duplicates: usize,
    pub failed: usize,
    pub current: Option<String>,
    pub errors: Vec<String>,
}

#[tauri::command]
pub fn import_start(app: AppHandle, state: State<'_, AppState>, request: ImportRequest) -> AppResult<u64> {
    if request.paths.is_empty() {
        return Err(AppError::msg("Nothing to import."));
    }
    let library = state.library()?;
    let job_id = state.imports.next_id.fetch_add(1, Ordering::Relaxed) + 1;
    let cancel = Arc::new(AtomicBool::new(false));
    if let Ok(mut jobs) = state.imports.jobs.lock() {
        jobs.insert(job_id, cancel.clone());
    }
    std::thread::Builder::new()
        .name(format!("import-{job_id}"))
        .spawn(move || {
            let mut progress = ImportProgress { job_id, phase: "scanning", ..Default::default() };
            if let Err(e) = run(&app, &library, &request, &cancel, &mut progress) {
                log::error!("import {job_id} failed: {e}");
                progress.phase = "failed";
                progress.errors.push(e.to_string());
            }
            emit(&app, &progress);
            let _ = app.emit("library-changed", ());
            if let Ok(mut jobs) = app.state::<AppState>().imports.jobs.lock() {
                jobs.remove(&job_id);
            }
        })
        .map_err(|e| AppError::msg(format!("could not start the import: {e}")))?;
    Ok(job_id)
}

#[tauri::command]
pub fn import_cancel(state: State<'_, AppState>, job_id: u64) {
    if let Some(cancel) = state.imports.jobs.lock().ok().and_then(|jobs| jobs.get(&job_id).cloned()) {
        cancel.store(true, Ordering::Relaxed);
    }
}

fn emit(app: &AppHandle, progress: &ImportProgress) {
    let _ = app.emit("import-progress", progress);
}

fn run(
    app: &AppHandle,
    library: &Library,
    request: &ImportRequest,
    cancel: &AtomicBool,
    progress: &mut ImportProgress,
) -> AppResult<()> {
    emit(app, progress);
    let paths: Vec<PathBuf> = request.paths.iter().map(PathBuf::from).collect();
    // Images are photos (D-033) unless a book or comic category was picked for them.
    let picked_handler: Option<String> = match &request.category {
        Some(key) => library.db.with(|conn| {
            Ok(conn.query_row("SELECT handler FROM categories WHERE key = ?1", [key], |row| row.get(0)).optional()?)
        })?,
        None => None,
    };
    let images = match picked_handler.as_deref() {
        Some("book" | "comic") => ImageMode::Pages,
        _ => ImageMode::Photos,
    };
    let candidates = scan(&paths, cancel, images);
    progress.total = candidates.len();
    progress.phase = "importing";
    emit(app, progress);
    log::info!("import {}: {} candidates from {} paths", progress.job_id, candidates.len(), paths.len());

    let categories: HashMap<String, (i64, String, String)> = library.db.with(|conn| {
        let mut stmt = conn.prepare("SELECT key, id, name, handler FROM categories")?;
        let rows = stmt.query_map([], |row| Ok((row.get(0)?, (row.get(1)?, row.get(2)?, row.get(3)?))))?.collect::<Result<_, _>>()?;
        Ok(rows)
    })?;
    if let Some(key) = &request.category {
        if !categories.contains_key(key) {
            return Err(AppError::msg(format!("unknown category '{key}'")));
        }
    }

    let mut since_refresh = 0;
    for chunk in candidates.chunks(8) {
        if cancel.load(Ordering::Relaxed) {
            progress.phase = "cancelled";
            return Ok(());
        }
        let prepared: Vec<(String, AppResult<Prepared>)> =
            chunk.par_iter().map(|candidate| (candidate.label(), prepare(library, candidate))).collect();
        for (label, result) in prepared {
            progress.current = Some(label.clone());
            let outcome = result.and_then(|prepared| match prepared {
                Prepared::Duplicate => Ok(false),
                Prepared::Draft(draft) => {
                    // A picked category applies to what it can hold (Videos or Movies & Series for
                    // videos, say); anything else keeps the category it was detected as.
                    let handler = |key: &str| categories.get(key).map(|c| c.2.as_str());
                    let key = match request.category.as_deref() {
                        Some(picked) if handler(picked) == handler(draft.category) || handler(picked) == Some("generic") => picked,
                        _ => draft.category,
                    };
                    let (category_id, category_name, _) = categories
                        .get(key)
                        .cloned()
                        .ok_or_else(|| AppError::msg(format!("unknown category '{key}'")))?;
                    save(library, *draft, request.mode, category_id, &category_name).map(|_| true)
                }
            });
            match outcome {
                Ok(true) => {
                    progress.imported += 1;
                    since_refresh += 1;
                }
                Ok(false) => progress.duplicates += 1,
                Err(e) => {
                    progress.failed += 1;
                    log::warn!("import of {label} failed: {e}");
                    if progress.errors.len() < 20 {
                        progress.errors.push(format!("{label}: {e}"));
                    }
                }
            }
            progress.processed += 1;
        }
        emit(app, progress);
        if since_refresh >= 25 {
            since_refresh = 0;
            let _ = app.emit("library-changed", ());
        }
    }
    progress.phase = "done";
    progress.current = None;
    Ok(())
}

// ---------------------------------------------------------------------------------------------
// Scanning

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Kind {
    Ebook,
    Pdf,
    ComicArchive,
    Video,
    Audio,
    Image,
}

fn kind_of(path: &Path) -> Option<Kind> {
    let name = path.file_name()?.to_str()?;
    if name.starts_with("._") {
        return None; // macOS resource forks
    }
    let ext = path.extension()?.to_str()?.to_ascii_lowercase();
    Some(match ext.as_str() {
        "epub" | "mobi" | "azw3" | "azw" | "fb2" => Kind::Ebook,
        "pdf" => Kind::Pdf,
        "cbz" | "cbr" | "cb7" | "cbt" => Kind::ComicArchive,
        "mp4" | "m4v" | "mkv" | "mov" | "avi" | "webm" | "wmv" | "mpg" | "mpeg" | "ts" | "m2ts" | "ogv" | "flv" => Kind::Video,
        "mp3" | "flac" | "wav" | "m4a" | "aac" | "ogg" | "oga" | "opus" | "wma" | "aiff" | "aif" | "ape" | "wv" | "dsf" => Kind::Audio,
        "jpg" | "jpeg" | "png" | "webp" | "gif" | "bmp" | "tif" | "tiff" => Kind::Image,
        _ => return None,
    })
}

enum Candidate {
    Single { kind: Kind, path: PathBuf },
    /// Photographed pages or numbered comic pages: one folder becomes one item.
    ImageSet { dir: PathBuf, pages: Vec<PathBuf> },
    /// One music track: each is an item of its own (D-027).
    Track { path: PathBuf },
    /// Episodes of one TV series, recognized by their names (D-018).
    Series { name: String, episodes: Vec<(PathBuf, EpisodeName)> },
    /// One photo (D-033), with the albums it sits in: the picked folder, then its subfolders.
    Picture { path: PathBuf, album: Vec<String> },
}

/// What images in the picked paths are.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ImageMode {
    /// Photos for Pictures, each an item of its own.
    Photos,
    /// The pages of a book or comic, one folder per item.
    Pages,
}

impl Candidate {
    fn label(&self) -> String {
        let name = |p: &Path| p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        match self {
            Candidate::Single { path, .. } => name(path),
            Candidate::ImageSet { dir, .. } => name(dir),
            Candidate::Track { path } => name(path),
            Candidate::Series { name, .. } => name.clone(),
            Candidate::Picture { path, .. } => name(path),
        }
    }

    fn paths(&self) -> Vec<&PathBuf> {
        match self {
            Candidate::Single { path, .. } => vec![path],
            Candidate::ImageSet { pages, .. } => pages.iter().collect(),
            Candidate::Track { path } => vec![path],
            Candidate::Series { episodes, .. } => episodes.iter().map(|(path, _)| path).collect(),
            Candidate::Picture { path, .. } => vec![path],
        }
    }
}

fn scan(paths: &[PathBuf], cancel: &AtomicBool, images: ImageMode) -> Vec<Candidate> {
    let mut found: Vec<PathBuf> = Vec::new();
    // The picked folder each file was found in, for photo albums.
    let mut roots: HashMap<PathBuf, PathBuf> = HashMap::new();
    for path in paths {
        if path.is_dir() {
            for entry in WalkDir::new(path).follow_links(false).into_iter().filter_map(Result::ok) {
                if cancel.load(Ordering::Relaxed) {
                    return Vec::new();
                }
                if entry.file_type().is_file() {
                    roots.entry(entry.path().to_path_buf()).or_insert_with(|| path.clone());
                    found.push(entry.into_path());
                }
            }
        } else if path.is_file() {
            found.push(path.clone());
        }
    }
    found.sort_by(|a, b| natural_cmp(&a.to_string_lossy(), &b.to_string_lossy()));
    found.dedup();

    let mut candidates = Vec::new();
    let mut image_dirs: BTreeMap<PathBuf, Vec<PathBuf>> = BTreeMap::new();
    let mut av_dirs: std::collections::HashSet<PathBuf> = Default::default();
    let mut series: BTreeMap<String, (String, Vec<(PathBuf, EpisodeName)>)> = BTreeMap::new();
    for file in found {
        let parent = file.parent().map(Path::to_path_buf).unwrap_or_default();
        match kind_of(&file) {
            Some(Kind::Image) => image_dirs.entry(parent).or_default().push(file),
            Some(Kind::Audio) => {
                av_dirs.insert(parent);
                candidates.push(Candidate::Track { path: file });
            }
            Some(Kind::Video) => {
                av_dirs.insert(parent);
                match episodes::parse(&file) {
                    Some(episode) => {
                        let entry = series.entry(episode.series.to_lowercase()).or_insert_with(|| (episode.series.clone(), Vec::new()));
                        entry.1.push((file, episode));
                    }
                    None => candidates.push(Candidate::Single { kind: Kind::Video, path: file }),
                }
            }
            Some(kind) => candidates.push(Candidate::Single { kind, path: file }),
            None => {}
        }
    }
    // Images next to music or video are album art and posters, neither photos nor books.
    for (dir, pages) in image_dirs {
        if av_dirs.contains(&dir) {
            continue;
        }
        match images {
            ImageMode::Pages => candidates.push(Candidate::ImageSet { dir, pages }),
            ImageMode::Photos => {
                for path in pages {
                    let album = roots.get(&path).map(|root| album_of(root, &path)).unwrap_or_default();
                    candidates.push(Candidate::Picture { path, album });
                }
            }
        }
    }
    candidates.extend(series.into_values().map(|(name, episodes)| Candidate::Series { name, episodes }));
    candidates
}

/// The albums a photo found inside a picked folder sits in: that folder, then each subfolder down
/// to the photo's own ("Trips", "2024", "Lisbon").
fn album_of(root: &Path, photo: &Path) -> Vec<String> {
    let name = |p: &Path| p.file_name().map(|n| n.to_string_lossy().into_owned());
    let mut album: Vec<String> = name(root).into_iter().collect();
    if let Some(folder) = photo.parent().and_then(|parent| parent.strip_prefix(root).ok()) {
        album.extend(folder.components().map(|c| c.as_os_str().to_string_lossy().into_owned()));
    }
    album.retain(|n| !n.is_empty());
    album
}

// ---------------------------------------------------------------------------------------------
// Preparing drafts

struct FileDraft {
    path: PathBuf,
    size: u64,
    modified: Option<i64>,
    quick_hash: String,
    part: Option<usize>,
}

struct PartDraft {
    kind: &'static str,
    number: Option<f64>,
    title: Option<String>,
    duration_ms: Option<i64>,
    /// For episodes.
    season: Option<i64>,
    /// For tracks whose artist isn't the album's.
    artist: Option<String>,
}

struct Draft {
    category: &'static str,
    title: String,
    subtitle: Option<String>,
    year: Option<i64>,
    description: Option<String>,
    people: Vec<(String, &'static str)>,
    metadata: Map<String, Value>,
    format: String,
    files: Vec<FileDraft>,
    parts: Vec<PartDraft>,
    artwork: Option<Vec<u8>>,
    /// Folder name for managed copies of multi-file items (albums, page folders).
    copy_folder: Option<String>,
    /// A photo's albums, outermost first (D-033).
    album: Vec<String>,
    /// Artwork made while preparing (photos are decoded in parallel there).
    ready_art: Option<artwork::Artwork>,
}

enum Prepared {
    Duplicate,
    Draft(Box<Draft>),
}

fn prepare(library: &Library, candidate: &Candidate) -> AppResult<Prepared> {
    // Fingerprint first: files already in the library are skipped before any heavy work.
    let mut files = Vec::new();
    for path in candidate.paths() {
        let metadata = std::fs::metadata(path)?;
        let quick_hash = files::quick_hash(path, metadata.len())?;
        files.push(FileDraft { path: path.clone(), size: metadata.len(), modified: files::modified_unix(&metadata), quick_hash, part: None });
    }
    let known = library.db.with(|conn| {
        let mut stmt = conn.prepare_cached("SELECT 1 FROM files WHERE quick_hash = ?1 AND size = ?2 LIMIT 1")?;
        let mut known = Vec::with_capacity(files.len());
        for file in &files {
            known.push(stmt.exists(params![file.quick_hash, file.size as i64])?);
        }
        Ok(known)
    })?;
    let files: Vec<FileDraft> = files.into_iter().zip(known).filter(|(_, known)| !known).map(|(f, _)| f).collect();
    if files.is_empty() {
        return Ok(Prepared::Duplicate);
    }
    let draft = match candidate {
        Candidate::Single { kind, path } => describe_single(*kind, path, files),
        Candidate::ImageSet { dir, .. } => describe_image_set(dir, files),
        Candidate::Track { path } => describe_track(path, files),
        Candidate::Series { name, episodes } => describe_series(name, episodes, files),
        Candidate::Picture { path, album } => {
            let mut d = describe_picture(path, album, files);
            d.ready_art = pictures::store_artwork(library, path, pictures::View::default())
                .map_err(|e| log::warn!("thumbnail for {} skipped: {e}", path.display()))
                .ok();
            d
        }
    };
    Ok(Prepared::Draft(Box::new(draft)))
}

/// Title from a file name: "Metropolis (1927).mkv" → ("Metropolis", 1927); dots and underscores
/// become spaces when the name has none.
fn title_from_name(path: &Path) -> (String, Option<i64>) {
    let stem = path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let mut text = if stem.contains(' ') { stem } else { stem.replace(['.', '_'], " ") };
    let mut year = None;
    let bytes = text.as_bytes();
    if let Some(start) = (0..bytes.len().saturating_sub(5)).find(|&i| {
        matches!(bytes[i], b'(' | b'[')
            && bytes[i + 1..i + 5].iter().all(u8::is_ascii_digit)
            && matches!(bytes[i + 5], b')' | b']')
    }) {
        year = year_of(&text[start + 1..start + 5]);
        if year.is_some() {
            text.replace_range(start..start + 6, "");
        }
    }
    let title = text.split_whitespace().collect::<Vec<_>>().join(" ");
    (if title.is_empty() { "Untitled".into() } else { title }, year)
}

fn extension(path: &Path) -> String {
    path.extension().map(|e| e.to_string_lossy().to_ascii_lowercase()).unwrap_or_default()
}

fn draft(category: &'static str, title: String, year: Option<i64>, format: String, files: Vec<FileDraft>) -> Draft {
    Draft {
        category,
        title,
        subtitle: None,
        year,
        description: None,
        people: Vec::new(),
        metadata: Map::new(),
        format,
        files,
        parts: Vec::new(),
        artwork: None,
        copy_folder: None,
        album: Vec::new(),
        ready_art: None,
    }
}

fn describe_single(kind: Kind, path: &Path, files: Vec<FileDraft>) -> Draft {
    let (name_title, name_year) = title_from_name(path);
    let ext = extension(path);
    match kind {
        Kind::Ebook => {
            let mut d = draft("books", name_title, name_year, ext.clone(), files);
            if ext == "epub" {
                if let Some(info) = formats::read_epub(path) {
                    if let Some(title) = info.title {
                        d.title = title;
                    }
                    d.year = info.year.or(d.year);
                    d.description = info.description;
                    d.people = info.creators.into_iter().map(|c| (c, "author")).collect();
                    d.artwork = info.cover;
                    for (key, value) in [("publisher", info.publisher), ("isbn", info.isbn), ("language", info.language)] {
                        if let Some(value) = value {
                            d.metadata.insert(key.into(), json!(value));
                        }
                    }
                }
            }
            d
        }
        Kind::Pdf => {
            let mut d = draft("books", name_title, name_year, "pdf".into(), files);
            match pdf::read_info(path, 900) {
                Ok(info) => {
                    if let Some(title) = info.title {
                        d.title = title;
                    }
                    d.year = d.year.or(info.year);
                    d.people.extend(info.author.map(|author| (author, "author")));
                    d.metadata.insert("pageCount".into(), json!(info.pages));
                    d.artwork = info.cover;
                }
                Err(e) => log::warn!("could not read PDF details from {}: {e}", path.display()),
            }
            d
        }
        Kind::ComicArchive => {
            let mut d = draft("comics", name_title, name_year, ext.clone(), files);
            {
                if let Some(archive) = formats::read_comic(path) {
                    d.artwork = archive.cover;
                    d.metadata.insert("pageCount".into(), json!(archive.pages));
                    if let Some(info) = archive.info {
                        if info.manga {
                            d.category = "manga";
                            d.metadata.insert("readingDirection".into(), json!("rtl"));
                        }
                        if let Some(series) = &info.series {
                            d.title = match (&info.number, &info.volume) {
                                (Some(number), _) => format!("{series} #{number}"),
                                (None, Some(volume)) => format!("{series} Vol. {volume}"),
                                (None, None) => series.clone(),
                            };
                            d.subtitle = info.title.clone();
                            d.metadata.insert("series".into(), json!(series));
                        } else if let Some(title) = &info.title {
                            d.title = title.clone();
                        }
                        d.year = info.year.or(d.year);
                        d.description = info.summary;
                        d.people.extend(info.writer.map(|w| (w, "writer")));
                        d.people.extend(info.artist.map(|a| (a, "artist")));
                        for (key, value) in [("number", info.number), ("volume", info.volume), ("publisher", info.publisher)] {
                            if let Some(value) = value {
                                d.metadata.insert(key.into(), json!(value));
                            }
                        }
                    }
                }
            }
            if !d.metadata.contains_key("series") {
                if let Some((series, key, number)) = series::from_name(&d.title) {
                    d.metadata.insert("series".into(), json!(series));
                    d.metadata.insert(key.into(), json!(number));
                }
            }
            d
        }
        Kind::Video => {
            let mut d = draft("video", name_title, name_year, ext, files);
            if let Some(info) = formats::probe_video(path) {
                if let Some(title) = info.title {
                    d.title = title;
                }
                d.year = d.year.or(info.year);
                if let Value::Object(details) = info.details {
                    d.metadata.extend(details);
                }
                let at = info.duration.map_or(10.0, |duration| (duration * 0.1).clamp(1.0, 300.0));
                d.artwork = formats::video_frame(path, at);
            }
            // A film has a year; anything else is a video (clips, recordings), D-027.
            if d.year.is_none() {
                d.category = "videos";
            }
            d
        }
        Kind::Audio | Kind::Image => draft("books", name_title, name_year, ext, files),
    }
}

fn describe_image_set(dir: &Path, mut files: Vec<FileDraft>) -> Draft {
    files.sort_by(|a, b| natural_cmp(&a.path.to_string_lossy(), &b.path.to_string_lossy()));
    let (title, year) = title_from_name(dir);
    let artwork = files.first().and_then(|f| std::fs::read(&f.path).ok());
    let pages = files.len();
    let mut d = draft("books", title.clone(), year, "images".into(), files);
    d.artwork = artwork;
    d.copy_folder = Some(title);
    d.metadata.insert("pageCount".into(), json!(pages));
    d
}

/// One photo (D-033): its file name as the title, the year it was taken, and what its EXIF says.
fn describe_picture(path: &Path, album: &[String], files: Vec<FileDraft>) -> Draft {
    let title = path.file_stem().map(|s| s.to_string_lossy().trim().to_string()).filter(|t| !t.is_empty()).unwrap_or_else(|| "Untitled".into());
    let metadata = pictures::describe(path);
    let year = metadata.get("taken").and_then(Value::as_str).and_then(|t| year_of(&t[..4.min(t.len())]));
    let mut d = draft("pictures", title, year, extension(path), files);
    d.metadata = metadata;
    d.album = album.to_vec();
    d
}

/// One track as an item of its own (D-027): its title, artist, album (kept as a detail), cover
/// art (embedded, else a cover image in its folder) and length.
fn describe_track(path: &Path, mut files: Vec<FileDraft>) -> Draft {
    let info = formats::read_track(path, true);
    let (name_title, name_year) = title_from_name(path);
    let title = info.title.clone().unwrap_or(name_title);
    let artist = info.artist.clone().or_else(|| info.album_artist.clone());
    let mut artwork = info.cover;
    if artwork.is_none() {
        if let Some(dir) = path.parent() {
            artwork = ["cover.jpg", "folder.jpg", "front.jpg", "cover.png", "folder.png", "albumart.jpg"]
                .iter()
                .find_map(|name| std::fs::read(dir.join(name)).ok());
        }
    }
    if let Some(file) = files.first_mut() {
        file.part = Some(0);
    }
    let mut d = draft("music", title.clone(), info.year.or(name_year), extension(path), files);
    d.people = artist.iter().map(|a| (a.clone(), "artist")).collect();
    d.parts = vec![PartDraft {
        kind: "track",
        number: info.track.map(f64::from),
        title: Some(title.clone()),
        duration_ms: info.duration_ms,
        season: None,
        artist: None,
    }];
    d.artwork = artwork;
    // Managed copies still sit together by album, as on disk.
    d.copy_folder = Some(match (&info.album_artist, &info.album) {
        (Some(artist), Some(album)) => format!("{artist} - {album}"),
        (None, Some(album)) => album.clone(),
        _ => artist.clone().unwrap_or_else(|| "Singles".into()),
    });
    for (key, value) in [("album", info.album), ("albumArtist", info.album_artist), ("genre", info.genre)] {
        if let Some(value) = value {
            d.metadata.insert(key.into(), json!(value));
        }
    }
    if let Some(number) = info.track {
        d.metadata.insert("trackNumber".into(), json!(number));
    }
    if let Some(ms) = info.duration_ms {
        d.metadata.insert("durationSec".into(), json!(ms / 1000));
    }
    d
}

/// A series item (D-018): one part per episode, in season and episode order.
fn describe_series(name: &str, episodes: &[(PathBuf, EpisodeName)], mut files: Vec<FileDraft>) -> Draft {
    let episode_of = |path: &Path| episodes.iter().find(|(p, _)| p == path).map(|(_, e)| e.clone());
    files.sort_by(|a, b| {
        let key = |f: &FileDraft| episode_of(&f.path).map(|e| (e.season, e.episode)).unwrap_or((i64::MAX, 0.0));
        let (ka, kb) = (key(a), key(b));
        ka.0.cmp(&kb.0).then(ka.1.total_cmp(&kb.1))
    });
    let mut parts = Vec::with_capacity(files.len());
    let mut details = Value::Null;
    for (index, file) in files.iter_mut().enumerate() {
        let episode = episode_of(&file.path);
        let info = formats::probe_video(&file.path);
        if details.is_null() {
            details = info.as_ref().map(|i| i.details.clone()).unwrap_or(Value::Null);
        }
        let number = episode.as_ref().map(|e| e.episode).unwrap_or(index as f64 + 1.0);
        parts.push(PartDraft {
            kind: "episode",
            number: Some(number),
            title: Some(episode.as_ref().and_then(|e| e.title.clone()).unwrap_or_else(|| format!("Episode {number}"))),
            duration_ms: info.and_then(|i| i.duration).map(|d| (d * 1000.0) as i64),
            season: episode.map(|e| e.season),
            artist: None,
        });
        file.part = Some(index);
    }
    let seasons = parts.iter().filter_map(|p| p.season).collect::<std::collections::BTreeSet<_>>().len();
    let first = files.first().map(|f| f.path.clone());
    let format = first.as_deref().map(extension).unwrap_or_default();
    let mut d = draft("video", name.to_string(), None, format, files);
    if let Some(path) = first {
        let at = formats::probe_video(&path).and_then(|i| i.duration).map_or(10.0, |duration| (duration * 0.1).clamp(1.0, 300.0));
        d.artwork = formats::video_frame(&path, at);
    }
    if let Value::Object(details) = details {
        for key in ["resolution", "videoCodec"] {
            if let Some(value) = details.get(key) {
                d.metadata.insert(key.into(), value.clone());
            }
        }
    }
    d.metadata.insert("kind".into(), json!("series"));
    d.metadata.insert("seasons".into(), json!(seasons));
    d.parts = parts;
    d.copy_folder = Some(name.to_string());
    d
}

// ---------------------------------------------------------------------------------------------
// Saving

fn mime(path: &Path) -> &'static str {
    match extension(path).as_str() {
        "epub" => "application/epub+zip",
        "pdf" => "application/pdf",
        "cbz" => "application/vnd.comicbook+zip",
        "cbr" => "application/vnd.comicbook-rar",
        "mobi" | "azw" | "azw3" => "application/x-mobipocket-ebook",
        "fb2" => "application/x-fictionbook+xml",
        "mkv" => "video/x-matroska",
        "mp4" | "m4v" => "video/mp4",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        "avi" => "video/x-msvideo",
        "mp3" => "audio/mpeg",
        "flac" => "audio/flac",
        "wav" => "audio/wav",
        "m4a" | "aac" => "audio/mp4",
        "ogg" | "oga" | "opus" => "audio/ogg",
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "webp" => "image/webp",
        _ => "application/octet-stream",
    }
}

struct Stored {
    path: String,
    storage: &'static str,
    volume: Option<String>,
}

fn save(library: &Library, draft: Draft, mode: ImportMode, category_id: i64, category_name: &str) -> AppResult<()> {
    // New episodes of a series already in the library join it.
    if draft.metadata.get("kind").and_then(Value::as_str) == Some("series") {
        let existing: Option<i64> = library.db.with(|conn| {
            Ok(conn
                .query_row(
                    "SELECT id FROM items WHERE category_id = ?1 AND lower(title) = lower(?2) AND json_extract(metadata, '$.kind') = 'series' LIMIT 1",
                    params![category_id, draft.title],
                    |row| row.get(0),
                )
                .optional()?)
        })?;
        if let Some(item_id) = existing {
            let stored = store_files(library, &draft, mode, category_name)?;
            let result = library.db.with(|conn| {
                let tx = conn.transaction()?;
                insert_version(&tx, item_id, &draft, true, &stored)?;
                tx.execute("UPDATE items SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?1", [item_id])?;
                reindex(&tx, item_id)?;
                tx.commit()?;
                Ok(())
            });
            if result.is_err() {
                discard_copies(library, &stored);
            }
            return result;
        }
    }
    let stored = store_files(library, &draft, mode, category_name)?;
    let art = store_artwork(library, &draft);
    let result = library.db.with(|conn| {
        let item = insert(conn, &draft, &stored, category_id, art.as_ref())?;
        if !draft.album.is_empty() {
            let album = ensure_album(conn, category_id, &draft.album)?;
            conn.execute("UPDATE items SET collection_id = ?2 WHERE id = ?1", params![item, album])?;
        }
        Ok(item)
    });
    if result.is_err() {
        discard_copies(library, &stored);
    }
    result.map(|_| ())
}

/// The collection for a photo's albums (`["Trips", "2024"]`), made where missing (D-033). An album
/// already there with the same name, in the same place, is used again.
fn ensure_album(conn: &Connection, category_id: i64, names: &[String]) -> AppResult<i64> {
    let mut parent: Option<i64> = None;
    for name in names {
        let existing: Option<i64> = conn
            .query_row(
                "SELECT id FROM collections WHERE category_id = ?1 AND parent_id IS ?2 AND lower(name) = lower(?3) ORDER BY id LIMIT 1",
                params![category_id, parent, name],
                |row| row.get(0),
            )
            .optional()?;
        parent = Some(match existing {
            Some(id) => id,
            None => {
                conn.execute(
                    "INSERT INTO collections (category_id, parent_id, kind, name, sort_name) VALUES (?1, ?2, 'folder', ?3, ?4)",
                    params![category_id, parent, name, sort_key(name)],
                )?;
                conn.last_insert_rowid()
            }
        });
    }
    parent.ok_or_else(|| AppError::msg("an album needs a name"))
}

fn store_files(library: &Library, draft: &Draft, mode: ImportMode, category_name: &str) -> AppResult<Vec<Stored>> {
    match mode {
        ImportMode::Reference => Ok(draft
            .files
            .iter()
            .map(|f| Stored { path: f.path.display().to_string(), storage: "referenced", volume: files::volume_serial(&f.path) })
            .collect()),
        ImportMode::Copy => copy_into_library(library, draft, category_name),
    }
}

fn store_artwork(library: &Library, draft: &Draft) -> Option<artwork::Artwork> {
    if let Some(art) = &draft.ready_art {
        return Some(art.clone());
    }
    let bytes = draft.artwork.as_deref()?;
    artwork::store(&library.folder, bytes)
        .map_err(|e| log::warn!("artwork for {} skipped: {e}", draft.title))
        .ok()
}

/// Removes copies made for an import that could not be recorded.
fn discard_copies(library: &Library, stored: &[Stored]) {
    for file in stored.iter().filter(|f| f.storage == "managed") {
        let _ = std::fs::remove_file(library.folder.resolve(&file.path, "managed"));
    }
}

/// Adds files Digitify itself made inside the library folder (ripped CDs, imported discs) as
/// managed copies, without copying them again. Returns the new items' ids.
pub fn import_in_place(library: &Library, paths: &[PathBuf]) -> AppResult<Vec<i64>> {
    let categories: HashMap<String, i64> = library.db.with(|conn| {
        let rows = conn.prepare("SELECT key, id FROM categories")?.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?.collect::<Result<_, _>>()?;
        Ok(rows)
    })?;
    let mut ids = Vec::new();
    for candidate in scan(paths, &AtomicBool::new(false), ImageMode::Photos) {
        let Prepared::Draft(draft) = prepare(library, &candidate)? else { continue };
        let category_id = *categories.get(draft.category).ok_or_else(|| AppError::msg(format!("unknown category '{}'", draft.category)))?;
        let stored: Vec<Stored> = draft
            .files
            .iter()
            .map(|file| {
                let relative = file.path.strip_prefix(&library.folder.root).unwrap_or(&file.path);
                Stored { path: relative.display().to_string(), storage: "managed", volume: None }
            })
            .collect();
        let art = store_artwork(library, &draft);
        ids.push(library.db.with(|conn| insert(conn, &draft, &stored, category_id, art.as_ref()))?);
    }
    Ok(ids)
}

/// A book made from images picked and put in order by hand (the image-set book builder).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageBook {
    pub title: String,
    /// A category key.
    pub category: String,
    /// The pages, in reading order.
    pub paths: Vec<String>,
    pub mode: ImportMode,
}

#[tauri::command]
pub async fn book_from_images(app: AppHandle, state: State<'_, AppState>, book: ImageBook) -> AppResult<i64> {
    let library = state.library()?;
    let id = crate::library::blocking(move || build_book(&library, book)).await?;
    let _ = app.emit("library-changed", ());
    Ok(id)
}

fn build_book(library: &Library, book: ImageBook) -> AppResult<i64> {
    let title = book.title.split_whitespace().collect::<Vec<_>>().join(" ");
    if title.is_empty() {
        return Err(AppError::msg("Give the book a title."));
    }
    if book.paths.is_empty() || book.paths.len() > 5000 {
        return Err(AppError::msg("A book needs between 1 and 5,000 images."));
    }
    let paths: Vec<PathBuf> = book.paths.iter().map(PathBuf::from).collect();
    if let Some(other) = paths.iter().find(|path| kind_of(path) != Some(Kind::Image)) {
        return Err(AppError::msg(format!("{} isn't an image Digitify can show.", other.display())));
    }
    let (category_id, category_name): (i64, String) = library.db.with(|conn| {
        conn.query_row("SELECT id, name FROM categories WHERE key = ?1", [&book.category], |row| Ok((row.get(0)?, row.get(1)?)))
            .optional()?
            .ok_or_else(|| AppError::msg("That category no longer exists."))
    })?;
    let mut drafts = Vec::with_capacity(paths.len());
    for path in &paths {
        let metadata = std::fs::metadata(path).map_err(|e| AppError::msg(format!("{} can't be read: {e}", path.display())))?;
        let quick_hash = files::quick_hash(path, metadata.len())?;
        drafts.push(FileDraft { path: path.clone(), size: metadata.len(), modified: files::modified_unix(&metadata), quick_hash, part: None });
    }
    let mut d = draft("books", title.clone(), None, "images".into(), drafts);
    d.artwork = std::fs::read(&paths[0]).ok();
    d.copy_folder = Some(title);
    d.metadata.insert("pageCount".into(), json!(paths.len()));
    let stored = store_files(library, &d, book.mode, &category_name)?;
    let art = store_artwork(library, &d);
    let result = library.db.with(|conn| insert(conn, &d, &stored, category_id, art.as_ref()));
    if result.is_err() {
        discard_copies(library, &stored);
    }
    result
}

fn copy_into_library(library: &Library, draft: &Draft, category_name: &str) -> AppResult<Vec<Stored>> {
    let mut dir = library.folder.media_dir().join(files::safe_name(category_name));
    if let Some(folder) = &draft.copy_folder {
        dir = files::unique_path(&dir, &files::safe_name(folder));
    }
    std::fs::create_dir_all(&dir)?;
    let mut stored: Vec<Stored> = Vec::new();
    for file in &draft.files {
        let name = file.path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "file".into());
        let destination = files::unique_path(&dir, &name);
        if let Err(e) = std::fs::copy(&file.path, &destination) {
            for done in &stored {
                let _ = std::fs::remove_file(library.folder.resolve(&done.path, "managed"));
            }
            return Err(AppError::msg(format!("could not copy {}: {e}", file.path.display())));
        }
        let relative = destination.strip_prefix(&library.folder.root).unwrap_or(&destination);
        stored.push(Stored { path: relative.display().to_string(), storage: "managed", volume: None });
    }
    Ok(stored)
}

fn insert(
    conn: &mut Connection,
    draft: &Draft,
    stored: &[Stored],
    category_id: i64,
    art: Option<&artwork::Artwork>,
) -> AppResult<i64> {
    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO items (category_id, title, sort_title, subtitle, year, description, cover_key, cover_color, metadata) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            category_id,
            draft.title,
            sort_key(&draft.title),
            draft.subtitle,
            draft.year,
            draft.description,
            art.map(|a| a.key.as_str()),
            art.map(|a| a.color.as_str()),
            Value::Object(draft.metadata.clone()).to_string(),
        ],
    )?;
    let item_id = tx.last_insert_rowid();
    for (position, (name, role)) in draft.people.iter().enumerate() {
        let person_id = upsert_person(&tx, name)?;
        tx.execute(
            "INSERT OR IGNORE INTO item_people (item_id, person_id, role, position) VALUES (?1, ?2, ?3, ?4)",
            params![item_id, person_id, role, position as i64],
        )?;
    }
    insert_version(&tx, item_id, draft, true, stored)?;
    reindex(&tx, item_id)?;
    tx.commit()?;
    Ok(item_id)
}

/// Records a digital version with its files, and optionally the draft's parts (tracks, pages).
fn insert_version(conn: &Connection, item_id: i64, draft: &Draft, with_parts: bool, stored: &[Stored]) -> AppResult<()> {
    let mut part_ids = Vec::new();
    if with_parts {
        for (position, part) in draft.parts.iter().enumerate() {
            let mut metadata = Map::new();
            if let Some(season) = part.season {
                metadata.insert("season".into(), json!(season));
            }
            if let Some(artist) = &part.artist {
                metadata.insert("artist".into(), json!(artist));
            }
            let metadata = Value::Object(metadata);
            conn.execute(
                "INSERT INTO parts (item_id, kind, number, title, duration_ms, position, metadata) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![item_id, part.kind, part.number, part.title, part.duration_ms, position as i64, metadata.to_string()],
            )?;
            part_ids.push(conn.last_insert_rowid());
        }
    }
    conn.execute(
        "INSERT INTO versions (item_id, kind, format, is_primary) \
         VALUES (?1, 'digital', ?2, NOT EXISTS (SELECT 1 FROM versions WHERE item_id = ?1 AND kind = 'digital'))",
        params![item_id, draft.format],
    )?;
    let version_id = conn.last_insert_rowid();
    for (position, (file, stored)) in draft.files.iter().zip(stored).enumerate() {
        conn.execute(
            "INSERT INTO files (version_id, part_id, position, path, storage, volume_id, size, modified_at, quick_hash, mime, status, last_seen_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'ok', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))",
            params![
                version_id,
                file.part.and_then(|index| part_ids.get(index).copied()),
                position as i64,
                stored.path,
                stored.storage,
                stored.volume,
                file.size as i64,
                file.modified,
                file.quick_hash,
                mime(&file.path),
            ],
        )?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn photo_albums_follow_the_picked_folder() {
        use std::path::Path;
        let root = Path::new("/photos/Trips");
        assert_eq!(super::album_of(root, Path::new("/photos/Trips/a.jpg")), ["Trips"]);
        assert_eq!(super::album_of(root, Path::new("/photos/Trips/2024/Lisbon/b.jpg")), ["Trips", "2024", "Lisbon"]);
    }

    use super::*;

    #[test]
    fn titles_come_from_file_names() {
        assert_eq!(title_from_name(Path::new("Metropolis (1927).mkv")), ("Metropolis".into(), Some(1927)));
        assert_eq!(title_from_name(Path::new("His_Girl_Friday.[1940].mp4")), ("His Girl Friday".into(), Some(1940)));
        assert_eq!(title_from_name(Path::new("Moby-Dick.epub")), ("Moby-Dick".into(), None));
    }
}

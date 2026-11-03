//! The import queue (D-028): each chosen entry is a job, worked by two background workers so the
//! app stays responsive and services aren't flooded. A job downloads (where allowed) or saves an
//! online item; one that fails doesn't stop the others, and can be retried. Progress goes to the UI
//! as `online-queue` events.

use std::collections::HashSet;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use rusqlite::params;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use super::{http, keys, save_download, save_link, Entry, ImportRequest};
use crate::error::{AppError, AppResult};
use crate::{files, AppState, Library};

const WORKERS: usize = 2;
/// Finished jobs kept on the list.
const KEEP: usize = 300;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum JobState {
    Pending,
    Working,
    Done,
    /// Already in the library: nothing was added.
    Skipped,
    Failed,
    Cancelled,
}

struct Job {
    id: u64,
    batch: u64,
    /// Its place in the original playlist or album.
    position: usize,
    entry: Entry,
    download: bool,
    category: String,
    playlist: Option<i64>,
    /// An online-only item this download replaces.
    replaces: Option<i64>,
    state: JobState,
    progress: Option<f64>,
    error: Option<String>,
    item: Option<i64>,
    cancel: Arc<AtomicBool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobView {
    pub id: u64,
    pub batch: u64,
    pub title: String,
    pub creator: Option<String>,
    pub service: String,
    pub audio: bool,
    /// "download" or "link".
    pub action: &'static str,
    pub state: JobState,
    pub progress: Option<f64>,
    pub error: Option<String>,
    pub item_id: Option<i64>,
}

impl Job {
    fn view(&self) -> JobView {
        JobView {
            id: self.id,
            batch: self.batch,
            title: self.entry.title.clone(),
            creator: self.entry.creator.clone(),
            service: self.entry.service.clone(),
            audio: self.entry.audio,
            action: if self.download { "download" } else { "link" },
            state: self.state,
            progress: self.progress,
            error: self.error.clone(),
            item_id: self.item,
        }
    }
}

#[derive(Default)]
struct Shared {
    jobs: Mutex<Vec<Job>>,
    wake: Condvar,
    next: AtomicU64,
    started: AtomicBool,
}

#[derive(Default)]
pub struct OnlineState {
    shared: Arc<Shared>,
}

fn emit(app: &AppHandle, shared: &Shared) {
    let views: Vec<JobView> = shared.jobs.lock().unwrap_or_else(|e| e.into_inner()).iter().map(Job::view).collect();
    let _ = app.emit("online-queue", views);
}

impl OnlineState {
    pub fn snapshot(&self) -> Vec<JobView> {
        self.shared.jobs.lock().unwrap_or_else(|e| e.into_inner()).iter().map(Job::view).collect()
    }

    pub fn enqueue(&self, app: &AppHandle, library: Arc<Library>, request: ImportRequest, playlist: Option<i64>) -> u64 {
        let batch = self.shared.next.fetch_add(1, Ordering::Relaxed) + 1;
        {
            let mut jobs = self.shared.jobs.lock().unwrap_or_else(|e| e.into_inner());
            let mut seen: HashSet<(String, String)> = HashSet::new();
            for (position, entry) in request.entries.into_iter().enumerate() {
                let id = self.shared.next.fetch_add(1, Ordering::Relaxed) + 1;
                let download = request.download && entry.downloadable && entry.download.is_some();
                let category = if entry.audio { request.music_category.clone() } else { request.video_category.clone() };
                let key = (entry.provider.clone(), entry.external_id.clone());
                // Already here: the same thing earlier in this list, queued now, or in the library.
                let queued = jobs.iter().any(|j| matches!(j.state, JobState::Pending | JobState::Working) && j.entry.provider == key.0 && j.entry.external_id == key.1);
                let existing = library.db.with(|conn| super::existing(conn, &entry)).ok().flatten();
                let online_only = existing.is_some_and(|item| library.db.with(|conn| Ok(conn.query_row("SELECT downloaded = 0 FROM online_sources WHERE item_id = ?1", [item], |row| row.get::<_, bool>(0))?)).unwrap_or(false));
                let (state, error, replaces) = if !entry.available {
                    (JobState::Failed, Some(entry.reason.clone().unwrap_or_else(|| "Not available.".into())), None)
                } else if !seen.insert(key) || queued {
                    (JobState::Skipped, Some("Already in this import.".into()), None)
                } else if let Some(item) = existing {
                    // An online-only item is replaced by a download of it; anything else is kept.
                    if download && online_only {
                        (JobState::Pending, None, Some(item))
                    } else {
                        (JobState::Skipped, Some("Already in your library.".into()), None)
                    }
                } else {
                    (JobState::Pending, None, None)
                };
                let item = if state == JobState::Skipped { existing } else { None };
                jobs.push(Job { id, batch, position, entry, download, category, playlist, replaces, state, progress: None, error, item, cancel: Arc::new(AtomicBool::new(false)) });
            }
            let finished = jobs.iter().filter(|j| !matches!(j.state, JobState::Pending | JobState::Working)).count();
            if finished > KEEP {
                let mut drop = finished - KEEP;
                jobs.retain(|j| {
                    let old = drop > 0 && !matches!(j.state, JobState::Pending | JobState::Working);
                    if old {
                        drop -= 1;
                    }
                    !old
                });
            }
        }
        if playlist.is_some() {
            sync_playlist(&library, &self.shared, batch);
        }
        self.start(app, library);
        self.shared.wake.notify_all();
        emit(app, &self.shared);
        batch
    }

    fn start(&self, app: &AppHandle, library: Arc<Library>) {
        if self.shared.started.swap(true, Ordering::SeqCst) {
            return;
        }
        for n in 0..WORKERS {
            let (shared, app, library) = (self.shared.clone(), app.clone(), library.clone());
            let _ = std::thread::Builder::new().name(format!("online-import-{n}")).spawn(move || work(app, library, shared));
        }
    }

    /// Cancels one job, or every pending and running one.
    pub fn cancel(&self, app: &AppHandle, id: Option<u64>) {
        {
            let mut jobs = self.shared.jobs.lock().unwrap_or_else(|e| e.into_inner());
            for job in jobs.iter_mut().filter(|j| id.is_none_or(|id| j.id == id)) {
                match job.state {
                    JobState::Pending => {
                        job.state = JobState::Cancelled;
                        job.progress = None;
                    }
                    JobState::Working => job.cancel.store(true, Ordering::Relaxed),
                    _ => {}
                }
            }
        }
        emit(app, &self.shared);
    }

    pub fn retry(&self, app: &AppHandle, id: u64) {
        {
            let mut jobs = self.shared.jobs.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(job) = jobs.iter_mut().find(|j| j.id == id && matches!(j.state, JobState::Failed | JobState::Cancelled) && j.entry.available) {
                job.state = JobState::Pending;
                job.error = None;
                job.progress = None;
                job.cancel = Arc::new(AtomicBool::new(false));
            }
        }
        self.shared.wake.notify_all();
        emit(app, &self.shared);
    }

    pub fn clear(&self, app: &AppHandle) {
        self.shared.jobs.lock().unwrap_or_else(|e| e.into_inner()).retain(|j| matches!(j.state, JobState::Pending | JobState::Working));
        emit(app, &self.shared);
    }
}

fn work(app: AppHandle, fallback: Arc<Library>, shared: Arc<Shared>) {
    loop {
        let picked = {
            let mut jobs = shared.jobs.lock().unwrap_or_else(|e| e.into_inner());
            loop {
                if let Some(job) = jobs.iter_mut().find(|j| j.state == JobState::Pending) {
                    job.state = JobState::Working;
                    job.progress = job.download.then_some(0.0);
                    break (job.id, job.entry.clone(), job.download, job.category.clone(), job.replaces, job.cancel.clone());
                }
                jobs = shared.wake.wait(jobs).unwrap_or_else(|e| e.into_inner());
            }
        };
        emit(&app, &shared);
        let (id, entry, download, category, replaces, cancel) = picked;
        // The library open now (it may have been switched since the queue started).
        let library = app.state::<AppState>().library().unwrap_or_else(|_| fallback.clone());
        let mut last_emit = Instant::now();
        let result = if download {
            let progress = |fraction: f64| {
                if let Some(job) = shared.jobs.lock().unwrap_or_else(|e| e.into_inner()).iter_mut().find(|j| j.id == id) {
                    job.progress = Some(fraction);
                }
                if last_emit.elapsed() > Duration::from_millis(250) {
                    last_emit = Instant::now();
                    emit(&app, &shared);
                }
            };
            fetch_file(&app, &library, &entry, &category, &cancel, progress).and_then(|path| {
                let saved = save_download(&library, &entry, &category, &path);
                if saved.is_err() {
                    let _ = std::fs::remove_file(&path);
                }
                saved
            })
        } else {
            save_link(&library, &entry, &category).map(|item| (item, false))
        };
        let result = result.and_then(|(item, already)| {
            if let Some(old) = replaces.filter(|old| *old != item) {
                take_over(&library, old, item)?;
            }
            Ok((item, already))
        });
        let batch = {
            let mut jobs = shared.jobs.lock().unwrap_or_else(|e| e.into_inner());
            let Some(job) = jobs.iter_mut().find(|j| j.id == id) else { continue };
            match result {
                Ok((item, already)) => {
                    job.state = if already { JobState::Skipped } else { JobState::Done };
                    job.error = already.then(|| "Already in your library.".into());
                    job.item = Some(item);
                    job.progress = job.download.then_some(1.0);
                }
                Err(_) if cancel.load(Ordering::Relaxed) => {
                    job.state = JobState::Cancelled;
                    job.progress = None;
                }
                Err(e) => {
                    log::warn!("online import of {} failed: {e}", job.entry.url);
                    job.state = JobState::Failed;
                    job.error = Some(e.to_string());
                    job.progress = None;
                }
            }
            job.playlist.map(|_| job.batch)
        };
        if let Some(batch) = batch {
            sync_playlist(&library, &shared, batch);
        }
        emit(&app, &shared);
        let _ = app.emit("library-changed", ());
    }
}

/// A download replacing an online-only item: the new item keeps its favorite mark, tags and
/// shelves, and the online-only one goes.
fn take_over(library: &Library, old: i64, new: i64) -> AppResult<()> {
    library.db.with(|conn| {
        let tx = conn.transaction()?;
        tx.execute("UPDATE items SET is_favorite = is_favorite OR (SELECT is_favorite FROM items WHERE id = ?1) WHERE id = ?2", params![old, new])?;
        tx.execute("INSERT OR IGNORE INTO item_tags (item_id, tag_id) SELECT ?2, tag_id FROM item_tags WHERE item_id = ?1", params![old, new])?;
        tx.execute("INSERT OR IGNORE INTO shelf_items (shelf_id, item_id, position, added_at) SELECT shelf_id, ?2, position, added_at FROM shelf_items WHERE item_id = ?1", params![old, new])?;
        tx.execute("DELETE FROM items_fts WHERE rowid = ?1", [old])?;
        tx.execute("DELETE FROM items WHERE id = ?1", [old])?;
        crate::library::reindex(&tx, new)?;
        tx.commit()?;
        Ok(())
    })
}

/// The batch's playlist holds its tracks that are in the library, in their original order.
fn sync_playlist(library: &Library, shared: &Shared, batch: u64) {
    let (playlist, items): (Option<i64>, Vec<i64>) = {
        let jobs = shared.jobs.lock().unwrap_or_else(|e| e.into_inner());
        let mut mine: Vec<&Job> = jobs.iter().filter(|j| j.batch == batch).collect();
        mine.sort_by_key(|j| j.position);
        (mine.first().and_then(|j| j.playlist), mine.iter().filter(|j| matches!(j.state, JobState::Done | JobState::Skipped)).filter_map(|j| j.item).collect())
    };
    let Some(playlist) = playlist else { return };
    let result = library.db.with(|conn| {
        let mut parts = Vec::new();
        for item in items {
            if let Some(part) = conn
                .query_row("SELECT id FROM parts WHERE item_id = ?1 AND kind = 'track' ORDER BY position LIMIT 1", [item], |row| row.get::<_, i64>(0))
                .ok()
            {
                parts.push(part);
            }
        }
        crate::music::replace_playlist(conn, playlist, &parts)
    });
    if let Err(e) = result {
        log::warn!("couldn't update the imported playlist: {e}");
    }
}

// ---------------------------------------------------------------------------------------------
// Downloading

fn extension_for(content_type: &str) -> Option<&'static str> {
    Some(match content_type.split(';').next()?.trim() {
        "audio/mpeg" | "audio/mp3" => "mp3",
        "audio/flac" | "audio/x-flac" => "flac",
        "audio/mp4" | "audio/x-m4a" | "audio/aac" => "m4a",
        "audio/ogg" | "audio/vorbis" => "ogg",
        "audio/opus" => "opus",
        "audio/wav" | "audio/x-wav" | "audio/wave" => "wav",
        "audio/aiff" | "audio/x-aiff" => "aiff",
        "video/mp4" => "mp4",
        "video/webm" => "webm",
        "video/x-matroska" => "mkv",
        "video/quicktime" => "mov",
        _ => return None,
    })
}

/// Downloads an entry's file into the library's media folder (`<Category>/Downloads`), with
/// progress, stopping when cancelled. Only files the service allows downloading get here.
fn fetch_file(app: &AppHandle, library: &Library, entry: &Entry, category: &str, cancel: &AtomicBool, mut progress: impl FnMut(f64)) -> AppResult<PathBuf> {
    let source = entry.download.as_deref().ok_or_else(|| AppError::msg("This can't be downloaded."))?;
    let mut request = match entry.provider.as_str() {
        // A direct link is downloaded from exactly the link that was pasted.
        "web" if source == entry.url && (source.starts_with("https://") || source.starts_with("http://")) => http::get(source)?,
        "soundcloud" if source.starts_with("https://api.soundcloud.com/") => {
            let keys = keys::load(&crate::config::config_dir(app)?);
            let (id, secret) = keys.soundcloud.ok_or_else(|| AppError::msg("Downloading from SoundCloud needs its keys in Settings › Online services."))?;
            let token = super::providers::soundcloud_token(&id, &secret)?;
            http::get(source)?.set("Authorization", &format!("OAuth {token}"))
        }
        _ => return Err(AppError::msg("This service doesn't allow downloads, so it's saved as an online item.")),
    };
    request = request.timeout(Duration::from_secs(60 * 60));
    // A direct link's errors speak of "the site" rather than a service name.
    let service = if entry.provider == "web" { "the site" } else { entry.service.as_str() };
    let response = http::send(service, request, None)?;
    let content_type = response.content_type().to_ascii_lowercase();
    if content_type.starts_with("text/") || content_type.contains("html") || content_type.contains("json") {
        return Err(AppError::msg("The link didn't give a media file (it led to a page instead)."));
    }
    let named = response
        .header("content-disposition")
        .and_then(|d| d.split("filename=").nth(1))
        .map(|n| n.trim_matches(|c| c == '"' || c == '\'' || c == ';' || c == ' ').to_string())
        .or_else(|| url::Url::parse(response.get_url()).ok().and_then(|u| u.path_segments().and_then(|mut s| s.next_back().map(str::to_string))));
    let extension = named
        .as_deref()
        .and_then(|n| n.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase()))
        .filter(|e| super::link::media_of_extension(e).is_some())
        .or_else(|| extension_for(&content_type).map(str::to_string))
        .ok_or_else(|| AppError::msg(format!("The file isn't audio or video Digitify can play ({}).", if content_type.is_empty() { "unknown type" } else { &content_type })))?;
    let total = response.header("content-length").and_then(|v| v.parse::<u64>().ok());

    let category_name: String = library.db.with(|conn| Ok(conn.query_row("SELECT name FROM categories WHERE key = ?1", [category], |row| row.get(0))?))?;
    let dir = library.folder.media_dir().join(files::safe_name(&category_name)).join("Downloads");
    std::fs::create_dir_all(&dir)?;
    let base = match &entry.creator {
        Some(creator) if entry.audio => format!("{creator} - {}", entry.title),
        _ => entry.title.clone(),
    };
    let target = files::unique_path(&dir, &format!("{}.{extension}", files::safe_name(&base)));
    let partial = target.with_extension(format!("{extension}.part"));
    let outcome = (|| -> AppResult<()> {
        let mut reader = response.into_reader();
        let mut out = std::io::BufWriter::new(std::fs::File::create(&partial)?);
        let mut buffer = vec![0u8; 64 * 1024];
        let mut done: u64 = 0;
        loop {
            if cancel.load(Ordering::Relaxed) {
                return Err(AppError::msg("cancelled"));
            }
            let read = reader.read(&mut buffer).map_err(|_| AppError::msg(format!("The connection to {service} dropped. Retry to try again.")))?;
            if read == 0 {
                break;
            }
            out.write_all(&buffer[..read])?;
            done += read as u64;
            if let Some(total) = total.filter(|t| *t > 0) {
                progress((done as f64 / total as f64).min(0.99));
            }
        }
        out.flush()?;
        if total.is_some_and(|t| done < t) {
            return Err(AppError::msg(format!("The download from {service} stopped early. Retry to try again.")));
        }
        if done == 0 {
            return Err(AppError::msg("The file was empty."));
        }
        Ok(())
    })();
    if let Err(e) = outcome {
        let _ = std::fs::remove_file(&partial);
        return Err(e);
    }
    std::fs::rename(&partial, &target)?;
    Ok(target)
}

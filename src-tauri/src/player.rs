//! Video playback through mpv, which runs as a separate helper program (D-002).
//!
//! mpv draws into a child "video host" window kept underneath the transparent WebView, so the
//! React controls float over the picture. Commands and events travel as JSON lines over mpv's
//! IPC named pipe; every message mpv sends is forwarded to the UI as a `player-event`.

use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWriteExt, BufReader};
use tokio::net::windows::named_pipe::{ClientOptions, NamedPipeClient};
use tokio::sync::{mpsc, oneshot};

use crate::error::{AppError, AppResult};

/// mpv properties mirrored to the UI as `property-change` events.
const OBSERVED: &[&str] = &[
    "time-pos", "duration", "pause", "volume", "mute", "eof-reached", "media-title",
    "track-list", "chapter-list", "chapter", "speed", "sid", "aid", "seeking", "paused-for-cache",
];

/// `time-pos` changes with every frame; the UI gets it at most this often (and on every jump).
const TIME_EVERY: Duration = Duration::from_millis(100);

const SUBTITLE_EXTENSIONS: &[&str] = &["srt", "ass", "ssa", "vtt", "sub", "sup", "idx"];

static NEXT_PIPE: AtomicU32 = AtomicU32::new(1);

#[derive(Default)]
pub struct PlayerState {
    session: Mutex<Option<Session>>,
}

struct Session {
    child: Child,
    host: isize,
    commands: mpsc::UnboundedSender<String>,
}

/// Opens any file in the player (the Phase 0 video lab only; library videos use `watch_open`).
#[tauri::command]
pub async fn player_open(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, PlayerState>,
    path: String,
) -> AppResult<()> {
    start(&app, &window, &state, Path::new(&path), 0.0, 100.0).await
}

/// Starts mpv on `path` under the WebView, `start` seconds in, at `volume` (0–100). Subtitles next
/// to the video whose names contain its name load with it.
pub async fn start(app: &AppHandle, window: &WebviewWindow, state: &PlayerState, path: &Path, start: f64, volume: f64) -> AppResult<()> {
    start_with(app, window, state, &path.to_string_lossy(), start, volume, &[]).await
}

/// Like `start`, for any source mpv can open (a disc title's EDL) with extra options.
pub async fn start_with(
    app: &AppHandle,
    window: &WebviewWindow,
    state: &PlayerState,
    source: &str,
    start: f64,
    volume: f64,
    options: &[String],
) -> AppResult<()> {
    stop(app, state);
    let app = app.clone();

    let parent = window.hwnd()?.0 as isize;
    let host = on_main_thread(&app, move || video_host::create(parent))
        .await?
        .ok_or_else(|| AppError::msg("could not create the video surface"))?;

    let pipe = format!(
        r"\\.\pipe\digitify-mpv-{}-{}",
        std::process::id(),
        NEXT_PIPE.fetch_add(1, Ordering::Relaxed)
    );
    let log_file = app.path().app_log_dir()?.join("mpv.log");
    let spawned = Command::new(mpv_path()?)
        .args([
            "--no-config".to_string(),
            format!("--wid={host}"),
            format!("--input-ipc-server={pipe}"),
            "--idle=yes".into(),
            "--force-window=yes".into(),
            "--keep-open=yes".into(),
            "--osc=no".into(),
            "--osd-level=0".into(),
            "--input-default-bindings=no".into(),
            "--input-vo-keyboard=no".into(),
            "--input-cursor=no".into(),
            "--cursor-autohide=no".into(),
            "--load-scripts=no".into(),
            "--ytdl=no".into(),
            "--hwdec=auto-safe".into(),
            // Keep what was just played and a little ahead in memory, so jumping back and forth
            // nearby doesn't have to go back to the disk.
            "--cache=yes".into(),
            "--demuxer-max-bytes=150MiB".into(),
            "--demuxer-max-back-bytes=100MiB".into(),
            "--sub-auto=fuzzy".into(),
            format!("--volume={}", volume.clamp(0.0, 100.0).round()),
            "--terminal=no".into(),
            format!("--log-file={}", log_file.display()),
        ])
        .args(options)
        .spawn();
    let mut child = match spawned {
        Ok(child) => child,
        Err(e) => {
            destroy_host(&app, host);
            return Err(AppError::msg(format!("could not start mpv: {e}")));
        }
    };

    let client = match connect(&pipe).await {
        Ok(client) => client,
        Err(e) => {
            let _ = child.kill();
            destroy_host(&app, host);
            return Err(e);
        }
    };
    let (reader, mut writer) = tokio::io::split(client);

    let (commands, mut queue) = mpsc::unbounded_channel::<String>();
    tauri::async_runtime::spawn(async move {
        while let Some(line) = queue.recv().await {
            if writer.write_all(line.as_bytes()).await.is_err() {
                break;
            }
        }
    });

    tauri::async_runtime::spawn(forward(reader, app.clone(), "player-event"));

    for (index, name) in OBSERVED.iter().enumerate() {
        send(&commands, json!({ "command": ["observe_property", index + 1, name] }));
    }
    if start > 0.0 {
        send(&commands, json!({ "command": ["set_property", "start", format!("{start:.1}")] }));
    }
    send(&commands, json!({ "command": ["loadfile", source] }));

    *lock(state)? = Some(Session { child, host, commands });
    log::info!("video player started (mpv pid {})", lock(state)?.as_ref().map_or(0, |s| s.child.id()));
    Ok(())
}

/// Loads a subtitle file the viewer picked and shows it.
#[tauri::command]
pub fn player_add_subtitle(state: State<'_, PlayerState>, path: String) -> AppResult<()> {
    let file = Path::new(&path);
    let extension = file.extension().and_then(|e| e.to_str()).unwrap_or_default().to_ascii_lowercase();
    if !SUBTITLE_EXTENSIONS.contains(&extension.as_str()) || !file.is_file() {
        return Err(AppError::msg("That isn't a subtitle file Digitify can load (SRT, ASS, SSA, VTT, SUB or SUP)."));
    }
    let guard = lock(&state)?;
    let session = guard.as_ref().ok_or_else(|| AppError::msg("no video is open"))?;
    send(&session.commands, json!({ "command": ["sub-add", path, "select"] }));
    Ok(())
}

/// Sends an mpv command, e.g. `["cycle", "pause"]` or `["seek", 30, "absolute"]`.
#[tauri::command]
pub fn player_command(state: State<'_, PlayerState>, args: Vec<Value>) -> AppResult<()> {
    let guard = lock(&state)?;
    let session = guard.as_ref().ok_or_else(|| AppError::msg("no video is open"))?;
    send(&session.commands, json!({ "command": args }));
    Ok(())
}

/// Places the video surface, in physical pixels relative to the window's client area.
/// Synchronous commands run on the main thread, which owns the host window.
#[tauri::command]
pub fn player_set_rect(state: State<'_, PlayerState>, x: i32, y: i32, width: i32, height: i32) -> AppResult<()> {
    if let Some(session) = lock(&state)?.as_ref() {
        video_host::place(session.host, x, y, width.max(1), height.max(1));
    }
    Ok(())
}

#[tauri::command]
pub fn player_close(app: AppHandle, state: State<'_, PlayerState>) -> AppResult<()> {
    stop(&app, &state);
    Ok(())
}

/// Called when the app exits: mpv must never outlive Digitify.
pub fn shutdown(app: &AppHandle) {
    if let Some(state) = app.try_state::<PlayerState>() {
        if let Ok(mut guard) = state.session.lock() {
            if let Some(mut session) = guard.take() {
                let _ = session.child.kill();
                let _ = session.child.wait();
            }
        }
    }
}

/// Asks mpv to quit, then cleans up on a helper thread so the window thread never blocks:
/// mpv's window is a child of ours, and tearing it down needs our window thread to respond.
fn stop(app: &AppHandle, state: &PlayerState) {
    let Some(mut session) = state.session.lock().ok().and_then(|mut guard| guard.take()) else {
        return;
    };
    send(&session.commands, json!({ "command": ["quit"] }));
    let app = app.clone();
    std::thread::spawn(move || {
        for _ in 0..40 {
            if matches!(session.child.try_wait(), Ok(Some(_))) {
                break;
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        let _ = session.child.kill();
        let _ = session.child.wait();
        destroy_host(&app, session.host);
    });
}

fn destroy_host(app: &AppHandle, host: isize) {
    let _ = app.run_on_main_thread(move || video_host::destroy(host));
}

/// Forwards every message mpv sends to the UI as `event`, except that `time-pos` goes at most every
/// `TIME_EVERY` (a jump goes at once, and the latest value follows once things settle), which keeps
/// the UI from redrawing on every frame.
pub(crate) async fn forward(reader: impl AsyncRead + Unpin, app: AppHandle, event: &'static str) {
    let mut lines = BufReader::new(reader).lines();
    let mut last_time: Option<(Instant, f64)> = None;
    let mut held: Option<(f64, Value)> = None;
    loop {
        let next = if held.is_some() {
            match tokio::time::timeout(TIME_EVERY, lines.next_line()).await {
                Ok(next) => next,
                Err(_) => {
                    if let Some((time, message)) = held.take() {
                        last_time = Some((Instant::now(), time));
                        let _ = app.emit(event, message);
                    }
                    continue;
                }
            }
        } else {
            lines.next_line().await
        };
        let Ok(Some(line)) = next else { break };
        let message = match serde_json::from_str::<Value>(&line) {
            Ok(message) => message,
            Err(e) => {
                log::warn!("unreadable message from mpv: {e}");
                continue;
            }
        };
        if message["event"] == "property-change" && message["name"] == "time-pos" {
            if let Some(time) = message["data"].as_f64() {
                let due = last_time.map_or(true, |(at, last)| at.elapsed() >= TIME_EVERY || (time - last).abs() > 1.0);
                if due {
                    held = None;
                    last_time = Some((Instant::now(), time));
                    let _ = app.emit(event, message);
                } else {
                    held = Some((time, message));
                }
                continue;
            }
        }
        let _ = app.emit(event, message);
    }
    let _ = app.emit(event, json!({ "event": "closed" }));
}

pub(crate) fn send(commands: &mpsc::UnboundedSender<String>, message: Value) {
    let _ = commands.send(format!("{message}\n"));
}

fn lock(state: &PlayerState) -> AppResult<std::sync::MutexGuard<'_, Option<Session>>> {
    state.session.lock().map_err(|_| AppError::msg("player state is unavailable"))
}

pub(crate) fn mpv_path() -> AppResult<PathBuf> {
    let exe = std::env::current_exe()?;
    let path = exe
        .parent()
        .ok_or_else(|| AppError::msg("cannot locate the app folder"))?
        .join("mpv.exe");
    if path.exists() {
        Ok(path)
    } else {
        Err(AppError::msg(format!(
            "mpv was not found at {}. Run scripts/fetch-deps.ps1, then rebuild.",
            path.display()
        )))
    }
}

/// mpv creates its control pipe shortly after starting; retry until it appears.
pub(crate) async fn connect(pipe: &str) -> AppResult<NamedPipeClient> {
    const ERROR_FILE_NOT_FOUND: i32 = 2;
    const ERROR_PIPE_BUSY: i32 = 231;
    for _ in 0..200 {
        match ClientOptions::new().open(pipe) {
            Ok(client) => return Ok(client),
            Err(e) if matches!(e.raw_os_error(), Some(ERROR_FILE_NOT_FOUND | ERROR_PIPE_BUSY)) => {
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
            Err(e) => return Err(e.into()),
        }
    }
    Err(AppError::msg("mpv did not open its control pipe within 5 seconds"))
}

async fn on_main_thread<T: Send + 'static>(
    app: &AppHandle,
    f: impl FnOnce() -> T + Send + 'static,
) -> AppResult<T> {
    let (tx, rx) = oneshot::channel();
    app.run_on_main_thread(move || {
        let _ = tx.send(f());
    })?;
    rx.await.map_err(|_| AppError::msg("the window thread did not respond"))
}

/// The child window mpv renders into. It stays at the bottom of the z-order, underneath the
/// WebView, whose transparent areas let the video show through.
mod video_host {
    use windows_sys::w;
    use windows_sys::Win32::Foundation::{HWND, LPARAM};
    use windows_sys::Win32::Graphics::Gdi::{GetStockObject, BLACK_BRUSH};
    use windows_sys::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DestroyWindow, EnumChildWindows, RegisterClassW,
        SetWindowPos, HWND_BOTTOM, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER,
        WNDCLASSW, WS_CHILD, WS_CLIPCHILDREN, WS_VISIBLE,
    };

    pub fn create(parent: isize) -> Option<isize> {
        unsafe {
            let instance = GetModuleHandleW(std::ptr::null());
            let class = WNDCLASSW {
                style: 0,
                lpfnWndProc: Some(DefWindowProcW),
                cbClsExtra: 0,
                cbWndExtra: 0,
                hInstance: instance,
                hIcon: std::ptr::null_mut(),
                hCursor: std::ptr::null_mut(),
                hbrBackground: GetStockObject(BLACK_BRUSH),
                lpszMenuName: std::ptr::null(),
                lpszClassName: w!("DigitifyVideoHost"),
            };
            // Registering twice fails harmlessly; the class from the first call is reused.
            RegisterClassW(&class);
            let hwnd = CreateWindowExW(
                0,
                w!("DigitifyVideoHost"),
                w!(""),
                WS_CHILD | WS_VISIBLE | WS_CLIPCHILDREN,
                0,
                0,
                1,
                1,
                parent as HWND,
                std::ptr::null_mut(),
                instance,
                std::ptr::null(),
            );
            if hwnd.is_null() {
                return None;
            }
            SetWindowPos(hwnd, HWND_BOTTOM, 0, 0, 0, 0, SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE);
            Some(hwnd as isize)
        }
    }

    /// Moves the host and stretches mpv's own window to fill it.
    pub fn place(host: isize, x: i32, y: i32, width: i32, height: i32) {
        unsafe {
            SetWindowPos(host as HWND, HWND_BOTTOM, x, y, width, height, SWP_NOACTIVATE);
            let packed = ((width as i64) << 32) | (height as i64 & 0xFFFF_FFFF);
            EnumChildWindows(host as HWND, Some(fill_child), packed as LPARAM);
        }
    }

    pub fn destroy(host: isize) {
        unsafe {
            DestroyWindow(host as HWND);
        }
    }

    unsafe extern "system" fn fill_child(child: HWND, packed: LPARAM) -> i32 {
        let packed = packed as i64;
        let (width, height) = ((packed >> 32) as i32, (packed & 0xFFFF_FFFF) as i32);
        SetWindowPos(child, std::ptr::null_mut(), 0, 0, width, height, SWP_NOACTIVATE | SWP_NOZORDER);
        1
    }
}

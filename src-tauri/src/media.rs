//! The system's media controls (D-058): the keyboard's and headphones' play/pause/next/previous
//! keys, and the "now playing" card of Windows (System Media Transport Controls) and Linux
//! desktops (MPRIS), for the music and videos Digitify plays. The UI tells the core what's playing;
//! the keys come back to the UI as `media-key` events, which act on whatever plays.

use std::sync::Mutex;

use serde::Deserialize;
use souvlaki::{MediaControlEvent, MediaControls, MediaMetadata, MediaPlayback, PlatformConfig};
use tauri::{Emitter, Manager, State};

use crate::error::AppResult;

#[derive(Default)]
pub struct MediaState {
    controls: Mutex<Option<MediaControls>>,
}

/// Connects to the system's media controls; Digitify works the same without them (no D-Bus
/// session on Linux, say).
pub fn start(app: &tauri::App) {
    let state = app.state::<MediaState>();
    #[cfg(windows)]
    let hwnd = app.get_webview_window("main").and_then(|w| w.hwnd().ok()).map(|h| h.0 as *mut std::ffi::c_void);
    #[cfg(not(windows))]
    let hwnd = None;
    let config = PlatformConfig { dbus_name: "digitify", display_name: "Digitify", hwnd };
    let mut controls = match MediaControls::new(config) {
        Ok(controls) => controls,
        Err(e) => {
            log::warn!("media controls unavailable: {e:?}");
            return;
        }
    };
    let handle = app.handle().clone();
    let attached = controls.attach(move |event: MediaControlEvent| {
        let action = match event {
            MediaControlEvent::Play => "play",
            MediaControlEvent::Pause => "pause",
            MediaControlEvent::Toggle => "toggle",
            MediaControlEvent::Next => "next",
            MediaControlEvent::Previous => "previous",
            MediaControlEvent::Stop => "stop",
            _ => return,
        };
        let _ = handle.emit("media-key", action);
    });
    if let Err(e) = attached {
        log::warn!("media controls couldn't be attached: {e:?}");
        return;
    }
    if let Ok(mut slot) = state.controls.lock() {
        *slot = Some(controls);
    };
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NowPlaying {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    /// `playing`, `paused` or `stopped` (nothing playing).
    pub state: String,
}

/// What plays now, for the system's "now playing" card.
#[tauri::command]
pub fn media_now_playing(app: tauri::AppHandle, state: State<'_, MediaState>, now: NowPlaying) -> AppResult<()> {
    // The tray icon's tooltip too (D-059).
    let tooltip = match (&now.title, now.state.as_str()) {
        (Some(title), "playing" | "paused") => {
            let by = now.artist.as_deref().map(|a| format!(" · {a}")).unwrap_or_default();
            format!("Digitify — {}{title}{by}", if now.state == "paused" { "paused: " } else { "" })
        }
        _ => "Digitify".to_string(),
    };
    crate::tray::set_tooltip(&app, &tooltip.chars().take(120).collect::<String>());
    let Ok(mut slot) = state.controls.lock() else { return Ok(()) };
    let Some(controls) = slot.as_mut() else { return Ok(()) };
    let playback = match now.state.as_str() {
        "playing" => MediaPlayback::Playing { progress: None },
        "paused" => MediaPlayback::Paused { progress: None },
        _ => MediaPlayback::Stopped,
    };
    let _ = controls.set_metadata(MediaMetadata {
        title: now.title.as_deref(),
        artist: now.artist.as_deref(),
        album: now.album.as_deref(),
        ..Default::default()
    });
    let _ = controls.set_playback(playback);
    Ok(())
}

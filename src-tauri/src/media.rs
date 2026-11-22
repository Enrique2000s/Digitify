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
    /// Its cover in the library's artwork (D-168), and its length in seconds.
    #[serde(default)]
    pub cover_key: Option<String>,
    /// `music` or `video`: which default cover shows when it has none (D-169).
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub duration: Option<f64>,
    /// `playing`, `paused` or `stopped` (nothing playing).
    pub state: String,
}

/// A cover's file as a `file://` address the system's card can show (D-168): the item's own, or
/// else Digitify's default for music or videos (D-169), so the card never keeps the one before.
fn cover_url(app: &tauri::AppHandle, key: Option<&str>, kind: Option<&str>) -> Option<String> {
    let own = key.filter(|k| !k.is_empty() && k.chars().all(|c| c.is_ascii_alphanumeric())).and_then(|key| {
        let library = app.state::<crate::AppState>().library().ok()?;
        Some(library.folder.covers_dir().join(format!("{key}.jpg"))).filter(|p| p.is_file())
    });
    let path = match own {
        Some(path) => path,
        None => default_cover(app, kind == Some("video"))?,
    };
    // Windows' card reads the path after "file://" as it is; MPRIS wants a proper file URL.
    #[cfg(windows)]
    return Some(format!("file://{}", path.display()));
    #[cfg(not(windows))]
    return url::Url::from_file_path(&path).ok().map(String::from);
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
    // Its cover and length on the card too (D-168).
    let cover = if now.state == "stopped" { None } else { cover_url(&app, now.cover_key.as_deref(), now.kind.as_deref()) };
    let _ = controls.set_metadata(MediaMetadata {
        title: now.title.as_deref(),
        artist: now.artist.as_deref(),
        album: now.album.as_deref(),
        cover_url: cover.as_deref(),
        duration: now.duration.filter(|d| d.is_finite() && *d > 0.0).map(std::time::Duration::from_secs_f64),
    });
    let _ = controls.set_playback(playback);
    Ok(())
}

/// Digitify's default cover for the system's card (D-169), as the mini player shows one: the music's
/// sound waves, or a video's play sign, white on a blue tile. Drawn once into the settings' cache.
fn default_cover(app: &tauri::AppHandle, video: bool) -> Option<std::path::PathBuf> {
    let dir = crate::config::config_dir(app).ok()?.join("cache");
    let path = dir.join(if video { "now-playing-video.png" } else { "now-playing-music.png" });
    if path.is_file() {
        return Some(path);
    }
    std::fs::create_dir_all(&dir).ok()?;
    draw_default_cover(video).save(&path).ok()?;
    Some(path)
}

fn draw_default_cover(video: bool) -> image::RgbaImage {
    const SIZE: u32 = 512;
    let mut img = image::RgbaImage::new(SIZE, SIZE);
    // A diagonal blue, lighter at the top left.
    for (x, y, pixel) in img.enumerate_pixels_mut() {
        let t = (x + y) as f32 / (2 * SIZE) as f32;
        let mix = |a: f32, b: f32| (a + (b - a) * t) as u8;
        *pixel = image::Rgba([mix(38.0, 10.0), mix(160.0, 72.0), mix(222.0, 128.0), 255]);
    }
    let white = image::Rgba([255, 255, 255, 255]);
    if video {
        // A play sign: a triangle pointing right, in the middle.
        let (cx, cy, h) = (SIZE as f32 * 0.54, SIZE as f32 / 2.0, SIZE as f32 * 0.36);
        for y in 0..SIZE {
            for x in 0..SIZE {
                let (fx, fy) = (x as f32, y as f32);
                let left = cx - h * 0.5;
                let along = (fx - left) / h;
                if (0.0..=1.0).contains(&along) && (fy - cy).abs() <= (1.0 - along) * h * 0.58 {
                    img.put_pixel(x, y, white);
                }
            }
        }
    } else {
        // Sound waves: rounded bars of different heights, side by side.
        let heights = [0.18f32, 0.38, 0.56, 0.3, 0.46, 0.22];
        let bar = SIZE as f32 * 0.05;
        let gap = SIZE as f32 * 0.045;
        let total = heights.len() as f32 * bar + (heights.len() - 1) as f32 * gap;
        let mut left = (SIZE as f32 - total) / 2.0;
        for h in heights {
            let half = h * SIZE as f32 / 2.0;
            let (top, bottom) = (SIZE as f32 / 2.0 - half, SIZE as f32 / 2.0 + half);
            let r = bar / 2.0;
            let cx = left + r;
            for y in top as u32..=bottom as u32 {
                for x in left as u32..=(left + bar) as u32 {
                    let (fx, fy) = (x as f32 + 0.5, y as f32 + 0.5);
                    // Rounded ends.
                    let cy = fy.clamp(top + r, bottom - r);
                    if (fx - cx).powi(2) + (fy - cy).powi(2) <= r * r {
                        img.put_pixel(x.min(SIZE - 1), y.min(SIZE - 1), white);
                    }
                }
            }
            left += bar + gap;
        }
    }
    img
}

#[cfg(test)]
mod tests {
    #[test]
    fn default_covers_have_their_sign() {
        for video in [false, true] {
            let img = super::draw_default_cover(video);
            assert_eq!(img.dimensions(), (512, 512));
            let white = img.pixels().filter(|p| p.0 == [255, 255, 255, 255]).count();
            assert!(white > 2000, "the sign is drawn ({white} white pixels)");
            assert_ne!(img.get_pixel(5, 5).0, [255, 255, 255, 255], "on a blue tile");
        }
    }
}

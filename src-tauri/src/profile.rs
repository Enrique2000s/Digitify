//! The personal profile (D-149): a name, a line about yourself, a picture and a banner, kept on this
//! computer beside Digitify's settings (`<config>/profile`), never online and with no account. The
//! profile page shows them with the library's statistics and achievements; its share card is drawn
//! by the app and saved here as a PNG where the user chooses.

use std::path::{Path, PathBuf};

use image::{imageops::FilterType, DynamicImage};
use serde::{Deserialize, Serialize};
use tauri::{ipc::Request, AppHandle, State};

use crate::error::{AppError, AppResult};
use crate::AppState;

/// The pictures are kept whole (D-150), no bigger than this, and framed by their view.
const AVATAR: u32 = 1200;
const BANNER: u32 = 2400;

/// How a picture sits in its frame (D-150): how much it's zoomed in (1 to 4) and which point of it
/// is in the middle (0 to 100 % across and down).
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct View {
    pub zoom: f32,
    pub x: f32,
    pub y: f32,
}

impl Default for View {
    fn default() -> Self {
        View { zoom: 1.0, x: 50.0, y: 50.0 }
    }
}

impl View {
    fn clean(self) -> View {
        let finite = |v: f32, fallback: f32| if v.is_finite() { v } else { fallback };
        View { zoom: finite(self.zoom, 1.0).clamp(1.0, 4.0), x: finite(self.x, 50.0).clamp(0.0, 100.0), y: finite(self.y, 50.0).clamp(0.0, 100.0) }
    }
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct Texts {
    name: String,
    motto: String,
    avatar_view: View,
    banner_view: View,
    /// The picture's frame (D-150): its shape and the ring around it.
    shape: String,
    ring: String,
}

const SHAPES: &[&str] = &["circle", "rounded", "hexagon"];
const RINGS: &[&str] = &["rainbow", "accent", "gold", "none"];

/// The profile as the app shows it: the pictures as data URLs, ready to draw.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub name: String,
    pub motto: String,
    pub avatar: Option<String>,
    pub banner: Option<String>,
    pub avatar_view: View,
    pub banner_view: View,
    pub shape: String,
    pub ring: String,
}

fn dir(app: &AppHandle) -> AppResult<PathBuf> {
    Ok(crate::config::config_dir(app)?.join("profile"))
}

fn read_texts(dir: &Path) -> Texts {
    std::fs::read_to_string(dir.join("profile.json")).ok().and_then(|text| serde_json::from_str(&text).ok()).unwrap_or_default()
}

fn picture(dir: &Path, kind: &str) -> Option<String> {
    let bytes = std::fs::read(dir.join(format!("{kind}.jpg"))).ok()?;
    Some(format!("data:image/jpeg;base64,{}", crate::tools::base64(&bytes)))
}

fn write_texts(dir: &Path, texts: &Texts) -> AppResult<()> {
    std::fs::create_dir_all(dir)?;
    let json = serde_json::to_vec_pretty(texts).map_err(|e| AppError::msg(e.to_string()))?;
    std::fs::write(dir.join("profile.json"), json)?;
    Ok(())
}

fn kind_of(kind: &str) -> AppResult<(&'static str, u32)> {
    match kind {
        "avatar" => Ok(("avatar", AVATAR)),
        "banner" => Ok(("banner", BANNER)),
        _ => Err(AppError::msg("That isn't a part of the profile.")),
    }
}

/// The whole picture, no bigger than `most` on its longer side, as a JPEG.
fn bounded(picture: &DynamicImage, most: u32) -> AppResult<Vec<u8>> {
    let fitted = if picture.width().max(picture.height()) > most { picture.resize(most, most, FilterType::CatmullRom) } else { picture.clone() }.to_rgb8();
    let mut jpeg = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, 88)
        .encode_image(&fitted)
        .map_err(|e| AppError::msg(format!("The picture couldn't be saved: {e}")))?;
    Ok(jpeg)
}

#[tauri::command]
pub fn profile_get(app: AppHandle) -> AppResult<Profile> {
    let dir = dir(&app)?;
    let texts = read_texts(&dir);
    Ok(Profile {
        name: texts.name,
        motto: texts.motto,
        avatar: picture(&dir, "avatar"),
        banner: picture(&dir, "banner"),
        avatar_view: texts.avatar_view.clean(),
        banner_view: texts.banner_view.clean(),
        shape: if SHAPES.contains(&texts.shape.as_str()) { texts.shape } else { "circle".into() },
        ring: if RINGS.contains(&texts.ring.as_str()) { texts.ring } else { "rainbow".into() },
    })
}

/// The profile's name and its line.
#[tauri::command]
pub fn profile_set_text(app: AppHandle, name: String, motto: String) -> AppResult<()> {
    let dir = dir(&app)?;
    let clean = |text: &str, most: usize| text.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(most).collect::<String>();
    let mut texts = read_texts(&dir);
    texts.name = clean(&name, 40);
    texts.motto = clean(&motto, 120);
    write_texts(&dir, &texts)
}

/// How the picture or the banner sits in its frame (D-150).
#[tauri::command]
pub fn profile_set_view(app: AppHandle, kind: String, view: View) -> AppResult<()> {
    let (name, _) = kind_of(&kind)?;
    let dir = dir(&app)?;
    let mut texts = read_texts(&dir);
    if name == "avatar" {
        texts.avatar_view = view.clean();
    } else {
        texts.banner_view = view.clean();
    }
    write_texts(&dir, &texts)
}

/// The picture's frame (D-150): a circle, a rounded square or a hexagon; a rainbow, accent, gold or no ring.
#[tauri::command]
pub fn profile_set_frame(app: AppHandle, shape: String, ring: String) -> AppResult<()> {
    if !SHAPES.contains(&shape.as_str()) || !RINGS.contains(&ring.as_str()) {
        return Err(AppError::msg("That frame isn't one Digitify has."));
    }
    let dir = dir(&app)?;
    let mut texts = read_texts(&dir);
    texts.shape = shape;
    texts.ring = ring;
    write_texts(&dir, &texts)
}

/// A picture of the user's (`path`) or a cover from the library (`artwork`, its key) as the
/// profile's picture or banner, cut to its shape.
#[tauri::command]
pub async fn profile_set_image(app: AppHandle, state: State<'_, AppState>, kind: String, path: Option<String>, artwork: Option<String>) -> AppResult<()> {
    let (name, size) = kind_of(&kind)?;
    let source = match (path, artwork) {
        (Some(path), _) => PathBuf::from(path),
        (None, Some(key)) => {
            if key.is_empty() || key.len() > 64 || !key.bytes().all(|b| b.is_ascii_alphanumeric()) {
                return Err(AppError::msg("That cover isn't one Digitify knows."));
            }
            state.library()?.folder.covers_dir().join(format!("{key}.jpg"))
        }
        (None, None) => return Err(AppError::msg("Choose a picture.")),
    };
    let dir = dir(&app)?;
    crate::library::blocking(move || {
        let picture = image::open(&source).map_err(|_| AppError::msg("That picture couldn't be read."))?;
        let jpeg = bounded(&picture, size)?;
        std::fs::create_dir_all(&dir)?;
        std::fs::write(dir.join(format!("{name}.jpg")), jpeg)?;
        // A new picture starts centred, not zoomed.
        let mut texts = read_texts(&dir);
        if name == "avatar" {
            texts.avatar_view = View::default();
        } else {
            texts.banner_view = View::default();
        }
        write_texts(&dir, &texts)
    })
    .await
}

#[tauri::command]
pub fn profile_clear_image(app: AppHandle, kind: String) -> AppResult<()> {
    let (name, _) = kind_of(&kind)?;
    let file = dir(&app)?.join(format!("{name}.jpg"));
    if file.exists() {
        std::fs::remove_file(file)?;
    }
    Ok(())
}

/// Saves the profile's share card (a PNG the app drew, sent as the request's body) where the user
/// chose (the `path` header, from the save dialog).
#[tauri::command]
pub fn profile_save_png(request: Request<'_>) -> AppResult<()> {
    let path = request.headers().get("path").and_then(|v| v.to_str().ok()).map(|p| percent_decode(p)).ok_or_else(|| AppError::msg("Choose where to save the picture."))?;
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err(AppError::msg("The picture didn't arrive."));
    };
    if !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err(AppError::msg("That isn't a PNG picture."));
    }
    let path = PathBuf::from(path);
    if !path.extension().is_some_and(|e| e.eq_ignore_ascii_case("png")) {
        return Err(AppError::msg("The picture is saved as a .png file."));
    }
    std::fs::write(path, bytes)?;
    Ok(())
}

/// Headers carry the path percent-encoded (it may hold any character).
fn percent_decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(byte) = u8::from_str_radix(&text[i + 1..i + 3], 16) {
                out.push(byte);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pictures_stay_whole_views_stay_in_range_and_paths_decode() {
        let wide = DynamicImage::new_rgb8(3000, 900);
        let back = image::load_from_memory(&bounded(&wide, AVATAR).unwrap()).unwrap();
        assert_eq!((back.width(), back.height()), (1200, 360), "whole, no bigger than 1200");
        let small = DynamicImage::new_rgb8(400, 600);
        let back = image::load_from_memory(&bounded(&small, BANNER).unwrap()).unwrap();
        assert_eq!((back.width(), back.height()), (400, 600), "a small one isn't enlarged");
        assert_eq!(View { zoom: 9.0, x: -5.0, y: f32::NAN }.clean(), View { zoom: 4.0, x: 0.0, y: 50.0 });
        let old: Texts = serde_json::from_str(r#"{"name":"A","motto":"B"}"#).unwrap();
        assert_eq!((old.avatar_view, old.shape.as_str()), (View::default(), ""), "a profile saved before D-150 reads with the defaults");
        assert!(kind_of("wallpaper").is_err());
        assert_eq!(percent_decode("C%3A%5CUsers%5Cme%5CMi%20perfil%20%C3%B1.png"), "C:\\Users\\me\\Mi perfil ñ.png");
    }
}

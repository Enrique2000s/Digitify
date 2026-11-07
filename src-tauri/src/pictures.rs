//! Pictures (D-033): photos as items of their own, shown in a gallery and an image viewer.
//!
//! Each photo keeps its original file untouched. What Digitify knows about it comes from the file
//! (size, EXIF: date taken, camera, exposure, location, orientation) and from the viewer (a
//! rotation or flip chosen there, applied to the thumbnail and the viewer only).

use std::path::{Path, PathBuf};

use image::{DynamicImage, ImageDecoder, ImageReader};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use tauri::State;

use crate::error::{AppError, AppResult};
use crate::library::with_library;
use crate::{artwork, AppState, Library};


/// What a photo file says about itself, as item metadata (camelCase keys).
pub fn describe(path: &Path) -> Map<String, Value> {
    let mut meta = Map::new();
    let exif = read_exif(path);
    let orientation = exif.as_ref().and_then(|e| uint(e, exif::Tag::Orientation)).unwrap_or(1);
    if let Ok(size) = imagesize::size(path) {
        let (mut width, mut height) = (size.width as u64, size.height as u64);
        // Orientations 5–8 turn the picture a quarter: what is shown is the other way round.
        if (5..=8).contains(&orientation) {
            std::mem::swap(&mut width, &mut height);
        }
        meta.insert("width".into(), json!(width));
        meta.insert("height".into(), json!(height));
    }
    meta.insert("orientation".into(), json!(orientation));
    // When the photo doesn't say when it was taken (screenshots, edited copies), its file's date
    // places it in "Date taken" order instead.
    if let Some(modified) = std::fs::metadata(path).ok().as_ref().and_then(crate::files::modified_unix) {
        meta.insert("fileDate".into(), json!(modified));
    }
    let Some(exif) = exif else { return meta };
    if let Some(taken) = taken(&exif) {
        meta.insert("taken".into(), json!(taken));
    }
    let make = text(&exif, exif::Tag::Make);
    let model = text(&exif, exif::Tag::Model);
    let camera = match (make, model) {
        // Most models already start with the maker's name ("Canon EOS R6").
        (Some(make), Some(model)) if model.to_lowercase().starts_with(&make.to_lowercase().split_whitespace().next().unwrap_or_default()) => Some(model),
        (Some(make), Some(model)) => Some(format!("{make} {model}")),
        (make, model) => make.or(model),
    };
    if let Some(camera) = camera {
        meta.insert("camera".into(), json!(camera));
    }
    if let Some(lens) = text(&exif, exif::Tag::LensModel) {
        meta.insert("lens".into(), json!(lens));
    }
    let mut exposure = Vec::new();
    if let Some(value) = rational(&exif, exif::Tag::ExposureTime) {
        exposure.push(if value > 0.0 && value < 1.0 { format!("1/{} s", (1.0 / value).round()) } else { format!("{value} s") });
    }
    if let Some(value) = rational(&exif, exif::Tag::FNumber) {
        exposure.push(format!("f/{}", trim(value)));
    }
    if let Some(value) = uint(&exif, exif::Tag::PhotographicSensitivity) {
        exposure.push(format!("ISO {value}"));
    }
    if let Some(value) = rational(&exif, exif::Tag::FocalLength) {
        exposure.push(format!("{} mm", trim(value)));
    }
    if !exposure.is_empty() {
        meta.insert("exposure".into(), json!(exposure.join(" · ")));
    }
    if let Some((lat, lon)) = location(&exif) {
        meta.insert("location".into(), json!({ "lat": lat, "lon": lon }));
    }
    meta
}

fn read_exif(path: &Path) -> Option<exif::Exif> {
    let file = std::fs::File::open(path).ok()?;
    exif::Reader::new().read_from_container(&mut std::io::BufReader::new(file)).ok()
}

fn field(exif: &exif::Exif, tag: exif::Tag) -> Option<&exif::Field> {
    exif.get_field(tag, exif::In::PRIMARY)
}

fn uint(exif: &exif::Exif, tag: exif::Tag) -> Option<u32> {
    field(exif, tag)?.value.get_uint(0)
}

fn rational(exif: &exif::Exif, tag: exif::Tag) -> Option<f64> {
    match &field(exif, tag)?.value {
        exif::Value::Rational(values) => values.first().filter(|r| r.denom != 0).map(|r| r.to_f64()),
        _ => None,
    }
}

fn text(exif: &exif::Exif, tag: exif::Tag) -> Option<String> {
    match &field(exif, tag)?.value {
        exif::Value::Ascii(parts) => {
            let joined = parts.iter().map(|p| String::from_utf8_lossy(p).trim_matches(char::from(0)).trim().to_string()).collect::<Vec<_>>().join(" ");
            let joined = joined.trim().to_string();
            (!joined.is_empty()).then_some(joined)
        }
        _ => None,
    }
}

fn trim(value: f64) -> String {
    let text = format!("{value:.1}");
    text.strip_suffix(".0").map(str::to_string).unwrap_or(text)
}

/// "2024:07:14 18:03:22" → "2024-07-14T18:03:22".
fn taken(exif: &exif::Exif) -> Option<String> {
    let raw = text(exif, exif::Tag::DateTimeOriginal).or_else(|| text(exif, exif::Tag::DateTime))?;
    let (date, time) = raw.split_once(' ')?;
    let date = date.replace(':', "-");
    let valid = date.len() == 10 && date[..4].chars().all(|c| c.is_ascii_digit()) && &date[..4] != "0000";
    valid.then(|| format!("{date}T{}", time.get(..8).unwrap_or(time)))
}

fn location(exif: &exif::Exif) -> Option<(f64, f64)> {
    let coordinate = |value: exif::Tag, reference: exif::Tag, negative: &str| -> Option<f64> {
        let exif::Value::Rational(parts) = &field(exif, value)?.value else { return None };
        if parts.len() < 3 || parts.iter().any(|p| p.denom == 0) {
            return None;
        }
        let degrees = parts[0].to_f64() + parts[1].to_f64() / 60.0 + parts[2].to_f64() / 3600.0;
        let sign = if text(exif, reference).is_some_and(|r| r.eq_ignore_ascii_case(negative)) { -1.0 } else { 1.0 };
        Some(degrees * sign)
    };
    let lat = coordinate(exif::Tag::GPSLatitude, exif::Tag::GPSLatitudeRef, "S")?;
    let lon = coordinate(exif::Tag::GPSLongitude, exif::Tag::GPSLongitudeRef, "W")?;
    (lat.abs() <= 90.0 && lon.abs() <= 180.0 && (lat, lon) != (0.0, 0.0)).then_some((lat, lon))
}

/// A turn or mirror chosen in the viewer (D-033). Never written to the file.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct View {
    /// Quarter turns clockwise: 0, 90, 180 or 270.
    pub rotate: u16,
    pub flip_h: bool,
    pub flip_v: bool,
}

impl View {
    pub fn from_metadata(meta: &Map<String, Value>) -> Self {
        meta.get("view").cloned().and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default()
    }
}

/// The photo, upright as its camera meant it and with the viewer's turn applied.
pub fn load(path: &Path, view: View) -> AppResult<DynamicImage> {
    let reader = ImageReader::open(path)?.with_guessed_format()?;
    let mut decoder = reader.into_decoder().map_err(|e| AppError::msg(format!("unreadable image: {e}")))?;
    let orientation = decoder.orientation().unwrap_or(image::metadata::Orientation::NoTransforms);
    let mut image = DynamicImage::from_decoder(decoder).map_err(|e| AppError::msg(format!("unreadable image: {e}")))?;
    image.apply_orientation(orientation);
    image = match view.rotate % 360 {
        90 => image.rotate90(),
        180 => image.rotate180(),
        270 => image.rotate270(),
        _ => image,
    };
    if view.flip_h {
        image = image.fliph();
    }
    if view.flip_v {
        image = image.flipv();
    }
    Ok(image)
}

/// Thumbnail and cover for a photo (upright, with the viewer's turn).
pub fn store_artwork(library: &Library, path: &Path, view: View) -> AppResult<artwork::Artwork> {
    let image = load(path, view)?;
    artwork::store_image(&library.folder, image, &format!("{}:{view:?}", path.display()))
}

/// The file behind a picture item.
pub fn file_of(library: &Library, item: i64) -> AppResult<PathBuf> {
    library.db.with(|conn| {
        let row: Option<(String, String)> = conn
            .query_row(
                "SELECT f.path, f.storage FROM files f JOIN versions v ON v.id = f.version_id \
                 JOIN items i ON i.id = v.item_id JOIN categories c ON c.id = i.category_id \
                 WHERE v.item_id = ?1 AND c.handler = 'image' ORDER BY f.id LIMIT 1",
                [item],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;
        let (stored, storage) = row.ok_or_else(|| AppError::msg(format!("item {item} isn't a picture")))?;
        Ok(library.folder.resolve(&stored, &storage))
    })
}

/// What the viewer may show as-is; anything else (TIFF) is converted on the way.
pub fn shown_directly(path: &Path) -> Option<&'static str> {
    match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "jpg" | "jpeg" => Some("image/jpeg"),
        "png" => Some("image/png"),
        "webp" => Some("image/webp"),
        "gif" => Some("image/gif"),
        "bmp" => Some("image/bmp"),
        _ => None,
    }
}

/// Turns or mirrors a photo in Digitify (thumbnail, cover and viewer), never in its file.
#[tauri::command]
pub async fn picture_set_view(state: State<'_, AppState>, id: i64, view: View) -> AppResult<()> {
    if !matches!(view.rotate, 0 | 90 | 180 | 270) {
        return Err(AppError::msg("a picture turns in quarter turns"));
    }
    with_library(&state, move |library| {
        let path = file_of(library, id)?;
        let art = store_artwork(library, &path, view)?;
        let (width, height) = library.db.with(|conn| {
            let meta: String = conn.query_row("SELECT metadata FROM items WHERE id = ?1", [id], |row| row.get(0))?;
            let meta: Map<String, Value> = serde_json::from_str(&meta).unwrap_or_default();
            Ok((meta.get("width").and_then(Value::as_i64), meta.get("height").and_then(Value::as_i64)))
        })?;
        let old = library.db.with(|conn| {
            let meta: String = conn.query_row("SELECT metadata FROM items WHERE id = ?1", [id], |row| row.get(0))?;
            Ok(View::from_metadata(&serde_json::from_str(&meta).unwrap_or_default()))
        })?;
        // A quarter turn more or less than before swaps the shown width and height.
        let swap = (view.rotate / 90 + old.rotate / 90) % 2 == 1;
        let (width, height) = if swap { (height, width) } else { (width, height) };
        library.db.with(|conn| {
            conn.execute(
                "UPDATE items SET cover_key = ?2, cover_color = ?3, \
                   metadata = json_set(metadata, '$.view', json(?4), '$.width', ?5, '$.height', ?6), \
                   updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?1",
                params![id, art.key, art.color, serde_json::to_string(&view).unwrap_or_default(), width, height],
            )?;
            Ok(())
        })
    })
    .await
}

/// Uses an item's cover as its collection's (an album's) cover; `None` goes back to the collage.
#[tauri::command]
pub async fn collection_set_cover(state: State<'_, AppState>, id: i64, item: Option<i64>) -> AppResult<()> {
    with_library(&state, move |library| {
        library.db.with(|conn| {
            let key: Option<String> = match item {
                Some(item) => Some(
                    conn.query_row("SELECT cover_key FROM items WHERE id = ?1", [item], |row| row.get::<_, Option<String>>(0))?
                        .ok_or_else(|| AppError::msg("that item has no cover"))?,
                ),
                None => None,
            };
            let changed = conn.execute(
                "UPDATE collections SET cover_key = ?2, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?1",
                params![id, key],
            )?;
            if changed == 0 {
                return Err(AppError::msg("that collection no longer exists"));
            }
            Ok(())
        })
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exposure_numbers_read_cleanly() {
        assert_eq!(trim(2.8), "2.8");
        assert_eq!(trim(35.0), "35");
    }

    #[test]
    fn a_turn_is_stored_in_metadata_and_read_back() {
        let mut meta = Map::new();
        meta.insert("view".into(), json!({ "rotate": 90, "flipH": true }));
        assert_eq!(View::from_metadata(&meta), View { rotate: 90, flip_h: true, flip_v: false });
        assert_eq!(View::from_metadata(&Map::new()), View::default());
    }
}

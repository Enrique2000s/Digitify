//! Cover artwork cache. Each image is stored once, keyed by its content hash, as a full-size cover
//! and a grid thumbnail, together with its average color for shelf spines and tinted backgrounds.

use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use image::{DynamicImage, GenericImageView};

use crate::error::{AppError, AppResult};
use crate::library_folder::LibraryFolder;

const COVER_MAX: u32 = 1400;
const THUMB_WIDTH: u32 = 400;

pub struct Artwork {
    pub key: String,
    pub color: String,
}

pub fn store(folder: &LibraryFolder, bytes: &[u8]) -> AppResult<Artwork> {
    let key = blake3::hash(bytes).to_hex()[..32].to_string();
    let decoded = image::load_from_memory(bytes).map_err(|e| AppError::msg(format!("unreadable image: {e}")))?;
    let image = DynamicImage::ImageRgb8(decoded.to_rgb8());
    let (width, height) = image.dimensions();

    let cover_path = folder.covers_dir().join(format!("{key}.jpg"));
    if !cover_path.exists() {
        let cover = if width.max(height) > COVER_MAX {
            image.resize(COVER_MAX, COVER_MAX, FilterType::CatmullRom)
        } else {
            image.clone()
        };
        write_jpeg(&cover, &cover_path, 88)?;
    }

    let thumb = if width > THUMB_WIDTH {
        image.resize(THUMB_WIDTH, THUMB_WIDTH * 2, FilterType::Triangle)
    } else {
        image
    };
    let thumb_path = folder.thumbs_dir().join(format!("{key}.jpg"));
    if !thumb_path.exists() {
        write_jpeg(&thumb, &thumb_path, 82)?;
    }
    Ok(Artwork { key, color: average_color(&thumb) })
}

/// Writes through a temporary file so a crash never leaves a half-written image behind.
fn write_jpeg(image: &DynamicImage, path: &Path, quality: u8) -> AppResult<()> {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let mut buffer = Vec::new();
    JpegEncoder::new_with_quality(&mut buffer, quality)
        .encode_image(image)
        .map_err(|e| AppError::msg(format!("could not encode artwork: {e}")))?;
    let temporary = path.with_extension(format!("{}.tmp", COUNTER.fetch_add(1, Ordering::Relaxed)));
    fs::write(&temporary, &buffer)?;
    if fs::rename(&temporary, path).is_err() {
        // Another import stored the same artwork at the same moment; theirs is identical.
        let _ = fs::remove_file(&temporary);
    }
    Ok(())
}

fn average_color(image: &DynamicImage) -> String {
    let rgb = image.to_rgb8();
    let (mut r, mut g, mut b, mut n) = (0u64, 0u64, 0u64, 0u64);
    for pixel in rgb.pixels().step_by(7) {
        r += u64::from(pixel[0]);
        g += u64::from(pixel[1]);
        b += u64::from(pixel[2]);
        n += 1;
    }
    let n = n.max(1);
    format!("#{:02x}{:02x}{:02x}", r / n, g / n, b / n)
}

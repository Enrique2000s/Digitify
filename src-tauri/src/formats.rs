//! Readers for metadata embedded in media files: EPUB package data, ComicInfo.xml in comic
//! archives, audio tags, and video stream information (via ffprobe). Everything here is offline
//! and read-only: files are never modified (D-009).

use std::fs::File;
use std::io::Read;
use std::path::Path;

use lofty::picture::PictureType;
use lofty::prelude::*;
use roxmltree::{Document, Node, ParsingOptions};
use serde_json::{json, Value};
use zip::ZipArchive;

use crate::{archives, tools};

const MAX_ENTRY: u64 = 64 * 1024 * 1024;

/// Some EPUB 2 packages still carry a DOCTYPE.
pub(crate) fn parse_xml(text: &str) -> Option<Document<'_>> {
    Document::parse_with_options(text, ParsingOptions { allow_dtd: true, ..ParsingOptions::default() }).ok()
}

pub(crate) fn read_entry(zip: &mut ZipArchive<File>, name: &str) -> Option<Vec<u8>> {
    let entry = zip.by_name(name).ok()?;
    if entry.size() > MAX_ENTRY {
        return None; // refuse oversized entries (zip bombs)
    }
    let mut bytes = Vec::with_capacity(entry.size() as usize);
    entry.take(MAX_ENTRY).read_to_end(&mut bytes).ok()?;
    Some(bytes)
}

fn text_of(node: Node) -> Option<String> {
    let text: String = node.descendants().filter(|n| n.is_text()).filter_map(|n| n.text()).collect();
    let text = text.split_whitespace().collect::<Vec<_>>().join(" ");
    (!text.is_empty()).then_some(text)
}

/// Removes HTML tags and decodes the common entities (EPUB descriptions often contain markup).
pub fn strip_html(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut in_tag = false;
    for c in html.chars() {
        match c {
            '<' => in_tag = true,
            '>' if in_tag => {
                in_tag = false;
                out.push(' ');
            }
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    let decoded = out
        .replace("&nbsp;", " ")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&");
    decoded.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// First four-digit year in a date string such as "1851-10-18" or "c. 1605".
pub fn year_of(text: &str) -> Option<i64> {
    text.as_bytes()
        .windows(4)
        .find(|w| w.iter().all(u8::is_ascii_digit))
        .and_then(|w| std::str::from_utf8(w).ok()?.parse().ok())
        .filter(|year| (1000..=2200).contains(year))
}

fn isbn_of(identifier: &str) -> Option<String> {
    let digits: String = identifier
        .trim_start_matches("urn:isbn:")
        .chars()
        .filter(|c| c.is_ascii_digit() || *c == 'X' || *c == 'x')
        .collect();
    matches!(digits.len(), 10 | 13).then(|| digits.to_uppercase())
}

/// Resolves an href relative to the OPF folder inside the archive, decoding %XX escapes.
fn zip_path(base: &str, href: &str) -> String {
    let mut decoded = Vec::new();
    let bytes = href.split('#').next().unwrap_or_default().as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(value) = u8::from_str_radix(std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("zz"), 16) {
                decoded.push(value);
                i += 3;
                continue;
            }
        }
        decoded.push(bytes[i]);
        i += 1;
    }
    let href = String::from_utf8_lossy(&decoded).into_owned();
    let mut parts: Vec<&str> = if base.is_empty() { Vec::new() } else { base.split('/').collect() };
    for segment in href.split('/') {
        match segment {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            _ => parts.push(segment),
        }
    }
    parts.join("/")
}

// ---------------------------------------------------------------------------------------------

#[derive(Debug, Default)]
pub struct EbookInfo {
    pub title: Option<String>,
    pub creators: Vec<String>,
    pub publisher: Option<String>,
    pub year: Option<i64>,
    pub description: Option<String>,
    pub isbn: Option<String>,
    pub language: Option<String>,
    pub cover: Option<Vec<u8>>,
}

pub fn read_epub(path: &Path) -> Option<EbookInfo> {
    let mut zip = ZipArchive::new(File::open(path).ok()?).ok()?;
    let container_xml = String::from_utf8(read_entry(&mut zip, "META-INF/container.xml")?).ok()?;
    let opf_path = parse_xml(&container_xml)?
        .descendants()
        .find(|n| n.tag_name().name() == "rootfile")?
        .attribute("full-path")?
        .to_string();
    let opf = String::from_utf8(read_entry(&mut zip, &opf_path)?).ok()?;
    let doc = parse_xml(&opf)?;
    let first = |name: &str| doc.descendants().find(|n| n.tag_name().name() == name).and_then(text_of);

    let mut info = EbookInfo {
        title: first("title"),
        creators: doc
            .descendants()
            .filter(|n| n.tag_name().name() == "creator")
            .filter_map(text_of)
            .collect(),
        publisher: first("publisher"),
        year: first("date").as_deref().and_then(year_of),
        description: first("description").map(|d| strip_html(&d)).filter(|d| !d.is_empty()),
        isbn: doc
            .descendants()
            .filter(|n| n.tag_name().name() == "identifier")
            .filter_map(text_of)
            .find_map(|id| isbn_of(&id)),
        language: first("language"),
        cover: None,
    };

    let items: Vec<Node> = doc.descendants().filter(|n| n.tag_name().name() == "item").collect();
    let cover_id = doc
        .descendants()
        .find(|n| n.tag_name().name() == "meta" && n.attribute("name") == Some("cover"))
        .and_then(|n| n.attribute("content"));
    let cover_href = items
        .iter()
        .find(|n| n.attribute("properties").is_some_and(|p| p.split_whitespace().any(|p| p == "cover-image")))
        .or_else(|| cover_id.and_then(|id| items.iter().find(|n| n.attribute("id") == Some(id))))
        .and_then(|n| n.attribute("href"));
    if let Some(href) = cover_href {
        let base = opf_path.rsplit_once('/').map(|(dir, _)| dir).unwrap_or("");
        info.cover = read_entry(&mut zip, &zip_path(base, href));
    }
    Some(info)
}

// ---------------------------------------------------------------------------------------------

#[derive(Debug, Default)]
pub struct ComicInfo {
    pub title: Option<String>,
    pub series: Option<String>,
    pub number: Option<String>,
    pub volume: Option<String>,
    pub year: Option<i64>,
    pub writer: Option<String>,
    pub artist: Option<String>,
    pub publisher: Option<String>,
    pub summary: Option<String>,
    pub manga: bool,
}

pub struct ComicArchive {
    pub info: Option<ComicInfo>,
    pub cover: Option<Vec<u8>>,
    pub pages: usize,
}

/// Reads a comic archive (CBZ, CBR, CB7 or CBT): its ComicInfo.xml (the ComicRack metadata
/// standard), its page count and its first page as the cover.
pub fn read_comic(path: &Path) -> Option<ComicArchive> {
    let format = archives::detect(path).ok()?;
    let names = archives::entries(path, format).ok()?;
    let pages = archives::pages(&names);
    let cover = pages.first().and_then(|name| archives::read(path, format, name).ok());
    let info = names
        .iter()
        .find(|n| n.to_ascii_lowercase().ends_with("comicinfo.xml"))
        .and_then(|name| archives::read(path, format, name).ok())
        .and_then(|bytes| String::from_utf8(bytes).ok())
        .and_then(|xml| parse_comic_info(&xml));
    Some(ComicArchive { info, cover, pages: pages.len() })
}

fn parse_comic_info(xml: &str) -> Option<ComicInfo> {
    let doc = parse_xml(xml)?;
    let field =|name: &str| doc.descendants().find(|n| n.tag_name().name() == name).and_then(text_of);
    let manga = field("Manga").is_some_and(|m| m.to_ascii_lowercase().starts_with("yes"));
    Some(ComicInfo {
        title: field("Title"),
        series: field("Series"),
        number: field("Number"),
        volume: field("Volume"),
        year: field("Year").and_then(|y| y.parse().ok()),
        writer: field("Writer"),
        artist: field("Penciller").or_else(|| field("Artist")),
        publisher: field("Publisher"),
        summary: field("Summary"),
        manga,
    })
}

// ---------------------------------------------------------------------------------------------

#[derive(Debug, Default)]
pub struct TrackInfo {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub track: Option<u32>,
    pub disc: Option<u32>,
    pub year: Option<i64>,
    pub genre: Option<String>,
    pub duration_ms: Option<i64>,
    pub cover: Option<Vec<u8>>,
}

fn non_empty(text: Option<std::borrow::Cow<'_, str>>) -> Option<String> {
    text.map(|t| t.trim().to_string()).filter(|t| !t.is_empty())
}

pub fn read_track(path: &Path, want_cover: bool) -> TrackInfo {
    let Ok(tagged) = lofty::read_from_path(path) else {
        return TrackInfo::default();
    };
    let mut info = TrackInfo {
        duration_ms: Some(tagged.properties().duration().as_millis() as i64).filter(|ms| *ms > 0),
        ..TrackInfo::default()
    };
    if let Some(tag) = tagged.primary_tag().or_else(|| tagged.first_tag()) {
        info.title = non_empty(tag.title());
        info.artist = non_empty(tag.artist());
        info.album = non_empty(tag.album());
        info.genre = non_empty(tag.genre());
        info.track = tag.track();
        info.disc = tag.disk();
        info.album_artist = tag.get_string(ItemKey::AlbumArtist).map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);
        info.year = [ItemKey::Year, ItemKey::RecordingDate, ItemKey::ReleaseDate]
            .into_iter()
            .find_map(|key| tag.get_string(key).and_then(year_of));
        if want_cover {
            let pictures = tag.pictures();
            info.cover = pictures
                .iter()
                .find(|p| p.pic_type() == PictureType::CoverFront)
                .or_else(|| pictures.first())
                .map(|p| p.data().to_vec());
        }
    }
    info
}

// ---------------------------------------------------------------------------------------------

#[derive(Debug, Default)]
pub struct VideoInfo {
    pub title: Option<String>,
    pub year: Option<i64>,
    pub duration: Option<f64>,
    pub details: Value,
}

/// Stream information through ffprobe: duration, resolution, codecs, audio and subtitle tracks.
pub fn probe_video(path: &Path) -> Option<VideoInfo> {
    let ffprobe = tools::find("ffprobe")?;
    let output = tools::command(&ffprobe)
        .args(["-v", "error", "-print_format", "json", "-show_format", "-show_streams", "-show_chapters"])
        .arg(path)
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let probe: Value = serde_json::from_slice(&output.stdout).ok()?;
    let format = &probe["format"];
    let tag = |tags: &Value, key: &str| {
        tags.as_object()?
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(key))
            .and_then(|(_, v)| v.as_str())
            .map(str::to_string)
    };
    let streams = probe["streams"].as_array().cloned().unwrap_or_default();
    let video = streams.iter().find(|s| s["codec_type"] == "video" && s["disposition"]["attached_pic"] != 1);
    let tracks = |kind: &str| -> Vec<Value> {
        streams
            .iter()
            .filter(|s| s["codec_type"] == kind)
            .map(|s| {
                json!({
                    "codec": s["codec_name"],
                    "language": tag(&s["tags"], "language"),
                    "title": tag(&s["tags"], "title"),
                    "channels": s["channels"],
                })
            })
            .collect()
    };
    let duration = format["duration"].as_str().and_then(|d| d.parse::<f64>().ok());
    Some(VideoInfo {
        title: tag(&format["tags"], "title").filter(|t| !t.trim().is_empty()),
        year: tag(&format["tags"], "date").or_else(|| tag(&format["tags"], "year")).as_deref().and_then(year_of),
        duration,
        details: json!({
            "durationSec": duration,
            "width": video.map(|v| v["width"].clone()),
            "height": video.map(|v| v["height"].clone()),
            "videoCodec": video.map(|v| v["codec_name"].clone()),
            "audioTracks": tracks("audio"),
            "subtitleTracks": tracks("subtitle"),
            "chapters": probe["chapters"].as_array().map_or(0, Vec::len),
        }),
    })
}

/// A still frame (JPEG) from `seconds` into the video, used as artwork until the user sets a poster.
pub fn video_frame(path: &Path, seconds: f64) -> Option<Vec<u8>> {
    let ffmpeg = tools::find("ffmpeg")?;
    let output = tools::command(&ffmpeg)
        .args(["-hide_banner", "-loglevel", "error", "-ss", &format!("{seconds:.2}"), "-i"])
        .arg(path)
        .args(["-frames:v", "1", "-vf", "scale='min(1280,iw)':-2", "-f", "image2pipe", "-c:v", "mjpeg", "-q:v", "3", "-"])
        .output()
        .ok()?;
    (output.status.success() && !output.stdout.is_empty()).then_some(output.stdout)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zip_paths_resolve_relative_and_escaped_hrefs() {
        assert_eq!(zip_path("OEBPS", "images/cover%20art.jpg"), "OEBPS/images/cover art.jpg");
        assert_eq!(zip_path("OEBPS/text", "../images/c.png#x"), "OEBPS/images/c.png");
        assert_eq!(zip_path("", "cover.jpg"), "cover.jpg");
    }

    #[test]
    fn metadata_helpers() {
        assert_eq!(year_of("1851-10-18"), Some(1851));
        assert_eq!(year_of("unknown"), None);
        assert_eq!(isbn_of("urn:isbn:978-0-14-143951-8").as_deref(), Some("9780141439518"));
        assert_eq!(strip_html("<p>Call me <i>Ishmael</i>.&nbsp;Some years ago&amp;</p>"), "Call me Ishmael . Some years ago&");
    }

    #[test]
    fn comic_info_detects_manga() {
        let info = parse_comic_info(
            "<ComicInfo><Series>Starfall</Series><Number>3</Number><Writer>A. Writer</Writer><Manga>YesAndRightToLeft</Manga></ComicInfo>",
        )
        .unwrap();
        assert_eq!(info.series.as_deref(), Some("Starfall"));
        assert!(info.manga);
    }
}

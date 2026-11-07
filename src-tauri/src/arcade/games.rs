//! Recognizing games on disk (D-034): GameCube and Wii discs for Dolphin, Nintendo 64 ROMs for
//! Project64 and RMG. Only each file's header is read, never the whole game.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

/// A console Arcade knows.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Platform {
    GameCube,
    Wii,
    N64,
}

impl Platform {
    pub fn key(self) -> &'static str {
        match self {
            Platform::GameCube => "gamecube",
            Platform::Wii => "wii",
            Platform::N64 => "n64",
        }
    }
}

/// What a game file says about itself.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GameInfo {
    pub platform: Platform,
    pub title: String,
    /// The disc's six-character ID (GALE01) or the cartridge's code (NSME), when the header has one.
    pub game_id: Option<String>,
}

/// Dolphin's disc and title formats.
pub const DOLPHIN_EXTENSIONS: [&str; 8] = ["iso", "gcm", "rvz", "wia", "wbfs", "ciso", "gcz", "wad"];
/// Nintendo 64 ROMs.
pub const N64_EXTENSIONS: [&str; 3] = ["z64", "n64", "v64"];

pub fn extension(path: &Path) -> String {
    path.extension().map(|e| e.to_string_lossy().to_ascii_lowercase()).unwrap_or_default()
}

/// Reads a game file's header; `None` when it isn't a game Arcade can launch.
pub fn identify(path: &Path) -> Option<GameInfo> {
    let ext = extension(path);
    let fallback = || title_from_name(path);
    if N64_EXTENSIONS.contains(&ext.as_str()) {
        let header = read_at(path, 0, 0x40)?;
        let (title, code) = n64_header(&header)?;
        // Internal names are short and in capitals ("SUPER MARIO 64"); a file name with lowercase
        // letters is usually the nicer title.
        let name = fallback();
        let title = if name.chars().any(|c| c.is_lowercase()) || title.is_empty() { name } else { title_case(&title) };
        return Some(GameInfo { platform: Platform::N64, title, game_id: code });
    }
    if !DOLPHIN_EXTENSIONS.contains(&ext.as_str()) {
        return None;
    }
    if ext == "wad" {
        // WiiWare and Virtual Console channels: their title lives in compressed banners.
        return Some(GameInfo { platform: Platform::Wii, title: fallback(), game_id: None });
    }
    if ext == "gcz" {
        // Compressed in blocks: the header isn't readable without decompressing; the file name it is.
        return Some(GameInfo { platform: Platform::GameCube, title: fallback(), game_id: None });
    }
    let disc = disc_header_offset(path, &ext)?;
    let header = read_at(path, disc.offset, disc.length)?;
    let (platform, id, title) = disc_header(&header, disc.platform_hint)?;
    // Some discs name themselves in capitals ("SUPER MARIO GALAXY"): shown in title case.
    let title = if title.is_empty() {
        fallback()
    } else if !title.chars().any(char::is_lowercase) {
        title_case(&title)
    } else {
        title
    };
    Some(GameInfo { platform, title, game_id: Some(id) })
}

struct DiscHeader {
    offset: u64,
    length: usize,
    /// For containers that say which console the disc is for (WIA/RVZ).
    platform_hint: Option<Platform>,
}

/// Where a container keeps (a copy of) the disc header.
fn disc_header_offset(path: &Path, ext: &str) -> Option<DiscHeader> {
    match ext {
        "iso" | "gcm" => Some(DiscHeader { offset: 0, length: 0x60, platform_hint: None }),
        // CISO: a 0x8000-byte block map, then the disc as it is.
        "ciso" => Some(DiscHeader { offset: 0x8000, length: 0x60, platform_hint: None }),
        "wia" | "rvz" => {
            // Header 1 (0x48 bytes), then header 2: disc type (1 GameCube, 2 Wii), compression,
            // level, chunk size, and the first 0x80 bytes of the disc.
            let head = read_at(path, 0, 0x48 + 0x10 + 0x80)?;
            if &head[0..3] != b"WIA" && &head[0..3] != b"RVZ" {
                return None;
            }
            let disc_type = u32::from_be_bytes(head[0x48..0x4C].try_into().ok()?);
            let hint = match disc_type {
                1 => Some(Platform::GameCube),
                2 => Some(Platform::Wii),
                _ => None,
            };
            Some(DiscHeader { offset: 0x58, length: 0x60, platform_hint: hint })
        }
        "wbfs" => {
            // "WBFS", sector count, then the sector size as a power of two; the first disc's
            // header copy starts at the first sector.
            let head = read_at(path, 0, 12)?;
            if &head[0..4] != b"WBFS" {
                return None;
            }
            let shift = u32::from(head[8]);
            (9..=24).contains(&shift).then(|| DiscHeader { offset: 1u64 << shift, length: 0x60, platform_hint: Some(Platform::Wii) })
        }
        _ => None,
    }
}

/// ID, console and title from a GameCube or Wii disc header (its first 0x60 bytes).
fn disc_header(header: &[u8], hint: Option<Platform>) -> Option<(Platform, String, String)> {
    if header.len() < 0x40 {
        return None;
    }
    let wii_magic = u32::from_be_bytes(header[0x18..0x1C].try_into().ok()?) == 0x5D1C_9EA3;
    let gc_magic = u32::from_be_bytes(header[0x1C..0x20].try_into().ok()?) == 0xC233_9F3D;
    let platform = if wii_magic {
        Platform::Wii
    } else if gc_magic {
        Platform::GameCube
    } else {
        hint?
    };
    let id: String = header[0..6].iter().map(|&b| b as char).collect();
    if !id.chars().all(|c| c.is_ascii_alphanumeric()) {
        return None;
    }
    Some((platform, id, clean_text(&header[0x20..header.len().min(0x60)])))
}

/// Title and game code from a Nintendo 64 ROM header, in any of the three byte orders.
fn n64_header(raw: &[u8]) -> Option<(String, Option<String>)> {
    if raw.len() < 0x40 {
        return None;
    }
    let mut header = raw.to_vec();
    match &raw[0..4] {
        [0x80, 0x37, 0x12, 0x40] => {}
        // .v64: every two bytes swapped.
        [0x37, 0x80, 0x40, 0x12] => header.chunks_exact_mut(2).for_each(|pair| pair.swap(0, 1)),
        // .n64: every four bytes reversed.
        [0x40, 0x12, 0x37, 0x80] => header.chunks_exact_mut(4).for_each(|word| word.reverse()),
        _ => return None,
    }
    let title = clean_text(&header[0x20..0x34]);
    let code: String = header[0x3B..0x3F].iter().map(|&b| b as char).collect();
    let code = code.chars().all(|c| c.is_ascii_alphanumeric()).then_some(code);
    Some((title, code))
}

fn clean_text(bytes: &[u8]) -> String {
    let end = bytes.iter().position(|&b| b == 0).unwrap_or(bytes.len());
    let text = String::from_utf8_lossy(&bytes[..end]);
    let text: String = text.chars().filter(|c| !c.is_control() && *c != '\u{FFFD}').collect();
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn title_case(text: &str) -> String {
    text.split_whitespace()
        .map(|word| {
            let lower = word.to_lowercase();
            let mut chars = lower.chars();
            match chars.next() {
                Some(_) if word.chars().any(|c| c.is_ascii_digit()) && word.len() <= 3 => word.to_string(),
                Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// "Super Mario Sunshine (USA) [!].rvz" → "Super Mario Sunshine (USA)": tags in square brackets
/// go, the region stays.
pub fn title_from_name(path: &Path) -> String {
    let stem = path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let mut out = String::new();
    let mut depth = 0;
    for c in stem.chars() {
        match c {
            '[' => depth += 1,
            ']' if depth > 0 => depth -= 1,
            _ if depth == 0 => out.push(if c == '_' { ' ' } else { c }),
            _ => {}
        }
    }
    let title = out.split_whitespace().collect::<Vec<_>>().join(" ");
    if title.is_empty() { "Untitled".into() } else { title }
}

fn read_at(path: &Path, offset: u64, length: usize) -> Option<Vec<u8>> {
    let mut file = File::open(path).ok()?;
    file.seek(SeekFrom::Start(offset)).ok()?;
    let mut buffer = vec![0u8; length];
    file.read_exact(&mut buffer).ok()?;
    Some(buffer)
}

/// libretro-thumbnails' collection for a console (D-035).
pub fn libretro_system(platform: &str) -> Option<&'static str> {
    match platform {
        "n64" => Some("Nintendo_-_Nintendo_64"),
        "gamecube" => Some("Nintendo_-_GameCube"),
        "wii" => Some("Nintendo_-_Wii"),
        _ => None,
    }
}

/// Names to try in libretro-thumbnails, which files box art by No-Intro / Redump names ("Super
/// Mario 64 (USA)"): the file's own name first (tags in square brackets dropped), then the title
/// with the usual regions. Characters it can't use in names (`&*/:\`<>?\|"`) become `_`.
pub fn libretro_names(file_stem: &str, title: &str) -> Vec<String> {
    let clean = |s: &str| -> String {
        s.chars().map(|c| if "&*/:`<>?\\|\"".contains(c) { '_' } else { c }).collect::<String>().trim().to_string()
    };
    let mut names = vec![clean(file_stem)];
    let base = clean(title);
    if !base.is_empty() && !base.contains('(') {
        for region in ["(USA)", "(Europe)", "(Japan)", "(USA, Europe)"] {
            names.push(format!("{base} {region}"));
        }
        names.push(base);
    }
    names.retain(|n| !n.is_empty());
    let mut seen = std::collections::HashSet::new();
    names.retain(|n| seen.insert(n.to_lowercase()));
    names
}

/// The raw address of a libretro-thumbnails box art.
pub fn libretro_url(system: &str, name: &str) -> String {
    let encoded: String = name
        .bytes()
        .map(|b| if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") })
        .collect();
    format!("https://raw.githubusercontent.com/libretro-thumbnails/{system}/master/Named_Boxarts/{encoded}.png")
}

/// GameTDB's cover regions for a disc ID's region letter, most likely first (D-034).
pub fn cover_regions(game_id: &str) -> Vec<&'static str> {
    let primary = match game_id.as_bytes().get(3).copied() {
        Some(b'E' | b'N') => "US",
        Some(b'J') => "JA",
        Some(b'K' | b'Q' | b'T') => "KO",
        Some(b'D') => "DE",
        Some(b'F') => "FR",
        Some(b'S') => "ES",
        Some(b'I') => "IT",
        Some(b'H') => "NL",
        Some(b'U') => "AU",
        Some(b'R') => "RU",
        _ => "EN",
    };
    let mut regions = vec![primary];
    for other in ["EN", "US", "JA"] {
        if !regions.contains(&other) {
            regions.push(other);
        }
    }
    regions
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gamecube_header(id: &str, title: &str) -> Vec<u8> {
        let mut h = vec![0u8; 0x60];
        h[..6].copy_from_slice(id.as_bytes());
        h[0x1C..0x20].copy_from_slice(&0xC233_9F3Du32.to_be_bytes());
        h[0x20..0x20 + title.len()].copy_from_slice(title.as_bytes());
        h
    }

    #[test]
    fn disc_headers_give_console_id_and_title() {
        let (platform, id, title) = disc_header(&gamecube_header("GMSE01", "Super Mario Sunshine"), None).unwrap();
        assert_eq!((platform, id.as_str(), title.as_str()), (Platform::GameCube, "GMSE01", "Super Mario Sunshine"));
        let mut wii = vec![0u8; 0x60];
        wii[..6].copy_from_slice(b"RMGE01");
        wii[0x18..0x1C].copy_from_slice(&0x5D1C_9EA3u32.to_be_bytes());
        wii[0x20..0x20 + 19].copy_from_slice(b"SUPER MARIO GALAXY ");
        assert_eq!(disc_header(&wii, None).unwrap().0, Platform::Wii);
        assert!(disc_header(&vec![0u8; 0x60], None).is_none(), "no magic, no hint: not a disc");
    }

    #[test]
    fn n64_roms_read_in_every_byte_order() {
        let mut z64 = vec![0u8; 0x40];
        z64[0..4].copy_from_slice(&[0x80, 0x37, 0x12, 0x40]);
        z64[0x20..0x2E].copy_from_slice(b"SUPER MARIO 64");
        z64[0x3B..0x3F].copy_from_slice(b"NSME");
        let v64: Vec<u8> = z64.chunks(2).flat_map(|p| [p[1], p[0]]).collect();
        let n64: Vec<u8> = z64.chunks(4).flat_map(|w| [w[3], w[2], w[1], w[0]]).collect();
        for rom in [&z64, &v64, &n64] {
            assert_eq!(n64_header(rom), Some(("SUPER MARIO 64".to_string(), Some("NSME".to_string()))));
        }
        assert_eq!(title_case("SUPER MARIO 64"), "Super Mario 64");
    }

    #[test]
    fn names_and_regions() {
        assert_eq!(title_from_name(Path::new("/g/Super Mario Sunshine (USA) [!].rvz")), "Super Mario Sunshine (USA)");
        assert_eq!(title_from_name(Path::new("/g/zelda_oot.z64")), "zelda oot");
        assert_eq!(cover_regions("GMSE01"), ["US", "EN", "JA"]);
        assert_eq!(cover_regions("GMSP01"), ["EN", "US", "JA"]);
        assert_eq!(cover_regions("GMSJ01")[0], "JA");
    }

    #[test]
    fn libretro_names_and_addresses() {
        assert_eq!(libretro_names("Super Mario 64 (USA)", "Super Mario 64")[0], "Super Mario 64 (USA)");
        let names = libretro_names("sm64", "Super Mario 64");
        assert_eq!(names, ["sm64", "Super Mario 64 (USA)", "Super Mario 64 (Europe)", "Super Mario 64 (Japan)", "Super Mario 64 (USA, Europe)", "Super Mario 64"]);
        assert_eq!(libretro_names("Banjo & Kazooie: X", "x")[0], "Banjo _ Kazooie_ X");
        assert_eq!(
            libretro_url("Nintendo_-_Nintendo_64", "Super Mario 64 (USA)"),
            "https://raw.githubusercontent.com/libretro-thumbnails/Nintendo_-_Nintendo_64/master/Named_Boxarts/Super%20Mario%2064%20%28USA%29.png"
        );
    }
}

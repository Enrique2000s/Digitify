//! Recognizing games on disk (D-034): GameCube and Wii discs for Dolphin, Nintendo 64 ROMs for
//! Project64 and RMG; PlayStation, PlayStation 2 and PlayStation 3 games and Nintendo DS ROMs
//! (D-101). Only each file's header (and a disc's `SYSTEM.CNF`) is read, never the whole game.

use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

/// A console Arcade knows.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Platform {
    GameCube,
    Wii,
    N64,
    Ps1,
    Ps2,
    Ps3,
    Ds,
    Nes,
    Snes,
    Gb,
    Gbc,
    Gba,
    Pce,
    Sms,
    GameGear,
    Genesis,
    SegaCd,
    Dreamcast,
    Psp,
    N3ds,
    WiiU,
    Xbox,
    Xbox360,
    Switch,
}

impl Platform {
    pub const ALL: [Platform; 24] = [
        Platform::GameCube,
        Platform::Wii,
        Platform::N64,
        Platform::Ps1,
        Platform::Ps2,
        Platform::Ps3,
        Platform::Ds,
        Platform::Nes,
        Platform::Snes,
        Platform::Gb,
        Platform::Gbc,
        Platform::Gba,
        Platform::Pce,
        Platform::Sms,
        Platform::GameGear,
        Platform::Genesis,
        Platform::SegaCd,
        Platform::Dreamcast,
        Platform::Psp,
        Platform::N3ds,
        Platform::WiiU,
        Platform::Xbox,
        Platform::Xbox360,
        Platform::Switch,
    ];

    pub fn parse(key: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|p| p.key() == key)
    }

    /// Its name, as messages say it.
    pub fn name(self) -> &'static str {
        match self {
            Platform::GameCube => "GameCube",
            Platform::Wii => "Wii",
            Platform::N64 => "Nintendo 64",
            Platform::Ps1 => "PlayStation",
            Platform::Ps2 => "PlayStation 2",
            Platform::Ps3 => "PlayStation 3",
            Platform::Ds => "Nintendo DS",
            Platform::Nes => "NES",
            Platform::Snes => "Super Nintendo",
            Platform::Gb => "Game Boy",
            Platform::Gbc => "Game Boy Color",
            Platform::Gba => "Game Boy Advance",
            Platform::Pce => "PC Engine",
            Platform::Sms => "Master System",
            Platform::GameGear => "Game Gear",
            Platform::Genesis => "Mega Drive",
            Platform::SegaCd => "Sega CD",
            Platform::Dreamcast => "Dreamcast",
            Platform::Psp => "PSP",
            Platform::N3ds => "Nintendo 3DS",
            Platform::WiiU => "Wii U",
            Platform::Xbox => "Xbox",
            Platform::Xbox360 => "Xbox 360",
            Platform::Switch => "Nintendo Switch",
        }
    }

    pub fn key(self) -> &'static str {
        match self {
            Platform::GameCube => "gamecube",
            Platform::Wii => "wii",
            Platform::N64 => "n64",
            Platform::Ps1 => "ps1",
            Platform::Ps2 => "ps2",
            Platform::Ps3 => "ps3",
            Platform::Ds => "ds",
            Platform::Nes => "nes",
            Platform::Snes => "snes",
            Platform::Gb => "gb",
            Platform::Gbc => "gbc",
            Platform::Gba => "gba",
            Platform::Pce => "pce",
            Platform::Sms => "sms",
            Platform::GameGear => "gamegear",
            Platform::Genesis => "genesis",
            Platform::SegaCd => "segacd",
            Platform::Dreamcast => "dreamcast",
            Platform::Psp => "psp",
            Platform::N3ds => "3ds",
            Platform::WiiU => "wiiu",
            // "xbox" is the Xbox app's (a store's) view.
            Platform::Xbox => "ogxbox",
            Platform::Xbox360 => "x360",
            Platform::Switch => "switch",
        }
    }

    /// The kinds of file its games come as.
    pub fn extensions(self) -> &'static [&'static str] {
        match self {
            Platform::GameCube | Platform::Wii => &DOLPHIN_EXTENSIONS,
            Platform::N64 => &N64_EXTENSIONS,
            Platform::Ps1 => &["cue", "bin", "chd", "pbp", "m3u", "iso"],
            Platform::Ps2 => &["iso", "chd", "cso", "zso", "bin", "cue"],
            // A PlayStation 3 game is a folder: its PARAM.SFO says what it is.
            Platform::Ps3 => &["sfo"],
            Platform::Ds => &["nds"],
            // Cartridges (D-106), also zipped: a ZIP holding one is that game.
            Platform::Nes => &["nes", "fds", "unf", "unif", "zip"],
            Platform::Snes => &["sfc", "smc", "zip"],
            Platform::Gb | Platform::Gbc => &["gb", "gbc", "sgb", "zip"],
            Platform::Gba => &["gba", "zip"],
            Platform::Pce => &["pce", "sgx", "zip"],
            // Mega Drive (and 32X) cartridges; Sega CD and Dreamcast discs (D-111).
            Platform::Genesis => &["md", "gen", "smd", "32x", "bin", "zip"],
            Platform::SegaCd => &["cue", "iso", "bin", "chd"],
            Platform::Dreamcast => &["gdi", "cdi", "chd"],
            // D-116: PSP discs and EBOOTs; 3DS cartridges; Wii U discs and installed folders (their
            // `code/*.rpx`); Xbox and Xbox 360 discs (an Xbox 360 game also as a folder with its
            // `default.xex`); Switch cartridges and packages.
            Platform::Psp => &["iso", "cso", "chd", "pbp"],
            Platform::N3ds => &["3ds", "cci", "cxi", "3dsx"],
            Platform::WiiU => &["wud", "wux", "wua", "rpx"],
            Platform::Xbox => &["iso"],
            Platform::Xbox360 => &["iso", "xex"],
            Platform::Switch => &["nsp", "xci"],
            Platform::Sms | Platform::GameGear => &["sms", "gg", "zip"],
        }
    }
}

/// What a game file says about itself.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GameInfo {
    pub platform: Platform,
    pub title: String,
    /// The disc's ID (GALE01, SLUS-20312, BLUS30443) or the cartridge's code (NSME), when it has one.
    pub game_id: Option<String>,
    /// The game is this folder rather than the file read (a PlayStation 3 game's folder).
    pub folder: Option<PathBuf>,
}

impl GameInfo {
    fn new(platform: Platform, title: String, game_id: Option<String>) -> Self {
        GameInfo { platform, title, game_id, folder: None }
    }
}

/// Dolphin's disc and title formats.
pub const DOLPHIN_EXTENSIONS: [&str; 8] = ["iso", "gcm", "rvz", "wia", "wbfs", "ciso", "gcz", "wad"];
/// Nintendo 64 ROMs.
pub const N64_EXTENSIONS: [&str; 3] = ["z64", "n64", "v64"];

pub fn extension(path: &Path) -> String {
    path.extension().map(|e| e.to_string_lossy().to_ascii_lowercase()).unwrap_or_default()
}

/// Reads a game file's header; `None` when it isn't a game Arcade can launch. `hint` is the console
/// of the emulator whose folder it's in, for the files that can't say (a compressed disc).
pub fn identify(path: &Path, hint: Option<Platform>) -> Option<GameInfo> {
    let ext = extension(path);
    let fallback = || title_from_name(path);
    if N64_EXTENSIONS.contains(&ext.as_str()) {
        let header = read_at(path, 0, 0x40)?;
        let (title, code) = n64_header(&header)?;
        return Some(GameInfo::new(Platform::N64, nicer_title(path, &title), code));
    }
    let playstation = |platform: Platform, id: Option<String>| Some(GameInfo::new(platform, fallback(), id));
    let disc_hint = hint.filter(|h| matches!(h, Platform::Ps1 | Platform::Ps2 | Platform::SegaCd | Platform::Dreamcast));
    if CARTRIDGE_EXTENSIONS.contains(&ext.as_str()) {
        let header = read_up_to(path, 0x8000)?;
        return cartridge(&ext, &header, path, hint);
    }
    match ext.as_str() {
        "zip" => return zipped_cartridge(path, hint),
        "nds" => {
            let header = read_at(path, 0, 0x10)?;
            let code: String = header[0x0C..0x10].iter().map(|&b| b as char).collect();
            if !code.chars().all(|c| c.is_ascii_alphanumeric()) {
                return None;
            }
            return Some(GameInfo::new(Platform::Ds, nicer_title(path, &clean_text(&header[..0x0C])), Some(code)));
        }
        "sfo" => return ps3_game(path),
        "pbp" => return pbp_game(path),
        "m3u" => {
            // A list of a game's discs: the first disc says which console; the list is the game.
            let first = m3u_entries(path).into_iter().next()?;
            if extension(&first) == "m3u" {
                return None;
            }
            let disc = identify(&first, hint)?;
            return playstation(disc.platform, disc.game_id);
        }
        "cue" => {
            let bin = cue_bin(path);
            if bin.as_deref().is_some_and(sega_cd_disc) {
                return playstation(Platform::SegaCd, None);
            }
            let (platform, id) = bin.and_then(|bin| playstation_disc(&bin)).or_else(|| disc_hint.filter(|h| *h != Platform::Dreamcast).map(|h| (h, None)))?;
            return playstation(platform, id);
        }
        "bin" => {
            if sega_cd_disc(path) {
                return playstation(Platform::SegaCd, None);
            }
            if let Some((platform, id)) = playstation_disc(path) {
                return playstation(platform, id);
            }
            // A Mega Drive cartridge dumped as .bin.
            let header = read_up_to(path, 0x200)?;
            return Some(GameInfo::new(Platform::Genesis, nicer_title(path, &mega_drive_name(&header)?), None));
        }
        "chd" => {
            let platform = match chd_kind(path)? {
                // A PSP's UMD is a DVD to MAME's tools: PPSSPP's folders say which.
                DiscKind::Dvd if hint == Some(Platform::Psp) => Platform::Psp,
                DiscKind::Dvd => Platform::Ps2,
                DiscKind::GdRom => Platform::Dreamcast,
                DiscKind::Cd => disc_hint.filter(|h| *h != Platform::Ps2).unwrap_or(Platform::Ps1),
            };
            return playstation(platform, None);
        }
        // D-116.
        "3ds" | "cci" | "cxi" => return n3ds_cartridge(path),
        "3dsx" => return (read_at(path, 0, 4)? == b"3DSX").then(|| GameInfo::new(Platform::N3ds, fallback(), None)),
        "wux" => return (read_at(path, 0, 4)? == b"WUX0").then(|| GameInfo::new(Platform::WiiU, fallback(), None)),
        "wud" => return (std::fs::metadata(path).ok()?.len() > 1 << 30).then(|| GameInfo::new(Platform::WiiU, fallback(), None)),
        "wua" => return (std::fs::metadata(path).ok()?.len() > 1 << 20).then(|| GameInfo::new(Platform::WiiU, fallback(), None)),
        "rpx" => return wii_u_folder(path),
        "xex" => return xbox_360_folder(path),
        "nsp" => return (read_at(path, 0, 4)? == b"PFS0").then(|| GameInfo::new(Platform::Switch, fallback(), switch_title_id(path))),
        "xci" => return (read_at(path, 0x100, 4)? == b"HEAD").then(|| GameInfo::new(Platform::Switch, fallback(), switch_title_id(path))),
        // Dreamcast: a GD-ROM's track list, or a DiscJuggler image.
        "gdi" => return gdi_disc(path).then(|| GameInfo::new(Platform::Dreamcast, disc_title(path), None)),
        "cdi" => return (std::fs::metadata(path).ok()?.len() > 1 << 20).then(|| GameInfo::new(Platform::Dreamcast, disc_title(path), None)),
        // Compressed discs: a CSO's first sectors say PSP or not (PlayStation 2); ZSO is PlayStation 2's.
        "cso" => return playstation(if hint == Some(Platform::Psp) || cso_is_psp(path) { Platform::Psp } else { Platform::Ps2 }, None),
        "zso" => return playstation(Platform::Ps2, None),
        "iso" => {
            if let Some(found) = dolphin_disc(path, &ext) {
                return Some(found);
            }
            if sega_cd_disc(path) {
                return playstation(Platform::SegaCd, None);
            }
            // A PSP disc (UMD), an Xbox or Xbox 360 disc (D-116).
            if let Some(found) = psp_disc(path) {
                return Some(found);
            }
            if let Some(platform) = xbox_disc(path) {
                return playstation(platform, None);
            }
            let (platform, id) = playstation_disc(path)?;
            return playstation(platform, id);
        }
        _ => {}
    }
    if !DOLPHIN_EXTENSIONS.contains(&ext.as_str()) {
        return None;
    }
    if ext == "wad" {
        // WiiWare and Virtual Console channels: their title lives in compressed banners.
        return Some(GameInfo::new(Platform::Wii, fallback(), None));
    }
    if ext == "gcz" {
        // Compressed in blocks: the header isn't readable without decompressing; the file name it is.
        return Some(GameInfo::new(Platform::GameCube, fallback(), None));
    }
    dolphin_disc(path, &ext)
}

/// Internal names are short and in capitals ("SUPER MARIO 64"); a file name with lowercase letters
/// is usually the nicer title.
fn nicer_title(path: &Path, internal: &str) -> String {
    let name = title_from_name(path);
    if name.chars().any(|c| c.is_lowercase()) || internal.is_empty() {
        name
    } else {
        title_case(internal)
    }
}

/// A GameCube or Wii disc in one of Dolphin's formats.
fn dolphin_disc(path: &Path, ext: &str) -> Option<GameInfo> {
    let fallback = || title_from_name(path);
    let disc = disc_header_offset(path, ext)?;
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
    Some(GameInfo::new(platform, title, Some(id)))
}

// ---------------------------------------------------------------------------------------------
// PlayStation (D-101)

/// A PlayStation or PlayStation 2 disc image (ISO, or raw BIN sectors): its `SYSTEM.CNF` says
/// which (`BOOT2` is PlayStation 2's) and names the game's ID. Early PlayStation discs only have
/// `PSX.EXE`. PSP discs and anything else: `None`.
pub(crate) fn playstation_disc(path: &Path) -> Option<(Platform, Option<String>)> {
    let mut disc = Disc::open(path)?;
    let pvd = disc.read(16, 2048)?;
    if pvd[0] != 1 || &pvd[1..6] != b"CD001" {
        return None;
    }
    let root_lba = u32::from_le_bytes(pvd[158..162].try_into().ok()?);
    let root_size = u32::from_le_bytes(pvd[166..170].try_into().ok()?);
    let mut cnf: Option<(u32, u32)> = None;
    let mut psx_exe = false;
    for sector in 0..(root_size / 2048).clamp(1, 16) {
        let records = disc.read(root_lba + sector, 2048)?;
        let mut at = 0;
        while at + 33 < records.len() {
            let length = records[at] as usize;
            if length == 0 {
                break;
            }
            let name_length = records[at + 32] as usize;
            let name = String::from_utf8_lossy(records.get(at + 33..at + 33 + name_length)?).to_uppercase();
            let name = name.split(';').next().unwrap_or_default().to_string();
            let extent = u32::from_le_bytes(records[at + 2..at + 6].try_into().ok()?);
            let size = u32::from_le_bytes(records[at + 10..at + 14].try_into().ok()?);
            match name.as_str() {
                "SYSTEM.CNF" => cnf = Some((extent, size)),
                "PSX.EXE" => psx_exe = true,
                "UMD_DATA.BIN" | "PSP_GAME" => return None,
                _ => {}
            }
            at += length;
        }
    }
    let Some((extent, size)) = cnf else { return psx_exe.then_some((Platform::Ps1, None)) };
    let text = disc.read(extent, (size as usize).clamp(1, 2048))?;
    system_cnf(&String::from_utf8_lossy(&text))
}

/// `BOOT2 = cdrom0:\SLUS_203.12;1` → PlayStation 2, SLUS-20312; `BOOT = cdrom:\SCUS_944.26;1` → PlayStation.
pub(crate) fn system_cnf(text: &str) -> Option<(Platform, Option<String>)> {
    for line in text.lines() {
        let Some((key, value)) = line.split_once('=') else { continue };
        let platform = match key.trim().to_uppercase().as_str() {
            "BOOT2" => Platform::Ps2,
            "BOOT" => Platform::Ps1,
            _ => continue,
        };
        let file = value.trim().rsplit(['\\', ':', '/']).next().unwrap_or_default();
        let file = file.split(';').next().unwrap_or_default().trim();
        let id: String = file.replace('_', "-").replace('.', "").to_uppercase();
        let id = (id.len() >= 8 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')).then_some(id);
        return Some((platform, id));
    }
    None
}

/// A disc image's sectors: 2048 bytes each (ISO), or raw 2352-byte CD sectors (BIN) whose data
/// starts after the sync, header and, for mode 2, subheader.
struct Disc {
    file: File,
    sector: u64,
    data: u64,
}

impl Disc {
    fn open(path: &Path) -> Option<Disc> {
        let mut file = File::open(path).ok()?;
        let mut head = [0u8; 16];
        file.read_exact(&mut head).ok()?;
        let raw = head[0] == 0 && head[1..11].iter().all(|&b| b == 0xFF) && head[11] == 0;
        let (sector, data) = match (raw, head[15]) {
            (true, 1) => (2352, 16),
            (true, _) => (2352, 24),
            (false, _) => (2048, 0),
        };
        Some(Disc { file, sector, data })
    }

    fn read(&mut self, lba: u32, length: usize) -> Option<Vec<u8>> {
        self.file.seek(SeekFrom::Start(u64::from(lba) * self.sector + self.data)).ok()?;
        let mut buffer = vec![0u8; length.min(2048)];
        self.file.read_exact(&mut buffer).ok()?;
        Some(buffer)
    }
}

/// The first data file a CUE sheet names, beside it.
fn cue_bin(cue: &Path) -> Option<PathBuf> {
    let text = std::fs::read_to_string(cue).ok().filter(|t| t.len() < 64 * 1024)?;
    text.lines().find_map(|line| {
        let rest = line.trim().strip_prefix("FILE ")?;
        let name = if let Some(quoted) = rest.strip_prefix('"') { quoted.split('"').next()? } else { rest.split_whitespace().next()? };
        Some(cue.parent()?.join(name))
    })
}

/// Every file a CUE sheet or M3U list names (the discs of one game, the tracks of one disc): they
/// aren't games of their own.
pub fn parts_of(path: &Path) -> Vec<PathBuf> {
    match extension(path).as_str() {
        "m3u" => m3u_entries(path),
        "gdi" => {
            let Ok(text) = std::fs::read_to_string(path) else { return Vec::new() };
            if text.len() > 64 * 1024 {
                return Vec::new();
            }
            let Some(dir) = path.parent() else { return Vec::new() };
            text.lines().skip(1).filter_map(|line| line.split_whitespace().nth(4)).map(|name| dir.join(name.trim_matches('"'))).collect()
        }
        "cue" => {
            let Ok(text) = std::fs::read_to_string(path) else { return Vec::new() };
            if text.len() > 64 * 1024 {
                return Vec::new();
            }
            text.lines()
                .filter_map(|line| {
                    let rest = line.trim().strip_prefix("FILE ")?;
                    let name = if let Some(quoted) = rest.strip_prefix('"') { quoted.split('"').next()? } else { rest.split_whitespace().next()? };
                    Some(path.parent()?.join(name))
                })
                .collect()
        }
        _ => Vec::new(),
    }
}

fn m3u_entries(path: &Path) -> Vec<PathBuf> {
    let Ok(text) = std::fs::read_to_string(path) else { return Vec::new() };
    if text.len() > 64 * 1024 {
        return Vec::new();
    }
    let Some(dir) = path.parent() else { return Vec::new() };
    text.lines().map(str::trim).filter(|l| !l.is_empty() && !l.starts_with('#')).map(|l| dir.join(l)).collect()
}

enum DiscKind {
    Cd,
    Dvd,
    /// A Dreamcast GD-ROM.
    GdRom,
}

/// Whether a CHD (MAME's compressed disc) holds a CD, a DVD or a Dreamcast GD-ROM, from its
/// metadata; hard disks aren't games here.
fn chd_kind(path: &Path) -> Option<DiscKind> {
    let head = read_at(path, 0, 0x40)?;
    if &head[0..8] != b"MComprHD" {
        return None;
    }
    let version = u32::from_be_bytes(head[12..16].try_into().ok()?);
    let at = if version >= 5 { 0x30 } else { 0x24 };
    let mut meta = u64::from_be_bytes(head[at..at + 8].try_into().ok()?);
    for _ in 0..16 {
        if meta == 0 {
            break;
        }
        let entry = read_at(path, meta, 16)?;
        match &entry[0..4] {
            b"CHT2" | b"CHTR" | b"CHCD" => return Some(DiscKind::Cd),
            b"DVD " => return Some(DiscKind::Dvd),
            b"CHGT" | b"CHGD" => return Some(DiscKind::GdRom),
            _ => {}
        }
        meta = u64::from_be_bytes(entry[8..16].try_into().ok()?);
    }
    None
}

/// A PARAM.SFO's values (titles, IDs, the kind of content): PlayStation 3 games and PSP files.
pub(crate) fn sfo_values(bytes: &[u8]) -> HashMap<String, String> {
    let mut values = HashMap::new();
    if bytes.len() < 20 || &bytes[0..4] != b"\0PSF" {
        return values;
    }
    let u32_at = |at: usize| bytes.get(at..at + 4).map(|b| u32::from_le_bytes(b.try_into().unwrap()) as usize);
    let u16_at = |at: usize| bytes.get(at..at + 2).map(|b| u16::from_le_bytes(b.try_into().unwrap()) as usize);
    let (Some(keys), Some(data), Some(count)) = (u32_at(8), u32_at(12), u32_at(16)) else { return values };
    for i in 0..count.min(256) {
        let entry = 20 + i * 16;
        let (Some(key_at), Some(format), Some(length), Some(data_at)) = (u16_at(entry), u16_at(entry + 2), u32_at(entry + 4), u32_at(entry + 12)) else { break };
        let Some(key) = bytes.get(keys + key_at..).map(|k| clean_text(&k[..k.iter().position(|&b| b == 0).unwrap_or(k.len()).min(64)])) else { continue };
        let Some(value) = bytes.get(data + data_at..data + data_at + length) else { continue };
        let value = if format == 0x0404 { u32::from_le_bytes(value.get(..4).and_then(|v| v.try_into().ok()).unwrap_or([0; 4])).to_string() } else { clean_text(value) };
        values.insert(key, value);
    }
    values
}

/// A PlayStation 3 game from its PARAM.SFO: a disc game's (`PS3_GAME/PARAM.SFO`) or an installed
/// one's (`dev_hdd0/game/<ID>/PARAM.SFO`). Updates and game data are left out.
fn ps3_game(sfo: &Path) -> Option<GameInfo> {
    if !sfo.file_name()?.to_string_lossy().eq_ignore_ascii_case("PARAM.SFO") || std::fs::metadata(sfo).ok()?.len() > 1 << 20 {
        return None;
    }
    let values = sfo_values(&std::fs::read(sfo).ok()?);
    let parent = sfo.parent()?;
    let disc_folder = parent.file_name().is_some_and(|n| n.to_string_lossy().eq_ignore_ascii_case("PS3_GAME"));
    let folder = match values.get("CATEGORY").map(String::as_str) {
        Some("DG") if disc_folder => parent.parent()?.to_path_buf(),
        Some("HG") if !disc_folder => parent.to_path_buf(),
        _ => return None,
    };
    let title = values.get("TITLE").filter(|t| !t.is_empty()).cloned().unwrap_or_else(|| title_from_name(&folder));
    Some(GameInfo { platform: Platform::Ps3, title, game_id: values.get("TITLE_ID").cloned(), folder: Some(folder) })
}

/// A PlayStation game converted for the PSP's PlayStation player (an EBOOT.PBP whose PARAM.SFO says
/// "ME"); PSP games themselves aren't.
fn pbp_game(path: &Path) -> Option<GameInfo> {
    let head = read_at(path, 0, 0x28)?;
    if &head[0..4] != b"\0PBP" {
        return None;
    }
    let start = u32::from_le_bytes(head[8..12].try_into().ok()?);
    let end = u32::from_le_bytes(head[12..16].try_into().ok()?);
    let length = end.checked_sub(start).filter(|l| *l > 20 && *l < 64 * 1024)?;
    let values = sfo_values(&read_at(path, u64::from(start), length as usize)?);
    // "ME": a PlayStation game for the PSP's player; "EG", "UG", "PG"…: a PSP game (D-116).
    let platform = match values.get("CATEGORY").map(String::as_str) {
        Some("ME") => Platform::Ps1,
        Some("EG" | "UG" | "PG" | "MG") => Platform::Psp,
        _ => return None,
    };
    let title = values.get("TITLE").filter(|t| !t.is_empty()).cloned().unwrap_or_else(|| title_from_name(path));
    Some(GameInfo::new(platform, title, values.get("DISC_ID").cloned()))
}

/// A file or folder in an ISO 9660 directory: its first sector, its size, whether it's a folder.
fn iso_entry(disc: &mut Disc, lba: u32, size: u32, wanted: &str) -> Option<(u32, u32, bool)> {
    for sector in 0..(size / 2048).clamp(1, 16) {
        let records = disc.read(lba + sector, 2048)?;
        let mut at = 0;
        while at + 33 < records.len() {
            let length = records[at] as usize;
            if length == 0 {
                break;
            }
            let name_length = records[at + 32] as usize;
            let name = String::from_utf8_lossy(records.get(at + 33..at + 33 + name_length)?).to_uppercase();
            if name.split(';').next() == Some(wanted) {
                let extent = u32::from_le_bytes(records[at + 2..at + 6].try_into().ok()?);
                let size = u32::from_le_bytes(records[at + 10..at + 14].try_into().ok()?);
                return Some((extent, size, records[at + 25] & 2 != 0));
            }
            at += length;
        }
    }
    None
}

/// A PSP disc (UMD image): "PSP GAME" as its system, named and numbered by `PSP_GAME/PARAM.SFO`.
fn psp_disc(path: &Path) -> Option<GameInfo> {
    let mut disc = Disc::open(path)?;
    let pvd = disc.read(16, 2048)?;
    if &pvd[1..6] != b"CD001" || !pvd[8..40].starts_with(b"PSP GAME") {
        return None;
    }
    let root = (u32::from_le_bytes(pvd[158..162].try_into().ok()?), u32::from_le_bytes(pvd[166..170].try_into().ok()?));
    let sfo = iso_entry(&mut disc, root.0, root.1, "PSP_GAME")
        .filter(|e| e.2)
        .and_then(|(lba, size, _)| iso_entry(&mut disc, lba, size, "PARAM.SFO"))
        .and_then(|(lba, size, _)| {
            let mut bytes = Vec::new();
            for sector in 0..size.div_ceil(2048).min(32) {
                bytes.extend(disc.read(lba + sector, 2048)?);
            }
            Some(sfo_values(&bytes))
        })
        .unwrap_or_default();
    let title = sfo.get("TITLE").filter(|t| !t.is_empty()).cloned().unwrap_or_else(|| title_from_name(path));
    Some(GameInfo::new(Platform::Psp, title, sfo.get("DISC_ID").cloned()))
}

/// Whether a CSO (compressed ISO) is a PSP's: its sector 16, inflated, says "PSP GAME".
fn cso_is_psp(path: &Path) -> bool {
    (|| -> Option<bool> {
        let head = read_at(path, 0, 24)?;
        if &head[0..4] != b"CISO" {
            return None;
        }
        let block = u32::from_le_bytes(head[16..20].try_into().ok()?) as u64;
        let align = u32::from(head[21]);
        if block != 2048 {
            return None;
        }
        let index = read_at(path, 24 + 16 * 4, 8)?;
        let entry = u32::from_le_bytes(index[0..4].try_into().ok()?);
        let next = u32::from_le_bytes(index[4..8].try_into().ok()?);
        let start = u64::from(entry & 0x7FFF_FFFF) << align;
        let end = u64::from(next & 0x7FFF_FFFF) << align;
        let raw = read_at(path, start, (end.checked_sub(start)?).min(4096) as usize)?;
        let sector = if entry & 0x8000_0000 != 0 {
            raw
        } else {
            let mut out = Vec::new();
            flate2::read::DeflateDecoder::new(&raw[..]).take(2048).read_to_end(&mut out).ok()?;
            out
        };
        Some(sector.get(1..6) == Some(b"CD001") && sector.get(8..16) == Some(b"PSP GAME"))
    })()
    .unwrap_or(false)
}

/// An Xbox or Xbox 360 disc: the Xbox file system's "MICROSOFT*XBOX*MEDIA" where each kind of disc
/// keeps it (XGD1 at 0x18310000, XGD2 at 0xFDA0000, XGD3 at 0x2090000, a trimmed image at 0x10000);
/// a trimmed image is the Xbox 360's when it starts with `default.xex` rather than `default.xbe`.
pub(crate) fn xbox_disc(path: &Path) -> Option<Platform> {
    const MAGIC: &[u8] = b"MICROSOFT*XBOX*MEDIA";
    let at = |offset: u64| read_at(path, offset, 0x20).filter(|b| b.starts_with(MAGIC));
    if at(0x1831_0000).is_some() {
        return Some(Platform::Xbox);
    }
    if at(0xFDA_0000).is_some() || at(0x209_0000).is_some() {
        return Some(Platform::Xbox360);
    }
    let volume = at(0x1_0000)?;
    let root = u64::from(u32::from_le_bytes(volume[0x14..0x18].try_into().ok()?)) * 2048;
    let size = u32::from_le_bytes(volume[0x18..0x1C].try_into().ok()?).clamp(1, 64 * 1024) as usize;
    let listing = read_at(path, root, size)?.to_ascii_lowercase();
    let has = |name: &[u8]| listing.windows(name.len()).any(|w| w == name);
    Some(if has(b"default.xex") && !has(b"default.xbe") { Platform::Xbox360 } else { Platform::Xbox })
}

/// A 3DS cartridge (`.3ds`/`.cci`: "NCSD"; `.cxi`: "NCCH"), with its product code ("CTR-P-AREE"
/// gives AREE, GameTDB's ID).
fn n3ds_cartridge(path: &Path) -> Option<GameInfo> {
    let magic = read_at(path, 0x100, 4)?;
    let ncch = match &magic[..] {
        b"NCSD" => u64::from(u32::from_le_bytes(read_at(path, 0x120, 4)?.try_into().ok()?)) * 0x200,
        b"NCCH" => 0,
        _ => return None,
    };
    let code = read_at(path, ncch + 0x150, 16).map(|b| clean_text(&b)).unwrap_or_default();
    let id = code.strip_prefix("CTR-").and_then(|c| c.rsplit('-').next()).filter(|c| c.len() == 4 && c.chars().all(|ch| ch.is_ascii_alphanumeric())).map(str::to_string);
    Some(GameInfo::new(Platform::N3ds, title_from_name(path), id))
}

/// A Wii U game installed as a folder: its `code/*.rpx`, with `meta/meta.xml` beside `code` naming
/// it and giving its product code (GameTDB's ID: "WUP-P-ARPE" with company 0001 gives ARPE01).
fn wii_u_folder(rpx: &Path) -> Option<GameInfo> {
    let code = rpx.parent()?;
    if !code.file_name()?.to_string_lossy().eq_ignore_ascii_case("code") {
        return None;
    }
    let folder = code.parent()?.to_path_buf();
    let meta = std::fs::read_to_string(folder.join("meta").join("meta.xml")).ok()?;
    let doc = roxmltree::Document::parse(&meta).ok()?;
    let value = |tag: &str| doc.descendants().find(|n| n.has_tag_name(tag)).and_then(|n| n.text()).map(|t| t.trim().to_string()).filter(|t| !t.is_empty());
    let title = value("longname_en").or_else(|| value("shortname_en")).map(|t| t.split_whitespace().collect::<Vec<_>>().join(" ")).unwrap_or_else(|| title_from_name(&folder));
    let id = value("product_code").and_then(|p| p.rsplit('-').next().map(str::to_string)).filter(|p| p.len() == 4).map(|p| {
        let company = value("company_code").unwrap_or_default();
        format!("{p}{}", company.get(company.len().saturating_sub(2)..).unwrap_or("01"))
    });
    Some(GameInfo { platform: Platform::WiiU, title, game_id: id, folder: Some(folder) })
}

/// An Xbox 360 game as a folder: its `default.xex` (other programs in it aren't games).
fn xbox_360_folder(xex: &Path) -> Option<GameInfo> {
    if !xex.file_name()?.to_string_lossy().eq_ignore_ascii_case("default.xex") || read_at(xex, 0, 4)? != b"XEX2" {
        return None;
    }
    let folder = xex.parent()?.to_path_buf();
    Some(GameInfo { platform: Platform::Xbox360, title: title_from_name(&PathBuf::from(format!("{}.x", folder.file_name()?.to_string_lossy()))), game_id: None, folder: Some(folder) })
}

/// A Switch game's title ID, when its file is named with it ("Game [0100ABCD12345000][v0].nsp").
fn switch_title_id(path: &Path) -> Option<String> {
    let name = path.file_name()?.to_string_lossy().into_owned();
    name.split(['[', ']']).find(|part| part.len() == 16 && part.starts_with("01") && part.chars().all(|c| c.is_ascii_hexdigit())).map(|id| id.to_uppercase())
}

/// The program that starts a game kept as a folder (D-116): a Wii U game's `code/*.rpx`, an
/// Xbox 360 game's `default.xex`; the folder itself otherwise (a PlayStation 3 game).
pub fn folder_program(folder: &Path) -> PathBuf {
    let xex = folder.join("default.xex");
    if xex.is_file() {
        return xex;
    }
    std::fs::read_dir(folder.join("code"))
        .ok()
        .and_then(|entries| entries.filter_map(Result::ok).map(|e| e.path()).find(|p| extension(p) == "rpx"))
        .unwrap_or_else(|| folder.to_path_buf())
}

/// A PlayStation 3 game's own picture (`ICON0.PNG`), beside its PARAM.SFO.
pub fn ps3_icon(folder: &Path) -> Option<PathBuf> {
    [folder.join("PS3_GAME").join("ICON0.PNG"), folder.join("ICON0.PNG")].into_iter().find(|p| p.is_file())
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

/// Cartridge ROMs' kinds of file (D-106).
pub const CARTRIDGE_EXTENSIONS: [&str; 18] = ["nes", "fds", "unf", "unif", "sfc", "smc", "gb", "gbc", "sgb", "gba", "pce", "sgx", "sms", "gg", "md", "gen", "smd", "32x"];

/// Every kind of game file an emulator's settings may name (its recent games), cartridges and discs.
pub const GAME_FILE_EXTENSIONS: [&str; 30] = [
    "nes", "fds", "unf", "unif", "sfc", "smc", "gb", "gbc", "sgb", "gba", "pce", "sgx", "sms", "gg", "md", "gen", "smd", "32x", "zip", "7z", "bin", "cue", "iso", "chd", "gdi", "cdi", "n64", "z64",
    "v64", "nds",
];

/// Up to `length` bytes from the start of a file.
fn read_up_to(path: &Path, length: u64) -> Option<Vec<u8>> {
    let mut buffer = Vec::new();
    File::open(path).ok()?.take(length).read_to_end(&mut buffer).ok()?;
    Some(buffer)
}

/// A cartridge ROM by its header where it has one (NES, Game Boy, Game Boy Advance), else by its
/// kind of file. `name` names the game when its header doesn't.
fn cartridge(ext: &str, header: &[u8], name: &Path, hint: Option<Platform>) -> Option<GameInfo> {
    let name_path = name;
    let fallback = || title_from_name(name);
    let at = |offset: usize, length: usize| header.get(offset..offset + length);
    let info = match ext {
        "nes" => (at(0, 4)? == b"NES\x1a").then(|| GameInfo::new(Platform::Nes, fallback(), None))?,
        "unf" | "unif" => (at(0, 4)? == b"UNIF").then(|| GameInfo::new(Platform::Nes, fallback(), None))?,
        // Famicom Disk System: with fwNES's header, or the disk's own.
        "fds" => (at(0, 4)? == b"FDS\x1a" || at(1, 14)? == b"*NINTENDO-HVC*").then(|| GameInfo::new(Platform::Nes, fallback(), None))?,
        "gb" | "gbc" | "sgb" => {
            // Nintendo's logo, which every cartridge carries.
            if at(0x104, 4)? != [0xCE, 0xED, 0x66, 0x66] {
                return None;
            }
            let flag = *header.get(0x143)?;
            let color = flag == 0xC0 || (flag == 0x80 && ext == "gbc");
            let title = clean_text(at(0x134, if flag & 0x80 != 0 { 15 } else { 16 })?);
            GameInfo::new(if color { Platform::Gbc } else { Platform::Gb }, nicer_title(name, &title), None)
        }
        "gba" => {
            // The fixed value every Game Boy Advance header has.
            if *header.get(0xB2)? != 0x96 {
                return None;
            }
            let code: String = at(0xAC, 4)?.iter().map(|&b| b as char).collect();
            let code = code.chars().all(|c| c.is_ascii_alphanumeric()).then_some(code);
            GameInfo::new(Platform::Gba, nicer_title(name, &clean_text(at(0xA0, 12)?)), code)
        }
        "sfc" | "smc" if header.len() >= 0x8000 => GameInfo::new(Platform::Snes, fallback(), None),
        "pce" | "sgx" if header.len() >= 0x2000 => GameInfo::new(Platform::Pce, fallback(), None),
        // Mega Drive and 32X: "SEGA" in the header at 0x100; SMD dumps are interleaved, so by size.
        "md" | "gen" | "32x" => {
            let name = mega_drive_name(header)?;
            GameInfo::new(Platform::Genesis, nicer_title(name_path, &name), None)
        }
        "smd" if header.len() >= 0x8000 => GameInfo::new(Platform::Genesis, fallback(), None),
        // Master System and Game Gear share their format: the file's kind, or the emulator's console.
        "sms" if header.len() >= 0x2000 => GameInfo::new(if hint == Some(Platform::GameGear) { Platform::GameGear } else { Platform::Sms }, fallback(), None),
        "gg" if header.len() >= 0x2000 => GameInfo::new(Platform::GameGear, fallback(), None),
        _ => return None,
    };
    Some(info)
}

/// A Mega Drive / Genesis / 32X header's game name (its overseas one, else its Japanese one), when
/// the header says "SEGA" at 0x100; empty when it has none worth using.
fn mega_drive_name(header: &[u8]) -> Option<String> {
    let system = header.get(0x100..0x110)?;
    if !system.windows(4).any(|w| w == b"SEGA") {
        return None;
    }
    let overseas = header.get(0x150..0x180).map(clean_text).unwrap_or_default();
    let domestic = header.get(0x120..0x150).map(clean_text).unwrap_or_default();
    Some(if overseas.chars().any(char::is_alphanumeric) { overseas } else { domestic })
}

/// A Sega CD disc: "SEGADISCSYSTEM" at its start (2048-byte sectors) or after a raw sector's header.
fn sega_cd_disc(path: &Path) -> bool {
    read_at(path, 0, 0x20).is_some_and(|head| head.starts_with(b"SEGADISCSYSTEM") || head[0x10..].starts_with(b"SEGADISCSYSTEM"))
}

/// A Dreamcast GD-ROM's track list (`.gdi`): a count of tracks, then one line per track.
fn gdi_disc(path: &Path) -> bool {
    let Ok(text) = std::fs::read_to_string(path) else { return false };
    let mut lines = text.lines().map(str::trim).filter(|l| !l.is_empty());
    let count = lines.next().and_then(|l| l.parse::<u32>().ok()).unwrap_or(0);
    (1..100).contains(&count) && lines.next().is_some_and(|l| l.split_whitespace().count() >= 5)
}

/// A disc's name: its file's, or its folder's when the file has a generic name ("disc.gdi").
fn disc_title(path: &Path) -> String {
    let stem = path.file_stem().map(|s| s.to_string_lossy().to_lowercase()).unwrap_or_default();
    let generic = ["disc", "disk", "game", "track01", "track1", "image", "cd", "gd"];
    match path.parent().and_then(|d| d.file_name()) {
        Some(folder) if generic.contains(&stem.as_str()) => title_from_name(Path::new(&format!("{}.x", folder.to_string_lossy()))),
        _ => title_from_name(path),
    }
}

/// A ZIP holding a cartridge ROM (D-106): the game is the ZIP, named after it.
fn zipped_cartridge(path: &Path, hint: Option<Platform>) -> Option<GameInfo> {
    let mut archive = zip::ZipArchive::new(File::open(path).ok()?).ok()?;
    // Only a ZIP of one game: a few files at most (a ROM and its readme).
    if archive.len() > 4 {
        return None;
    }
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).ok()?;
        let Ok(name) = entry.name() else { continue };
        let ext = extension(Path::new(name.as_ref()));
        if !CARTRIDGE_EXTENSIONS.contains(&ext.as_str()) || entry.size() > 64 << 20 {
            continue;
        }
        let mut header = Vec::new();
        (&mut entry).take(0x8000).read_to_end(&mut header).ok()?;
        return cartridge(&ext, &header, path, hint);
    }
    None
}

/// libretro-thumbnails' collection for a console (D-035).
pub fn libretro_system(platform: &str) -> Option<&'static str> {
    match platform {
        "n64" => Some("Nintendo_-_Nintendo_64"),
        "gamecube" => Some("Nintendo_-_GameCube"),
        "wii" => Some("Nintendo_-_Wii"),
        "ps1" => Some("Sony_-_PlayStation"),
        "ps2" => Some("Sony_-_PlayStation_2"),
        "ps3" => Some("Sony_-_PlayStation_3"),
        "ds" => Some("Nintendo_-_Nintendo_DS"),
        "nes" => Some("Nintendo_-_Nintendo_Entertainment_System"),
        "snes" => Some("Nintendo_-_Super_Nintendo_Entertainment_System"),
        "gb" => Some("Nintendo_-_Game_Boy"),
        "gbc" => Some("Nintendo_-_Game_Boy_Color"),
        "gba" => Some("Nintendo_-_Game_Boy_Advance"),
        "pce" => Some("NEC_-_PC_Engine_-_TurboGrafx_16"),
        "sms" => Some("Sega_-_Master_System_-_Mark_III"),
        "gamegear" => Some("Sega_-_Game_Gear"),
        "genesis" => Some("Sega_-_Mega_Drive_-_Genesis"),
        "segacd" => Some("Sega_-_Mega-CD_-_Sega_CD"),
        "dreamcast" => Some("Sega_-_Dreamcast"),
        "psp" => Some("Sony_-_PlayStation_Portable"),
        "3ds" => Some("Nintendo_-_Nintendo_3DS"),
        "wiiu" => Some("Nintendo_-_Wii_U"),
        "ogxbox" => Some("Microsoft_-_Xbox"),
        "x360" => Some("Microsoft_-_Xbox_360"),
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
    fn playstation_discs_and_ds_roms() {
        assert_eq!(system_cnf("BOOT2 = cdrom0:\\SLUS_203.12;1\r\nVER = 1.00\r\n"), Some((Platform::Ps2, Some("SLUS-20312".to_string()))));
        assert_eq!(system_cnf("BOOT=cdrom:\\SCUS_944.26;1\nTCB=4\n"), Some((Platform::Ps1, Some("SCUS-94426".to_string()))));
        assert_eq!(system_cnf("VMODE = NTSC\n"), None);

        let dir = std::env::temp_dir().join(format!("digitify-ps-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        // A tiny ISO 9660 image: the volume descriptor at sector 16, the root at 18, SYSTEM.CNF at 19.
        let mut iso = vec![0u8; 2048 * 20];
        let pvd = 16 * 2048;
        iso[pvd] = 1;
        iso[pvd + 1..pvd + 6].copy_from_slice(b"CD001");
        iso[pvd + 158..pvd + 162].copy_from_slice(&18u32.to_le_bytes());
        iso[pvd + 166..pvd + 170].copy_from_slice(&2048u32.to_le_bytes());
        let cnf = b"BOOT2 = cdrom0:\\SLES_523.27;1\r\n";
        let root = 18 * 2048;
        let name = b"SYSTEM.CNF;1";
        iso[root] = (33 + name.len()) as u8;
        iso[root + 2..root + 6].copy_from_slice(&19u32.to_le_bytes());
        iso[root + 10..root + 14].copy_from_slice(&(cnf.len() as u32).to_le_bytes());
        iso[root + 32] = name.len() as u8;
        iso[root + 33..root + 33 + name.len()].copy_from_slice(name);
        iso[19 * 2048..19 * 2048 + cnf.len()].copy_from_slice(cnf);
        let file = dir.join("Shadow of the Colossus (Europe).iso");
        std::fs::write(&file, &iso).unwrap();
        let game = identify(&file, None).unwrap();
        assert_eq!((game.platform, game.title.as_str(), game.game_id.as_deref()), (Platform::Ps2, "Shadow of the Colossus (Europe)", Some("SLES-52327")));
        // The same disc as a CUE sheet and its BIN of raw sectors.
        let mut raw = Vec::new();
        for sector in iso.chunks(2048) {
            let mut s = vec![0u8; 2352];
            s[1..11].fill(0xFF);
            s[15] = 2;
            s[24..24 + 2048].copy_from_slice(sector);
            raw.extend(s);
        }
        std::fs::write(dir.join("Game.bin"), &raw).unwrap();
        std::fs::write(dir.join("Game.cue"), "FILE \"Game.bin\" BINARY\n  TRACK 01 MODE2/2352\n").unwrap();
        assert_eq!(identify(&dir.join("Game.cue"), None).unwrap().platform, Platform::Ps2);
        assert_eq!(parts_of(&dir.join("Game.cue")), vec![dir.join("Game.bin")]);
        // Nothing to read in a CUE without its BIN: the emulator's folder decides.
        std::fs::write(dir.join("Lost.cue"), "FILE \"Lost.bin\" BINARY\n").unwrap();
        assert_eq!(identify(&dir.join("Lost.cue"), Some(Platform::Ps1)).unwrap().platform, Platform::Ps1);
        assert!(identify(&dir.join("Lost.cue"), None).is_none());

        let mut nds = vec![0u8; 0x200];
        nds[..11].copy_from_slice(b"POKEMON PL\0");
        nds[0x0C..0x10].copy_from_slice(b"CPUE");
        std::fs::write(dir.join("pokemon_platinum.nds"), &nds).unwrap();
        let ds = identify(&dir.join("pokemon_platinum.nds"), None).unwrap();
        assert_eq!((ds.platform, ds.title.as_str(), ds.game_id.as_deref()), (Platform::Ds, "pokemon platinum", Some("CPUE")));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn playstation_3_param_sfo() {
        // Two string values: TITLE and CATEGORY.
        let mut keys = b"CATEGORY\0TITLE\0TITLE_ID\0".to_vec();
        while keys.len() % 4 != 0 {
            keys.push(0);
        }
        let values: [&[u8]; 3] = [b"DG\0\0", b"Demon's Souls\0\0\0", b"BLUS30443\0\0\0"];
        let key_offsets = [0u16, 9, 15];
        let header = 20 + 16 * values.len();
        let mut sfo = vec![0u8; header];
        sfo[0..4].copy_from_slice(b"\0PSF");
        sfo[8..12].copy_from_slice(&(header as u32).to_le_bytes());
        sfo[12..16].copy_from_slice(&((header + keys.len()) as u32).to_le_bytes());
        sfo[16..20].copy_from_slice(&(values.len() as u32).to_le_bytes());
        let mut data = Vec::new();
        for (i, value) in values.iter().enumerate() {
            let e = 20 + i * 16;
            sfo[e..e + 2].copy_from_slice(&key_offsets[i].to_le_bytes());
            sfo[e + 2..e + 4].copy_from_slice(&0x0204u16.to_le_bytes());
            sfo[e + 4..e + 8].copy_from_slice(&(value.len() as u32).to_le_bytes());
            sfo[e + 8..e + 12].copy_from_slice(&(value.len() as u32).to_le_bytes());
            sfo[e + 12..e + 16].copy_from_slice(&(data.len() as u32).to_le_bytes());
            data.extend_from_slice(value);
        }
        sfo.extend(keys);
        sfo.extend(data);
        let read = sfo_values(&sfo);
        assert_eq!(read.get("TITLE").map(String::as_str), Some("Demon's Souls"));

        let dir = std::env::temp_dir().join(format!("digitify-ps3-{}", std::process::id()));
        let game = dir.join("Demons Souls");
        std::fs::create_dir_all(game.join("PS3_GAME")).unwrap();
        std::fs::write(game.join("PS3_GAME").join("PARAM.SFO"), &sfo).unwrap();
        let info = identify(&game.join("PS3_GAME").join("PARAM.SFO"), None).unwrap();
        assert_eq!((info.platform, info.title.as_str(), info.game_id.as_deref(), info.folder.as_deref()), (Platform::Ps3, "Demon's Souls", Some("BLUS30443"), Some(game.as_path())));
        // The same file outside a PS3_GAME folder is a disc's data copy, not a game.
        std::fs::write(dir.join("PARAM.SFO"), &sfo).unwrap();
        assert!(identify(&dir.join("PARAM.SFO"), None).is_none());
        let _ = std::fs::remove_dir_all(&dir);
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

    #[test]
    fn cartridges_by_their_headers_and_zipped() {
        let dir = std::env::temp_dir().join(format!("digitify-carts-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let write = |name: &str, bytes: &[u8]| {
            let path = dir.join(name);
            std::fs::write(&path, bytes).unwrap();
            path
        };
        // NES: iNES's header, or nothing.
        let mut nes = b"NES\x1a".to_vec();
        nes.resize(0x4010, 0);
        assert_eq!(identify(&write("Mega Man (USA).nes", &nes), None).unwrap().platform, Platform::Nes);
        assert!(identify(&write("fake.nes", &[0u8; 0x4010]), None).is_none());
        // Game Boy, and Game Boy Color by its flag.
        let mut gb = vec![0u8; 0x8000];
        gb[0x104..0x108].copy_from_slice(&[0xCE, 0xED, 0x66, 0x66]);
        gb[0x134..0x13E].copy_from_slice(b"TETRIS\0\0\0\0");
        let tetris = identify(&write("TETRIS.gb", &gb), None).unwrap();
        assert_eq!((tetris.platform, tetris.title.as_str()), (Platform::Gb, "Tetris"));
        gb[0x143] = 0xC0;
        assert_eq!(identify(&write("Pokemon Crystal (USA).gbc", &gb), None).unwrap().platform, Platform::Gbc);
        // Game Boy Advance: its fixed byte, title and code.
        let mut gba = vec![0u8; 0x200];
        gba[0xA0..0xAC].copy_from_slice(b"POKEMON EMER");
        gba[0xAC..0xB0].copy_from_slice(b"BPEE");
        gba[0xB2] = 0x96;
        let emerald = identify(&write("Pokemon - Emerald Version (USA).gba", &gba), None).unwrap();
        assert_eq!((emerald.platform, emerald.title.as_str(), emerald.game_id.as_deref()), (Platform::Gba, "Pokemon - Emerald Version (USA)", Some("BPEE")));
        // Super Nintendo by its kind of file (and a size a cartridge has).
        assert_eq!(identify(&write("Super Metroid (USA).sfc", &vec![0u8; 0x8000]), None).unwrap().platform, Platform::Snes);
        assert!(identify(&write("tiny.sfc", &[0u8; 16]), None).is_none());
        // A ZIP holding a ROM is that game, named after the ZIP; other ZIPs aren't games.
        let zipped = dir.join("Super Mario Bros. (World).zip");
        {
            let mut zip = zip::ZipWriter::new(std::fs::File::create(&zipped).unwrap());
            zip.start_file("Super Mario Bros. (World).nes", zip::write::SimpleFileOptions::default()).unwrap();
            std::io::Write::write_all(&mut zip, &nes).unwrap();
            zip.finish().unwrap();
        }
        let mario = identify(&zipped, None).unwrap();
        assert_eq!((mario.platform, mario.title.as_str()), (Platform::Nes, "Super Mario Bros. (World)"));
        let other = dir.join("photos.zip");
        {
            let mut zip = zip::ZipWriter::new(std::fs::File::create(&other).unwrap());
            zip.start_file("a.jpg", zip::write::SimpleFileOptions::default()).unwrap();
            zip.finish().unwrap();
        }
        assert!(identify(&other, None).is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn mega_drive_sega_cd_and_dreamcast() {
        let dir = std::env::temp_dir().join(format!("digitify-sega-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("Shenmue")).unwrap();
        // Mega Drive: "SEGA" at 0x100 and its overseas name.
        let mut md = vec![0u8; 0x8000];
        md[0x100..0x110].copy_from_slice(b"SEGA GENESIS    ");
        md[0x150..0x160].copy_from_slice(b"SONIC THE HEDGEH");
        let sonic = identify(&dir.join("SONIC.md").tap_write(&md), None).unwrap();
        assert_eq!((sonic.platform, sonic.title.as_str()), (Platform::Genesis, "Sonic The Hedgeh"));
        // As a .bin it's still the Mega Drive (not a PlayStation disc).
        assert_eq!(identify(&dir.join("Streets of Rage (USA).bin").tap_write(&md), None).unwrap().platform, Platform::Genesis);
        // Sega CD: its disc's signature, in a 2048-byte ISO and a raw BIN behind a CUE.
        let mut iso = vec![0u8; 0x8000];
        iso[..14].copy_from_slice(b"SEGADISCSYSTEM");
        assert_eq!(identify(&dir.join("Sonic CD (USA).iso").tap_write(&iso), None).unwrap().platform, Platform::SegaCd);
        let mut raw = vec![0u8; 0x8000];
        raw[0x10..0x1E].copy_from_slice(b"SEGADISCSYSTEM");
        dir.join("Lunar (USA).bin").tap_write(&raw);
        let cue = dir.join("Lunar (USA).cue").tap_write(b"FILE \"Lunar (USA).bin\" BINARY\n  TRACK 01 MODE1/2352\n");
        let lunar = identify(&cue, None).unwrap();
        assert_eq!((lunar.platform, lunar.title.as_str()), (Platform::SegaCd, "Lunar (USA)"));
        // Dreamcast: a GD-ROM's track list, named after its folder; its tracks aren't games.
        let gdi = dir.join("Shenmue").join("disc.gdi").tap_write(b"3\n1 0 4 2352 track01.bin 0\n2 756 0 2352 track02.raw 0\n3 45000 4 2352 track03.bin 0\n");
        let shenmue = identify(&gdi, None).unwrap();
        assert_eq!((shenmue.platform, shenmue.title.as_str()), (Platform::Dreamcast, "Shenmue"));
        assert_eq!(parts_of(&gdi), vec![dir.join("Shenmue").join("track01.bin"), dir.join("Shenmue").join("track02.raw"), dir.join("Shenmue").join("track03.bin")]);
        assert!(identify(&dir.join("notes.gdi").tap_write(b"hello"), None).is_none());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn psp_3ds_wii_u_xbox_and_switch() {
        let dir = std::env::temp_dir().join(format!("digitify-d116-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        // PSP: a UMD image, named by its PARAM.SFO.
        let mut iso = vec![0u8; 2048 * 24];
        let pvd = 16 * 2048;
        iso[pvd] = 1;
        iso[pvd + 1..pvd + 6].copy_from_slice(b"CD001");
        iso[pvd + 8..pvd + 16].copy_from_slice(b"PSP GAME");
        iso[pvd + 158..pvd + 162].copy_from_slice(&18u32.to_le_bytes());
        iso[pvd + 166..pvd + 170].copy_from_slice(&2048u32.to_le_bytes());
        let record = |iso: &mut Vec<u8>, at: usize, name: &[u8], lba: u32, size: u32, folder: bool| {
            iso[at] = (33 + name.len()) as u8;
            iso[at + 2..at + 6].copy_from_slice(&lba.to_le_bytes());
            iso[at + 10..at + 14].copy_from_slice(&size.to_le_bytes());
            iso[at + 25] = if folder { 2 } else { 0 };
            iso[at + 32] = name.len() as u8;
            iso[at + 33..at + 33 + name.len()].copy_from_slice(name);
        };
        record(&mut iso, 18 * 2048, b"PSP_GAME", 19, 2048, true);
        record(&mut iso, 19 * 2048, b"PARAM.SFO;1", 20, 2048, false);
        let sfo = {
            // A minimal PARAM.SFO: TITLE and DISC_ID.
            let keys = b"DISC_ID\0TITLE\0\0\0";
            let data: Vec<u8> = [b"ULUS10041\0\0\0".to_vec(), b"Lumen Racer\0".to_vec()].concat();
            let mut out = b"\0PSF".to_vec();
            out.extend(0x0101u32.to_le_bytes());
            out.extend((20u32 + 32).to_le_bytes());
            out.extend((20u32 + 32 + keys.len() as u32).to_le_bytes());
            out.extend(2u32.to_le_bytes());
            for (key, len, at) in [(0u16, 12u32, 0u32), (8, 12, 12)] {
                out.extend(key.to_le_bytes());
                out.extend(0x0204u16.to_le_bytes());
                out.extend(len.to_le_bytes());
                out.extend(len.to_le_bytes());
                out.extend(at.to_le_bytes());
            }
            out.extend(keys);
            out.extend(data);
            out
        };
        iso[20 * 2048..20 * 2048 + sfo.len()].copy_from_slice(&sfo);
        let psp = identify(&dir.join("game.iso").tap_write(&iso), None).unwrap();
        assert_eq!((psp.platform, psp.title.as_str(), psp.game_id.as_deref()), (Platform::Psp, "Lumen Racer", Some("ULUS10041")));
        // 3DS: an NCSD cartridge with its product code.
        let mut cart = vec![0u8; 0x400];
        cart[0x100..0x104].copy_from_slice(b"NCSD");
        cart[0x120..0x124].copy_from_slice(&1u32.to_le_bytes());
        cart[0x200 + 0x150..0x200 + 0x15A].copy_from_slice(b"CTR-P-AREE");
        let n3ds = identify(&dir.join("Land (USA).3ds").tap_write(&cart), None).unwrap();
        assert_eq!((n3ds.platform, n3ds.game_id.as_deref()), (Platform::N3ds, Some("AREE")));
        // Wii U: an installed folder, named by meta.xml, its rpx the program.
        let wiiu = dir.join("Kart Party");
        std::fs::create_dir_all(wiiu.join("code")).unwrap();
        std::fs::create_dir_all(wiiu.join("meta")).unwrap();
        std::fs::write(wiiu.join("meta").join("meta.xml"), r#"<?xml version="1.0"?><menu><product_code type="string">WUP-P-AMKE</product_code><company_code type="string">0001</company_code><longname_en type="string">Kart
Party 8</longname_en></menu>"#).unwrap();
        let rpx = wiiu.join("code").join("Kart.rpx").tap_write(b"\x7fELF");
        let game = identify(&rpx, None).unwrap();
        assert_eq!((game.platform, game.title.as_str(), game.game_id.as_deref(), game.folder.as_deref()), (Platform::WiiU, "Kart Party 8", Some("AMKE01"), Some(wiiu.as_path())));
        assert_eq!(folder_program(&wiiu), rpx);
        // Xbox and Xbox 360: a trimmed image with default.xbe or default.xex.
        let xiso = |program: &[u8]| {
            let mut bytes = vec![0u8; 0x12000];
            bytes[0x10000..0x10014].copy_from_slice(b"MICROSOFT*XBOX*MEDIA");
            bytes[0x10014..0x10018].copy_from_slice(&0x22u32.to_le_bytes());
            bytes[0x10018..0x1001C].copy_from_slice(&2048u32.to_le_bytes());
            bytes[0x11000 + 14..0x11000 + 14 + program.len()].copy_from_slice(program);
            bytes
        };
        assert_eq!(identify(&dir.join("halo.iso").tap_write(&xiso(b"default.xbe")), None).unwrap().platform, Platform::Xbox);
        assert_eq!(identify(&dir.join("gow.iso").tap_write(&xiso(b"default.xex")), None).unwrap().platform, Platform::Xbox360);
        // Switch: a package, its title ID from its name.
        let switch = identify(&dir.join("Hero Quest [0100ABCD12345000][v0].nsp").tap_write(b"PFS0\0\0\0\0"), None).unwrap();
        assert_eq!((switch.platform, switch.title.as_str(), switch.game_id.as_deref()), (Platform::Switch, "Hero Quest", Some("0100ABCD12345000")));
        let _ = std::fs::remove_dir_all(&dir);
    }

    trait TapWrite {
        fn tap_write(&self, bytes: &[u8]) -> PathBuf;
    }

    impl TapWrite for PathBuf {
        fn tap_write(&self, bytes: &[u8]) -> PathBuf {
            std::fs::write(self, bytes).unwrap();
            self.clone()
        }
    }
}

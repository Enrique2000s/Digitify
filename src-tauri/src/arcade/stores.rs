//! PC games installed through their stores (D-037): Steam (Windows and Linux), Epic Games and the
//! Xbox app (Windows), and Heroic Games Launcher (Linux: its Epic and GOG games). Only installed
//! games are listed, read from each store's own files on this computer; nothing is asked online.
//! A game starts through its store, the way its own launcher would start it.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

/// A store Arcade reads.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Store {
    Steam,
    Epic,
    Xbox,
    Heroic,
}

impl Store {
    pub const ALL: [Store; 4] = [Store::Steam, Store::Epic, Store::Xbox, Store::Heroic];

    pub fn key(self) -> &'static str {
        match self {
            Store::Steam => "steam",
            Store::Epic => "epic",
            Store::Xbox => "xbox",
            Store::Heroic => "heroic",
        }
    }

    pub fn parse(key: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|s| s.key() == key)
    }

    pub fn name(self) -> &'static str {
        match self {
            Store::Steam => "Steam",
            Store::Epic => "Epic Games",
            Store::Xbox => "Xbox",
            Store::Heroic => "Heroic",
        }
    }

    /// Whether it exists for this system.
    pub fn available_here(self) -> bool {
        match self {
            Store::Steam => true,
            Store::Epic | Store::Xbox => cfg!(windows),
            Store::Heroic => cfg!(not(windows)),
        }
    }
}

/// One installed game.
#[derive(Debug, Clone)]
pub struct StoreGame {
    pub store: Store,
    /// The store's own id for it (a Steam app id, an Epic app name, an Xbox package family name).
    pub key: String,
    pub title: String,
    /// Where it's installed: its running programs are recognized by it.
    pub install_dir: PathBuf,
    /// How to start it: a store link (`steam://…`, `com.epicgames.launcher://…`, `heroic://…`) or
    /// an app target (`shell:AppsFolder\…`).
    pub launch: String,
    /// Art for it already on this computer.
    pub cover: Option<PathBuf>,
    /// The art its launcher shows for it, online (Epic's and Heroic's own records name it; D-039).
    pub cover_url: Option<String>,
}

/// What was found for one store: where it is, and its installed games.
#[derive(Debug, Clone)]
pub struct StoreScan {
    pub store: Store,
    pub found: Option<String>,
    pub games: Vec<StoreGame>,
}

pub fn scan_all() -> Vec<StoreScan> {
    Store::ALL
        .into_iter()
        .filter(|s| s.available_here())
        .map(|store| {
            let (found, games) = match store {
                Store::Steam => steam(),
                Store::Epic => epic(),
                Store::Xbox => xbox(),
                Store::Heroic => heroic(),
            };
            StoreScan { store, found, games }
        })
        .collect()
}

/// A cheap fingerprint of every store's install records (names and modification times), to notice
/// a game installed or removed without reading everything again.
pub fn fingerprint() -> u64 {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    for dir in watched_dirs() {
        if let Ok(entries) = std::fs::read_dir(&dir) {
            let mut names: Vec<(String, u64)> = entries
                .filter_map(Result::ok)
                .map(|e| {
                    let modified = e.metadata().ok().and_then(|m| m.modified().ok()).and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map_or(0, |d| d.as_secs());
                    (e.file_name().to_string_lossy().into_owned(), modified)
                })
                .collect();
            names.sort();
            names.hash(&mut hasher);
        }
    }
    hasher.finish()
}

fn watched_dirs() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = steam_roots().iter().flat_map(|root| steam_libraries(root)).map(|lib| lib.join("steamapps")).collect();
    #[cfg(windows)]
    {
        dirs.push(epic_manifests());
        dirs.extend(xbox_roots());
    }
    #[cfg(not(windows))]
    dirs.extend(heroic_dirs());
    dirs
}

// ---------------------------------------------------------------------------------------------
// Steam

/// Steam's own tools that sit in the library like games.
const STEAM_TOOLS: [&str; 6] = ["Proton", "Steam Linux Runtime", "Steamworks Common Redistributables", "Steamworks SDK", "SteamVR", "Steam Audio"];

fn steam() -> (Option<String>, Vec<StoreGame>) {
    let roots = steam_roots();
    let Some(first) = roots.first() else { return (None, Vec::new()) };
    let mut games = Vec::new();
    let mut seen = HashSet::new();
    for root in &roots {
        for library in steam_libraries(root) {
            let apps = library.join("steamapps");
            let Ok(entries) = std::fs::read_dir(&apps) else { continue };
            for entry in entries.filter_map(Result::ok) {
                let name = entry.file_name().to_string_lossy().into_owned();
                if !(name.starts_with("appmanifest_") && name.ends_with(".acf")) {
                    continue;
                }
                let Ok(text) = std::fs::read_to_string(entry.path()) else { continue };
                let Some(game) = steam_manifest(&text, &apps, root) else { continue };
                if seen.insert(game.key.clone()) {
                    games.push(game);
                }
            }
        }
    }
    // Steam lists software and tools next to games (Blender, Wallpaper Engine…): its app info
    // says which is which; only games and demos stay. Without that file, everything stays.
    let wanted: HashSet<String> = games.iter().map(|g| g.key.clone()).collect();
    let mut kinds = std::collections::HashMap::new();
    for root in &roots {
        if let Ok(bytes) = std::fs::read(root.join("appcache").join("appinfo.vdf")) {
            kinds.extend(steam_app_types(&bytes, &wanted));
        }
    }
    games.retain(|g| kinds.get(&g.key).is_none_or(|kind| matches!(kind.as_str(), "game" | "demo" | "beta" | "mod")));
    (Some(first.display().to_string()), games)
}

/// Each wanted app's `common/type` (lower case) from Steam's binary `appinfo.vdf` (versions 27, 28
/// and 29; 29 keeps its keys in a string table at the end).
pub(crate) fn steam_app_types(bytes: &[u8], wanted: &HashSet<String>) -> std::collections::HashMap<String, String> {
    let mut out = std::collections::HashMap::new();
    let u32_at = |at: usize| bytes.get(at..at + 4).map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]));
    let Some(magic) = u32_at(0) else { return out };
    let (header, extra_sha, table) = match magic {
        0x0756_4427 => (8, false, None),
        0x0756_4428 => (8, true, None),
        0x0756_4429 => {
            let Some(offset) = bytes.get(8..16).map(|b| u64::from_le_bytes(b.try_into().unwrap_or([0; 8])) as usize) else { return out };
            let Some(count) = u32_at(offset) else { return out };
            let mut strings = Vec::with_capacity(count as usize);
            let mut at = offset + 4;
            for _ in 0..count {
                let end = bytes[at.min(bytes.len())..].iter().position(|&b| b == 0).map_or(bytes.len(), |p| at + p);
                strings.push(String::from_utf8_lossy(&bytes[at.min(end)..end]).into_owned());
                at = end + 1;
            }
            (16, true, Some(strings))
        }
        _ => return out,
    };
    let fixed = 4 + 4 + 8 + 20 + 4 + if extra_sha { 20 } else { 0 };
    let mut at = header;
    while let (Some(app), Some(size)) = (u32_at(at), u32_at(at + 4)) {
        if app == 0 {
            break;
        }
        let start = at + 8;
        let end = start + size as usize;
        if end > bytes.len() {
            break;
        }
        let id = app.to_string();
        if wanted.contains(&id) {
            let mut reader = KvReader { bytes: &bytes[start + fixed.min(size as usize)..end], at: 0, table: table.as_deref() };
            if let Some(kind) = reader.find_type() {
                out.insert(id, kind.to_lowercase());
            }
        }
        at = end;
    }
    out
}

/// Steam's binary KeyValues, read just far enough to find `common/type`.
struct KvReader<'a> {
    bytes: &'a [u8],
    at: usize,
    table: Option<&'a [String]>,
}

impl KvReader<'_> {
    fn byte(&mut self) -> Option<u8> {
        let b = *self.bytes.get(self.at)?;
        self.at += 1;
        Some(b)
    }
    fn cstring(&mut self) -> Option<String> {
        let rest = self.bytes.get(self.at..)?;
        let len = rest.iter().position(|&b| b == 0)?;
        let text = String::from_utf8_lossy(&rest[..len]).into_owned();
        self.at += len + 1;
        Some(text)
    }
    fn key(&mut self) -> Option<String> {
        match self.table {
            Some(table) => {
                let b = self.bytes.get(self.at..self.at + 4)?;
                self.at += 4;
                table.get(u32::from_le_bytes([b[0], b[1], b[2], b[3]]) as usize).cloned()
            }
            None => self.cstring(),
        }
    }
    /// Walks the tree; returns the `type` found directly inside a `common` node.
    fn find_type(&mut self) -> Option<String> {
        let mut path: Vec<String> = Vec::new();
        loop {
            let kind = self.byte()?;
            if kind == 0x08 {
                if path.pop().is_none() {
                    return None;
                }
                continue;
            }
            let key = self.key()?;
            match kind {
                0x00 => path.push(key),
                0x01 => {
                    let value = self.cstring()?;
                    if key.eq_ignore_ascii_case("type") && path.last().is_some_and(|p| p.eq_ignore_ascii_case("common")) {
                        return Some(value);
                    }
                }
                0x02 | 0x04 | 0x06 => self.at += 4,
                0x03 => self.at += 4,
                0x07 | 0x0A => self.at += 8,
                _ => return None,
            }
        }
    }
}

/// One `appmanifest_<id>.acf`: an installed game (fully installed: state flag 4), or none.
pub(crate) fn steam_manifest(text: &str, apps: &Path, root: &Path) -> Option<StoreGame> {
    let value = |key: &str| vdf_value(text, key);
    let id = value("appid")?;
    let title = value("name")?;
    let flags: u64 = value("StateFlags").and_then(|v| v.parse().ok()).unwrap_or(0);
    if flags & 4 == 0 || STEAM_TOOLS.iter().any(|t| title.starts_with(t)) {
        return None;
    }
    let install_dir = apps.join("common").join(value("installdir")?);
    Some(StoreGame {
        store: Store::Steam,
        launch: format!("steam://rungameid/{id}"),
        cover: steam_cover(root, &id),
        cover_url: None,
        key: id,
        title,
        install_dir,
    })
}

/// Steam's cached library art: `appcache/librarycache/<id>_library_600x900.jpg`, or the newer
/// `appcache/librarycache/<id>/…/library_600x900.jpg`.
fn steam_cover(root: &Path, id: &str) -> Option<PathBuf> {
    let cache = root.join("appcache").join("librarycache");
    let flat = cache.join(format!("{id}_library_600x900.jpg"));
    if flat.is_file() {
        return Some(flat);
    }
    walkdir::WalkDir::new(cache.join(id)).max_depth(3).into_iter().filter_map(Result::ok).map(|e| e.into_path()).find(|p| {
        p.file_name().map(|n| n.to_string_lossy().to_ascii_lowercase()).is_some_and(|n| n == "library_600x900.jpg" || n == "library_capsule.jpg")
    })
}

/// The first `"key" "value"` in a Valve KeyValues text.
pub(crate) fn vdf_value(text: &str, key: &str) -> Option<String> {
    let needle = format!("\"{key}\"");
    text.lines().find_map(|line| {
        let line = line.trim();
        let rest = line.strip_prefix(&needle)?;
        let value = rest.trim().strip_prefix('"')?.strip_suffix('"')?;
        Some(value.replace("\\\\", "\\"))
    })
}

/// Every `"path"` in `libraryfolders.vdf`, plus the Steam folder itself.
fn steam_libraries(root: &Path) -> Vec<PathBuf> {
    let mut libraries = vec![root.to_path_buf()];
    if let Ok(text) = std::fs::read_to_string(root.join("steamapps").join("libraryfolders.vdf")) {
        for line in text.lines() {
            let line = line.trim();
            if let Some(rest) = line.strip_prefix("\"path\"") {
                if let Some(path) = rest.trim().strip_prefix('"').and_then(|r| r.strip_suffix('"')) {
                    libraries.push(PathBuf::from(path.replace("\\\\", "\\")));
                }
            }
        }
    }
    dedupe(libraries)
}

fn dedupe(paths: Vec<PathBuf>) -> Vec<PathBuf> {
    let mut seen = HashSet::new();
    paths
        .into_iter()
        .filter(|p| p.is_dir())
        .filter(|p| seen.insert(std::fs::canonicalize(p).unwrap_or_else(|_| p.clone())))
        .collect()
}

fn steam_roots() -> Vec<PathBuf> {
    #[cfg(windows)]
    {
        let mut roots = Vec::new();
        if let Some(path) = registry_value("HKCU\\Software\\Valve\\Steam", "SteamPath") {
            roots.push(PathBuf::from(path.replace('/', "\\")));
        }
        for var in ["ProgramFiles(x86)", "ProgramFiles"] {
            if let Some(dir) = std::env::var_os(var) {
                roots.push(PathBuf::from(dir).join("Steam"));
            }
        }
        dedupe(roots)
    }
    #[cfg(not(windows))]
    {
        let home = std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default();
        dedupe(vec![
            home.join(".local/share/Steam"),
            home.join(".steam/steam"),
            home.join(".steam/debian-installation"),
            home.join(".var/app/com.valvesoftware.Steam/.local/share/Steam"),
            home.join("snap/steam/common/.local/share/Steam"),
        ])
    }
}

/// A value from the registry, through `reg.exe` (read-only).
#[cfg(windows)]
fn registry_value(key: &str, name: &str) -> Option<String> {
    let output = crate::tools::command(Path::new("reg")).args(["query", key, "/v", name]).output().ok()?;
    let text = String::from_utf8_lossy(&output.stdout);
    text.lines().find_map(|line| {
        let mut parts = line.trim().splitn(3, "    ");
        let found = parts.next()?.trim();
        let _kind = parts.next()?;
        (found.eq_ignore_ascii_case(name)).then(|| parts.next().map(|v| v.trim().to_string())).flatten()
    })
}

// ---------------------------------------------------------------------------------------------
// Epic Games (Windows)

#[cfg(windows)]
fn epic_manifests() -> PathBuf {
    std::env::var_os("ProgramData").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("C:\\ProgramData")).join("Epic\\EpicGamesLauncher\\Data\\Manifests")
}

#[cfg(windows)]
fn epic() -> (Option<String>, Vec<StoreGame>) {
    let dir = epic_manifests();
    let Ok(entries) = std::fs::read_dir(&dir) else { return (None, Vec::new()) };
    // The launcher's catalog cache, beside the manifests: its art for each game.
    let art = dir.parent().and_then(|data| std::fs::read(data.join("Catalog").join("catcache.bin")).ok()).map(|bin| epic_art(&bin)).unwrap_or_default();
    let games = entries
        .filter_map(Result::ok)
        .filter(|e| e.path().extension().is_some_and(|x| x.eq_ignore_ascii_case("item")))
        .filter_map(|e| std::fs::read_to_string(e.path()).ok())
        .filter_map(|text| epic_manifest(&text))
        .map(|mut game: StoreGame| {
            game.cover_url = art.get(&game.key).cloned();
            game
        })
        .collect();
    (Some("Epic Games Launcher".into()), games)
}

#[cfg(not(windows))]
fn epic() -> (Option<String>, Vec<StoreGame>) {
    (None, Vec::new())
}

/// Epic's catalog cache (`catcache.bin`, Base64 of a JSON list): each app's tall cover, the one the
/// launcher's library shows.
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn epic_art(bin: &[u8]) -> HashMap<String, String> {
    let mut out = HashMap::new();
    let Some(json) = base64_decode(bin) else { return out };
    let Ok(serde_json::Value::Array(items)) = serde_json::from_slice::<serde_json::Value>(&json) else { return out };
    for item in items {
        let images = item.get("keyImages").and_then(|x| x.as_array()).cloned().unwrap_or_default();
        let url = |kind: &str| images.iter().find(|i| i.get("type").and_then(|t| t.as_str()) == Some(kind)).and_then(|i| i.get("url")?.as_str().map(str::to_string));
        let Some(url) = url("DieselGameBoxTall").or_else(|| url("DieselGameBox")) else { continue };
        for release in item.get("releaseInfo").and_then(|x| x.as_array()).into_iter().flatten() {
            if let Some(app) = release.get("appId").and_then(|x| x.as_str()) {
                out.entry(app.to_string()).or_insert_with(|| url.clone());
            }
        }
    }
    out
}

/// Standard Base64 (whitespace skipped).
fn base64_decode(text: &[u8]) -> Option<Vec<u8>> {
    let mut out = Vec::with_capacity(text.len() * 3 / 4);
    let (mut acc, mut bits) = (0u32, 0u32);
    for &c in text {
        let v = match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'+' | b'-' => 62,
            b'/' | b'_' => 63,
            b'=' => break,
            b' ' | b'\r' | b'\n' | b'\t' => continue,
            _ => return None,
        };
        acc = (acc << 6) | u32::from(v);
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
            acc &= (1 << bits) - 1;
        }
    }
    Some(out)
}

/// One Epic `.item` manifest: an installed game (not a plug-in, not unfinished), or none.
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn epic_manifest(text: &str) -> Option<StoreGame> {
    let v: serde_json::Value = serde_json::from_str(text).ok()?;
    let s = |k: &str| v.get(k).and_then(|x| x.as_str()).map(str::to_string);
    let app = s("AppName")?;
    if v.get("bIsIncompleteInstall").and_then(|x| x.as_bool()) == Some(true) {
        return None;
    }
    if s("MainGameAppName").is_some_and(|main| !main.is_empty() && main != app) {
        return None; // add-on content
    }
    let categories: Vec<String> = v.get("AppCategories").and_then(|x| x.as_array()).map(|a| a.iter().filter_map(|c| c.as_str().map(str::to_string)).collect()).unwrap_or_default();
    if !categories.is_empty() && !categories.iter().any(|c| c == "games") {
        return None;
    }
    let namespace = s("CatalogNamespace")?;
    let item = s("CatalogItemId")?;
    Some(StoreGame {
        store: Store::Epic,
        title: s("DisplayName").unwrap_or_else(|| app.clone()),
        install_dir: PathBuf::from(s("InstallLocation")?),
        launch: format!("com.epicgames.launcher://apps/{namespace}%3A{item}%3A{app}?action=launch&silent=true"),
        cover: None,
        cover_url: None,
        key: app,
    })
}

// ---------------------------------------------------------------------------------------------
// Xbox app (Windows): games in the folders the Xbox app installs to

#[cfg(windows)]
fn xbox_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    for letter in b'C'..=b'Z' {
        let drive = PathBuf::from(format!("{}:\\", letter as char));
        // `.GamingRoot` names the drive's game folders (UTF-16 after an 8-byte header).
        if let Ok(bytes) = std::fs::read(drive.join(".GamingRoot")) {
            if bytes.len() > 8 && &bytes[..4] == b"RGBX" {
                let units: Vec<u16> = bytes[8..].chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
                for name in String::from_utf16_lossy(&units).split('\0').filter(|n| !n.is_empty()) {
                    roots.push(drive.join(name));
                }
            }
        }
        roots.push(drive.join("XboxGames"));
    }
    dedupe(roots)
}

#[cfg(windows)]
fn xbox() -> (Option<String>, Vec<StoreGame>) {
    let roots = xbox_roots();
    if roots.is_empty() {
        return (None, Vec::new());
    }
    let mut games = Vec::new();
    for root in &roots {
        let Ok(entries) = std::fs::read_dir(root) else { continue };
        for entry in entries.filter_map(Result::ok) {
            let content = entry.path().join("Content");
            if let Some(game) = xbox_game(&content) {
                games.push(game);
            }
        }
    }
    (Some(roots.iter().map(|r| r.display().to_string()).collect::<Vec<_>>().join(", ")), games)
}

#[cfg(not(windows))]
fn xbox() -> (Option<String>, Vec<StoreGame>) {
    (None, Vec::new())
}

/// An Xbox app game from its `Content` folder: `MicrosoftGame.config` (name, logos) and
/// `appxmanifest.xml` (package identity and app id, for `shell:AppsFolder\<family>!<app>`).
#[cfg(windows)]
fn xbox_game(content: &Path) -> Option<StoreGame> {
    let config = std::fs::read_to_string(content.join("MicrosoftGame.config")).ok()?;
    let manifest = std::fs::read_to_string(content.join("appxmanifest.xml")).or_else(|_| std::fs::read_to_string(content.join("AppxManifest.xml"))).ok()?;
    let config = roxmltree::Document::parse(&config).ok()?;
    let manifest = roxmltree::Document::parse(&manifest).ok()?;
    let identity = manifest.descendants().find(|n| n.has_tag_name("Identity"))?;
    let name = identity.attribute("Name")?;
    let publisher = identity.attribute("Publisher")?;
    let app = manifest.descendants().find(|n| n.has_tag_name("Application")).and_then(|n| n.attribute("Id")).unwrap_or("Game");
    let family = format!("{name}_{}", publisher_id(publisher));
    let visuals = config.descendants().find(|n| n.has_tag_name("ShellVisuals"));
    let title = visuals
        .and_then(|v| v.attribute("DefaultDisplayName"))
        .filter(|t| !t.starts_with("ms-resource:"))
        .map(str::to_string)
        .unwrap_or_else(|| content.parent().and_then(|p| p.file_name()).map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| name.to_string()));
    let cover = visuals.and_then(|v| {
        ["Square480x480Logo", "Square150x150Logo", "StoreLogo", "Square44x44Logo"]
            .iter()
            .filter_map(|attr| v.attribute(*attr))
            .map(|file| content.join(file))
            .find(|p| p.is_file())
    });
    Some(StoreGame { store: Store::Xbox, key: family.clone(), title, install_dir: content.to_path_buf(), launch: format!("shell:AppsFolder\\{family}!{app}"), cover, cover_url: None })
}

/// The publisher part of a package family name: the first 8 bytes of SHA-256 over the publisher
/// (UTF-16LE), in Crockford's base32 (13 lowercase characters).
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn publisher_id(publisher: &str) -> String {
    use sha2::{Digest, Sha256};
    let utf16: Vec<u8> = publisher.encode_utf16().flat_map(|u| u.to_le_bytes()).collect();
    let hash = Sha256::digest(&utf16);
    let value = u64::from_be_bytes(hash[..8].try_into().unwrap_or([0; 8]));
    const ALPHABET: &[u8] = b"0123456789abcdefghjkmnpqrstvwxyz";
    // 64 bits plus one zero bit make 13 groups of 5.
    let bits = (value as u128) << 1;
    (0..13).rev().map(|i| ALPHABET[((bits >> (i * 5)) & 31) as usize] as char).collect()
}

// ---------------------------------------------------------------------------------------------
// Heroic Games Launcher (Linux): its Epic (Legendary) and GOG games

#[cfg(not(windows))]
fn heroic_bases() -> Vec<PathBuf> {
    let home = std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default();
    let config = std::env::var_os("XDG_CONFIG_HOME").map(PathBuf::from).unwrap_or_else(|| home.join(".config"));
    [config.join("heroic"), home.join(".var/app/com.heroicgameslauncher.hgl/config/heroic")].into_iter().filter(|p| p.is_dir()).collect()
}

#[cfg(not(windows))]
fn heroic_dirs() -> Vec<PathBuf> {
    heroic_bases()
        .into_iter()
        .flat_map(|base| [base.join("legendaryConfig/legendary"), base.join("gog_store")])
        .filter(|p| p.is_dir())
        .collect()
}

/// The art Heroic's library shows for each game, from its library caches (`art_square`, its tall
/// cover; else `art_cover`), by app name.
#[cfg_attr(windows, allow(dead_code))]
pub(crate) fn heroic_art(text: &str) -> HashMap<String, String> {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(text) else { return HashMap::new() };
    ["library", "games"]
        .iter()
        .filter_map(|k| v.get(*k).and_then(|x| x.as_array()))
        .flatten()
        .filter_map(|g| {
            let app = g.get("app_name")?.as_str()?.to_string();
            let art = ["art_square", "art_cover"].iter().find_map(|k| g.get(*k).and_then(|x| x.as_str()).filter(|s| s.starts_with("http")))?;
            Some((app, art.to_string()))
        })
        .collect()
}

#[cfg(not(windows))]
fn heroic() -> (Option<String>, Vec<StoreGame>) {
    let dirs = heroic_dirs();
    if dirs.is_empty() {
        return (None, Vec::new());
    }
    let mut games = Vec::new();
    for dir in &dirs {
        if let Ok(text) = std::fs::read_to_string(dir.join("installed.json")) {
            if dir.ends_with("legendary") {
                games.extend(heroic_legendary(&text));
            } else {
                let library = std::fs::read_to_string(dir.join("library.json")).unwrap_or_default();
                games.extend(heroic_gog(&text, &library));
            }
        }
    }
    let mut seen = HashSet::new();
    games.retain(|g| seen.insert(g.key.clone()));
    let mut art = HashMap::new();
    for base in heroic_bases() {
        for file in ["store_cache/legendary_library.json", "store_cache/gog_library.json", "gog_store/library.json"] {
            if let Ok(text) = std::fs::read_to_string(base.join(file)) {
                for (app, url) in heroic_art(&text) {
                    art.entry(app).or_insert(url);
                }
            }
        }
    }
    for game in &mut games {
        let app = game.key.split_once(':').map_or(game.key.as_str(), |(_, a)| a);
        game.cover_url = art.get(app).cloned();
    }
    (Some("Heroic Games Launcher".into()), games)
}

#[cfg(windows)]
fn heroic() -> (Option<String>, Vec<StoreGame>) {
    (None, Vec::new())
}

/// Legendary's `installed.json`: `{ "<app>": { "title", "install_path", "is_dlc" } }`.
#[cfg_attr(windows, allow(dead_code))]
pub(crate) fn heroic_legendary(text: &str) -> Vec<StoreGame> {
    let Ok(serde_json::Value::Object(map)) = serde_json::from_str::<serde_json::Value>(text) else { return Vec::new() };
    map.into_iter()
        .filter_map(|(app, v)| {
            if v.get("is_dlc").and_then(|x| x.as_bool()) == Some(true) {
                return None;
            }
            Some(StoreGame {
                store: Store::Heroic,
                title: v.get("title").and_then(|x| x.as_str()).unwrap_or(&app).to_string(),
                install_dir: PathBuf::from(v.get("install_path")?.as_str()?),
                launch: format!("heroic://launch/legendary/{app}"),
                cover: None,
                cover_url: None,
                key: format!("legendary:{app}"),
            })
        })
        .collect()
}

/// Heroic's GOG `installed.json` (`{ "installed": [{ "appName", "install_path" }] }`), titles from
/// its `library.json` when there.
#[cfg_attr(windows, allow(dead_code))]
pub(crate) fn heroic_gog(text: &str, library: &str) -> Vec<StoreGame> {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(text) else { return Vec::new() };
    let titles: std::collections::HashMap<String, String> = serde_json::from_str::<serde_json::Value>(library)
        .ok()
        .and_then(|l| l.get("games").and_then(|g| g.as_array()).cloned())
        .unwrap_or_default()
        .into_iter()
        .filter_map(|g| Some((g.get("app_name")?.as_str()?.to_string(), g.get("title")?.as_str()?.to_string())))
        .collect();
    v.get("installed")
        .and_then(|i| i.as_array())
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|g| {
            let app = g.get("appName")?.as_str()?.to_string();
            let install = PathBuf::from(g.get("install_path")?.as_str()?);
            let title = titles.get(&app).cloned().unwrap_or_else(|| install.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| app.clone()));
            Some(StoreGame { store: Store::Heroic, title, install_dir: install, launch: format!("heroic://launch/gog/{app}"), cover: None, cover_url: None, key: format!("gog:{app}") })
        })
        .collect()
}

/// Steam's public library art for a game, when it has none cached (D-037; only with "Download covers").
pub fn steam_cover_urls(id: &str) -> Vec<String> {
    vec![
        format!("https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/{id}/library_600x900.jpg"),
        format!("https://cdn.cloudflare.steamstatic.com/steam/apps/{id}/library_600x900.jpg"),
        format!("https://cdn.cloudflare.steamstatic.com/steam/apps/{id}/header.jpg"),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn steam_manifests_list_installed_games_only() {
        let game = "\"AppState\"\n{\n\t\"appid\"\t\t\"620\"\n\t\"name\"\t\t\"Portal 2\"\n\t\"StateFlags\"\t\t\"4\"\n\t\"installdir\"\t\t\"Portal 2\"\n}\n";
        let g = steam_manifest(game, Path::new("/s/steamapps"), Path::new("/s")).unwrap();
        assert_eq!((g.key.as_str(), g.title.as_str(), g.launch.as_str()), ("620", "Portal 2", "steam://rungameid/620"));
        assert_eq!(g.install_dir, Path::new("/s/steamapps/common/Portal 2"));
        let downloading = game.replace("\"StateFlags\"\t\t\"4\"", "\"StateFlags\"\t\t\"1026\"");
        assert!(steam_manifest(&downloading, Path::new("/s/steamapps"), Path::new("/s")).is_none(), "not fully installed");
        let tool = game.replace("Portal 2\"\n\t\"StateFlags", "Proton 9.0\"\n\t\"StateFlags");
        assert!(steam_manifest(&tool, Path::new("/s/steamapps"), Path::new("/s")).is_none(), "Steam's own tools aren't games");
    }

    #[test]
    fn steam_app_info_types() {
        // A version-29 appinfo.vdf: header, one app whose KeyValues say common/type = Application,
        // then the string table.
        let mut kv = Vec::new();
        kv.push(0x00u8);
        kv.extend(0u32.to_le_bytes()); // "appinfo"
        kv.push(0x00);
        kv.extend(1u32.to_le_bytes()); // "common"
        kv.push(0x01);
        kv.extend(2u32.to_le_bytes()); // "type"
        kv.extend(b"Application\0");
        kv.extend([0x08, 0x08, 0x08]);
        let fixed = vec![0u8; 4 + 4 + 8 + 20 + 4 + 20];
        let mut entry = Vec::new();
        entry.extend(365670u32.to_le_bytes());
        entry.extend(((fixed.len() + kv.len()) as u32).to_le_bytes());
        entry.extend(&fixed);
        entry.extend(&kv);
        let mut file = Vec::new();
        file.extend(0x0756_4429u32.to_le_bytes());
        file.extend(1u32.to_le_bytes());
        let table_at = 16 + entry.len() + 4;
        file.extend((table_at as u64).to_le_bytes());
        file.extend(&entry);
        file.extend(0u32.to_le_bytes());
        file.extend(3u32.to_le_bytes());
        file.extend(b"appinfo\0common\0type\0");
        let wanted: HashSet<String> = ["365670".to_string()].into();
        assert_eq!(steam_app_types(&file, &wanted).get("365670").map(String::as_str), Some("application"));
        assert!(steam_app_types(b"nonsense", &wanted).is_empty());
    }

    #[test]
    fn epic_manifests_skip_addons_and_unfinished_installs() {
        let item = r#"{"AppName":"Fortnite","DisplayName":"Fortnite","InstallLocation":"C:\\Games\\Fortnite","CatalogNamespace":"fn","CatalogItemId":"4fe7","AppCategories":["public","games","applications"],"bIsIncompleteInstall":false,"MainGameAppName":"Fortnite"}"#;
        let g = epic_manifest(item).unwrap();
        assert_eq!(g.launch, "com.epicgames.launcher://apps/fn%3A4fe7%3AFortnite?action=launch&silent=true");
        assert!(epic_manifest(&item.replace("\"MainGameAppName\":\"Fortnite\"", "\"MainGameAppName\":\"Other\"")).is_none());
        assert!(epic_manifest(&item.replace("\"bIsIncompleteInstall\":false", "\"bIsIncompleteInstall\":true")).is_none());
        // A main game's MainGameAppName is empty (D-039).
        assert!(epic_manifest(&item.replace("\"MainGameAppName\":\"Fortnite\"", "\"MainGameAppName\":\"\"")).is_some());
    }

    #[test]
    fn launcher_art_from_epic_and_heroic() {
        let json = r#"[{"keyImages":[{"type":"DieselGameBox","url":"https://x/wide"},{"type":"DieselGameBoxTall","url":"https://x/tall"}],"releaseInfo":[{"appId":"Sugar"}]},{"keyImages":[],"releaseInfo":[{"appId":"Other"}]}]"#;
        let alphabet = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut b64 = String::new();
        for chunk in json.as_bytes().chunks(3) {
            let n = chunk.iter().enumerate().fold(0u32, |acc, (i, &b)| acc | (u32::from(b) << (16 - 8 * i)));
            for i in 0..4 {
                b64.push(if i <= chunk.len() { alphabet[((n >> (18 - 6 * i)) & 63) as usize] as char } else { '=' });
            }
        }
        let art = epic_art(b64.as_bytes());
        assert_eq!(art.get("Sugar").map(String::as_str), Some("https://x/tall"));
        assert!(!art.contains_key("Other"));
        let heroic = heroic_art(r#"{"library":[{"app_name":"Sable","art_square":"https://h/sq","art_cover":"https://h/c"},{"app_name":"NoArt","art_square":"fallback"}]}"#);
        assert_eq!(heroic.get("Sable").map(String::as_str), Some("https://h/sq"));
        assert!(!heroic.contains_key("NoArt"));
    }

    #[test]
    fn package_family_publisher_id() {
        // Microsoft's own publisher id, as seen in package family names (…_8wekyb3d8bbwe).
        assert_eq!(publisher_id("CN=Microsoft Corporation, O=Microsoft Corporation, L=Redmond, S=Washington, C=US"), "8wekyb3d8bbwe");
    }

    #[test]
    fn heroic_installed_games() {
        let legendary = r#"{"Sable":{"title":"Sable","install_path":"/home/me/Games/Heroic/Sable","is_dlc":false},"SableDLC":{"title":"x","install_path":"/x","is_dlc":true}}"#;
        let games = heroic_legendary(legendary);
        assert_eq!(games.len(), 1);
        assert_eq!(games[0].launch, "heroic://launch/legendary/Sable");
        let gog = r#"{"installed":[{"appName":"1207658924","install_path":"/home/me/Games/Heroic/Unreal Gold","platform":"windows"}]}"#;
        let library = r#"{"games":[{"app_name":"1207658924","title":"Unreal Gold"}]}"#;
        assert_eq!(heroic_gog(gog, library)[0].title, "Unreal Gold");
    }
}

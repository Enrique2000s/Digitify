//! RetroArch's games (D-101): the playlists it keeps of what it found (`playlists/*.lpl`, JSON),
//! each game with the core that plays it. Each game goes to its console's view; it starts in
//! RetroArch with that core. Its box art comes from RetroArch's own downloads (`thumbnails`).

use std::path::{Path, PathBuf};

/// One game in a RetroArch playlist.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RetroGame {
    /// The game's file; a file inside an archive is `archive.zip#game.sfc`.
    pub path: String,
    pub title: String,
    /// The core that plays it, when the playlist names one.
    pub core: Option<String>,
    /// RetroArch's name for its console ("Nintendo - Super Nintendo Entertainment System").
    pub system: String,
}

/// Every game in the playlists in `dir`. RetroArch's own lists (history, favorites, music…) repeat
/// games already in the consoles' playlists and are left out.
pub fn games(dir: &Path) -> Vec<RetroGame> {
    let Ok(entries) = std::fs::read_dir(dir) else { return Vec::new() };
    let mut files: Vec<PathBuf> = entries
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|e| e.eq_ignore_ascii_case("lpl")))
        .filter(|p| !p.file_name().is_some_and(|n| n.to_string_lossy().starts_with("content_")))
        .collect();
    files.sort();
    files
        .iter()
        .flat_map(|file| {
            let system = file.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
            std::fs::read_to_string(file).map(|text| playlist(&text, &system)).unwrap_or_default()
        })
        .collect()
}

/// A playlist's games (RetroArch's JSON format, 1.7.6 on); `system` is the playlist's name.
pub(crate) fn playlist(text: &str, system: &str) -> Vec<RetroGame> {
    let Ok(json) = serde_json::from_str::<serde_json::Value>(text) else { return Vec::new() };
    let named = |value: Option<&serde_json::Value>| value.and_then(|v| v.as_str()).map(str::trim).filter(|v| !v.is_empty() && !v.eq_ignore_ascii_case("DETECT")).map(str::to_string);
    let default_core = named(json.get("default_core_path"));
    let Some(items) = json.get("items").and_then(|i| i.as_array()) else { return Vec::new() };
    items
        .iter()
        .filter_map(|item| {
            let path = named(item.get("path"))?;
            let title = named(item.get("label")).unwrap_or_else(|| super::games::title_from_name(Path::new(path.split('#').next_back().unwrap_or(&path))));
            let system = named(item.get("db_name")).map(|d| d.trim_end_matches(".lpl").to_string()).unwrap_or_else(|| system.to_string());
            Some(RetroGame { path, title, core: named(item.get("core_path")).or_else(|| default_core.clone()), system })
        })
        .collect()
}

/// The file on disk behind a game's path (the archive, for a file inside one).
pub fn file_of(path: &str) -> PathBuf {
    let whole = PathBuf::from(path);
    if whole.exists() || !path.contains('#') {
        return whole;
    }
    PathBuf::from(path.rsplit_once('#').map_or(path, |(archive, _)| archive))
}

/// Arcade's view for one of RetroArch's consoles; the ones without a view of their own share
/// "Other consoles".
pub fn platform_of(system: &str) -> &'static str {
    match system {
        "Nintendo - Nintendo Entertainment System" | "Nintendo - Family Computer Disk System" => "nes",
        "Nintendo - Super Nintendo Entertainment System" | "Nintendo - Satellaview" | "Nintendo - Sufami Turbo" => "snes",
        "Nintendo - Nintendo 64" | "Nintendo - Nintendo 64DD" => "n64",
        "Nintendo - GameCube" => "gamecube",
        "Nintendo - Wii" => "wii",
        "Nintendo - Game Boy" => "gb",
        "Nintendo - Game Boy Color" => "gbc",
        "Nintendo - Game Boy Advance" => "gba",
        "Nintendo - Nintendo DS" | "Nintendo - Nintendo DSi" | "Nintendo - Nintendo DS Decrypted" => "ds",
        "Nintendo - Nintendo 3DS" => "3ds",
        "Sega - Master System - Mark III" => "sms",
        "Sega - Mega Drive - Genesis" | "Sega - 32X" => "genesis",
        "Sega - Mega-CD - Sega CD" => "segacd",
        "Sega - Game Gear" => "gamegear",
        "Sega - Saturn" => "saturn",
        "Sega - Dreamcast" => "dreamcast",
        "Sony - PlayStation" => "ps1",
        "Sony - PlayStation 2" => "ps2",
        "Sony - PlayStation 3" => "ps3",
        "Sony - PlayStation Portable" => "psp",
        "NEC - PC Engine - TurboGrafx 16" | "NEC - PC Engine CD - TurboGrafx-CD" | "NEC - PC Engine SuperGrafx" => "pce",
        "Atari - 2600" => "atari2600",
        "MAME" | "FBNeo - Arcade Games" | "SNK - Neo Geo" | "MAME 2003-Plus" | "MAME 2010" => "arcade",
        _ if system.starts_with("MAME") => "arcade",
        _ => "other",
    }
}

/// RetroArch's downloaded box art for a game: `thumbnails/<console>/Named_Boxarts/<name>.png`,
/// with the characters it can't use in names (`&*/:\`<>?\|"`) as `_`.
pub fn thumbnail(thumbnails: &Path, system: &str, names: &[String]) -> Option<PathBuf> {
    let dir = thumbnails.join(system).join("Named_Boxarts");
    names
        .iter()
        .map(|name| name.chars().map(|c| if "&*/:`<>?\\|\"".contains(c) { '_' } else { c }).collect::<String>())
        .map(|name| dir.join(format!("{name}.png")))
        .find(|p| p.is_file())
}

/// libretro-thumbnails' name for a console's collection (spaces as underscores).
pub fn libretro_system(system: &str) -> String {
    system.replace(' ', "_")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn playlists_give_games_cores_and_consoles() {
        let text = r#"{
          "version": "1.5",
          "default_core_path": "C:\\RetroArch\\cores\\snes9x_libretro.dll",
          "items": [
            { "path": "D:\\ROMs\\SNES\\Super Metroid (USA).sfc", "label": "Super Metroid (Japan, USA)", "core_path": "DETECT", "db_name": "Nintendo - Super Nintendo Entertainment System.lpl" },
            { "path": "D:\\ROMs\\SNES\\pack.zip#Zelda.sfc", "label": "", "core_path": "C:\\RetroArch\\cores\\bsnes_libretro.dll", "db_name": "" },
            { "label": "no path" }
          ]
        }"#;
        let games = playlist(text, "Nintendo - Super Nintendo Entertainment System");
        assert_eq!(games.len(), 2);
        assert_eq!(games[0].core.as_deref(), Some("C:\\RetroArch\\cores\\snes9x_libretro.dll"), "DETECT falls back to the playlist's core");
        assert_eq!(games[1].title, "Zelda");
        assert_eq!(platform_of(&games[1].system), "snes");
        assert_eq!(platform_of("Bandai - WonderSwan"), "other");
        assert_eq!(file_of("D:\\nowhere\\pack.zip#Zelda.sfc"), PathBuf::from("D:\\nowhere\\pack.zip"));
        assert_eq!(libretro_system("Sony - PlayStation"), "Sony_-_PlayStation");
    }
}

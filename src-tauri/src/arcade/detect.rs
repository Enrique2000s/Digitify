//! Finding the emulators Arcade launches (D-034) and the game folders set up in them.
//!
//! - Dolphin (GameCube, Wii): Windows and Linux (native or Flatpak). Folders: `Dolphin.ini`,
//!   `[General]` `ISOPaths` / `ISOPath0…` / `RecursiveISOPaths`. Covers it downloaded itself:
//!   its `GameCovers` cache.
//! - Project64 (Nintendo 64): Windows only. Folder: `Config\Project64.cfg`, `[Game Directory]`
//!   `Directory` / `Recursive`.
//! - RMG, Rosalie's Mupen GUI (Nintendo 64): Windows and Linux (native or Flatpak). Folder:
//!   `mupen64plus.cfg`, `[Rosalie's Mupen GUI RomBrowser]` `Directory` / `Recursive`.
//!
//! An emulator can also be pointed at by hand (a portable copy, an unusual place); its settings
//! are then looked for next to it.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Emulator {
    Dolphin,
    Project64,
    Rmg,
}

impl Emulator {
    pub const ALL: [Emulator; 3] = [Emulator::Dolphin, Emulator::Project64, Emulator::Rmg];

    pub fn key(self) -> &'static str {
        match self {
            Emulator::Dolphin => "dolphin",
            Emulator::Project64 => "project64",
            Emulator::Rmg => "rmg",
        }
    }

    pub fn parse(key: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|e| e.key() == key)
    }

    pub fn name(self) -> &'static str {
        match self {
            Emulator::Dolphin => "Dolphin",
            Emulator::Project64 => "Project64",
            Emulator::Rmg => "RMG",
        }
    }

    /// Whether it exists for this system at all (Project64 is Windows-only).
    pub fn available_here(self) -> bool {
        !(self == Emulator::Project64 && cfg!(not(windows)))
    }

    #[cfg_attr(windows, allow(dead_code))]
    fn flatpak_id(self) -> Option<&'static str> {
        match self {
            Emulator::Dolphin => Some("org.DolphinEmu.dolphin-emu"),
            Emulator::Rmg => Some("com.github.Rosalie241.RMG"),
            Emulator::Project64 => None,
        }
    }
}

/// How to start an emulator: a program, or `flatpak run <id>`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Program {
    Native(PathBuf),
    /// Linux only.
    #[cfg_attr(windows, allow(dead_code))]
    Flatpak(&'static str),
}

impl Program {
    pub fn label(&self) -> String {
        match self {
            Program::Native(path) => path.display().to_string(),
            Program::Flatpak(id) => format!("Flatpak {id}"),
        }
    }
}

/// An emulator found on this computer, with what its settings say.
#[derive(Debug, Clone)]
pub struct Found {
    pub emulator: Emulator,
    pub program: Program,
    /// Its game folders and whether each is searched with its subfolders.
    pub folders: Vec<(PathBuf, bool)>,
    /// Dolphin's downloaded covers (`GameCovers`), if it has any.
    pub covers: Option<PathBuf>,
}

/// Finds `emulator`: at `picked` when one was pointed at by hand, else where it's usually installed.
pub fn find(emulator: Emulator, picked: Option<&Path>) -> Option<Found> {
    if !emulator.available_here() {
        return None;
    }
    let program = match picked {
        Some(path) if path.is_file() => Program::Native(path.to_path_buf()),
        Some(_) => return None,
        None => installed(emulator)?,
    };
    let (folders, covers) = settings(emulator, &program);
    Some(Found { emulator, program, folders, covers })
}

fn installed(emulator: Emulator) -> Option<Program> {
    #[cfg(windows)]
    {
        let env = |name: &str| std::env::var_os(name).map(PathBuf::from);
        let roots: Vec<PathBuf> = ["ProgramFiles", "ProgramFiles(x86)", "ProgramW6432"].iter().filter_map(|n| env(n)).chain(env("LOCALAPPDATA").map(|p| p.join("Programs"))).collect();
        let candidates: Vec<PathBuf> = match emulator {
            Emulator::Dolphin => roots.iter().flat_map(|r| [r.join("Dolphin").join("Dolphin.exe"), r.join("Dolphin-x64").join("Dolphin.exe")]).collect(),
            Emulator::Rmg => roots.iter().flat_map(|r| [r.join("RMG").join("RMG.exe"), r.join("Rosalie's Mupen GUI").join("RMG.exe")]).collect(),
            // "Project64 3.0", "Project64 2.4"…: any folder of that name.
            Emulator::Project64 => roots
                .iter()
                .filter_map(|r| std::fs::read_dir(r).ok())
                .flatten()
                .filter_map(Result::ok)
                .filter(|e| e.file_name().to_string_lossy().to_ascii_lowercase().starts_with("project64"))
                .map(|e| e.path().join("Project64.exe"))
                .collect(),
        };
        candidates.into_iter().find(|p| p.is_file()).map(Program::Native)
    }
    #[cfg(not(windows))]
    {
        let binary = match emulator {
            Emulator::Dolphin => "dolphin-emu",
            Emulator::Rmg => "RMG",
            Emulator::Project64 => return None,
        };
        if let Some(path) = crate::tools::find_in(Path::new("/nonexistent"), binary) {
            return Some(Program::Native(path));
        }
        let id = emulator.flatpak_id()?;
        let home = home();
        let installed = [PathBuf::from("/var/lib/flatpak/app").join(id), home.join(".local/share/flatpak/app").join(id)].iter().any(|p| p.is_dir());
        installed.then_some(Program::Flatpak(id))
    }
}

#[cfg(not(windows))]
fn home() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default()
}

/// Where an emulator keeps its settings, and the game folders and covers they point to.
fn settings(emulator: Emulator, program: &Program) -> (Vec<(PathBuf, bool)>, Option<PathBuf>) {
    match emulator {
        Emulator::Dolphin => {
            let Some(user) = dolphin_user_dir(program) else { return (Vec::new(), None) };
            let ini = user.config.join("Dolphin.ini");
            let folders = std::fs::read_to_string(&ini).map(|text| dolphin_folders(&text)).unwrap_or_default();
            let covers = Some(user.cache.join("GameCovers")).filter(|p| p.is_dir());
            (folders, covers)
        }
        Emulator::Project64 => {
            let Program::Native(exe) = program else { return (Vec::new(), None) };
            let cfg = exe.parent().map(|d| d.join("Config").join("Project64.cfg"));
            let folders = cfg.and_then(|p| std::fs::read_to_string(p).ok()).map(|t| section_folder(&t, "Game Directory", false)).unwrap_or_default();
            (folders, None)
        }
        Emulator::Rmg => {
            let folders = rmg_config(program).and_then(|p| std::fs::read_to_string(p).ok()).map(|t| section_folder(&t, "Rosalie's Mupen GUI RomBrowser", true)).unwrap_or_default();
            (folders, None)
        }
    }
}

struct DolphinUser {
    config: PathBuf,
    cache: PathBuf,
}

fn dolphin_user_dir(program: &Program) -> Option<DolphinUser> {
    let both = |user: PathBuf| DolphinUser { config: user.join("Config"), cache: user.join("Cache") };
    if let Some(path) = std::env::var_os("DOLPHIN_EMU_USERPATH").map(PathBuf::from) {
        return Some(both(path));
    }
    if let Program::Native(exe) = program {
        // A portable copy keeps everything in "User" beside it.
        if let Some(dir) = exe.parent() {
            if dir.join("portable.txt").is_file() {
                return Some(both(dir.join("User")));
            }
        }
    }
    #[cfg(windows)]
    {
        let appdata = std::env::var_os("APPDATA").map(|p| PathBuf::from(p).join("Dolphin Emulator"));
        let documents = std::env::var_os("USERPROFILE").map(|p| PathBuf::from(p).join("Documents").join("Dolphin Emulator"));
        [appdata, documents].into_iter().flatten().find(|p| p.is_dir()).map(both)
    }
    #[cfg(not(windows))]
    {
        let home = home();
        if let Program::Flatpak(id) = program {
            let base = home.join(".var/app").join(id);
            return Some(DolphinUser { config: base.join("config/dolphin-emu"), cache: base.join("cache/dolphin-emu") });
        }
        let legacy = home.join(".dolphin-emu");
        if legacy.is_dir() {
            return Some(both(legacy));
        }
        let config = std::env::var_os("XDG_CONFIG_HOME").map(PathBuf::from).unwrap_or_else(|| home.join(".config")).join("dolphin-emu");
        let cache = std::env::var_os("XDG_CACHE_HOME").map(PathBuf::from).unwrap_or_else(|| home.join(".cache")).join("dolphin-emu");
        Some(DolphinUser { config, cache })
    }
}

fn rmg_config(program: &Program) -> Option<PathBuf> {
    if let Program::Native(exe) = program {
        // The Windows build is portable: its settings sit beside it.
        if let Some(path) = exe.parent().map(|d| d.join("Config").join("mupen64plus.cfg")).filter(|p| p.is_file()) {
            return Some(path);
        }
    }
    #[cfg(not(windows))]
    {
        let home = home();
        let base = match program {
            Program::Flatpak(id) => home.join(".var/app").join(id).join("config"),
            Program::Native(_) => std::env::var_os("XDG_CONFIG_HOME").map(PathBuf::from).unwrap_or_else(|| home.join(".config")),
        };
        return Some(base.join("RMG").join("mupen64plus.cfg"));
    }
    #[allow(unreachable_code)]
    None
}

/// INI-style sections: `[Section]` then `Key = Value` (values may be quoted, as mupen64plus writes them).
fn ini(text: &str) -> HashMap<String, HashMap<String, String>> {
    let mut sections: HashMap<String, HashMap<String, String>> = HashMap::new();
    let mut current = String::new();
    for line in text.lines() {
        let line = line.trim();
        if line.starts_with('#') || line.starts_with(';') || line.is_empty() {
            continue;
        }
        if let Some(name) = line.strip_prefix('[').and_then(|l| l.strip_suffix(']')) {
            current = name.trim().to_string();
            continue;
        }
        if let Some((key, value)) = line.split_once('=') {
            let value = value.trim();
            let value = value.strip_prefix('"').and_then(|v| v.strip_suffix('"')).unwrap_or(value);
            sections.entry(current.clone()).or_default().insert(key.trim().to_string(), value.to_string());
        }
    }
    sections
}

fn truthy(value: Option<&String>, default: bool) -> bool {
    match value.map(|v| v.trim().to_ascii_lowercase()) {
        Some(v) if v == "true" || v == "1" => true,
        Some(v) if v == "false" || v == "0" => false,
        _ => default,
    }
}

/// Dolphin's game folders: `ISOPaths` says how many `ISOPath<n>` there are.
pub(crate) fn dolphin_folders(text: &str) -> Vec<(PathBuf, bool)> {
    let sections = ini(text);
    let Some(general) = sections.get("General") else { return Vec::new() };
    let recursive = truthy(general.get("RecursiveISOPaths"), false);
    let count: usize = general.get("ISOPaths").and_then(|v| v.trim().parse().ok()).unwrap_or(0);
    (0..count.min(256))
        .filter_map(|n| general.get(&format!("ISOPath{n}")))
        .filter(|p| !p.trim().is_empty())
        .map(|p| (PathBuf::from(p.trim()), recursive))
        .collect()
}

/// A single game folder kept as `Directory` (and `Recursive`) in a section (Project64, RMG).
pub(crate) fn section_folder(text: &str, section: &str, recursive_default: bool) -> Vec<(PathBuf, bool)> {
    let sections = ini(text);
    let Some(values) = sections.get(section) else { return Vec::new() };
    let Some(directory) = values.get("Directory").map(|d| d.trim()).filter(|d| !d.is_empty()) else { return Vec::new() };
    vec![(PathBuf::from(directory), truthy(values.get("Recursive"), recursive_default))]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dolphin_lists_its_folders() {
        let ini = "[General]\nISOPaths = 2\nISOPath0 = C:\\Games\\GameCube\nISOPath1 = D:\\Wii\nRecursiveISOPaths = True\n[Interface]\nX = 1\n";
        assert_eq!(dolphin_folders(ini), vec![(PathBuf::from("C:\\Games\\GameCube"), true), (PathBuf::from("D:\\Wii"), true)]);
        assert!(dolphin_folders("[General]\nISOPaths = 0\n").is_empty());
    }

    #[test]
    fn project64_and_rmg_folders() {
        let pj64 = "[Game Directory]\nDirectory=C:\\ROMs\\N64\\\nUse Selected=1\nRecursive=1\n";
        assert_eq!(section_folder(pj64, "Game Directory", false), vec![(PathBuf::from("C:\\ROMs\\N64\\"), true)]);
        let rmg = "[Rosalie's Mupen GUI RomBrowser]\nDirectory = \"/home/me/roms\"\nMaxItems = 2048\n";
        assert_eq!(section_folder(rmg, "Rosalie's Mupen GUI RomBrowser", true), vec![(PathBuf::from("/home/me/roms"), true)]);
        assert!(section_folder("[Other]\nDirectory=x\n", "Game Directory", false).is_empty());
    }
}

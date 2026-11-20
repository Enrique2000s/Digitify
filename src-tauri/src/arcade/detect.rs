//! Finding the emulators Arcade launches (D-034) and the game folders set up in them.
//!
//! - Dolphin (GameCube, Wii): Windows and Linux (native or Flatpak). Folders: `Dolphin.ini`,
//!   `[General]` `ISOPaths` / `ISOPath0…` / `RecursiveISOPaths`. Covers it downloaded itself:
//!   its `GameCovers` cache.
//! - Project64 (Nintendo 64): Windows only. Folder: `Config\Project64.cfg`, `[Game Directory]`
//!   `Directory` / `Recursive`.
//! - RMG, Rosalie's Mupen GUI (Nintendo 64): Windows and Linux (native or Flatpak). Folder:
//!   `mupen64plus.cfg`, `[Rosalie's Mupen GUI RomBrowser]` `Directory` / `Recursive`.
//! - DuckStation (PlayStation) and PCSX2 (PlayStation 2): `settings.ini` / `inis/PCSX2.ini`,
//!   `[GameList]` `RecursivePaths` and `Paths` (one line per folder) (D-101).
//! - RPCS3 (PlayStation 3): its installed games (`dev_hdd0/game`, or where `vfs.yml` puts it), its
//!   `games` folder, and the folders of the discs it knows (`games.yml`).
//! - melonDS and DeSmuME (Nintendo DS): the last folder melonDS opened a game from; the folders of
//!   DeSmuME's recent games (`desmume.ini`, Windows).
//! - RetroArch (many consoles): its playlists (`playlists/*.lpl`) and the box art it downloaded
//!   (`thumbnails`), from `retroarch.cfg`.
//! - Mesen (NES, Super Nintendo, Game Boy, Game Boy Advance, PC Engine, Master System, Game Gear),
//!   FCEUX (NES) and mGBA (Game Boy, Game Boy Color, Game Boy Advance): the folders of the games
//!   they opened last and the folder they last opened one from, in their settings (D-106).
//! - Kega Fusion (Mega Drive, Sega CD, Master System, Game Gear), ZSNES and Snes9x (Super
//!   Nintendo), Nestopia (NES), nullDC (Dreamcast, Windows) and ares (many consoles): the same, from
//!   `Fusion.ini`, `zsnesw.cfg`, `snes9x.conf`, `nestopia.xml`, `nullDC.cfg` and `settings.bml` (D-111).
//! - PPSSPP (PSP), Flycast (Dreamcast), Cemu (Wii U), Azahar / Lime3DS / Citra (3DS), xemu (Xbox),
//!   Xenia (Xbox 360, Windows) and Ryujinx (Switch): their game folders from `ppsspp.ini`,
//!   `emu.cfg`, `settings.xml`, `qt-config.ini`, `xemu.toml` and `Config.json` (D-116).
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
    DuckStation,
    Pcsx2,
    Rpcs3,
    MelonDs,
    Desmume,
    RetroArch,
    Mesen,
    Fceux,
    Mgba,
    Fusion,
    Zsnes,
    Snes9x,
    Nestopia,
    NullDc,
    Ares,
    Ppsspp,
    Flycast,
    Cemu,
    Azahar,
    Xemu,
    Xenia,
    Ryujinx,
}

impl Emulator {
    pub const ALL: [Emulator; 25] = [
        Emulator::Dolphin,
        Emulator::Project64,
        Emulator::Rmg,
        Emulator::DuckStation,
        Emulator::Pcsx2,
        Emulator::Rpcs3,
        Emulator::MelonDs,
        Emulator::Desmume,
        Emulator::Mesen,
        Emulator::Fceux,
        Emulator::Nestopia,
        Emulator::Snes9x,
        Emulator::Zsnes,
        Emulator::Mgba,
        Emulator::Fusion,
        Emulator::NullDc,
        Emulator::Flycast,
        Emulator::Ppsspp,
        Emulator::Azahar,
        Emulator::Cemu,
        Emulator::Ryujinx,
        Emulator::Xemu,
        Emulator::Xenia,
        Emulator::Ares,
        Emulator::RetroArch,
    ];

    pub fn key(self) -> &'static str {
        match self {
            Emulator::Dolphin => "dolphin",
            Emulator::Project64 => "project64",
            Emulator::Rmg => "rmg",
            Emulator::DuckStation => "duckstation",
            Emulator::Pcsx2 => "pcsx2",
            Emulator::Rpcs3 => "rpcs3",
            Emulator::MelonDs => "melonds",
            Emulator::Desmume => "desmume",
            Emulator::RetroArch => "retroarch",
            Emulator::Mesen => "mesen",
            Emulator::Fceux => "fceux",
            Emulator::Mgba => "mgba",
            Emulator::Fusion => "fusion",
            Emulator::Zsnes => "zsnes",
            Emulator::Snes9x => "snes9x",
            Emulator::Nestopia => "nestopia",
            Emulator::NullDc => "nulldc",
            Emulator::Ares => "ares",
            Emulator::Ppsspp => "ppsspp",
            Emulator::Flycast => "flycast",
            Emulator::Cemu => "cemu",
            Emulator::Azahar => "azahar",
            Emulator::Xemu => "xemu",
            Emulator::Xenia => "xenia",
            Emulator::Ryujinx => "ryujinx",
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
            Emulator::DuckStation => "DuckStation",
            Emulator::Pcsx2 => "PCSX2",
            Emulator::Rpcs3 => "RPCS3",
            Emulator::MelonDs => "melonDS",
            Emulator::Desmume => "DeSmuME",
            Emulator::RetroArch => "RetroArch",
            Emulator::Mesen => "Mesen",
            Emulator::Fceux => "FCEUX",
            Emulator::Mgba => "mGBA",
            Emulator::Fusion => "Kega Fusion",
            Emulator::Zsnes => "ZSNES",
            Emulator::Snes9x => "Snes9x",
            Emulator::Nestopia => "Nestopia",
            Emulator::NullDc => "nullDC",
            Emulator::Ares => "ares",
            Emulator::Ppsspp => "PPSSPP",
            Emulator::Flycast => "Flycast",
            Emulator::Cemu => "Cemu",
            Emulator::Azahar => "Azahar / Lime3DS",
            Emulator::Xemu => "xemu",
            Emulator::Xenia => "Xenia",
            Emulator::Ryujinx => "Ryujinx",
        }
    }

    /// The names its program goes by, for checking a program pointed at by hand.
    pub fn program_names(self) -> &'static [&'static str] {
        match self {
            Emulator::Dolphin => &["dolphin"],
            Emulator::Project64 => &["project64"],
            Emulator::Rmg => &["rmg"],
            Emulator::DuckStation => &["duckstation"],
            Emulator::Pcsx2 => &["pcsx2"],
            Emulator::Rpcs3 => &["rpcs3"],
            Emulator::MelonDs => &["melonds"],
            Emulator::Desmume => &["desmume"],
            Emulator::RetroArch => &["retroarch"],
            Emulator::Mesen => &["mesen"],
            Emulator::Fceux => &["fceux", "qfceux"],
            Emulator::Mgba => &["mgba"],
            Emulator::Fusion => &["fusion", "kega"],
            Emulator::Zsnes => &["zsnes"],
            Emulator::Snes9x => &["snes9x"],
            Emulator::Nestopia => &["nestopia"],
            Emulator::NullDc => &["nulldc"],
            Emulator::Ares => &["ares"],
            Emulator::Ppsspp => &["ppsspp"],
            Emulator::Flycast => &["flycast"],
            Emulator::Cemu => &["cemu"],
            Emulator::Azahar => &["azahar", "lime3ds", "citra"],
            Emulator::Xemu => &["xemu"],
            Emulator::Xenia => &["xenia"],
            Emulator::Ryujinx => &["ryujinx"],
        }
    }

    /// Whether it exists for this system at all (Project64 is Windows-only).
    pub fn available_here(self) -> bool {
        !(matches!(self, Emulator::Project64 | Emulator::NullDc | Emulator::Xenia) && cfg!(not(windows)))
    }

    #[cfg_attr(windows, allow(dead_code))]
    fn flatpak_id(self) -> Option<&'static str> {
        match self {
            Emulator::Dolphin => Some("org.DolphinEmu.dolphin-emu"),
            Emulator::Rmg => Some("com.github.Rosalie241.RMG"),
            Emulator::DuckStation => Some("org.duckstation.DuckStation"),
            Emulator::Pcsx2 => Some("net.pcsx2.PCSX2"),
            Emulator::Rpcs3 => Some("net.rpcs3.RPCS3"),
            Emulator::MelonDs => Some("net.kuribo64.melonDS"),
            Emulator::Desmume => Some("org.desmume.DeSmuME"),
            Emulator::RetroArch => Some("org.libretro.RetroArch"),
            Emulator::Mgba => Some("io.mgba.mGBA"),
            Emulator::Fceux => Some("io.github.fceux.FCEUX"),
            Emulator::Mesen => Some("com.github.SourMesen.Mesen2"),
            Emulator::Snes9x => Some("com.snes9x.Snes9x"),
            Emulator::Nestopia => Some("ca._0ldsk00l.Nestopia"),
            Emulator::Ares => Some("dev.ares.ares"),
            Emulator::Ppsspp => Some("org.ppsspp.PPSSPP"),
            Emulator::Flycast => Some("org.flycast.Flycast"),
            Emulator::Cemu => Some("info.cemu.Cemu"),
            Emulator::Azahar => Some("org.azahar_emu.Azahar"),
            Emulator::Xemu => Some("app.xemu.xemu"),
            Emulator::Ryujinx => Some("io.github.ryubing.Ryujinx"),
            Emulator::Project64 | Emulator::Fusion | Emulator::Zsnes | Emulator::NullDc | Emulator::Xenia => None,
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
    /// Box art it keeps: Dolphin's downloaded covers (`GameCovers`), RetroArch's `thumbnails`.
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
            other => {
                let mut places = roots.clone();
                if let Some(profile) = env("USERPROFILE") {
                    places.extend(["Documents", "Desktop", "Downloads", "Emulators", "Games", "scoop\\apps"].iter().map(|d| profile.join(d)));
                }
                places.extend(env("LOCALAPPDATA"));
                places.extend(["C:\\", "C:\\Emulators", "C:\\Games"].iter().map(PathBuf::from));
                if other == Emulator::RetroArch {
                    // RetroArch's installer puts it in C:\RetroArch-Win64; Steam has it too.
                    places.extend(super::stores::steam_library_dirs().into_iter().map(|l| l.join("steamapps").join("common")));
                }
                return portable_program(&places, other.program_names()).map(Program::Native);
            }
        };
        candidates.into_iter().find(|p| p.is_file()).map(Program::Native)
    }
    #[cfg(not(windows))]
    {
        let binaries: &[&str] = match emulator {
            Emulator::Dolphin => &["dolphin-emu"],
            Emulator::Rmg => &["RMG"],
            Emulator::DuckStation => &["duckstation-qt", "duckstation"],
            Emulator::Pcsx2 => &["pcsx2-qt", "pcsx2"],
            Emulator::Rpcs3 => &["rpcs3"],
            Emulator::MelonDs => &["melonDS"],
            Emulator::Desmume => &["desmume"],
            Emulator::RetroArch => &["retroarch"],
            Emulator::Mesen => &["Mesen", "mesen"],
            Emulator::Fceux => &["fceux", "qfceux"],
            Emulator::Mgba => &["mgba-qt", "mgba"],
            Emulator::Fusion => &["kega-fusion", "Fusion", "fusion"],
            Emulator::Zsnes => &["zsnes"],
            Emulator::Snes9x => &["snes9x-gtk", "snes9x"],
            Emulator::Nestopia => &["nestopia"],
            Emulator::Ares => &["ares"],
            Emulator::Ppsspp => &["PPSSPPSDL", "PPSSPPQt", "ppsspp"],
            Emulator::Flycast => &["flycast"],
            Emulator::Cemu => &["cemu", "Cemu"],
            Emulator::Azahar => &["azahar", "lime3ds", "lime3ds-gui", "citra-qt"],
            Emulator::Xemu => &["xemu"],
            Emulator::Ryujinx => &["ryujinx", "Ryujinx"],
            Emulator::Project64 | Emulator::NullDc | Emulator::Xenia => return None,
        };
        if let Some(path) = binaries.iter().find_map(|b| crate::tools::find_in(Path::new("/nonexistent"), b)) {
            return Some(Program::Native(path));
        }
        let id = emulator.flatpak_id()?;
        let home = home();
        let installed = [PathBuf::from("/var/lib/flatpak/app").join(id), home.join(".local/share/flatpak/app").join(id)].iter().any(|p| p.is_dir());
        installed.then_some(Program::Flatpak(id))
    }
}

/// A portable copy (or an installed one) in a folder named after it, in one of `places`: the first
/// program in it whose name starts with `name` ("duckstation-qt-x64-ReleaseLTCG.exe" for
/// "duckstation"). Scoop keeps the program in a `current` folder inside.
#[cfg(windows)]
fn portable_program(places: &[PathBuf], names: &[&str]) -> Option<PathBuf> {
    let starts = |text: &str| names.iter().any(|n| text.starts_with(n));
    let program_in = |dir: &Path| -> Option<PathBuf> {
        let mut found: Vec<PathBuf> = std::fs::read_dir(dir)
            .ok()?
            .filter_map(Result::ok)
            .map(|e| e.path())
            .filter(|p| {
                let file = p.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
                starts(&file) && file.ends_with(".exe") && p.is_file()
            })
            .collect();
        // The shortest name is the main program ("retroarch.exe" before "retroarch_debug.exe").
        found.sort_by_key(|p| p.as_os_str().len());
        found.into_iter().next()
    };
    for place in places {
        let Ok(entries) = std::fs::read_dir(place) else { continue };
        let mut dirs: Vec<PathBuf> = entries
            .filter_map(Result::ok)
            .filter(|e| starts(&e.file_name().to_string_lossy().to_lowercase()))
            .map(|e| e.path())
            .filter(|p| p.is_dir())
            .collect();
        dirs.sort();
        for dir in dirs {
            if let Some(program) = program_in(&dir).or_else(|| program_in(&dir.join("current"))) {
                return Some(program);
            }
        }
    }
    None
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
        Emulator::DuckStation | Emulator::Pcsx2 => {
            let file = if emulator == Emulator::DuckStation { duckstation_settings(program) } else { pcsx2_settings(program) };
            (file.and_then(|p| std::fs::read_to_string(p).ok()).map(|t| game_list_folders(&t)).unwrap_or_default(), None)
        }
        Emulator::Rpcs3 => (rpcs3_dir(program).map(|dir| rpcs3_folders(&dir)).unwrap_or_default(), None),
        Emulator::MelonDs => (melonds_folder(program).map(|p| vec![(p, false)]).unwrap_or_default(), None),
        Emulator::Desmume => (desmume_folders(program), None),
        Emulator::RetroArch => match retroarch_dirs(program) {
            Some((playlists, thumbnails)) => (vec![(playlists, false)], Some(thumbnails)),
            None => (Vec::new(), None),
        },
        Emulator::Mesen
        | Emulator::Fceux
        | Emulator::Mgba
        | Emulator::Fusion
        | Emulator::Zsnes
        | Emulator::Snes9x
        | Emulator::Nestopia
        | Emulator::NullDc
        | Emulator::Ares
        | Emulator::Ppsspp
        | Emulator::Flycast
        | Emulator::Cemu
        | Emulator::Azahar
        | Emulator::Xemu
        | Emulator::Xenia
        | Emulator::Ryujinx => {
            let text: String = settings_files(emulator, program).iter().filter_map(|p| std::fs::read_to_string(p).ok()).collect::<Vec<_>>().join("\n");
            (recent_folders(&text), None)
        }
    }
}

/// The settings files of the emulators read for their recent games: beside a portable copy, else
/// in the user's settings.
fn settings_files(emulator: Emulator, program: &Program) -> Vec<PathBuf> {
    let names: &[&str] = match emulator {
        Emulator::Mesen => &["settings.json"],
        Emulator::Fceux => &["fceux.cfg"],
        Emulator::Fusion => &["Fusion.ini"],
        Emulator::Zsnes => &["zsnesw.cfg", "zsnesl.cfg", "zsnes.cfg"],
        Emulator::Snes9x => &["snes9x.conf", "snes9x.cfg"],
        Emulator::Nestopia => &["nestopia.xml", "nestopia.conf"],
        Emulator::NullDc => &["nullDC.cfg"],
        Emulator::Ares => &["settings.bml"],
        Emulator::Ppsspp => &["memstick/PSP/SYSTEM/ppsspp.ini", "PSP/SYSTEM/ppsspp.ini"],
        Emulator::Flycast => &["emu.cfg"],
        Emulator::Cemu => &["settings.xml", "portable/settings.xml"],
        Emulator::Azahar => &["qt-config.ini", "config/qt-config.ini", "user/config/qt-config.ini"],
        Emulator::Xemu => &["xemu.toml"],
        Emulator::Xenia => &["xenia-canary.config.toml", "xenia.config.toml"],
        Emulator::Ryujinx => &["Config.json", "portable/Config.json"],
        _ => &["config.ini", "qt.ini"],
    };
    let mut dirs: Vec<PathBuf> = Vec::new();
    if let Program::Native(exe) = program {
        dirs.extend(exe.parent().map(Path::to_path_buf));
    }
    #[cfg(windows)]
    {
        let env = |name: &str| std::env::var_os(name).map(PathBuf::from);
        match emulator {
            Emulator::Mesen => dirs.extend(env("USERPROFILE").map(|p| p.join("Documents").join("Mesen2"))),
            Emulator::Mgba => dirs.extend(env("APPDATA").map(|p| p.join("mGBA"))),
            Emulator::Ares => dirs.extend(env("LOCALAPPDATA").map(|p| p.join("ares"))),
            Emulator::Ppsspp => dirs.extend(env("USERPROFILE").map(|p| p.join("Documents").join("PPSSPP"))),
            Emulator::Flycast => dirs.extend(env("APPDATA").map(|p| p.join("flycast"))),
            Emulator::Cemu => dirs.extend(env("APPDATA").map(|p| p.join("Cemu"))),
            Emulator::Azahar => dirs.extend(["Azahar", "Lime3DS", "Citra"].iter().filter_map(|n| env("APPDATA").map(|p| p.join(n)))),
            Emulator::Xemu => dirs.extend(env("APPDATA").map(|p| p.join("xemu").join("xemu"))),
            Emulator::Ryujinx => dirs.extend(env("APPDATA").map(|p| p.join("Ryujinx"))),
            _ => {}
        }
    }
    #[cfg(not(windows))]
    {
        let (flatpak, native) = match emulator {
            Emulator::Mesen => ("config/Mesen2", "Mesen2"),
            Emulator::Fceux => ("config/fceux", "fceux"),
            Emulator::Snes9x => ("config/snes9x", "snes9x"),
            Emulator::Nestopia => ("config/nestopia", "nestopia"),
            Emulator::Ares => ("data/ares", "ares"),
            Emulator::Ppsspp => ("config/ppsspp", "ppsspp"),
            Emulator::Flycast => ("config/flycast", "flycast"),
            Emulator::Cemu => ("config/Cemu", "Cemu"),
            Emulator::Azahar => ("config/azahar-emu", "azahar-emu"),
            Emulator::Xemu => ("data/xemu/xemu", "xemu/xemu"),
            Emulator::Ryujinx => ("config/Ryujinx", "Ryujinx"),
            _ => ("config/mgba", "mgba"),
        };
        match program {
            Program::Flatpak(id) => dirs.push(home().join(".var/app").join(id).join(flatpak)),
            // ares keeps its settings with its data.
            Program::Native(_) if matches!(emulator, Emulator::Ares | Emulator::Xemu) => dirs.push(xdg("XDG_DATA_HOME", ".local/share").join(native)),
            Program::Native(_) => dirs.push(xdg("XDG_CONFIG_HOME", ".config").join(native)),
        }
        match emulator {
            Emulator::Fceux => dirs.push(home().join(".fceux")),
            Emulator::Nestopia => dirs.push(home().join(".nestopia")),
            Emulator::Zsnes => dirs.push(home().join(".zsnes")),
            Emulator::Fusion => dirs.push(home().join(".Kega Fusion")),
            Emulator::Azahar => dirs.extend(["lime3ds-emu", "citra-emu"].iter().map(|n| xdg("XDG_CONFIG_HOME", ".config").join(n))),
            _ => {}
        }
    }
    dirs.iter().flat_map(|d| names.iter().map(move |n| d.join(n))).filter(|p| p.is_file()).collect()
}

/// Whether a setting names a game folder: the last folder a game was opened from, a ROM folder
/// (`Dir:Roms`, `RomPath`), ares's per-console `Path`, or Fusion's per-console paths.
fn folder_setting(key: &str) -> bool {
    let rom = key.contains("rom") && (key.contains("dir") || key.contains("path") || key.contains("folder"));
    let console = ["md", "gen", "sms", "gg", "scd", "32x", "cd", "iso", "image", "game"].iter().any(|c| key.starts_with(c)) && (key.ends_with("path") || key.ends_with("dir"));
    // Azahar's `Paths\gamedirs\2\path`, xemu's `games_dir`, Cemu's `<Entry>`, PPSSPP's `CurrentDirectory`.
    let more = (key.contains("gamedirs") && key.ends_with("path")) || key.contains("games_dir") || key.contains("gamesdir") || key == "entry" || key == "currentdirectory";
    key.contains("lastdir") || key.contains("lastfolder") || key.contains("lastrom") || rom || console || key == "path" || more
}

/// The quoted strings of a line of JSON, unescaped (`\\` and `\"`).
fn json_strings(line: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut current: Option<String> = None;
    let mut chars = line.chars();
    while let Some(c) = chars.next() {
        match (&mut current, c) {
            (None, '"') => current = Some(String::new()),
            (Some(s), '\\') => {
                if let Some(next) = chars.next() {
                    s.push(match next {
                        'n' => '\n',
                        't' => '\t',
                        other => other,
                    });
                }
            }
            (Some(_), '"') => out.extend(current.take()),
            (Some(s), c) => s.push(c),
            (None, _) => {}
        }
    }
    out
}

/// The game folders in an emulator's settings, whatever their format (Mesen's JSON, FCEUX's
/// `.cfg`, mGBA's `.ini`): each recent game's folder, and the folder it last opened a game from.
pub(crate) fn recent_folders(text: &str) -> Vec<(PathBuf, bool)> {
    let mut folders: Vec<(PathBuf, bool)> = Vec::new();
    let mut add = |folder: PathBuf| {
        let folder = (folder, false);
        if !folder.0.as_os_str().is_empty() && !folders.contains(&folder) {
            folders.push(folder);
        }
    };
    let is_game = |path: &Path| super::games::GAME_FILE_EXTENSIONS.contains(&super::games::extension(path).as_str());
    // The JSON key a list of values belongs to (Ryujinx's `"game_dirs": [ … ]`).
    let mut json_key = String::new();
    for line in text.lines() {
        let line = line.trim();
        // JSON (Mesen, Ryujinx): every quoted path to a game, and the folders of a "…dirs" list.
        if line.contains('"') && (line.starts_with('"') || line.starts_with('{') || line.starts_with('[')) {
            let strings = json_strings(line);
            let pair = line.starts_with('"') && line.contains("\":");
            if pair {
                json_key = strings.first().map(|k| k.to_ascii_lowercase()).unwrap_or_default();
            }
            for (index, quoted) in strings.iter().enumerate() {
                if pair && index == 0 {
                    continue;
                }
                let path = PathBuf::from(quoted);
                if !(quoted.contains('/') || quoted.contains('\\')) {
                    continue;
                }
                if is_game(&path) {
                    if let Some(parent) = path.parent() {
                        add(parent.to_path_buf());
                    }
                } else if json_key.contains("dir") && super::games::extension(&path).is_empty() {
                    add(path);
                }
            }
            continue;
        }
        if line.starts_with(']') || line.starts_with('}') {
            json_key.clear();
        }
        // `<key>value</key>` (Nestopia's XML), `key = value` (FCEUX, mGBA, Snes9x, Fusion, nullDC),
        // `key: value` (ares's BML) or `key value` (older FCEUX).
        let xml = line.strip_prefix('<').and_then(|l| l.split_once('>')).and_then(|(tag, rest)| Some((tag.split_whitespace().next()?, rest.split_once("</")?.0)));
        let (key, value) = if let Some(pair) = xml {
            pair
        } else if let Some((key, value)) = line.split_once('=') {
            (key, value)
        } else if let Some((key, value)) = line.split_once(": ") {
            (key, value)
        } else if let Some((key, value)) = line.split_once(' ') {
            (key, value)
        } else {
            continue;
        };
        let key = key.trim().trim_end_matches(':').to_ascii_lowercase();
        let value = value.trim().trim_end_matches(',').trim().trim_matches('"').trim_matches('\'').replace("\\\\", "\\");
        // Flycast keeps its content folders in one setting, separated by semicolons.
        if key.contains("contentpath") {
            value.split(';').map(str::trim).filter(|p| !p.is_empty()).for_each(|p| add(PathBuf::from(p)));
            continue;
        }
        // ares names a recent game "System;path".
        let value = match value.rsplit_once(';') {
            Some((_, path)) if path.starts_with('/') || path.get(1..3) == Some(":\\") || path.get(1..3) == Some(":/") => path.to_string(),
            _ => value,
        };
        if !(value.contains('/') || value.contains('\\')) {
            continue;
        }
        let path = PathBuf::from(&value);
        if is_game(&path) {
            if let Some(parent) = path.parent() {
                add(parent.to_path_buf());
            }
        } else if super::games::extension(&path).is_empty() && folder_setting(&key) {
            add(path);
        }
    }
    folders
}

/// A folder in the user's settings, for each system: Windows, then Linux (native and Flatpak).
#[cfg(not(windows))]
fn xdg(var: &str, fallback: &str) -> PathBuf {
    std::env::var_os(var).map(PathBuf::from).unwrap_or_else(|| home().join(fallback))
}

/// The folder a native program sits in, when it's a portable copy (marked by one of `markers`).
fn portable_dir(program: &Program, markers: &[&str]) -> Option<PathBuf> {
    let Program::Native(exe) = program else { return None };
    let dir = exe.parent()?;
    markers.iter().any(|m| dir.join(m).is_file()).then(|| dir.to_path_buf())
}

fn duckstation_settings(program: &Program) -> Option<PathBuf> {
    if let Some(dir) = portable_dir(program, &["portable.txt", "settings.ini"]) {
        return Some(dir.join("settings.ini"));
    }
    #[cfg(windows)]
    {
        let local = std::env::var_os("LOCALAPPDATA").map(|p| PathBuf::from(p).join("DuckStation").join("settings.ini"));
        let documents = std::env::var_os("USERPROFILE").map(|p| PathBuf::from(p).join("Documents").join("DuckStation").join("settings.ini"));
        [local, documents].into_iter().flatten().find(|p| p.is_file())
    }
    #[cfg(not(windows))]
    {
        Some(match program {
            Program::Flatpak(id) => home().join(".var/app").join(id).join("data/duckstation/settings.ini"),
            Program::Native(_) => xdg("XDG_DATA_HOME", ".local/share").join("duckstation/settings.ini"),
        })
    }
}

fn pcsx2_settings(program: &Program) -> Option<PathBuf> {
    if let Some(dir) = portable_dir(program, &["portable.ini", "portable.txt"]) {
        return Some(dir.join("inis").join("PCSX2.ini"));
    }
    #[cfg(windows)]
    {
        std::env::var_os("USERPROFILE").map(|p| PathBuf::from(p).join("Documents").join("PCSX2").join("inis").join("PCSX2.ini"))
    }
    #[cfg(not(windows))]
    {
        Some(match program {
            Program::Flatpak(id) => home().join(".var/app").join(id).join("config/PCSX2/inis/PCSX2.ini"),
            Program::Native(_) => xdg("XDG_CONFIG_HOME", ".config").join("PCSX2/inis/PCSX2.ini"),
        })
    }
}

/// DuckStation's and PCSX2's game folders: `[GameList]`, one `RecursivePaths` or `Paths` line each.
pub(crate) fn game_list_folders(text: &str) -> Vec<(PathBuf, bool)> {
    let mut folders = Vec::new();
    for (key, value) in section_lines(text, "GameList") {
        let recursive = match key.as_str() {
            "RecursivePaths" => true,
            "Paths" => false,
            _ => continue,
        };
        if !value.is_empty() {
            folders.push((PathBuf::from(value), recursive));
        }
    }
    folders
}

/// Every `key = value` line of a section, repeated keys included, in order.
fn section_lines(text: &str, section: &str) -> Vec<(String, String)> {
    let mut inside = false;
    let mut out = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if let Some(name) = line.strip_prefix('[').and_then(|l| l.strip_suffix(']')) {
            inside = name.trim() == section;
            continue;
        }
        if inside {
            if let Some((key, value)) = line.split_once('=') {
                let value = value.trim();
                let value = value.strip_prefix('"').and_then(|v| v.strip_suffix('"')).unwrap_or(value);
                out.push((key.trim().to_string(), value.to_string()));
            }
        }
    }
    out
}

/// RPCS3's own folder: beside the program on Windows, in the user's settings on Linux.
fn rpcs3_dir(program: &Program) -> Option<PathBuf> {
    if let Program::Native(exe) = program {
        if let Some(dir) = exe.parent().filter(|d| d.join("config").is_dir() || d.join("dev_hdd0").is_dir() || cfg!(windows)) {
            return Some(dir.to_path_buf());
        }
    }
    #[cfg(not(windows))]
    {
        return Some(match program {
            Program::Flatpak(id) => home().join(".var/app").join(id).join("config/rpcs3"),
            Program::Native(_) => xdg("XDG_CONFIG_HOME", ".config").join("rpcs3"),
        });
    }
    #[allow(unreachable_code)]
    None
}

/// Where RPCS3's PlayStation 3 games are: its installed games, its `games` folder, and the folders
/// holding the discs it was given. Each is searched a few levels down for `PARAM.SFO`.
fn rpcs3_folders(dir: &Path) -> Vec<(PathBuf, bool)> {
    let read = |name: &str| std::fs::read_to_string(dir.join("config").join(name)).or_else(|_| std::fs::read_to_string(dir.join(name))).unwrap_or_default();
    let hdd0 = yaml_value(&read("vfs.yml"), "/dev_hdd0/")
        .filter(|v| !v.is_empty())
        .map(|v| PathBuf::from(v.replace("$(EmulatorDir)", &format!("{}/", dir.display()))))
        .unwrap_or_else(|| dir.join("dev_hdd0"));
    // Its own folders only when they're there (a fresh copy has neither yet).
    let mut folders: Vec<(PathBuf, bool)> = [hdd0.join("game"), dir.join("games")].into_iter().filter(|p| p.is_dir()).map(|p| (p, true)).collect();
    for (_, game) in yaml_pairs(&read("games.yml")) {
        let game = PathBuf::from(game.trim_end_matches(['/', '\\']));
        if let Some(parent) = game.parent().filter(|p| p.as_os_str().len() > 3) {
            let parent = (parent.to_path_buf(), true);
            if !folders.contains(&parent) {
                folders.push(parent);
            }
        }
    }
    folders
}

/// `key: value` lines of a flat YAML file (RPCS3's `games.yml` and `vfs.yml`), quotes removed.
pub(crate) fn yaml_pairs(text: &str) -> Vec<(String, String)> {
    text.lines()
        .filter(|l| !l.starts_with(' ') && !l.trim_start().starts_with('#'))
        .filter_map(|line| {
            let (key, value) = line.split_once(": ")?;
            let unquote = |s: &str| s.trim().trim_matches('"').trim_matches('\'').to_string();
            Some((unquote(key), unquote(value)))
        })
        .collect()
}

fn yaml_value(text: &str, key: &str) -> Option<String> {
    yaml_pairs(text).into_iter().find(|(k, _)| k == key).map(|(_, v)| v)
}

/// The folder melonDS last opened a game from (`LastROMFolder`, in `melonDS.toml` or the older `.ini`).
fn melonds_folder(program: &Program) -> Option<PathBuf> {
    let mut dirs: Vec<PathBuf> = Vec::new();
    if let Program::Native(exe) = program {
        dirs.extend(exe.parent().map(Path::to_path_buf));
    }
    #[cfg(windows)]
    dirs.extend(std::env::var_os("APPDATA").map(|p| PathBuf::from(p).join("melonDS")));
    #[cfg(not(windows))]
    dirs.push(match program {
        Program::Flatpak(id) => home().join(".var/app").join(id).join("config/melonDS"),
        Program::Native(_) => xdg("XDG_CONFIG_HOME", ".config").join("melonDS"),
    });
    dirs.iter().flat_map(|d| [d.join("melonDS.toml"), d.join("melonDS.ini")]).find_map(|file| last_rom_folder(&std::fs::read_to_string(file).ok()?))
}

pub(crate) fn last_rom_folder(text: &str) -> Option<PathBuf> {
    text.lines().find_map(|line| {
        let (key, value) = line.split_once('=')?;
        if key.trim() != "LastROMFolder" {
            return None;
        }
        let value = value.trim();
        // TOML writes it quoted, with its backslashes doubled.
        let value = match value.strip_prefix('"').and_then(|v| v.strip_suffix('"')) {
            Some(quoted) => quoted.replace("\\\\", "\\"),
            None => value.to_string(),
        };
        (!value.is_empty()).then(|| PathBuf::from(value))
    })
}

/// The folders of DeSmuME's recent games (Windows: `desmume.ini` beside it, `[Recent Roms]`).
fn desmume_folders(program: &Program) -> Vec<(PathBuf, bool)> {
    let Program::Native(exe) = program else { return Vec::new() };
    let Some(text) = exe.parent().and_then(|d| std::fs::read_to_string(d.join("desmume.ini")).ok()) else { return Vec::new() };
    recent_rom_folders(&text)
}

pub(crate) fn recent_rom_folders(text: &str) -> Vec<(PathBuf, bool)> {
    let mut folders: Vec<(PathBuf, bool)> = Vec::new();
    for (_, value) in section_lines(text, "Recent Roms") {
        if let Some(parent) = Path::new(&value).parent().filter(|p| !p.as_os_str().is_empty()) {
            let folder = (parent.to_path_buf(), false);
            if !folders.contains(&folder) {
                folders.push(folder);
            }
        }
    }
    folders
}

/// RetroArch's playlists and downloaded box art: `playlist_directory` and `thumbnails_directory`
/// in `retroarch.cfg` (":" stands for RetroArch's own folder, "default" for the usual place).
fn retroarch_dirs(program: &Program) -> Option<(PathBuf, PathBuf)> {
    let mut configs: Vec<PathBuf> = Vec::new();
    if let Program::Native(exe) = program {
        configs.extend(exe.parent().map(|d| d.join("retroarch.cfg")));
    }
    #[cfg(windows)]
    configs.extend(std::env::var_os("APPDATA").map(|p| PathBuf::from(p).join("RetroArch").join("retroarch.cfg")));
    #[cfg(not(windows))]
    configs.push(match program {
        Program::Flatpak(id) => home().join(".var/app").join(id).join("config/retroarch/retroarch.cfg"),
        Program::Native(_) => xdg("XDG_CONFIG_HOME", ".config").join("retroarch/retroarch.cfg"),
    });
    let config = configs.into_iter().find(|p| p.is_file())?;
    let base = config.parent()?.to_path_buf();
    let values = ini(&std::fs::read_to_string(&config).ok()?).remove("").unwrap_or_default();
    let dir = |key: &str, default: &str| -> PathBuf {
        match values.get(key).map(|v| v.trim()).filter(|v| !v.is_empty() && *v != "default") {
            Some(v) if v.starts_with(':') => base.join(v.trim_start_matches(':').trim_start_matches(['/', '\\'])),
            #[cfg(not(windows))]
            Some(v) if v.starts_with('~') => home().join(v.trim_start_matches('~').trim_start_matches('/')),
            Some(v) => PathBuf::from(v),
            None => base.join(default),
        }
    };
    Some((dir("playlist_directory", "playlists"), dir("thumbnails_directory", "thumbnails")))
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

    #[test]
    fn playstation_and_ds_emulators_folders() {
        let ini = "[Main]\nX = 1\n[GameList]\nRecursivePaths = D:\\PS1\nRecursivePaths = E:\\More PS1\nPaths = F:\\Loose\n[BIOS]\nPaths = nope\n";
        assert_eq!(
            game_list_folders(ini),
            vec![(PathBuf::from("D:\\PS1"), true), (PathBuf::from("E:\\More PS1"), true), (PathBuf::from("F:\\Loose"), false)]
        );
        assert_eq!(last_rom_folder("Foo = 1\nLastROMFolder = \"C:\\\\Games\\\\DS\"\n"), Some(PathBuf::from("C:\\Games\\DS")));
        assert_eq!(last_rom_folder("LastROMFolder=/home/me/ds\n"), Some(PathBuf::from("/home/me/ds")));
        let desmume = "[Recent Roms]\nRecent Rom 1=D:/DS/Mario.nds\nRecent Rom 2=D:/DS/Zelda.nds\n";
        assert_eq!(recent_rom_folders(desmume), vec![(PathBuf::from("D:/DS"), false)]);
        let games = "BLUS30443: \"D:/PS3/Demon's Souls/\"\nBCES00065: D:/PS3/Uncharted/\n";
        assert_eq!(yaml_pairs(games)[0], ("BLUS30443".to_string(), "D:/PS3/Demon's Souls/".to_string()));
        let dir = std::env::temp_dir().join(format!("digitify-rpcs3-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("config")).unwrap();
        std::fs::write(dir.join("config").join("games.yml"), games).unwrap();
        let folders = rpcs3_folders(&dir);
        assert_eq!(folders, vec![(PathBuf::from("D:/PS3"), true)], "D:/PS3 once; no installed games or games folder yet");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn ppsspp_flycast_cemu_azahar_xemu_and_ryujinx_folders() {
        let ppsspp = "[General]\nCurrentDirectory = /games/psp/\n[Recent]\nFileName0 = /media/umd/Lumen.iso\n";
        assert_eq!(recent_folders(ppsspp), vec![(PathBuf::from("/games/psp/"), false), (PathBuf::from("/media/umd"), false)]);
        let flycast = "[config]\nDreamcast.ContentPath = /dc/one;/dc/two\n";
        assert_eq!(recent_folders(flycast), vec![(PathBuf::from("/dc/one"), false), (PathBuf::from("/dc/two"), false)]);
        let cemu = "<content>\n  <GamePaths>\n    <Entry>/wiiu/games</Entry>\n  </GamePaths>\n</content>";
        assert_eq!(recent_folders(cemu), vec![(PathBuf::from("/wiiu/games"), false)]);
        let azahar = "[UI]\nPaths\\gamedirs\\3\\path=/3ds/carts\nPaths\\gamedirs\\size=3\n";
        assert_eq!(recent_folders(azahar), vec![(PathBuf::from("/3ds/carts"), false)]);
        let xemu = "[general]\ngames_dir = '/xbox/discs'\n[sys.files]\ndvd_path = '/xbox/other/Halo.iso'\nbootrom_path = '/bios/mcpx.bin'\n";
        assert_eq!(recent_folders(xemu)[..2], [(PathBuf::from("/xbox/discs"), false), (PathBuf::from("/xbox/other"), false)]);
        let ryujinx = "{\n  \"game_dirs\": [\n    \"/switch/games\",\n    \"/switch/more\"\n  ],\n  \"language_code\": \"en_US\"\n}";
        assert_eq!(recent_folders(ryujinx), vec![(PathBuf::from("/switch/games"), false), (PathBuf::from("/switch/more"), false)]);
    }

    #[test]
    fn fusion_snes9x_nestopia_nulldc_and_ares_folders() {
        // Snes9x: its ROM folder and recent games.
        let snes9x = "[Settings\\Win\\Files]\nDir:Roms = /roms/snes\nRom:RecentGame1 = /media/usb/snes/Zelda.sfc\nDir:Screenshots = /pics\n";
        assert_eq!(recent_folders(snes9x), vec![(PathBuf::from("/roms/snes"), false), (PathBuf::from("/media/usb/snes"), false)]);
        // Nestopia's XML.
        let nestopia = "<recent-files>\n  <file>/roms/nes/Contra.nes</file>\n</recent-files>\n<paths>\n  <images>\n    <save>/saves</save>\n  </images>\n</paths>";
        assert_eq!(recent_folders(nestopia), vec![(PathBuf::from("/roms/nes"), false)]);
        // Fusion's per-console folders; nullDC's last disc.
        let fusion = "[Paths]\nMDPath=/roms/md\nSCDPath=/roms/segacd\nScreenShotPath=/pics\n";
        assert_eq!(recent_folders(fusion), vec![(PathBuf::from("/roms/md"), false), (PathBuf::from("/roms/segacd"), false)]);
        let nulldc = "[ImageReader]\nDefaultImage=/roms/dc/Shenmue/disc.gdi\nLoadDefaultImage=1\n";
        assert_eq!(recent_folders(nulldc), vec![(PathBuf::from("/roms/dc/Shenmue"), false)]);
        // ares's BML: a console's folder and a recent game named "System;path".
        let ares = "PCEngine\n  Path: /roms/pce/\nRecent\n  Game1: Mega Drive;/roms/md/Sonic.md\n";
        assert_eq!(recent_folders(ares), vec![(PathBuf::from("/roms/pce/"), false), (PathBuf::from("/roms/md"), false)]);
    }

    #[test]
    fn mesen_fceux_and_mgba_folders() {
        // Mesen's settings.json: its recent games.
        let mesen = r#"{
  "RecentFiles": [
    { "RomFile": { "Path": "D:/Roms/SNES/Super Metroid (USA).sfc", "InnerFile": "" } },
    {
      "RomFile": {
        "Path": "D:/Roms/NES/Zelda.zip"
      }
    }
  ],
  "Theme": "Dark"
}"#;
        assert_eq!(recent_folders(mesen), vec![(PathBuf::from("D:/Roms/SNES"), false), (PathBuf::from("D:/Roms/NES"), false)]);
        // As Windows writes it, backslashes doubled.
        #[cfg(windows)]
        assert_eq!(recent_folders(r#"{ "Path": "D:\\Roms\\GBA\\Golden Sun.gba" }"#), vec![(PathBuf::from(r"D:\Roms\GBA"), false)]);
        // FCEUX's .cfg: recent games and the last folder.
        let fceux = "SDL.LastOpenFile = /home/me/nes/Mega Man.nes\nSDL.RecentRom00 = /home/me/nes/Contra.nes\nSDL.LastOpenNSF = /home/me/music\nSound = 1\n";
        assert_eq!(recent_folders(fceux), vec![(PathBuf::from("/home/me/nes"), false)]);
        // mGBA's config.ini: its recent list and last directory.
        let mgba = "[ports.qt]\nlastDirectory=/home/me/gba\nrecentList0=/media/usb/gb/Tetris.gb\nvolume=100\n";
        assert_eq!(recent_folders(mgba), vec![(PathBuf::from("/home/me/gba"), false), (PathBuf::from("/media/usb/gb"), false)]);
    }
}

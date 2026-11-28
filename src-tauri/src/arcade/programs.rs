//! The programs on this computer that could be added to Arcade as games (D-183), listed the way
//! Steam lists them for "Add a non-Steam game": on Windows the Start menu's and the desktop's
//! shortcuts, each followed to its program (.exe); on Linux the desktop entries of programs that
//! start from a program file. Installers, uninstallers, updaters, readmes and Windows' own tools are
//! left out. Each comes with its name, its program's place and its icon (taken from the program, as
//! the emulators' are, and kept).

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgramEntry {
    /// The shortcut's or desktop entry's name.
    pub name: String,
    /// The program file it starts.
    pub path: String,
    /// Its icon as a data URL, when one could be read.
    pub icon: Option<String>,
}

/// Words that mark a program as anything but something to play.
const NOT_GAMES: [&str; 17] = [
    "uninstall", "unins0", "setup", "installer", "update", "crashreport", "crash report", "bugreport", "readme", "read me", "license", "manual", "website", "support", "repair", "diagnostic", "helper",
];

pub fn looks_like_a_game(name: &str, path: &Path) -> bool {
    let name = name.to_lowercase();
    let stem = path.file_stem().map(|s| s.to_string_lossy().to_lowercase()).unwrap_or_default();
    !NOT_GAMES.iter().any(|word| name.contains(word) || stem.contains(word))
}

/// Every program found, once each (by its program file), in no particular order.
pub fn list(icon_cache: &Path) -> Vec<ProgramEntry> {
    let found = found();
    let mut seen = HashSet::new();
    let found: Vec<(String, PathBuf)> = found
        .into_iter()
        .filter(|(name, path)| looks_like_a_game(name, path))
        .filter(|(_, path)| seen.insert(path.to_string_lossy().to_lowercase()))
        .collect();
    let icons = icons(&found, icon_cache);
    found.into_iter().zip(icons).map(|((name, path), icon)| ProgramEntry { name, path: path.display().to_string(), icon }).collect()
}

/// The Start menu's and desktop's shortcuts, followed by Windows' own shell (in one run of Windows
/// PowerShell), keeping those that start a program file that's there and isn't one of Windows'.
#[cfg(windows)]
fn found() -> Vec<(String, PathBuf)> {
    let script = "$sh = New-Object -ComObject WScript.Shell; \
        $dirs = @([Environment]::GetFolderPath('CommonPrograms'), [Environment]::GetFolderPath('Programs'), [Environment]::GetFolderPath('CommonDesktopDirectory'), [Environment]::GetFolderPath('DesktopDirectory')); \
        $out = New-Object System.Collections.ArrayList; \
        foreach ($d in $dirs) { if (-not $d -or -not (Test-Path -LiteralPath $d)) { continue }; \
          Get-ChildItem -LiteralPath $d -Recurse -Filter *.lnk -ErrorAction SilentlyContinue | ForEach-Object { \
            try { $t = $sh.CreateShortcut($_.FullName).TargetPath } catch { $t = $null }; \
            if ($t -and $t.ToLower().EndsWith('.exe') -and (Test-Path -LiteralPath $t)) { [void]$out.Add(@{ name = $_.BaseName; exe = $t }) } } }; \
        ConvertTo-Json -InputObject @($out) -Compress";
    let encoded: Vec<u8> = script.encode_utf16().flat_map(|u| u.to_le_bytes()).collect();
    let Ok(output) = crate::tools::command(Path::new("powershell")).args(["-NoProfile", "-NonInteractive", "-EncodedCommand", &crate::tools::base64(&encoded)]).output() else {
        return Vec::new();
    };
    let text = String::from_utf8_lossy(&output.stdout);
    let Ok(list) = serde_json::from_str::<serde_json::Value>(text.trim()) else { return Vec::new() };
    let windows = std::env::var_os("WINDIR").map(PathBuf::from).map(|w| w.to_string_lossy().to_lowercase());
    list.as_array()
        .into_iter()
        .flatten()
        .filter_map(|entry| Some((entry["name"].as_str()?.to_string(), PathBuf::from(entry["exe"].as_str()?))))
        .filter(|(_, exe)| windows.as_deref().is_none_or(|w| !exe.to_string_lossy().to_lowercase().starts_with(w)))
        .collect()
}

/// Desktop entries of programs (not hidden, not run in a terminal) whose command is a program file.
#[cfg(not(windows))]
fn found() -> Vec<(String, PathBuf)> {
    let home = std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default();
    let dirs = [PathBuf::from("/usr/share/applications"), PathBuf::from("/usr/local/share/applications"), home.join(".local/share/applications")];
    let mut out = Vec::new();
    for dir in dirs {
        let Ok(files) = std::fs::read_dir(dir) else { continue };
        for file in files.filter_map(Result::ok).map(|e| e.path()).filter(|p| super::games::extension(p) == "desktop") {
            let Ok(text) = std::fs::read_to_string(&file) else { continue };
            if let Some(entry) = desktop_entry(&text) {
                out.push(entry);
            }
        }
    }
    out
}

/// A desktop entry's name and program file, when it's a visible application started by one.
#[cfg_attr(windows, allow(dead_code))]
pub fn desktop_entry(text: &str) -> Option<(String, PathBuf)> {
    let section: Vec<&str> = text.lines().skip_while(|l| l.trim() != "[Desktop Entry]").skip(1).take_while(|l| !l.trim_start().starts_with('[')).collect();
    let field = |key: &str| section.iter().find_map(|l| l.strip_prefix(key).and_then(|rest| rest.strip_prefix('='))).map(str::trim);
    if field("Type") != Some("Application") || field("NoDisplay") == Some("true") || field("Hidden") == Some("true") || field("Terminal") == Some("true") {
        return None;
    }
    let name = field("Name")?.to_string();
    let command = field("Exec")?.split_whitespace().next()?.trim_matches('"');
    let program = if command.starts_with('/') { PathBuf::from(command) } else { crate::tools::find_on_path(command)? };
    // A wrapper (flatpak, env, sh) isn't a game's own program.
    let wrapper = ["flatpak", "env", "sh", "bash", "snap", "xdg-open"].iter().any(|w| program.file_name().is_some_and(|n| n == *w));
    (program.is_file() && !wrapper).then_some((name, program))
}

/// Each program's icon, in the same order.
fn icons(found: &[(String, PathBuf)], cache: &Path) -> Vec<Option<String>> {
    #[cfg(windows)]
    {
        let _ = std::fs::create_dir_all(cache);
        let pngs: Vec<PathBuf> = found.iter().map(|(_, exe)| cache.join(format!("{}.png", &blake3::hash(exe.to_string_lossy().to_lowercase().as_bytes()).to_hex()[..16]))).collect();
        let missing: Vec<(&Path, &Path)> = found.iter().zip(&pngs).filter(|(_, png)| !png.exists()).map(|((_, exe), png)| (exe.as_path(), png.as_path())).collect();
        // A few hundred at a time, so the list Windows PowerShell gets stays a reasonable size.
        for chunk in missing.chunks(150) {
            super::icons::extract_windows(chunk);
        }
        for png in &pngs {
            if !png.exists() {
                let _ = std::fs::write(png, b"");
            }
        }
        pngs.iter().map(|png| super::icons::data_url(png)).collect()
    }
    #[cfg(not(windows))]
    {
        let _ = cache;
        found.iter().map(|(_, program)| super::icons::linux_program_icon(program)).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tools_and_installers_are_left_out() {
        assert!(looks_like_a_game("Hollow Knight", Path::new("C:/Games/Hollow Knight/hollow_knight.exe")));
        assert!(!looks_like_a_game("Uninstall Hollow Knight", Path::new("C:/Games/Hollow Knight/unins000.exe")));
        assert!(!looks_like_a_game("Game Updater", Path::new("C:/Games/x/update.exe")));
        assert!(!looks_like_a_game("Readme", Path::new("C:/Games/x/readme.exe")));
    }

    #[test]
    fn desktop_entries_name_their_program() {
        let entry = "[Desktop Entry]\nType=Application\nName=SuperTux\nExec=/bin/sh %U\n";
        assert!(desktop_entry(entry).is_none(), "a shell isn't a game's program");
        let hidden = "[Desktop Entry]\nType=Application\nName=Thing\nNoDisplay=true\nExec=/bin/ls\n";
        assert!(desktop_entry(hidden).is_none());
        let link = "[Desktop Entry]\nType=Link\nName=Site\nURL=https://example.test\n";
        assert!(desktop_entry(link).is_none());
    }
}

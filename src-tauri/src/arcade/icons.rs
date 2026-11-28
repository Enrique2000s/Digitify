//! The emulators' own icons (D-123), read from the programs found on this computer, as the
//! launchers' art is (D-037): nothing is shipped or downloaded. On Windows a program's icon is
//! taken from its .exe (through Windows' own drawing library, once, then kept); on Linux from the
//! icon its desktop entry or Flatpak installs. An emulator without one shows its initials instead.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use super::detect::{Emulator, Program};

/// Each found emulator's icon as a data URL, by its key; `cache` keeps the ones taken from programs.
pub fn icons(found: &[(Emulator, Program)], cache: &Path) -> HashMap<&'static str, String> {
    let mut out = HashMap::new();
    #[cfg(windows)]
    {
        let _ = std::fs::create_dir_all(cache);
        let wanted: Vec<(Emulator, PathBuf, PathBuf)> = found
            .iter()
            .filter_map(|(emulator, program)| match program {
                Program::Native(exe) => Some((*emulator, exe.clone(), cache.join(format!("{}.png", emulator.key())))),
                Program::Flatpak(_) => None,
            })
            .collect();
        // Taken again when the program is newer than the icon kept (an update).
        let stale = |exe: &Path, png: &Path| {
            let modified = |p: &Path| std::fs::metadata(p).and_then(|m| m.modified()).ok();
            match (modified(exe), modified(png)) {
                (Some(program), Some(icon)) => program > icon,
                (_, None) => true,
                _ => false,
            }
        };
        let missing: Vec<&(Emulator, PathBuf, PathBuf)> = wanted.iter().filter(|(_, exe, png)| stale(exe, png)).collect();
        if !missing.is_empty() {
            extract_windows(&missing.iter().map(|(_, exe, png)| (exe.as_path(), png.as_path())).collect::<Vec<_>>());
            // A program whose icon couldn't be read leaves an empty file, so Windows PowerShell isn't
            // started again for it every time Arcade looks (D-152); its initials show instead.
            for (_, _, png) in &missing {
                if !png.is_file() {
                    let _ = std::fs::write(png, b"");
                }
            }
        }
        for (emulator, _, png) in &wanted {
            if let Some(url) = data_url(png) {
                out.insert(emulator.key(), url);
            }
        }
    }
    #[cfg(not(windows))]
    {
        let _ = cache;
        for (emulator, program) in found {
            if let Some(url) = linux_icon(program).and_then(|p| data_url(&p)) {
                out.insert(emulator.key(), url);
            }
        }
    }
    out
}

pub(super) fn data_url(path: &Path) -> Option<String> {
    let bytes = std::fs::read(path).ok().filter(|b| !b.is_empty() && b.len() < 512 * 1024)?;
    let mime = if super::games::extension(path) == "svg" { "image/svg+xml" } else { "image/png" };
    Some(format!("data:{mime};base64,{}", crate::tools::base64(&bytes)))
}

/// Saves each program's icon as a PNG, in one run of Windows PowerShell (its drawing library reads
/// a program's icon). The list goes in an environment variable, the script as an encoded command.
#[cfg(windows)]
pub(super) fn extract_windows(pairs: &[(&Path, &Path)]) {
    let list: Vec<serde_json::Value> = pairs.iter().map(|(exe, png)| serde_json::json!({ "exe": exe.display().to_string(), "png": png.display().to_string() })).collect();
    let script = "Add-Type -AssemblyName System.Drawing; \
        foreach ($p in ($env:DIGITIFY_ICON_LIST | ConvertFrom-Json)) { \
          try { $i = [System.Drawing.Icon]::ExtractAssociatedIcon($p.exe); \
                if ($i) { $b = $i.ToBitmap(); $b.Save($p.png, [System.Drawing.Imaging.ImageFormat]::Png); $b.Dispose(); $i.Dispose() } } catch {} }";
    let encoded: Vec<u8> = script.encode_utf16().flat_map(|u| u.to_le_bytes()).collect();
    let result = crate::tools::command(Path::new("powershell"))
        .args(["-NoProfile", "-NonInteractive", "-EncodedCommand", &crate::tools::base64(&encoded)])
        .env("DIGITIFY_ICON_LIST", serde_json::Value::Array(list).to_string())
        .output();
    if let Err(e) = result {
        log::warn!("arcade: couldn't read the emulators' icons: {e}");
    }
}

/// A program's icon on Linux as a data URL (D-183's list of programs).
#[cfg(not(windows))]
pub(super) fn linux_program_icon(program: &Path) -> Option<String> {
    linux_icon(&Program::Native(program.to_path_buf())).and_then(|p| data_url(&p))
}

/// A Linux program's icon: a Flatpak's exported one, or the one its desktop entry names.
#[cfg(not(windows))]
fn linux_icon(program: &Program) -> Option<PathBuf> {
    let home = std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default();
    let themes = [
        PathBuf::from("/var/lib/flatpak/exports/share/icons/hicolor"),
        home.join(".local/share/flatpak/exports/share/icons/hicolor"),
        home.join(".local/share/icons/hicolor"),
        PathBuf::from("/usr/share/icons/hicolor"),
    ];
    let find = |name: &str| -> Option<PathBuf> {
        if Path::new(name).is_absolute() {
            return Some(PathBuf::from(name)).filter(|p| p.is_file());
        }
        for theme in &themes {
            for size in ["scalable", "256x256", "128x128", "96x96", "64x64", "48x48"] {
                for ext in ["svg", "png"] {
                    let path = theme.join(size).join("apps").join(format!("{name}.{ext}"));
                    if path.is_file() {
                        return Some(path);
                    }
                }
            }
        }
        ["png", "svg"].iter().map(|ext| PathBuf::from(format!("/usr/share/pixmaps/{name}.{ext}"))).find(|p| p.is_file())
    };
    match program {
        Program::Flatpak(id) => find(id),
        Program::Native(exe) => {
            let binary = exe.file_name()?.to_string_lossy().into_owned();
            let entries = [PathBuf::from("/usr/share/applications"), home.join(".local/share/applications")];
            for dir in entries {
                let Ok(files) = std::fs::read_dir(dir) else { continue };
                for file in files.filter_map(Result::ok).map(|e| e.path()).filter(|p| super::games::extension(p) == "desktop") {
                    let Ok(text) = std::fs::read_to_string(&file) else { continue };
                    let exec = text.lines().find_map(|l| l.strip_prefix("Exec=")).and_then(|e| e.split_whitespace().next()).map(|e| e.rsplit('/').next().unwrap_or(e).to_string());
                    if exec.as_deref() == Some(binary.as_str()) {
                        if let Some(icon) = text.lines().find_map(|l| l.strip_prefix("Icon=")).and_then(|name| find(name.trim())) {
                            return Some(icon);
                        }
                    }
                }
            }
            find(&binary.to_lowercase())
        }
    }
}

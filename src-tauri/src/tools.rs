//! Locating the helper programs shipped with the app (D-002).

#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;

/// Starts console helpers (ffmpeg, ffprobe, explorer) without flashing a console window.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Finds a helper executable: next to the app, in the bundled `ffmpeg` folder, or — for builds
/// run from the source tree — in the project's `tools/ffmpeg` folder. On Linux the system's
/// (`/usr/bin/ffmpeg`…) is used when none ships with the app.
pub fn find(name: &str) -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    find_in(exe.parent()?, name)
}

/// A program on the system's PATH.
pub fn find_on_path(name: &str) -> Option<PathBuf> {
    let file = if cfg!(windows) { format!("{name}.exe") } else { name.to_string() };
    std::env::var_os("PATH").and_then(|paths| std::env::split_paths(&paths).map(|p| p.join(&file)).find(|candidate| candidate.is_file()))
}

/// Text as Windows' wide strings want it: UTF-16, ending in a NUL.
#[cfg(windows)]
pub fn wide(text: &str) -> Vec<u16> {
    text.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Standard Base64, with padding (data URLs, PowerShell's encoded commands).
pub fn base64(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let n = (u32::from(chunk[0]) << 16) | (u32::from(*chunk.get(1).unwrap_or(&0)) << 8) | u32::from(*chunk.get(2).unwrap_or(&0));
        for (i, shift) in [18, 12, 6, 0].into_iter().enumerate() {
            out.push(if i <= chunk.len() { TABLE[(n >> shift) as usize & 63] as char } else { '=' });
        }
    }
    out
}

/// Like `find`, looking first in `dir` (the app's folder).
pub fn find_in(dir: &Path, name: &str) -> Option<PathBuf> {
    let file = if cfg!(windows) { format!("{name}.exe") } else { name.to_string() };
    let bundled = [dir.join(&file), dir.join("ffmpeg").join(&file)]
        .into_iter()
        .chain(dir.ancestors().take(5).map(|ancestor| ancestor.join("tools").join("ffmpeg").join(&file)))
        .find(|candidate| candidate.is_file());
    if bundled.is_some() || cfg!(windows) {
        return bundled;
    }
    find_on_path(name)
}

pub fn command(program: &Path) -> Command {
    #[allow(unused_mut)]
    let mut command = host_command(program);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    command
}

/// A command for a program of the system's own (mpv, ffmpeg, xdg-open, udisksctl…).
///
/// Inside the Linux AppImage, its launcher points `LD_LIBRARY_PATH`, `PATH` and the GTK, GIO,
/// GStreamer and Python paths at the libraries the AppImage carries (built on an older Ubuntu).
/// The system's programs must not inherit them: they would load those libraries instead of their
/// own and fail to start (no video thumbnails, no playback on Arch and other newer systems). So
/// every entry that points inside the AppImage is taken out again. Elsewhere this is `Command::new`.
pub fn host_command(program: impl AsRef<std::ffi::OsStr>) -> Command {
    #[allow(unused_mut)]
    let mut command = Command::new(program);
    #[cfg(target_os = "linux")]
    for (key, value) in appimage_env_fixes() {
        match value {
            Some(value) => command.env(key, value),
            None => command.env_remove(key),
        };
    }
    command
}

/// What to change in a child's environment to undo the AppImage launcher's settings: each variable
/// with paths inside the AppImage keeps only its other paths (or goes away), and the launcher's
/// own markers are removed. Empty outside an AppImage.
#[cfg(target_os = "linux")]
fn appimage_env_fixes() -> Vec<(std::ffi::OsString, Option<std::ffi::OsString>)> {
    use std::os::unix::ffi::OsStrExt;
    let Some(appdir) = std::env::var_os("APPDIR").filter(|_| std::env::var_os("APPIMAGE").is_some()) else {
        return Vec::new();
    };
    env_fixes(appdir.as_bytes(), std::env::vars_os())
}

#[cfg(target_os = "linux")]
fn env_fixes(
    appdir: &[u8],
    vars: impl Iterator<Item = (std::ffi::OsString, std::ffi::OsString)>,
) -> Vec<(std::ffi::OsString, Option<std::ffi::OsString>)> {
    use std::ffi::OsString;
    use std::os::unix::ffi::{OsStrExt, OsStringExt};
    // Set by the launcher (or its hooks) with no paths in them, or naming the AppImage itself.
    const LAUNCHER_ONLY: [&str; 7] =
        ["APPDIR", "APPIMAGE", "ARGV0", "OWD", "GTK_THEME", "PYTHONDONTWRITEBYTECODE", "GST_REGISTRY_REUSE_PLUGIN_SCANNER"];
    let appdir = appdir.strip_suffix(b"/").unwrap_or(appdir);
    let mut fixes = Vec::new();
    for (key, value) in vars {
        if LAUNCHER_ONLY.iter().any(|name| key.as_bytes() == name.as_bytes()) {
            fixes.push((key, None));
            continue;
        }
        let bytes = value.as_bytes();
        if !bytes.windows(appdir.len()).any(|w| w == appdir) {
            continue;
        }
        let kept: Vec<&[u8]> = bytes
            .split(|b| *b == b':')
            .filter(|entry| !entry.is_empty() && !entry.starts_with(appdir))
            .collect();
        let value = (!kept.is_empty()).then(|| OsString::from_vec(kept.join(&b':')));
        fixes.push((key, value));
    }
    fixes
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use std::ffi::OsString;

    fn var(key: &str, value: &str) -> (OsString, OsString) {
        (key.into(), value.into())
    }

    #[test]
    fn appimage_paths_are_taken_out_of_child_environments() {
        let app = "/tmp/.mount_DigiXY";
        let vars = vec![
            var("LD_LIBRARY_PATH", "/tmp/.mount_DigiXY/usr/lib/:/tmp/.mount_DigiXY/usr/lib64/:"),
            var("PATH", "/tmp/.mount_DigiXY/usr/bin/:/usr/local/bin:/usr/bin"),
            var("XDG_DATA_DIRS", "/tmp/.mount_DigiXY/usr/share/:/usr/share:"),
            var("GTK_THEME", "Adwaita:light"),
            var("APPDIR", app),
            var("HOME", "/home/someone"),
            var("GST_PLUGIN_SYSTEM_PATH_1_0", "/tmp/.mount_DigiXY/usr/lib/gstreamer-1.0:"),
        ];
        let fixes = super::env_fixes(app.as_bytes(), vars.into_iter());
        let get = |key: &str| fixes.iter().find(|(k, _)| k == key).map(|(_, v)| v.clone());
        assert_eq!(get("LD_LIBRARY_PATH"), Some(None));
        assert_eq!(get("PATH"), Some(Some("/usr/local/bin:/usr/bin".into())));
        assert_eq!(get("XDG_DATA_DIRS"), Some(Some("/usr/share".into())));
        assert_eq!(get("GTK_THEME"), Some(None));
        assert_eq!(get("APPDIR"), Some(None));
        assert_eq!(get("GST_PLUGIN_SYSTEM_PATH_1_0"), Some(None));
        assert_eq!(get("HOME"), None, "untouched variables are left alone");
    }
}

/// Opens a link or app target the way the system does (a web page in the browser; `steam://`,
/// `com.epicgames.launcher://` or `heroic://` in its launcher; `shell:AppsFolder\\…` on Windows).
/// Windows: the shell itself (`ShellExecuteW`), not `explorer.exe`, which falls back to opening a
/// folder for links with a query string such as Epic's (D-040).
#[cfg(windows)]
pub fn open_link(target: &str) -> std::io::Result<()> {
    use windows_sys::Win32::UI::Shell::ShellExecuteW;
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
    let (verb, target) = (wide("open"), wide(target));
    let result = unsafe { ShellExecuteW(std::ptr::null_mut(), verb.as_ptr(), target.as_ptr(), std::ptr::null(), std::ptr::null(), SW_SHOWNORMAL) };
    if result as isize <= 32 {
        return Err(std::io::Error::other(format!("Windows couldn't open it (code {})", result as isize)));
    }
    Ok(())
}

#[cfg(not(windows))]
pub fn open_link(target: &str) -> std::io::Result<()> {
    host_command("xdg-open").arg(target).spawn().map(|_| ())
}

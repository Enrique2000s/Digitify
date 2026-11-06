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
    std::env::var_os("PATH")
        .map(|paths| std::env::split_paths(&paths).map(|p| p.join(&file)).collect::<Vec<_>>())
        .unwrap_or_default()
        .into_iter()
        .find(|candidate| candidate.is_file())
}

pub fn command(program: &Path) -> Command {
    #[allow(unused_mut)]
    let mut command = Command::new(program);
    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);
    command
}

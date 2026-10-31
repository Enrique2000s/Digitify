//! Locating the helper programs shipped with the app (D-002).

use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;

/// Starts console helpers (ffmpeg, ffprobe, explorer) without flashing a console window.
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Finds a helper executable: next to the app, in the bundled `ffmpeg` folder, or — for builds
/// run from the source tree — in the project's `tools/ffmpeg` folder.
pub fn find(name: &str) -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    let file = format!("{name}.exe");
    [dir.join(&file), dir.join("ffmpeg").join(&file)]
        .into_iter()
        .chain(dir.ancestors().take(5).map(|ancestor| ancestor.join("tools").join("ffmpeg").join(&file)))
        .find(|candidate| candidate.exists())
}

pub fn command(program: &Path) -> Command {
    let mut command = Command::new(program);
    command.creation_flags(CREATE_NO_WINDOW);
    command
}

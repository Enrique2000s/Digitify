//! The computer locked (D-183): while its lock screen shows, the page holds the menu music, so it
//! isn't playing to an empty room; it comes back when the person unlocks. (Asleep, nothing plays
//! anyway, and waking up shows the lock screen first.) Checked every two seconds:
//! - Windows: the lock screen is a desktop of its own, which a program can't open as its input desktop.
//! - Linux: logind's `LockedHint` for this session, set by the desktop's lock screen.

use std::time::Duration;

use tauri::{AppHandle, Emitter};

#[cfg(windows)]
fn locked() -> Option<bool> {
    use windows_sys::Win32::System::StationsAndDesktops::{CloseDesktop, OpenInputDesktop, DESKTOP_SWITCHDESKTOP};
    // SAFETY: plain Win32 calls; the handle is closed right away when one is given.
    unsafe {
        let desktop = OpenInputDesktop(0, 0, DESKTOP_SWITCHDESKTOP);
        if desktop.is_null() {
            Some(true)
        } else {
            CloseDesktop(desktop);
            Some(false)
        }
    }
}

#[cfg(target_os = "linux")]
fn locked() -> Option<bool> {
    let session = std::env::var("XDG_SESSION_ID").ok().filter(|s| !s.is_empty()).unwrap_or_else(|| "self".into());
    let output = std::process::Command::new("loginctl").args(["show-session", &session, "-p", "LockedHint", "--value"]).output().ok()?;
    if !output.status.success() {
        return None;
    }
    match String::from_utf8_lossy(&output.stdout).trim() {
        "yes" => Some(true),
        "no" => Some(false),
        _ => None,
    }
}

#[cfg(not(any(windows, target_os = "linux")))]
fn locked() -> Option<bool> {
    None
}

/// Tells the page `session-locked` (true or false) whenever the lock screen comes or goes.
pub fn watch(app: AppHandle) {
    std::thread::spawn(move || {
        let mut last = false;
        // A system where it can't be told (no logind) stops asking after a few tries.
        let mut unknown = 0;
        loop {
            match locked() {
                Some(now) => {
                    unknown = 0;
                    if now != last {
                        last = now;
                        let _ = app.emit("session-locked", now);
                    }
                }
                None => {
                    unknown += 1;
                    if unknown >= 5 {
                        log::info!("the lock screen can't be told on this system; the menu music isn't held while locked");
                        return;
                    }
                }
            }
            std::thread::sleep(Duration::from_secs(2));
        }
    });
}

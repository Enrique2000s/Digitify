//! The computer locked (D-183): while its lock screen shows, the page holds the menu music, so it
//! isn't playing to an empty room; it comes back when the person unlocks. (Asleep, nothing plays
//! anyway, and waking up shows the lock screen first.) Checked every two seconds:
//! - Windows: the session's own lock state (D-185), which is on from the lock screen's picture and
//!   clock onwards; the sign-in desktop (the PIN or password) can't be opened as the input desktop
//!   either. Only the second was asked before, so the menu music played on under the picture.
//! - Linux: logind's `LockedHint` for this session, set by the desktop's lock screen.

use std::time::Duration;

use tauri::{AppHandle, Emitter};

#[cfg(windows)]
fn locked() -> Option<bool> {
    Some(session_locked() || !input_desktop())
}

/// The session's lock flag (its meaning is reversed only on Windows 7, which Digitify doesn't run on).
#[cfg(windows)]
fn session_locked() -> bool {
    use windows_sys::Win32::System::RemoteDesktop::{
        WTSFreeMemory, WTSQuerySessionInformationW, WTSSessionInfoEx, WTSINFOEXW, WTS_CURRENT_SERVER_HANDLE, WTS_CURRENT_SESSION, WTS_SESSIONSTATE_LOCK,
    };
    let mut buffer: windows_sys::core::PWSTR = std::ptr::null_mut();
    let mut bytes = 0u32;
    // SAFETY: the buffer is filled by the call, read only when it's big enough, and freed once.
    unsafe {
        if WTSQuerySessionInformationW(WTS_CURRENT_SERVER_HANDLE, WTS_CURRENT_SESSION, WTSSessionInfoEx, &mut buffer, &mut bytes) == 0 || buffer.is_null() {
            return false;
        }
        let mut locked = false;
        if bytes as usize >= std::mem::size_of::<WTSINFOEXW>() {
            let info = &*(buffer as *const WTSINFOEXW);
            if info.Level == 1 {
                locked = info.Data.WTSInfoExLevel1.SessionFlags as u32 == WTS_SESSIONSTATE_LOCK;
            }
        }
        WTSFreeMemory(buffer as *mut _);
        locked
    }
}

/// Whether the input desktop can be opened: it can't while the sign-in desktop is up.
#[cfg(windows)]
fn input_desktop() -> bool {
    use windows_sys::Win32::System::StationsAndDesktops::{CloseDesktop, OpenInputDesktop, DESKTOP_SWITCHDESKTOP};
    // SAFETY: plain Win32 calls; the handle is closed right away when one is given.
    unsafe {
        let desktop = OpenInputDesktop(0, 0, DESKTOP_SWITCHDESKTOP);
        if desktop.is_null() {
            false
        } else {
            CloseDesktop(desktop);
            true
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
                        log::info!("the computer {}", if now { "locked" } else { "unlocked" });
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

#[cfg(all(test, windows))]
mod tests {
    /// Run by hand (`--ignored`) on an unlocked desktop: neither sign says locked.
    #[test]
    #[ignore]
    fn unlocked_desktop_reads_unlocked() {
        assert!(!super::session_locked());
        assert!(super::input_desktop());
        assert_eq!(super::locked(), Some(false));
    }
}

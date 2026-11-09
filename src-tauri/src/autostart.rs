//! Starting Digitify when the user signs in (D-047), off unless switched on in Settings.
//! Windows: a value under the user's own `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` key
//! (no admin rights). Linux: `~/.config/autostart/digitify.desktop`, the freedesktop autostart
//! entry that desktops (GNOME, KDE, Xfce, Hyprland via its autostart helpers…) read at sign-in.
//! The entry itself is the setting: Settings shows whether it's there.
//!
//! `DIGITIFY_AUTOSTART_NAME` gives the entry another name, for tests that mustn't touch the real one.

use crate::error::{AppError, AppResult};

/// The entry's name: the registry value, or the `.desktop` file's name.
fn entry_name() -> String {
    std::env::var("DIGITIFY_AUTOSTART_NAME").ok().filter(|n| !n.trim().is_empty() && !n.contains(['/', '\\'])).unwrap_or_else(|| "Digitify".into())
}

/// The program to start: on Linux the AppImage itself when run from one (its mount point changes
/// every time), otherwise this executable.
fn program() -> AppResult<std::path::PathBuf> {
    #[cfg(target_os = "linux")]
    if let Some(appimage) = std::env::var_os("APPIMAGE") {
        return Ok(appimage.into());
    }
    Ok(std::env::current_exe()?)
}

#[cfg(windows)]
mod platform {
    use super::*;
    use windows_sys::Win32::Foundation::ERROR_SUCCESS;
    use windows_sys::Win32::System::Registry::{
        RegCloseKey, RegDeleteValueW, RegOpenKeyExW, RegQueryValueExW, RegSetValueExW, HKEY, HKEY_CURRENT_USER, KEY_QUERY_VALUE, KEY_SET_VALUE, REG_SZ,
    };

    const RUN: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";

    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    fn open(access: u32) -> AppResult<HKEY> {
        let mut key: HKEY = std::ptr::null_mut();
        let status = unsafe { RegOpenKeyExW(HKEY_CURRENT_USER, wide(RUN).as_ptr(), 0, access, &mut key) };
        if status != ERROR_SUCCESS {
            return Err(AppError::msg(format!("Windows' startup list couldn't be opened (error {status}).")));
        }
        Ok(key)
    }

    pub fn enabled() -> AppResult<bool> {
        let key = open(KEY_QUERY_VALUE)?;
        let status = unsafe { RegQueryValueExW(key, wide(&entry_name()).as_ptr(), std::ptr::null(), std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null_mut()) };
        unsafe { RegCloseKey(key) };
        Ok(status == ERROR_SUCCESS)
    }

    pub fn set(on: bool) -> AppResult<()> {
        let key = open(KEY_SET_VALUE)?;
        let name = wide(&entry_name());
        let status = if on {
            let command = wide(&format!("\"{}\" --autostart", program()?.display()));
            let bytes = (command.len() * 2) as u32;
            unsafe { RegSetValueExW(key, name.as_ptr(), 0, REG_SZ, command.as_ptr().cast(), bytes) }
        } else {
            let status = unsafe { RegDeleteValueW(key, name.as_ptr()) };
            // Already gone is fine.
            if status == windows_sys::Win32::Foundation::ERROR_FILE_NOT_FOUND {
                ERROR_SUCCESS
            } else {
                status
            }
        };
        unsafe { RegCloseKey(key) };
        if status != ERROR_SUCCESS {
            return Err(AppError::msg(format!("Windows' startup list couldn't be changed (error {status}).")));
        }
        Ok(())
    }
}

#[cfg(not(windows))]
mod platform {
    use super::*;
    use std::path::PathBuf;

    fn desktop_file() -> AppResult<PathBuf> {
        let config = std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .filter(|p| p.is_absolute())
            .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".config")))
            .ok_or_else(|| AppError::msg("The home folder isn't known."))?;
        Ok(config.join("autostart").join(format!("{}.desktop", entry_name().to_lowercase())))
    }

    pub fn enabled() -> AppResult<bool> {
        Ok(desktop_file()?.is_file())
    }

    pub fn set(on: bool) -> AppResult<()> {
        let file = desktop_file()?;
        if on {
            std::fs::create_dir_all(file.parent().unwrap_or(&file))?;
            // Exec quoting (freedesktop): the path in double quotes, with \ " ` $ escaped.
            let path = program()?.display().to_string();
            let quoted: String = path.chars().flat_map(|c| if matches!(c, '\\' | '"' | '`' | '$') { vec!['\\', c] } else { vec![c] }).collect();
            std::fs::write(
                &file,
                format!(
                    "[Desktop Entry]\nType=Application\nName=Digitify\nComment=Your media library\nExec=\"{quoted}\" --autostart\nIcon=digitify\nTerminal=false\nX-GNOME-Autostart-enabled=true\n"
                ),
            )?;
        } else if file.exists() {
            std::fs::remove_file(&file)?;
        }
        Ok(())
    }
}

/// Whether Digitify starts when the user signs in.
#[tauri::command]
pub fn autostart_get() -> AppResult<bool> {
    platform::enabled()
}

/// Turns starting at sign-in on or off.
#[tauri::command]
pub fn autostart_set(on: bool) -> AppResult<bool> {
    platform::set(on)?;
    let now = platform::enabled()?;
    log::info!("start at sign-in: {now}");
    Ok(now)
}

#[cfg(all(test, not(windows)))]
mod tests {
    use super::*;

    #[test]
    fn autostart_entry_is_written_and_removed() {
        let dir = std::env::temp_dir().join(format!("digitify-autostart-{}", std::process::id()));
        std::env::set_var("XDG_CONFIG_HOME", &dir);
        std::env::set_var("DIGITIFY_AUTOSTART_NAME", "DigitifyTest");
        assert!(!autostart_get().unwrap());
        assert!(autostart_set(true).unwrap());
        let text = std::fs::read_to_string(dir.join("autostart/digitifytest.desktop")).unwrap();
        assert!(text.contains("[Desktop Entry]") && text.contains("--autostart") && text.contains("Exec=\""));
        assert!(!autostart_set(false).unwrap());
        assert!(!dir.join("autostart/digitifytest.desktop").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }
}

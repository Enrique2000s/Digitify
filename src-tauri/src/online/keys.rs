//! API keys for online services (D-028), entered by the owner in Settings. They're kept in the
//! config folder encrypted with Windows' data protection for the signed-in user (DPAPI), never
//! sent to the UI once saved, and never written to logs.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Keys {
    /// A YouTube Data API v3 key.
    pub youtube: Option<String>,
    /// Spotify client id and secret.
    pub spotify: Option<(String, String)>,
    /// SoundCloud client id and secret.
    pub soundcloud: Option<(String, String)>,
}

/// Which services have keys, for Settings.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeysStatus {
    pub youtube: bool,
    pub spotify: bool,
    pub soundcloud: bool,
}

impl Keys {
    pub fn status(&self) -> KeysStatus {
        KeysStatus { youtube: self.youtube.is_some(), spotify: self.spotify.is_some(), soundcloud: self.soundcloud.is_some() }
    }
}

pub fn file(config_dir: &Path) -> PathBuf {
    config_dir.join("online-keys.bin")
}

pub fn load(config_dir: &Path) -> Keys {
    let Ok(sealed) = std::fs::read(file(config_dir)) else { return Keys::default() };
    match unprotect(&sealed).and_then(|plain| serde_json::from_slice(&plain).map_err(|e| AppError::msg(e.to_string()))) {
        Ok(keys) => keys,
        Err(e) => {
            log::warn!("the saved online-service keys couldn't be read ({e}); they need entering again");
            Keys::default()
        }
    }
}

pub fn save(config_dir: &Path, keys: &Keys) -> AppResult<()> {
    let target = file(config_dir);
    if keys.youtube.is_none() && keys.spotify.is_none() && keys.soundcloud.is_none() {
        let _ = std::fs::remove_file(&target);
        return Ok(());
    }
    let plain = serde_json::to_vec(keys).map_err(|e| AppError::msg(e.to_string()))?;
    std::fs::create_dir_all(config_dir)?;
    let temporary = target.with_extension("bin.tmp");
    std::fs::write(&temporary, protect(&plain)?)?;
    std::fs::rename(&temporary, &target)?;
    Ok(())
}

#[cfg(windows)]
fn crypt(data: &[u8], seal: bool) -> AppResult<Vec<u8>> {
    use windows_sys::Win32::Foundation::{LocalFree, HLOCAL};
    use windows_sys::Win32::Security::Cryptography::{CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB};
    let input = CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 };
    let mut output = CRYPT_INTEGER_BLOB { cbData: 0, pbData: std::ptr::null_mut() };
    let ok = unsafe {
        if seal {
            CryptProtectData(&input, std::ptr::null(), std::ptr::null(), std::ptr::null(), std::ptr::null(), CRYPTPROTECT_UI_FORBIDDEN, &mut output)
        } else {
            CryptUnprotectData(&input, std::ptr::null_mut(), std::ptr::null(), std::ptr::null(), std::ptr::null(), CRYPTPROTECT_UI_FORBIDDEN, &mut output)
        }
    };
    if ok == 0 || output.pbData.is_null() {
        return Err(AppError::msg("Windows couldn't protect the keys."));
    }
    let bytes = unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
    unsafe { LocalFree(output.pbData as HLOCAL) };
    Ok(bytes)
}

#[cfg(windows)]
fn protect(data: &[u8]) -> AppResult<Vec<u8>> {
    crypt(data, true)
}

#[cfg(windows)]
fn unprotect(data: &[u8]) -> AppResult<Vec<u8>> {
    crypt(data, false)
}

#[cfg(not(windows))]
fn protect(_: &[u8]) -> AppResult<Vec<u8>> {
    Err(AppError::msg("Saving keys needs Windows."))
}

#[cfg(not(windows))]
fn unprotect(_: &[u8]) -> AppResult<Vec<u8>> {
    Err(AppError::msg("Saving keys needs Windows."))
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn keys_round_trip_encrypted() {
        let dir = std::env::temp_dir().join(format!("digitify-keys-{}", std::process::id()));
        let keys = Keys { youtube: Some("AIza-test".into()), spotify: None, soundcloud: Some(("id".into(), "secret".into())) };
        save(&dir, &keys).unwrap();
        let raw = std::fs::read(file(&dir)).unwrap();
        assert!(!String::from_utf8_lossy(&raw).contains("AIza-test"), "stored in the clear");
        let back = load(&dir);
        assert_eq!(back.youtube.as_deref(), Some("AIza-test"));
        assert_eq!(back.soundcloud, Some(("id".into(), "secret".into())));
        save(&dir, &Keys::default()).unwrap();
        assert!(!file(&dir).exists());
        let _ = std::fs::remove_dir_all(&dir);
    }
}

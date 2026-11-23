//! Updates (D-181): when Digitify starts it asks GitHub, quietly, which version is the newest
//! release (nothing about the person or their library is sent: it's the same public page anyone can
//! open), and if it's newer the page offers it. Accepting downloads this system's installer from
//! the release, checks it against the release's SHA256SUMS.txt, and installs it:
//! - Windows: the installer runs on its own, showing only its progress (`/P /UPDATE /R`), and opens
//!   Digitify again when it's done; Digitify closes first.
//! - Linux AppImage: the new AppImage takes the old one's place and starts.
//! - Linux .deb: `pkexec apt install` (the system asks for the password in its own window), then
//!   Digitify starts again.
//! - Arch-based Linux: the release's install script runs in a terminal, where it asks for sudo.

use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter};

use crate::error::{AppError, AppResult};
use crate::library::blocking;

const LATEST: &str = "https://api.github.com/repos/Enrique2000s/Digitify/releases/latest";

/// The version this build is, or the one a test pretends to be (`DIGITIFY_FAKE_VERSION`).
fn current() -> String {
    std::env::var("DIGITIFY_FAKE_VERSION").ok().filter(|v| !v.trim().is_empty()).unwrap_or_else(|| env!("CARGO_PKG_VERSION").to_string())
}

/// "v0.10.2" or "0.10.2" as numbers, for comparing; anything after a "-" (a pre-release) is ignored.
fn parts(version: &str) -> Vec<u64> {
    version.trim().trim_start_matches(['v', 'V']).split('-').next().unwrap_or("").split('.').map(|p| p.parse().unwrap_or(0)).collect()
}

/// Whether `latest` is a newer version than `running`.
pub fn is_newer(latest: &str, running: &str) -> bool {
    let (a, b) = (parts(latest), parts(running));
    for i in 0..a.len().max(b.len()) {
        let (x, y) = (a.get(i).copied().unwrap_or(0), b.get(i).copied().unwrap_or(0));
        if x != y {
            return x > y;
        }
    }
    false
}

/// How this copy of Digitify was installed, which decides the file to download and how it installs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Kind {
    Windows,
    AppImage,
    Deb,
    Arch,
}

impl Kind {
    pub fn here() -> Kind {
        if cfg!(windows) {
            Kind::Windows
        } else if std::env::var_os("APPIMAGE").is_some() {
            Kind::AppImage
        } else if Path::new("/etc/arch-release").exists() || crate::tools::find_on_path("pacman").is_some() {
            Kind::Arch
        } else {
            Kind::Deb
        }
    }

    /// The release's file for it (D-172's names).
    pub fn asset(self) -> &'static str {
        match self {
            Kind::Windows => "Digitify-Setup-Windows-x64.exe",
            Kind::AppImage => "Digitify-Linux-x86_64.AppImage",
            Kind::Deb => "Digitify-Linux-amd64.deb",
            Kind::Arch => "Digitify-Arch-install.sh",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Update {
    /// The newer version, without the "v".
    pub version: String,
    /// The version running now.
    pub current: String,
    /// The release's page.
    pub page: String,
    pub kind: Kind,
    /// This system's file, its address and size.
    pub file: String,
    pub url: String,
    pub size: u64,
    /// The release's SHA256SUMS.txt, and for Arch the .deb the script installs.
    pub sums: Option<String>,
    pub deb: Option<String>,
}

/// What the newest release offers this computer, from GitHub's answer.
fn offer(release: &serde_json::Value, running: &str, kind: Kind) -> Option<Update> {
    let tag = release["tag_name"].as_str()?;
    if release["draft"].as_bool() == Some(true) || release["prerelease"].as_bool() == Some(true) || !is_newer(tag, running) {
        return None;
    }
    let assets = release["assets"].as_array()?;
    let find = |name: &str| assets.iter().find(|a| a["name"].as_str() == Some(name));
    let file = find(kind.asset())?;
    let address = |a: &serde_json::Value| a["browser_download_url"].as_str().map(str::to_string);
    Some(Update {
        version: tag.trim_start_matches(['v', 'V']).to_string(),
        current: running.to_string(),
        page: release["html_url"].as_str().unwrap_or_default().to_string(),
        kind,
        file: kind.asset().to_string(),
        url: address(file)?,
        size: file["size"].as_u64().unwrap_or(0),
        sums: find("SHA256SUMS.txt").and_then(address),
        deb: if kind == Kind::Arch { find(Kind::Deb.asset()).and_then(address) } else { None },
    })
}

/// Asks GitHub for the newest release. Nothing when this is the newest, or GitHub can't be reached
/// (offline is normal, so it's not an error unless `loud`, for Check now).
#[tauri::command]
pub async fn update_check(loud: bool) -> AppResult<Option<Update>> {
    blocking(move || {
        let response = crate::online::http::agent()?.get(LATEST).set("Accept", "application/vnd.github+json").call();
        let release: serde_json::Value = match response {
            Ok(response) => response.into_json().map_err(|e| AppError::msg(format!("GitHub's answer couldn't be read: {e}")))?,
            Err(e) if loud => return Err(crate::online::http::explain("GitHub", e)),
            Err(e) => {
                log::info!("update check skipped: {e}");
                return Ok(None);
            }
        };
        Ok(offer(&release, &current(), Kind::here()))
    })
    .await
}

/// Where downloads wait before installing.
fn folder() -> PathBuf {
    std::env::temp_dir().join("digitify-update")
}

/// Downloads one file, telling the page how far along it is.
fn download(app: &AppHandle, url: &str, to: &Path, total_hint: u64) -> AppResult<()> {
    let response = crate::online::http::agent()?.get(url).call().map_err(|e| crate::online::http::explain("GitHub", e))?;
    let total = response.header("Content-Length").and_then(|v| v.parse().ok()).unwrap_or(total_hint);
    let part = to.with_extension("part");
    let mut out = std::fs::File::create(&part)?;
    let mut reader = response.into_reader();
    let mut buffer = vec![0u8; 256 * 1024];
    let (mut received, mut told) = (0u64, 0u64);
    loop {
        let n = reader.read(&mut buffer).map_err(|e| AppError::msg(format!("The download stopped: {e}")))?;
        if n == 0 {
            break;
        }
        out.write_all(&buffer[..n])?;
        received += n as u64;
        if received - told >= 1024 * 1024 || received == total {
            told = received;
            let _ = app.emit("update-progress", serde_json::json!({ "received": received, "total": total }));
        }
    }
    out.flush()?;
    drop(out);
    if total > 0 && received != total {
        return Err(AppError::msg("The download ended early. Try again."));
    }
    std::fs::rename(&part, to)?;
    Ok(())
}

/// The SHA-256 a SHA256SUMS.txt gives for a file name ("<hash>  <name>" lines).
pub fn sum_for(sums: &str, name: &str) -> Option<String> {
    sums.lines().find_map(|line| {
        let mut words = line.split_whitespace();
        let hash = words.next()?;
        let file = words.next()?.trim_start_matches('*');
        (file == name && hash.len() == 64).then(|| hash.to_ascii_lowercase())
    })
}

fn sha256(path: &Path) -> AppResult<String> {
    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    std::io::copy(&mut file, &mut hasher)?;
    Ok(format!("{:x}", hasher.finalize()))
}

/// Downloads the update and checks it. Returns the downloaded file (for Arch, the script; the .deb
/// is next to it, where the script looks).
#[tauri::command]
pub async fn update_download(app: AppHandle, update: UpdateRequest) -> AppResult<String> {
    blocking(move || {
        let dir = folder();
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir)?;
        let sums = match &update.sums {
            Some(url) => Some(crate::online::http::agent()?.get(url).call().map_err(|e| crate::online::http::explain("GitHub", e))?.into_string()?),
            None => None,
        };
        let mut files = vec![(update.url.clone(), update.file.clone(), update.size)];
        if let Some(deb) = &update.deb {
            files.insert(0, (deb.clone(), Kind::Deb.asset().to_string(), 0));
        }
        for (url, name, size) in &files {
            let path = dir.join(name);
            download(&app, url, &path, *size)?;
            // Checked against the release's own list; a release without one can't be checked.
            let Some(sums) = &sums else { return Err(AppError::msg("This release has no SHA256SUMS.txt, so its download can't be checked. Download it from its page instead.")) };
            let want = sum_for(sums, name).ok_or_else(|| AppError::msg(format!("{name} isn't in the release's SHA256SUMS.txt, so it can't be checked.")))?;
            if sha256(&path)? != want {
                let _ = std::fs::remove_file(&path);
                return Err(AppError::msg("The download doesn't match the release's checksum, so it was thrown away. Try again."));
            }
        }
        Ok(dir.join(&update.file).to_string_lossy().to_string())
    })
    .await
}

/// What the page sends back to download: the parts of the offer it needs.
#[derive(Debug, serde::Deserialize)]
pub struct UpdateRequest {
    pub url: String,
    pub file: String,
    pub size: u64,
    pub sums: Option<String>,
    pub deb: Option<String>,
}

/// Installs the downloaded update (see the top of this file). Digitify closes where the installer
/// needs it to.
#[tauri::command]
pub async fn update_install(app: AppHandle, path: String) -> AppResult<()> {
    // A test pretending to be an older version never installs over the real Digitify on this computer.
    if std::env::var("DIGITIFY_FAKE_VERSION").is_ok_and(|v| !v.trim().is_empty()) {
        return Err(AppError::msg("Test mode (DIGITIFY_FAKE_VERSION): the update was downloaded and checked, and isn't installed."));
    }
    let path = PathBuf::from(path);
    if !path.starts_with(folder()) || !path.is_file() {
        return Err(AppError::msg("The downloaded update isn't there anymore. Download it again."));
    }
    match Kind::here() {
        Kind::Windows => {
            std::process::Command::new(&path).args(["/P", "/UPDATE", "/R"]).spawn().map_err(|e| AppError::msg(format!("The installer couldn't start: {e}")))?;
            app.exit(0);
        }
        #[cfg(unix)]
        Kind::AppImage => {
            use std::os::unix::fs::PermissionsExt;
            let target = PathBuf::from(std::env::var_os("APPIMAGE").ok_or_else(|| AppError::msg("This AppImage's place isn't known."))?);
            let staged = target.with_extension("new");
            std::fs::copy(&path, &staged).map_err(|e| AppError::msg(format!("The new AppImage couldn't be put next to {}: {e}", target.display())))?;
            std::fs::set_permissions(&staged, std::fs::Permissions::from_mode(0o755))?;
            std::fs::rename(&staged, &target)?;
            std::process::Command::new(&target).env_remove("APPIMAGE").spawn().map_err(|e| AppError::msg(format!("The new version couldn't start: {e}")))?;
            app.exit(0);
        }
        #[cfg(unix)]
        Kind::Deb => {
            let status = blocking(move || {
                Ok(std::process::Command::new("pkexec").args(["apt-get", "install", "-y", "--allow-downgrades"]).arg(&path).status())
            })
            .await?;
            match status {
                Ok(s) if s.success() => {
                    let _ = std::process::Command::new("digitify").spawn();
                    app.exit(0);
                }
                Ok(_) => return Err(AppError::msg("The update wasn't installed (the password was cancelled, or apt stopped). Digitify is unchanged.")),
                Err(e) => return Err(AppError::msg(format!("pkexec isn't available ({e}). Install the downloaded package with: sudo apt install ./{}", Kind::Deb.asset()))),
            }
        }
        #[cfg(unix)]
        Kind::Arch => {
            let dir = path.parent().map(Path::to_path_buf).unwrap_or_else(folder);
            let command = format!("cd '{}' && bash '{}' '{}'; echo; read -rp 'Press Enter to close this window.' _", dir.display(), path.display(), dir.join(Kind::Deb.asset()).display());
            let terminals: [(&str, &[&str]); 7] = [
                ("konsole", &["-e", "bash", "-c"]),
                ("gnome-terminal", &["--", "bash", "-c"]),
                ("xfce4-terminal", &["-x", "bash", "-c"]),
                ("kitty", &["bash", "-c"]),
                ("alacritty", &["-e", "bash", "-c"]),
                ("x-terminal-emulator", &["-e", "bash", "-c"]),
                ("xterm", &["-e", "bash", "-c"]),
            ];
            let found = terminals.iter().find(|(name, _)| crate::tools::find_on_path(name).is_some());
            let Some((terminal, args)) = found else {
                return Err(AppError::msg(format!("No terminal was found to run the installer in. Run it yourself: bash '{}'", path.display())));
            };
            std::process::Command::new(terminal).args(*args).arg(command).spawn().map_err(|e| AppError::msg(format!("The terminal couldn't start: {e}")))?;
        }
        #[cfg(not(unix))]
        _ => return Err(AppError::msg("This kind of install isn't on this system.")),
    }
    Ok(())
}

/// Opens a release's page in the browser (the popup's "See what's in it").
#[tauri::command]
pub fn update_page_open(version: String) -> AppResult<()> {
    if version.is_empty() || !version.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-') {
        return Err(AppError::msg("That isn't a version."));
    }
    let page = format!("https://github.com/Enrique2000s/Digitify/releases/tag/v{version}");
    crate::tools::open_link(&page).map_err(|e| AppError::msg(format!("Couldn't open the browser: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions_compare_as_numbers() {
        assert!(is_newer("v0.10.0", "0.9.3"));
        assert!(is_newer("0.10.1", "0.10.0"));
        assert!(is_newer("v1.0", "0.99.9"));
        assert!(!is_newer("v0.10.0", "0.10.0"));
        assert!(!is_newer("v0.9.3", "0.10.0"));
        assert!(!is_newer("v0.10.0-beta", "0.10.0"));
    }

    #[test]
    fn the_offer_is_this_systems_file_from_a_newer_release() {
        let release = serde_json::json!({
            "tag_name": "v0.11.0", "draft": false, "prerelease": false, "html_url": "https://example.test/r", "body": "Notes",
            "assets": [
                { "name": "Digitify-Setup-Windows-x64.exe", "browser_download_url": "https://example.test/w.exe", "size": 10 },
                { "name": "Digitify-Linux-amd64.deb", "browser_download_url": "https://example.test/l.deb", "size": 20 },
                { "name": "Digitify-Arch-install.sh", "browser_download_url": "https://example.test/a.sh", "size": 1 },
                { "name": "SHA256SUMS.txt", "browser_download_url": "https://example.test/sums", "size": 1 }
            ]
        });
        let windows = offer(&release, "0.10.0", Kind::Windows).unwrap();
        assert_eq!((windows.version.as_str(), windows.url.as_str(), windows.size), ("0.11.0", "https://example.test/w.exe", 10));
        assert_eq!(windows.sums.as_deref(), Some("https://example.test/sums"));
        let arch = offer(&release, "0.10.0", Kind::Arch).unwrap();
        assert_eq!(arch.deb.as_deref(), Some("https://example.test/l.deb"));
        // Not offered: the same version, a release without this system's file.
        assert!(offer(&release, "0.11.0", Kind::Windows).is_none());
        assert!(offer(&release, "0.10.0", Kind::AppImage).is_none());
    }

    #[test]
    fn checksums_are_read_by_name() {
        let sums = format!("{}  Digitify-Setup-Windows-x64.exe\n{} *Digitify-Linux-amd64.deb\n", "a".repeat(64), "B".repeat(64));
        assert_eq!(sum_for(&sums, "Digitify-Setup-Windows-x64.exe"), Some("a".repeat(64)));
        assert_eq!(sum_for(&sums, "Digitify-Linux-amd64.deb"), Some("b".repeat(64)));
        assert_eq!(sum_for(&sums, "Digitify-Linux-x86_64.AppImage"), None);
    }
}

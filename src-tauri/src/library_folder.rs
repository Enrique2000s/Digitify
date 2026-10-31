//! The library folder the user chooses (D-010). It holds the database, the artwork cache, managed
//! copies of media and backups, so the whole library can be backed up or moved as one folder.

use std::fs;
use std::path::{Path, PathBuf};

use crate::error::{AppError, AppResult};

pub struct LibraryFolder {
    pub root: PathBuf,
}

impl LibraryFolder {
    /// Creates the folder structure when needed and checks that Digitify can write to it.
    pub fn prepare(root: &Path) -> AppResult<Self> {
        let folder = Self { root: root.to_path_buf() };
        for dir in [folder.covers_dir(), folder.thumbs_dir(), folder.media_dir(), folder.backups_dir()] {
            fs::create_dir_all(&dir)
                .map_err(|e| AppError::msg(format!("Digitify can't create {}: {e}", dir.display())))?;
        }
        let probe = folder.root.join(".digitify-write-test");
        fs::write(&probe, b"ok")
            .map_err(|e| AppError::msg(format!("Digitify can't write to {}: {e}", root.display())))?;
        let _ = fs::remove_file(&probe);
        Ok(folder)
    }

    pub fn db_path(&self) -> PathBuf {
        self.root.join("library.db")
    }

    /// Full-size artwork (long side up to 1400 px).
    pub fn covers_dir(&self) -> PathBuf {
        self.root.join("cache").join("covers")
    }

    /// Grid-size artwork (400 px wide).
    pub fn thumbs_dir(&self) -> PathBuf {
        self.root.join("cache").join("thumbs")
    }

    /// Managed copies made by "Copy into library" imports.
    pub fn media_dir(&self) -> PathBuf {
        self.root.join("media")
    }

    pub fn backups_dir(&self) -> PathBuf {
        self.root.join("backups")
    }

    /// Turns a stored file path into a real one: managed copies are stored relative to the library.
    pub fn resolve(&self, stored: &str, storage: &str) -> PathBuf {
        if storage == "managed" {
            self.root.join(stored)
        } else {
            PathBuf::from(stored)
        }
    }
}

/// Default suggestion at first launch: a folder in the user's profile, outside Documents, which
/// cloud backup tools often redirect.
pub fn suggested_path() -> PathBuf {
    std::env::var_os("USERPROFILE")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("C:\\"))
        .join("Digitify Library")
}

/// Name of the sync service when `path` is inside a cloud-synced folder. Syncing a live SQLite
/// database can corrupt it, and would upload the library, so the UI warns about it (D-010).
pub fn cloud_sync_provider(path: &Path) -> Option<&'static str> {
    let lower = path.to_string_lossy().to_lowercase();
    for var in ["OneDrive", "OneDriveConsumer", "OneDriveCommercial"] {
        if let Some(root) = std::env::var_os(var) {
            let root = root.to_string_lossy().to_lowercase();
            if !root.is_empty() && lower.starts_with(&root) {
                return Some("OneDrive");
            }
        }
    }
    const MARKERS: &[(&str, &str)] = &[
        ("\\onedrive", "OneDrive"),
        ("\\dropbox", "Dropbox"),
        ("\\google drive", "Google Drive"),
        ("\\my drive", "Google Drive"),
        ("\\icloud drive", "iCloud Drive"),
        ("\\iclouddrive", "iCloud Drive"),
        ("\\box\\", "Box"),
    ];
    MARKERS.iter().find(|(marker, _)| lower.contains(marker)).map(|(_, name)| *name)
}

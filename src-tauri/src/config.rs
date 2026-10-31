//! Machine-specific app configuration, kept outside the library: where the library lives and the
//! interface preferences. Stored as JSON in the app's local data folder, or in the folder named by
//! the DIGITIFY_CONFIG_DIR environment variable (used by tests and portable setups).

use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Config {
    pub library_path: Option<PathBuf>,
    /// Interface preferences (theme, accent, motion, layouts…). Owned and validated by the UI.
    pub preferences: Value,
}

pub struct ConfigStore {
    file: PathBuf,
    current: Mutex<Config>,
}

impl ConfigStore {
    pub fn load(dir: PathBuf) -> Self {
        let file = dir.join("config.json");
        // Editors on Windows may save the file with a UTF-8 byte-order mark; JSON parsers reject it.
        let current = fs::read(&file)
            .ok()
            .and_then(|bytes| serde_json::from_slice(bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(&bytes)).ok())
            .unwrap_or_default();
        Self { file, current: Mutex::new(current) }
    }

    pub fn get(&self) -> Config {
        self.current.lock().map(|config| config.clone()).unwrap_or_default()
    }

    /// Applies `change` and writes the result atomically (temporary file, then rename).
    pub fn update(&self, change: impl FnOnce(&mut Config)) -> AppResult<Config> {
        let mut config = self.current.lock().map_err(|_| AppError::msg("configuration is unavailable"))?;
        change(&mut config);
        if let Some(dir) = self.file.parent() {
            fs::create_dir_all(dir)?;
        }
        let json = serde_json::to_vec_pretty(&*config).map_err(|e| AppError::msg(e.to_string()))?;
        let temporary = self.file.with_extension("json.tmp");
        fs::write(&temporary, json)?;
        fs::rename(&temporary, &self.file)?;
        Ok(config.clone())
    }
}

pub fn config_dir(app: &AppHandle) -> AppResult<PathBuf> {
    match std::env::var_os("DIGITIFY_CONFIG_DIR") {
        Some(dir) => Ok(PathBuf::from(dir)),
        None => Ok(app.path().app_local_data_dir()?),
    }
}

//! Developer harness kept from Phase 0: the video lab and its automated run. Not product
//! functionality; it is only reachable from Settings › Developer and the DIGITIFY_POC variable.

use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};

/// `DIGITIFY_POC=video:<path>` opens the video lab and runs its automated checks.
pub fn mode() -> Option<String> {
    std::env::var("DIGITIFY_POC").ok().filter(|value| !value.is_empty())
}

/// Automated runs keep the window on top so screenshots reflect what is shown.
pub fn configure_window(app: &tauri::App) -> AppResult<()> {
    if mode().is_some() {
        if let Some(window) = app.get_webview_window("main") {
            window.set_always_on_top(true)?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn dev_mode() -> Option<String> {
    mode()
}

#[tauri::command]
pub fn dev_report(app: AppHandle, name: String, report: Value) -> AppResult<String> {
    let name: String = name.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').collect();
    let dir = app.path().app_local_data_dir()?.join("poc-results");
    std::fs::create_dir_all(&dir)?;
    let path = dir.join(format!("{name}.json"));
    let json = serde_json::to_vec_pretty(&report).map_err(|e| AppError::msg(e.to_string()))?;
    std::fs::write(&path, json)?;
    Ok(path.display().to_string())
}

#[tauri::command]
pub fn dev_exit(app: AppHandle) {
    app.exit(0);
}

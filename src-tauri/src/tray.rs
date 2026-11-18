//! The tray icon (D-059): beside the clock, with what's playing in its tooltip, and a menu to show
//! Digitify, play or pause, skip, and quit. Closing the window can keep Digitify running there
//! (Settings › "Keep running in the tray when closed", off by default); started with the computer
//! with that on, it starts hidden there.

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};

use crate::AppState;

/// Whether closing the window keeps Digitify in the tray, from the saved preferences.
pub fn close_to_tray(app: &AppHandle) -> bool {
    app.try_state::<AppState>()
        .and_then(|state| state.config.get().preferences.get("closeToTray").and_then(|v| v.as_bool()))
        .unwrap_or(false)
}

/// Whether closing the window (with the tray off) asks first (D-080), on unless turned off.
pub fn confirm_close(app: &AppHandle) -> bool {
    app.try_state::<AppState>()
        .and_then(|state| state.config.get().preferences.get("confirmClose").and_then(|v| v.as_bool()))
        .unwrap_or(true)
}

/// Quits Digitify, after the page asked (D-080).
#[tauri::command]
pub fn app_quit(app: AppHandle) {
    app.exit(0);
}

pub fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        // Coming back from the tray, the page plays again what it paused (D-076).
        if !window.is_visible().unwrap_or(true) {
            let _ = window.emit("app-shown", ());
        }
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Puts the icon in the tray; Digitify works the same without it (a desktop with no tray).
pub fn start(app: &tauri::App) {
    let built = (|| -> tauri::Result<()> {
        let show = MenuItem::with_id(app, "show", "Show Digitify", true, None::<&str>)?;
        let toggle = MenuItem::with_id(app, "toggle", "Play / Pause", true, None::<&str>)?;
        let next = MenuItem::with_id(app, "next", "Next", true, None::<&str>)?;
        let quit = MenuItem::with_id(app, "quit", "Quit Digitify", true, None::<&str>)?;
        let menu = Menu::with_items(app, &[&show, &PredefinedMenuItem::separator(app)?, &toggle, &next, &PredefinedMenuItem::separator(app)?, &quit])?;
        let mut builder = TrayIconBuilder::with_id("main")
            .tooltip("Digitify")
            .menu(&menu)
            .show_menu_on_left_click(false)
            .on_menu_event(|app, event| match event.id().as_ref() {
                "show" => show_main(app),
                "toggle" => {
                    let _ = app.emit("media-key", "toggle");
                }
                "next" => {
                    let _ = app.emit("media-key", "next");
                }
                "quit" => app.exit(0),
                _ => {}
            })
            .on_tray_icon_event(|tray, event| {
                if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                    show_main(tray.app_handle());
                }
            });
        if let Some(icon) = app.default_window_icon() {
            builder = builder.icon(icon.clone());
        }
        builder.build(app)?;
        Ok(())
    })();
    if let Err(e) = built {
        log::warn!("tray icon unavailable: {e}");
        return;
    }
    // Started with the computer and kept in the tray: start hidden there.
    if std::env::args().any(|a| a == "--autostart") && close_to_tray(app.handle()) {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.hide();
        }
    }
}

/// What plays now, in the icon's tooltip.
pub fn set_tooltip(app: &AppHandle, text: &str) {
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_tooltip(Some(text));
    }
}

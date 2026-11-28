//! Digitify core: the Rust side of the desktop app.

mod ambient;
mod arcade;
mod archives;
mod autostart;
mod artwork;
mod backup;
mod bookmarks;
mod builder;
mod categories;
mod check;
mod chapters;
mod config;
mod db;
mod ebooks;
mod episodes;
mod error;
mod files;
mod films;
mod formats;
mod history;
mod import;
mod library;
mod library_folder;
mod manual;
mod media;
mod localhost;
mod media_protocol;
mod music;
mod online;
mod optical;
mod organize;
mod pages;
mod pdf;
mod pictures;
mod previews;
mod updates;
mod session;
mod player;
mod profile;
mod reshape;
mod series;
mod setup;
mod stats;
mod tools;
mod tray;
mod watch;
mod watched;
mod year;

use std::sync::{Arc, RwLock};

use tauri::{Emitter, Manager};

use crate::error::{AppError, AppResult};

/// An open library: its database and its folder.
pub struct Library {
    pub db: db::Database,
    pub folder: library_folder::LibraryFolder,
}

/// State shared by every command.
pub struct AppState {
    pub config: config::ConfigStore,
    pub imports: import::ImportManager,
    library: RwLock<Option<Arc<Library>>>,
    library_error: RwLock<Option<String>>,
}

impl AppState {
    fn new(config: config::ConfigStore) -> Self {
        Self { config, imports: Default::default(), library: RwLock::new(None), library_error: RwLock::new(None) }
    }

    pub fn library(&self) -> AppResult<Arc<Library>> {
        self.library
            .read()
            .ok()
            .and_then(|library| library.clone())
            .ok_or_else(|| AppError::msg("No library is open yet."))
    }

    pub fn set_library(&self, library: Arc<Library>) {
        if let Ok(mut current) = self.library.write() {
            *current = Some(library);
        }
        if let Ok(mut error) = self.library_error.write() {
            *error = None;
        }
    }

    pub fn library_error(&self) -> Option<String> {
        self.library_error.read().ok().and_then(|error| error.clone())
    }
}

pub fn run() {
    // Linux: the video player embeds mpv in an X11 window, so Digitify runs on X11 (XWayland on
    // Wayland desktops). WebKitGTK's DMA-BUF renderer draws blank windows with NVIDIA's own
    // driver, so it's turned off there (unless asked for); with Intel, AMD and other Mesa drivers
    // it stays on, as it draws much faster.
    #[cfg(target_os = "linux")]
    {
        if std::env::var_os("GDK_BACKEND").is_none() {
            std::env::set_var("GDK_BACKEND", "x11");
        }
        let nvidia = std::path::Path::new("/proc/driver/nvidia/version").exists();
        if nvidia && std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
    }
    let mut builder = tauri::Builder::default();
    // One Digitify at a time (D-077): opening it again brings back the one already running (from
    // the tray too). A copy with its own config folder (DIGITIFY_CONFIG_DIR, for trying things out)
    // runs on its own, unless DIGITIFY_SINGLE_INSTANCE asks for the rule (tests).
    if std::env::var_os("DIGITIFY_CONFIG_DIR").is_none() || std::env::var_os("DIGITIFY_SINGLE_INSTANCE").is_some() {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| tray::show_main(app)));
    }
    let app = builder
        .plugin(tauri_plugin_log::Builder::new().level(log::LevelFilter::Info).build())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let state = AppState::new(config::ConfigStore::load(config::config_dir(app.handle())?));
            // The window opens maximized unless Settings says otherwise (D-046).
            let maximized = state.config.get().preferences.get("startMaximized").and_then(|v| v.as_bool()).unwrap_or(true);
            if maximized {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.maximize();
                }
            }
            if let Some(path) = state.config.get().library_path {
                match setup::open_library(&path) {
                    Ok(library) => state.set_library(library),
                    Err(e) => {
                        log::error!("could not open the library at {}: {e}", path.display());
                        if let Ok(mut error) = state.library_error.write() {
                            *error = Some(e.to_string());
                        }
                    }
                }
            }
            app.manage(state);
            app.manage(player::PlayerState::default());
            app.manage(music::MusicState::default());
            app.manage(online::OnlineState::default());
            app.manage(arcade::ArcadeState::default());
            arcade::watch_stores(app.handle().clone());
            // Games started outside Digitify (D-083).
            arcade::watch_outside(app.handle().clone());
            app.manage(optical::OpticalState::default());
            optical::watch(app.handle().clone());
            app.manage(ambient::AmbientState::default());
            app.manage(media::MediaState::default());
            media::start(app);
            tray::start(app);
            app.manage(pages::PageEngine::default());
            setup::spawn_maintenance(app.handle().clone());
            backup::watch_auto(app.handle().clone());
            watched::watch(app.handle().clone());
            // The lock screen holds the menu music (D-183).
            session::watch(app.handle().clone());
            Ok(())
        })
        // Closing the window can keep Digitify running in the tray (D-059).
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" && tray::close_to_tray(window.app_handle()) && window.app_handle().tray_by_id("main").is_some() {
                    api.prevent_close();
                    let _ = window.hide();
                    // The page pauses what's playing until the window comes back (D-076).
                    let _ = window.emit("app-hidden", ());
                } else if window.label() == "main" && tray::confirm_close(window.app_handle()) {
                    // Closing quits: the page asks first, so a stray click doesn't (D-080).
                    api.prevent_close();
                    let _ = window.emit("close-asked", ());
                }
            }
        })
        .register_asynchronous_uri_scheme_protocol("digitify", media_protocol::handle)
        .invoke_handler(tauri::generate_handler![
            setup::app_status,
            setup::library_choose,
            setup::preferences_set,
            setup::library_reveal,
            setup::path_cloud_sync,
            setup::notices_reveal,
            autostart::autostart_get,
            media::media_now_playing,
            autostart::autostart_set,
            ambient::ambient_playlist,
            ambient::ambient_track_info,
            backup::backup_list,
            backup::backup_create,
            backup::backup_restore,
            backup::backup_reveal,
            backup::backup_auto_status,
            backup::backup_auto_now,
            check::library_check,
            watched::watched_list,
            watched::watched_add,
            watched::watched_set_category,
            watched::watched_remove,
            watched::watched_look_now,
            files::files_relink,
            library::categories_list,
            library::library_query,
            library::library_query_ids,
            library::library_query_shapes,
            library::library_query_aspects,
            library::items_blurbs,
            library::custom_order_set,
            library::items_cards,
            stats::activity_add,
            stats::library_stats,
            year::activity_calendar,
            year::year_review,
            year::week_review,
            year::achievements_list,
            year::profile_extras,
            library::dashboard_get,
            library::item_get,
            library::item_update,
            library::item_set_favorite,
            library::item_set_cover_view,
            library::item_set_review,
            library::resume_get,
            tray::app_quit,
            library::item_set_cover,
            library::items_set_cover,
            library::item_set_backdrop,
            library::item_remove,
            library::file_reveal,
            organize::collections_list,
            organize::collection_tree,
            organize::collection_create,
            organize::collection_rename,
            organize::collection_move,
            organize::collection_delete,
            organize::items_bulk,
            organize::items_bulk_actions,
            online::online_inspect,
            localhost::online_embed_host,
            pictures::picture_set_view,
            pictures::collection_set_cover,
            arcade::arcade_status,
            arcade::arcade_set_emulator,
            arcade::arcade_folder_add,
            arcade::arcade_folder_remove,
            arcade::arcade_scan,
            arcade::arcade_games,
            arcade::arcade_set_favorite,
            arcade::arcade_set_cover_view,
            arcade::arcade_set_cover,
            arcade::arcade_forget,
            arcade::arcade_reveal,
            arcade::play::arcade_launch,
            arcade::arcade_add_program,
            arcade::arcade_programs,
            arcade::arcade_ignore_emulator,
            arcade::covers::arcade_cover_choices,
            arcade::covers::arcade_choose_cover,
            arcade::covers::arcade_steamgriddb_status,
            arcade::covers::arcade_steamgriddb_set,
            arcade::covers::arcade_steamgriddb_open,
            arcade::covers::arcade_launchbox_status,
            arcade::covers::arcade_launchbox_download,
            arcade::covers::arcade_launchbox_remove,
            arcade::arcade_emulator_folders,
            arcade::arcade_set_favorite_many,
            arcade::arcade_forget_many,
            arcade::arcade_find_covers,
            arcade::arcade_set_extra_time,
            arcade::arcade_set_review,
            arcade::arcade_rename,
            arcade::arcade_reorder,
            arcade::arcade_set_game_emulator,
            arcade::arcade_set_completed,
            arcade::arcade_set_keywords,
            arcade::arcade_change_keywords,
            arcade::arcade_steam_hours,
            arcade::arcade_steam_hours_apply,
            profile::profile_get,
            manual::manual_sync,
            manual::manual_add,
            profile::profile_set_text,
            profile::profile_set_view,
            profile::profile_set_frame,
            profile::profile_set_image,
            profile::artwork_import,
            profile::profile_clear_image,
            profile::profile_save_png,
            arcade::collections::arcade_collections,
            arcade::collections::arcade_collection_create,
            arcade::collections::arcade_collection_update,
            arcade::collections::arcade_collection_delete,
            arcade::collections::arcade_collection_add,
            arcade::collections::arcade_collection_remove,
            library::custom_order_slots,
            arcade::arcade_unhide,
            online::online_import,
            online::online_queue,
            online::online_cancel,
            online::online_retry,
            online::online_clear,
            online::online_keys_status,
            online::online_download_items,
            history::history_list,
            history::history_clear,
            history::history_retry,
            films::films_series,
            films::videos_to_films,
            films::episodes_arrange,
            films::episode_remove,
            films::series_add_files,
            films::episode_set_thumb,
            films::episode_thumbs_fill,
            online::ytdlp_status,
            online::ytdlp_update,
            online::online_keys_set,
            online::online_open,
            pages::reader_open,
            pages::progress_save,
            ebooks::ebook_progress_save,
            bookmarks::bookmarks_list,
            bookmarks::bookmark_add,
            bookmarks::bookmark_rename,
            bookmarks::bookmark_remove,
            chapters::chapters_get,
            chapters::chapters_set,
            series::series_get,
            builder::image_previews,
            watch::watch_open,
            watch::watch_progress_save,
            watch::watch_mark,
            watch::read_mark,
            previews::video_preview,
            updates::update_check,
            updates::update_download,
            updates::update_install,
            updates::update_page_open,
            watch::episodes_list,
            player::player_add_subtitle,
            music::music_tracks,
            music::music_artists,
            music::music_set_favorite,
            music::track_update,
            music::music_played,
            music::playlists_list,
            music::playlist_create,
            music::playlist_rename,
            music::playlist_delete,
            music::playlist_add,
            music::track_playlists,
            music::playlist_remove,
            music::playlist_set,
            music::music_play,
            music::music_enqueue,
            music::music_command,
            music::music_stop,
            optical::drives_list,
            optical::drive_eject,
            optical::disc_contents,
            optical::disc_play,
            optical::cd_rip,
            optical::disc_import,
            optical::disc_job_cancel,
            optical::dev_write_sample_discs,
            builder::pages_arrange,
            import::book_from_images,
            categories::categories_arrange,
            import::import_start,
            import::import_cancel,
            player::player_open,
            player::player_command,
            player::player_set_rect,
            player::player_close,
            setup::repository_open,
        ])
        .build(tauri::generate_context!())
        .expect("failed to start Digitify");

    app.run(|handle, event| {
        if let tauri::RunEvent::Exit = event {
            player::shutdown(handle);
            music::shutdown(handle);
        }
    });
}

//! Digitify core: the Rust side of the desktop app.

mod ambient;
mod archives;
mod artwork;
mod backup;
mod bookmarks;
mod builder;
mod categories;
mod chapters;
mod config;
mod db;
mod dev;
mod ebooks;
mod episodes;
mod error;
mod files;
mod formats;
mod import;
mod library;
mod library_folder;
mod media_protocol;
mod music;
mod optical;
mod organize;
mod pages;
mod pdf;
mod player;
mod series;
mod setup;
mod smart;
mod stats;
mod tools;
mod watch;

use std::sync::{Arc, RwLock};

use tauri::Manager;

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
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::new().level(log::LevelFilter::Info).build())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let state = AppState::new(config::ConfigStore::load(config::config_dir(app.handle())?));
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
            app.manage(optical::OpticalState::default());
            optical::watch(app.handle().clone());
            app.manage(ambient::AmbientState::default());
            app.manage(pages::PageEngine::default());
            dev::configure_window(app)?;
            setup::spawn_maintenance(app.handle().clone());
            Ok(())
        })
        .register_asynchronous_uri_scheme_protocol("digitify", media_protocol::handle)
        .invoke_handler(tauri::generate_handler![
            setup::app_status,
            setup::library_choose,
            setup::preferences_set,
            setup::library_reveal,
            setup::path_cloud_sync,
            setup::notices_reveal,
            ambient::ambient_playlist,
            ambient::ambient_track_info,
            backup::backup_list,
            backup::backup_create,
            backup::backup_restore,
            backup::backup_reveal,
            files::files_relink,
            library::categories_list,
            library::library_query,
            library::library_query_ids,
            library::library_query_shapes,
            library::items_blurbs,
            library::custom_order_set,
            library::items_cards,
            organize::shelf_order_set,
            smart::smart_count,
            stats::activity_add,
            stats::library_stats,
            library::dashboard_get,
            library::item_get,
            library::item_update,
            library::item_create,
            library::item_set_favorite,
            library::item_set_cover,
            library::item_set_backdrop,
            library::item_remove,
            library::version_save,
            library::version_delete,
            library::file_reveal,
            organize::tags_list,
            organize::item_tags_set,
            organize::tag_rename,
            organize::tag_delete,
            organize::shelves_list,
            organize::shelf_create,
            organize::shelf_update,
            organize::shelf_delete,
            organize::collections_list,
            organize::collection_tree,
            organize::collection_create,
            organize::collection_rename,
            organize::collection_move,
            organize::collection_delete,
            organize::items_bulk,
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
            optical::disc_catalog,
            optical::dev_write_sample_discs,
            builder::pages_arrange,
            import::book_from_images,
            categories::category_create,
            categories::category_update,
            categories::category_delete,
            categories::categories_arrange,
            import::import_start,
            import::import_cancel,
            import::item_attach_files,
            player::player_open,
            player::player_command,
            player::player_set_rect,
            player::player_close,
            dev::dev_mode,
            dev::dev_report,
            dev::dev_exit,
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

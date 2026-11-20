import { useSyncExternalStore } from "react";

/**
 * Something you asked for is still being done (D-143): any call to the core that takes more than
 * a moment shows "Working…" with what it's doing, so nothing seems stuck. Reads that draw their own
 * placeholders, saves that run by themselves, and actions with their own progress stay quiet.
 */
const QUIET = new Set([
  "app_status", "app_quit", "dashboard_get", "items_cards", "items_blurbs", "image_previews", "items_bulk_actions",
  "item_get", "series_get", "episodes_list", "chapters_get", "bookmarks_list", "resume_get", "year_review", "achievements_list",
  "playlists_list", "tags_list", "categories_list", "collections_list", "collection_tree", "watched_list",
  "backup_list", "backup_auto_status", "autostart_get", "online_keys_status", "ytdlp_status", "films_series", "library_stats",
  "custom_order_slots", "track_playlists", "music_artists", "music_tracks", "online_embed_host", "disc_contents", "drives_list",
  "online_queue", "history_list", "preferences_set", "progress_save", "watch_progress_save", "ebook_progress_save",
  "music_command", "music_played", "music_play", "music_enqueue", "music_stop", "music_set_favorite", "activity_add",
  "activity_calendar", "picture_set_view", "reader_open", "watch_open", "arcade_status", "arcade_games",
  "arcade_launchbox_status", "arcade_steamgriddb_status", "arcade_launch", "online_inspect", "ytdlp_update",
  "arcade_cover_choices", "arcade_launchbox_download", "import_start", "import_cancel", "cd_rip", "disc_import",
  "disc_job_cancel", "media_now_playing",
]);
const QUIET_PREFIXES = ["library_query", "player_", "ambient_", "dev_"];

/** What the indicator says while a call runs. */
function label(command: string): string {
  if (/^arcade_(scan|set_emulator|ignore_emulator|folder_|emulator_folders|add_program)/.test(command)) return "Looking for games and emulators…";
  if (command === "arcade_find_covers") return "Finding covers…";
  if (/cover|backdrop/.test(command)) return "Saving the picture…";
  if (/(remove|delete|forget)/.test(command)) return "Removing…";
  if (command === "backup_restore") return "Restoring…";
  if (command.startsWith("backup_")) return "Backing up…";
  if (command === "library_check") return "Checking the library…";
  if (command === "files_relink") return "Looking for the files…";
  if (command.startsWith("watched_")) return "Looking in the folder…";
  if (/^(online_import|online_download_items|history_retry)$/.test(command)) return "Adding to the queue…";
  if (command === "videos_to_films") return "Moving to Movies & Series…";
  if (command === "book_from_images") return "Making the book…";
  if (command === "library_choose") return "Opening the library…";
  return "Working…";
}

const SHOW_AFTER_MS = 500;
let next = 0;
const shown = new Map<number, string>();
let snapshot: string | null = null;
const listeners = new Set<() => void>();

function emit() {
  const labels = [...shown.values()];
  snapshot = labels.length ? labels[labels.length - 1] : null;
  listeners.forEach((listener) => listener());
}

/** Watches one call to the core; returns the same promise. */
export function trackBusy<T>(command: string, promise: Promise<T>): Promise<T> {
  if (QUIET.has(command) || QUIET_PREFIXES.some((prefix) => command.startsWith(prefix))) return promise;
  const id = ++next;
  const timer = window.setTimeout(() => {
    shown.set(id, label(command));
    emit();
  }, SHOW_AFTER_MS);
  const done = () => {
    window.clearTimeout(timer);
    if (shown.delete(id)) emit();
  };
  promise.then(done, done);
  return promise;
}

/** What's being done right now (after a moment), or null. */
export function useBusy(): string | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    () => snapshot,
  );
}

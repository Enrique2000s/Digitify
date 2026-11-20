import { invoke as callCore } from "@tauri-apps/api/core";
import { trackBusy } from "./busy";

/** Every call to the core, watched so a slow one shows "Working…" (D-143). */
function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return trackBusy(command, callCore<T>(command, args));
}

export type Handler = "book" | "comic" | "video" | "audio" | "generic" | "image";
/** The library filter (D-029): with files in the library, or added from a link and played online. */
export type Ownership = "digital" | "online";
export type SortKey = "title" | "added" | "year" | "creator" | "rating" | "durationAsc" | "durationDesc" | "takenDesc" | "takenAsc" | "relevance" | "custom";
export type ImportMode = "reference" | "copy";

export interface NamedRef {
  id: number;
  name: string;
}

export interface AppStatus {
  version: string;
  libraryPath: string | null;
  libraryOpen: boolean;
  libraryError: string | null;
  cloudSync: string | null;
  suggestedPath: string;
  preferences: unknown;
}

export interface Category {
  id: number;
  key: string;
  name: string;
  icon: string;
  color: string | null;
  handler: Handler;
  sortOrder: number;
  isHidden: boolean;
  isBuiltin: boolean;
  itemCount: number;
  /** Kind-specific settings, such as `readingDirection` for comics. */
  settings: { readingDirection?: "ltr" | "rtl" } & Record<string, unknown>;
}

export interface ItemCard {
  id: number;
  title: string;
  subtitle: string | null;
  year: number | null;
  category: string;
  handler: Handler;
  coverKey: string | null;
  coverColor: string | null;
  isFavorite: boolean;
  formats: string[];
  hasPhysical: boolean;
  hasDigital: boolean;
  missing: boolean;
  progress: number | null;
  /** The item's own cover shape, when it has one (otherwise the default for its kind). */
  coverShape: CoverShape | null;
  /** Imported from a link and not downloaded: it plays online only (D-028). */
  online: boolean;
  /** The service it came from (YouTube, YouTube Music, Spotify, SoundCloud), for its tag. */
  source: string | null;
  /** A film's disc format (`dvd`, `bluray`, `uhd-bluray`, `bluray-3d`), for the case band. */
  discFormat: string | null;
  /** A photo's own proportions (width / height), so it's drawn whole at any height (D-073). */
  aspect?: number | null;
  /** Set when this stands for a collection among a view's items (D-030); its id is then negative. */
  collection?: { id: number; covers: TileCover[]; itemCount: number; childCount: number };
}

/** Where an item imported from a link lives (D-028). */
export interface OnlineSource {
  /** youtube, spotify, soundcloud, web, or another site yt-dlp knows (vimeo, bandcamp…, D-133). */
  provider: string;
  service: string;
  kind: "video" | "track" | "playlist" | "album" | "file";
  externalId: string;
  url: string;
  /** A copy is in the library (available offline); otherwise it needs a connection. */
  downloaded: boolean;
}

/** One thing a pasted link holds. */
export interface OnlineEntry {
  provider: string;
  service: string;
  kind: string;
  externalId: string;
  url: string;
  title: string;
  creator: string | null;
  durationSec: number | null;
  thumbnail: string | null;
  audio: boolean;
  /** It can be downloaded (directly, or through yt-dlp); otherwise it can only be an online item. */
  downloadable: boolean;
  download: string | null;
  /** Downloaded through yt-dlp (D-133): its quality and format can be chosen. */
  ytdlp: boolean;
  /** A live stream: saved as an online item until it's over. */
  live: boolean;
  available: boolean;
  reason: string | null;
  /** The library item it already is. */
  existing: number | null;
}

export interface OnlinePreview {
  provider: string;
  service: string;
  kind: string;
  collection: boolean;
  title: string;
  creator: string | null;
  thumbnail: string | null;
  audio: boolean;
  entries: OnlineEntry[];
  notes: string[];
}

export interface OnlineImportRequest {
  entries: OnlineEntry[];
  musicCategory: string;
  videoCategory: string;
  download: boolean;
  playlistName: string | null;
  /** A collection in Videos for the videos (D-146). */
  collectionName?: string | null;
  quality: DownloadQuality;
}

/** How yt-dlp downloads (D-133): the tallest picture wanted, the video's format, the sound's format. */
export interface DownloadQuality {
  video: "best" | "2160" | "1440" | "1080" | "720" | "480";
  container: "mkv" | "mp4";
  audio: "mp3" | "m4a" | "original";
}

/** A series in Movies & Series that videos can join as episodes (D-135). */
export interface FilmSeries {
  id: number;
  title: string;
  coverKey: string | null;
  episodes: number;
  lastSeason: number;
}

/** One line of the imports history (D-137): an entry from a link, or one import of files. */
export interface HistoryEntry {
  id: number;
  kind: "link" | "files";
  title: string;
  /** Links: the service. Files: the category they went into. */
  detail: string | null;
  action: "download" | "link" | null;
  state: "done" | "skipped" | "failed" | "cancelled";
  error: string | null;
  itemId: number | null;
  counts: { total?: number; imported?: number; duplicates?: number; skipped?: number; failed?: number };
  retry: boolean;
  finishedAt: string;
}

/** The yt-dlp Digitify runs (D-133): shipped with the app, or updated from Settings. */
export interface YtDlpStatus {
  available: boolean;
  version: string | null;
  shippedVersion: string | null;
  updated: boolean;
  deno: boolean;
  ffmpeg: boolean;
}

export interface OnlineJob {
  id: number;
  batch: number;
  title: string;
  creator: string | null;
  service: string;
  audio: boolean;
  action: "download" | "link";
  state: "pending" | "working" | "done" | "skipped" | "failed" | "cancelled";
  progress: number | null;
  error: string | null;
  itemId: number | null;
  /** The online-only item this download takes the place of. */
  replaces: number | null;
}

export interface OnlineKeysStatus {
  youtube: boolean;
  spotify: boolean;
  soundcloud: boolean;
}

/** Music as square covers or round CDs; videos as vertical posters or horizontal frames (Movies & Series: vertical only). */
export type CoverShape = "square" | "disc" | "poster" | "landscape";

/** Seconds spent reading, watching and listening. */
export interface ActivityTime {
  read: number;
  watch: number;
  listen: number;
  /** Arcade's games (D-041). */
  play: number;
}

export interface NamedCount {
  key: string;
  name: string;
  count: number;
}

/** Home's statistics (Phase 5). */
export interface LibraryStats {
  month: ActivityTime;
  year: ActivityTime;
  since: string | null;
  days: (ActivityTime & { day: string })[];
  finishedMonth: number;
  finishedYear: number;
  inProgress: number;
  playsMonth: number;
  topArtists: NamedCount[];
  /** Most played games this year; `count` is minutes (D-041). */
  topGames: NamedCount[];
  /** Days in a row with any activity, and the longest run (D-052). */
  streak: number;
  bestStreak: number;
  categories: NamedCount[];
}

/** What to offer to continue when the app opens (D-068). */
export type Resume = { kind: "item"; card: ItemCard } | { kind: "game"; id: number; title: string };

/** A day of the activity calendar (D-067). */
export interface CalendarDay {
  day: string;
  seconds: number;
}

/** Your year in Digitify (D-065); times in seconds, top lists' `count` in minutes (artists: plays). */
export interface YearReview {
  year: number;
  read: number;
  watch: number;
  listen: number;
  play: number;
  finished: number;
  added: number;
  daysActive: number;
  longestStreak: number;
  bestMonth: [number, number] | null;
  bestDay: [string, number] | null;
  topGames: NamedCount[];
  topItems: NamedCount[];
  topArtists: NamedCount[];
}

/** An achievement (D-066); `new` when this check just reached it. */
export interface Achievement {
  key: string;
  title: string;
  description: string;
  progress: number;
  goal: number;
  unlockedAt: string | null;
  new: boolean;
}

/** The detailed view's extra lines for an item (Phase 5). */
export interface Blurb {
  id: number;
  description: string | null;
  tags: string[];
  facts: string[];
}

export interface QueryParams {
  category?: string | null;
  /** A collection and everything inside it. */
  collection?: number | null;
  tag?: number | null;
  search?: string | null;
  favorites?: boolean;
  ownership?: Ownership | null;
  sort?: SortKey | null;
  /** The view a custom order belongs to, for `sort: "custom"`. */
  custom?: string | null;
  /** Only items of this kind of category (photos for the image viewer, D-033). */
  handler?: Handler | null;
  /** Smart lists' rules (D-051). */
  progress?: "unstarted" | "inProgress" | "finished" | null;
  yearFrom?: number | null;
  yearTo?: number | null;
  addedDays?: number | null;
  minRating?: number | null;
  /** Only what's in Later (D-062). */
  later?: boolean;
  offset: number;
  limit: number;
}

/** A smart list's rules: the fields of a library query it keeps (D-051). */
export type SmartQuery = Pick<QueryParams, "category" | "tag" | "favorites" | "ownership" | "progress" | "yearFrom" | "yearTo" | "addedDays" | "minRating">;

/** How automatic backups went last (D-056). */
export interface AutoBackupStatus {
  last: string | null;
  missingFolder: string | null;
  error: string | null;
}

/** A file in the library check (D-057). */
export interface CheckedFile {
  itemId: number;
  title: string;
  category: string;
  path: string;
  size: number | null;
}

export interface LibraryCheck {
  missing: CheckedFile[];
  duplicates: CheckedFile[][];
}

/** A folder whose new files are imported by themselves (D-060). */
export interface WatchedFolder {
  id: number;
  path: string;
  category: string;
  missing: boolean;
}

export interface SmartList {
  id: number;
  name: string;
  query: SmartQuery;
}

export interface QueryResult {
  total: number;
  offset: number;
  items: ItemCard[];
  elapsedMs: number;
}

export interface TileCover {
  key: string;
  color: string | null;
  handler: Handler;
  /** Its category, own cover shape and a photo's proportions (D-127), for its shape on a tile. */
  category?: string | null;
  coverShape?: CoverShape | null;
  aspect?: number | null;
}

export interface Dashboard {
  featured: ItemCard | null;
  continueItems: ItemCard[];
  /** Films and series in progress. */
  continueWatching: ItemCard[];
  /** The next volume of series lately finished (D-050). */
  nextVolumes: ItemCard[];
  /** What's in Later, newest first (D-062). */
  later: ItemCard[];
  /** "Because you liked …" (D-064). */
  because: { seed: ItemCard; items: ItemCard[] } | null;
  recent: ItemCard[];
  recentlyOpened: ItemCard[];
  favorites: ItemCard[];
  categories: Category[];
  totals: { items: number; physical: number; digital: number; missingFiles: number };
  /** Up to three recent covers per category key, plus `all` and `favorites`. */
  tileCovers: Record<string, TileCover[]>;
}

/** Where ambient music comes from when it isn't the built-in theme. */
export type MusicSource =
  | { kind: "file"; path: string }
  | { kind: "folder"; path: string }
  | { kind: "item"; id: number; title: string };

export interface AmbientPlaylist {
  generation: number;
  tracks: { id: number; title: string; artist: string | null }[];
  unavailable: number;
  truncated: boolean;
}

/** A page-based item opened for reading (comic archives, folders of images, PDFs). */
export interface ReaderBook {
  kind: "pages";
  itemId: number;
  versionId: number;
  title: string;
  direction: "ltr" | "rtl";
  /** Pixel sizes (points for PDFs): the reader lays pages out before they load. */
  pages: { width: number; height: number }[];
  /** Where reading stopped last time. */
  position: number;
  chapters: Chapter[];
}

/** A chapter of a page-based book (D-019): detected, from a PDF outline, or the reader's own. */
export interface Chapter {
  title: string;
  /** The page it starts on, from 0. */
  page: number;
  depth: number;
}

export interface SeriesEntry {
  id: number;
  title: string;
  coverKey: string | null;
  /** "Vol. 3" or "#12". */
  label: string | null;
  progress: number | null;
  completed: boolean;
}

/** The volumes of a series in reading order, and where the asked-for item sits. */
export interface Series {
  name: string;
  entries: SeriesEntry[];
  index: number;
}

/** An ebook opened for reading (EPUB, MOBI, AZW3, FB2), laid out by foliate-js. */
export interface Ebook {
  kind: "ebook";
  itemId: number;
  versionId: number;
  title: string;
  fileName: string;
  /** Where reading stopped last time (an EPUB CFI). */
  position: string | null;
}

export type Opened = ReaderBook | Ebook;

/** What's in a disc drive (Phase 4, D-022). */
export interface DiscMedia {
  kind: "audio" | "dvd" | "bluray" | "data" | "unknown";
  label: string | null;
  /** "CSS", "AACS" or "BD+" when the disc is copy-protected. */
  protection: string | null;
}

export interface DriveInfo {
  letter: string;
  name: string | null;
  media: DiscMedia | null;
  simulated: boolean;
}

export interface DiscTitle {
  number: number;
  seconds: number;
  chapters: number[];
  audio: string[];
  subtitles: string[];
}

export interface DiscTrack {
  number: number;
  title: string | null;
  artist: string | null;
  seconds: number;
  audio: boolean;
}

export type DiscContents =
  | { kind: "audio"; album: string | null; artist: string | null; tracks: DiscTrack[] }
  | { kind: "dvd"; titles: DiscTitle[] }
  | { kind: "bluray"; titles: DiscTitle[] }
  | { kind: "data"; root: string; path: string; entries: { name: string; path: string; dir: boolean; size: number }[] }
  | { kind: "protected"; disc: string; protection: string; message: string }
  | { kind: "empty" };

/** A rip or a disc import running in the background. */
export interface DiscJob {
  id: number;
  letter: string;
  kind: "rip" | "import";
  phase: "reading" | "encoding" | "importing" | "done" | "failed" | "cancelled";
  fraction: number;
  current: string | null;
  warnings: string[];
  error: string | null;
  itemId: number | null;
}

export interface RipRequest {
  tracks: number[];
  album: string;
  artist: string | null;
  year: number | null;
  titles: Record<number, string>;
  format: "flac" | "wav";
}

/** A track in the library: its own item with one part (D-027); `id` is the part's. */
export interface Track {
  id: number;
  itemId: number;
  title: string;
  artist: string | null;
  /** The album it came from, kept as a detail. */
  album: string | null;
  number: number | null;
  durationMs: number | null;
  coverKey: string | null;
  favorite: boolean;
  genre: string | null;
}

export interface TrackFilter {
  search?: string;
  artist?: string;
  favorites?: boolean;
  playlist?: number;
  recent?: boolean;
  ids?: number[];
  /** The tracks of these items, in this order. */
  items?: number[];
}

/** A queued track and the file the music player plays for it. */
export interface QueueEntry {
  path: string;
  track: Track;
}

export interface Artist {
  name: string;
  tracks: number;
}

export interface Playlist {
  id: number;
  name: string;
  tracks: number;
  durationMs: number;
  updatedAt: string;
}

/** What the video player opened: a film, or an episode of a series (D-018). */
export interface WatchTarget {
  itemId: number;
  partId: number | null;
  title: string;
  /** "S1 · E3 · The Fog", for episodes. */
  episode: string | null;
  /** Seconds to start at: where it stopped last time, or 0. */
  start: number;
  previous: number | null;
  next: number | null;
  nextLabel: string | null;
}

export interface Episode {
  id: number;
  season: number | null;
  number: number | null;
  title: string | null;
  durationMs: number | null;
  progress: number;
  completed: boolean;
  seconds: number | null;
}

/** A page of a page-based book, or a place in an ebook. */
export type BookmarkLocator = { page: number } | { cfi: string; fraction: number; location?: number | null } | { time: number; part?: number | null };

export interface Bookmark {
  id: number;
  locator: BookmarkLocator;
  label: string | null;
  createdAt: string;
}

export interface TrackDetails {
  title: string | null;
  artist: string | null;
  album: string | null;
}

export interface Person {
  id: number;
  name: string;
  role: string;
}

export interface FileInfo {
  id: number;
  path: string;
  storage: "referenced" | "managed";
  size: number | null;
  status: "ok" | "missing" | "unreadable";
  mime: string | null;
  partId: number | null;
}

export interface VersionInfo {
  id: number;
  kind: "physical" | "digital";
  label: string | null;
  format: string | null;
  edition: string | null;
  condition: string | null;
  location: string | null;
  acquiredAt: string | null;
  notes: string | null;
  files: FileInfo[];
}

export interface PartInfo {
  id: number;
  kind: string;
  number: number | null;
  title: string | null;
  durationMs: number | null;
}

export interface ItemDetail {
  id: number;
  category: string;
  categoryName: string;
  handler: Handler;
  title: string;
  subtitle: string | null;
  year: number | null;
  description: string | null;
  coverKey: string | null;
  coverColor: string | null;
  isFavorite: boolean;
  metadata: Record<string, unknown> | null;
  addedAt: string;
  updatedAt: string;
  people: Person[];
  versions: VersionInfo[];
  parts: PartInfo[];
  tags: NamedRef[];
  /** From the category root down; empty when the item isn't in a collection. */
  collectionPath: NamedRef[];
  progress: number | null;
  /** Where it was imported from, if from a link (D-028). */
  online: OnlineSource | null;
  /** The user's rating (1-5) and note (D-049). */
  rating: number | null;
  note: string | null;
  /** In Later (D-062). */
  inLater: boolean;
}

export interface Tag {
  id: number;
  name: string;
  itemCount: number;
}

export interface Collection {
  id: number;
  parentId: number | null;
  name: string;
  /** Items in it and in every collection inside it. */
  itemCount: number;
  childCount: number;
  covers: TileCover[];
}

export interface CollectionLevel {
  path: NamedRef[];
  children: Collection[];
}

export interface CollectionNode {
  id: number;
  parentId: number | null;
  name: string;
  depth: number;
}

export type BulkOp =
  | { op: "favorite"; favorite: boolean }
  | { op: "addTags"; names: string[] }
  | { op: "removeTags"; names: string[] }
  | { op: "move"; category: string; collection: number | null }
  | { op: "setYear"; year: number | null }
  | { op: "setSeries"; series: string | null }
  | { op: "setDirection"; direction: "ltr" | "rtl" }
  | { op: "setCoverShape"; shape: CoverShape | null }
  | { op: "setCoverColor"; color: string | null }
  | { op: "addToPlaylist"; playlist: number };

/** What a selection allows beyond the actions every item takes (D-027): each only when every selected item supports it. */
export interface BulkActions {
  playlist: boolean;
  /** How many are online items that can be downloaded (D-133). */
  download: number;
  coverShapes: CoverShape[];
  series: boolean;
  direction: boolean;
}

export interface PersonInput {
  name: string;
  role: string;
}

export interface ItemEdit {
  title: string;
  subtitle: string | null;
  year: number | null;
  description: string | null;
  category: string;
  people: PersonInput[];
  metadata: Record<string, unknown>;
}

export interface VersionInput {
  id?: number | null;
  itemId?: number;
  kind: "physical" | "digital";
  label?: string | null;
  format?: string | null;
  edition?: string | null;
  condition?: string | null;
  location?: string | null;
  acquiredAt?: string | null;
  notes?: string | null;
}

export interface RemoveReport {
  removed: number;
  trashed: number;
  errors: string[];
}

export interface ImportProgress {
  jobId: number;
  phase: "scanning" | "importing" | "done" | "cancelled" | "failed";
  total: number;
  processed: number;
  imported: number;
  duplicates: number;
  /** Files the picked category can't hold, left out (D-125). */
  skipped: number;
  failed: number;
  current: string | null;
  errors: string[];
}

export interface BackupInfo {
  name: string;
  /** Local time, `YYYY-MM-DDTHH:MM:SS`. */
  created: string;
  kind: "manual" | "before-upgrade" | "before-restore" | string;
  size: number;
}

export interface RelinkReport {
  missing: number;
  found: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const api = {
  appStatus: () => invoke<AppStatus>("app_status"),
  libraryChoose: (path: string) => invoke<AppStatus>("library_choose", { path }),
  preferencesSet: (preferences: unknown) => invoke<void>("preferences_set", { preferences }),
  /** Starting Digitify when the user signs in (D-047). */
  autostartGet: () => invoke<boolean>("autostart_get"),
  autostartSet: (on: boolean) => invoke<boolean>("autostart_set", { on }),
  libraryReveal: () => invoke<void>("library_reveal"),
  pathCloudSync: (path: string) => invoke<string | null>("path_cloud_sync", { path }),
  noticesReveal: () => invoke<void>("notices_reveal"),
  backupList: () => invoke<BackupInfo[]>("backup_list"),
  backupCreate: () => invoke<BackupInfo>("backup_create"),
  backupRestore: (name: string) => invoke<void>("backup_restore", { name }),
  backupReveal: (name: string | null) => invoke<void>("backup_reveal", { name }),
  filesRelink: (folder: string) => invoke<RelinkReport>("files_relink", { folder }),
  ambientPlaylist: (sources: MusicSource[]) => invoke<AmbientPlaylist>("ambient_playlist", { sources }),
  ambientTrackInfo: (generation: number, id: number) => invoke<TrackDetails>("ambient_track_info", { generation, id }),

  categories: () => invoke<Category[]>("categories_list"),
  query: (params: QueryParams) => invoke<QueryResult>("library_query", { params }),
  queryIds: (params: Omit<QueryParams, "offset" | "limit">) => invoke<number[]>("library_query_ids", { params: { ...params, offset: 0, limit: 0 } }),
  blurbs: (ids: number[]) => invoke<Blurb[]>("items_blurbs", { ids }),
  queryShapes: (params: Omit<QueryParams, "offset" | "limit">) => invoke<string>("library_query_shapes", { params: { ...params, offset: 0, limit: 0 } }),
  queryAspects: (params: Omit<QueryParams, "offset" | "limit">) => invoke<number[]>("library_query_aspects", { params: { ...params, offset: 0, limit: 0 } }),
  cards: (ids: number[]) => invoke<ItemCard[]>("items_cards", { ids }),
  /** A view's custom order; negative ids are collections placed among the items (D-036). */
  customOrderSet: (view: string, ids: number[]) => invoke<void>("custom_order_set", { view, ids }),
  /** Where collections (negative card ids) stand among a view's items in its custom order: [id, index]. */
  customOrderSlots: (params: Omit<QueryParams, "offset" | "limit">, collections: number[]) =>
    invoke<[number, number][]>("custom_order_slots", { params: { ...params, offset: 0, limit: 0 }, collections }),
  activityAdd: (item: number, kind: "read" | "watch" | "listen", seconds: number) => invoke<void>("activity_add", { item, kind, seconds }),
  stats: () => invoke<LibraryStats>("library_stats"),
  activityCalendar: (year: number) => invoke<CalendarDay[]>("activity_calendar", { year }),
  yearReview: (year: number) => invoke<YearReview>("year_review", { year }),
  achievementsList: () => invoke<Achievement[]>("achievements_list"),
  resumeGet: () => invoke<Resume | null>("resume_get"),
  appQuit: () => invoke<void>("app_quit"),
  tags: () => invoke<Tag[]>("tags_list"),
  itemTagsSet: (id: number, names: string[]) => invoke<void>("item_tags_set", { id, names }),
  tagRename: (id: number, name: string) => invoke<void>("tag_rename", { id, name }),
  tagDelete: (id: number) => invoke<void>("tag_delete", { id }),
  collections: (category: string, parent: number | null) => invoke<CollectionLevel>("collections_list", { category, parent }),
  collectionTree: (category: string) => invoke<CollectionNode[]>("collection_tree", { category }),
  collectionCreate: (category: string, parent: number | null, name: string) => invoke<number>("collection_create", { category, parent, name }),
  collectionRename: (id: number, name: string) => invoke<void>("collection_rename", { id, name }),
  collectionMove: (id: number, parent: number | null) => invoke<void>("collection_move", { id, parent }),
  collectionDelete: (id: number) => invoke<void>("collection_delete", { id }),
  itemsBulk: (ids: number[], ops: BulkOp[]) => invoke<number>("items_bulk", { ids, ops }),
  itemsBulkActions: (ids: number[]) => invoke<BulkActions>("items_bulk_actions", { ids }),
  onlineInspect: (url: string) => invoke<OnlinePreview>("online_inspect", { url }),
  onlineImport: (request: OnlineImportRequest) => invoke<number>("online_import", { request }),
  onlineQueue: () => invoke<OnlineJob[]>("online_queue"),
  onlineCancel: (id: number | null) => invoke<void>("online_cancel", { id }),
  onlineRetry: (id: number) => invoke<void>("online_retry", { id }),
  onlineClear: () => invoke<void>("online_clear"),
  onlineKeysStatus: () => invoke<OnlineKeysStatus>("online_keys_status"),
  onlineKeysSet: (service: "youtube" | "spotify" | "soundcloud", first: string | null, second: string | null) =>
    invoke<OnlineKeysStatus>("online_keys_set", { service, first, second }),
  onlineOpen: (id: number) => invoke<void>("online_open", { id }),
  onlineDownloadItems: (ids: number[], quality: DownloadQuality, audio: boolean | null) => invoke<number>("online_download_items", { ids, quality, audio }),
  ytdlpStatus: () => invoke<YtDlpStatus>("ytdlp_status"),
  historyList: () => invoke<HistoryEntry[]>("history_list"),
  historyClear: () => invoke<void>("history_clear"),
  historyRetry: (id: number) => invoke<void>("history_retry", { id }),
  filmsSeries: () => invoke<FilmSeries[]>("films_series"),
  videosToFilms: (ids: number[], series: { existing: number | null; name: string | null; season: number } | null) => invoke<number[]>("videos_to_films", { request: { ids, series } }),
  ytdlpUpdate: () => invoke<YtDlpStatus>("ytdlp_update"),
  arcadeStatus: () => invoke<ArcadeStatus>("arcade_status"),
  arcadeSetEmulator: (emulator: ArcadeEmulator, path: string | null) => invoke<void>("arcade_set_emulator", { emulator, path }),
  arcadeFolderAdd: (path: string) => invoke<void>("arcade_folder_add", { path }),
  arcadeFolderRemove: (id: number) => invoke<void>("arcade_folder_remove", { id }),
  arcadeScan: (downloadCovers: boolean) => invoke<ArcadeScanReport>("arcade_scan", { downloadCovers }),
  arcadeGames: () => invoke<ArcadeGame[]>("arcade_games"),
  arcadeSetFavorite: (id: number, favorite: boolean) => invoke<void>("arcade_set_favorite", { id, favorite }),
  arcadeSetCover: (id: number, path: string) => invoke<void>("arcade_set_cover", { id, path }),
  arcadeSetExtraTime: (id: number, seconds: number) => invoke<void>("arcade_set_extra_time", { id, seconds }),
  arcadeSetReview: (id: number, rating: number | null, note: string | null) => invoke<void>("arcade_set_review", { id, rating, note }),
  itemSetReview: (id: number, rating: number | null, note: string | null) => invoke<void>("item_set_review", { id, rating, note }),
  laterSet: (ids: number[], later: boolean) => invoke<void>("later_set", { ids, later }),
  smartLists: () => invoke<SmartList[]>("smart_lists"),
  backupAutoStatus: () => invoke<AutoBackupStatus>("backup_auto_status"),
  backupAutoNow: () => invoke<AutoBackupStatus>("backup_auto_now"),
  libraryCheck: () => invoke<LibraryCheck>("library_check"),
  watchedList: () => invoke<WatchedFolder[]>("watched_list"),
  watchedAdd: (path: string, category: string) => invoke<void>("watched_add", { path, category }),
  watchedSetCategory: (id: number, category: string) => invoke<void>("watched_set_category", { id, category }),
  watchedRemove: (id: number) => invoke<void>("watched_remove", { id }),
  watchedLookNow: () => invoke<number>("watched_look_now"),
  smartListSave: (id: number | null, name: string, query: SmartQuery) => invoke<number>("smart_list_save", { id, name, query }),
  smartListDelete: (id: number) => invoke<void>("smart_list_delete", { id }),
  arcadeForget: (id: number) => invoke<void>("arcade_forget", { id }),
  arcadeReveal: (id: number) => invoke<void>("arcade_reveal", { id }),
  /** Starts the game in its emulator; `n64` picks Project64 or RMG for Nintendo 64 games. */
  /** `mode`: what Digitify does while the game runs (D-041). */
  /** `choices`: the emulator chosen for each console (D-111), by the console's key. */
  arcadeLaunch: (id: number, mode: "stay" | "hide" | "quit", choices: Partial<Record<ArcadeConsole, ArcadeEmulator>> = {}) =>
    invoke<void>("arcade_launch", { id, n64: null, ds: null, mode, choices }),
  /** SteamGridDB's box art (D-128): whether a key is set, setting or removing it, its key page. */
  arcadeSteamGridDbStatus: () => invoke<boolean>("arcade_steamgriddb_status"),
  arcadeSteamGridDbSet: (key: string | null) => invoke<void>("arcade_steamgriddb_set", { key }),
  arcadeSteamGridDbOpen: () => invoke<void>("arcade_steamgriddb_open"),
  /** LaunchBox's database for covers (D-131): what's here, downloading it (about 110 MB), removing it. */
  arcadeLaunchBoxStatus: () => invoke<{ updated: string; games: number } | null>("arcade_launchbox_status"),
  arcadeLaunchBoxDownload: () => invoke<{ updated: string; games: number }>("arcade_launchbox_download"),
  arcadeLaunchBoxRemove: () => invoke<void>("arcade_launchbox_remove"),
  /** Sets an emulator aside, or uses it again (D-117). */
  arcadeIgnoreEmulator: (emulator: ArcadeEmulator, ignored: boolean) => invoke<void>("arcade_ignore_emulator", { emulator, ignored }),
  /** Every cover found for a game, to choose from (D-118). */
  arcadeCoverChoices: (id: number, search?: string) => invoke<ArcadeCoverChoice[]>("arcade_cover_choices", { id, search: search ?? null }),
  arcadeChooseCover: (id: number, index: number) => invoke<void>("arcade_choose_cover", { id, index }),
  /** Adds a PC game by its program (D-107); returns its id. */
  arcadeAddProgram: (path: string, downloadCovers: boolean) => invoke<number>("arcade_add_program", { path, downloadCovers }),
  /** An emulator's game folders set in Arcade (D-035); null goes back to its own. */
  arcadeEmulatorFolders: (emulator: ArcadeEmulator, folders: { path: string; recursive: boolean }[] | null) => invoke<void>("arcade_emulator_folders", { emulator, folders }),
  arcadeSetFavoriteMany: (ids: number[], favorite: boolean) => invoke<void>("arcade_set_favorite_many", { ids, favorite }),
  arcadeForgetMany: (ids: number[]) => invoke<number>("arcade_forget_many", { ids }),
  /** `reset`: pictures the user chose give way too (Default cover, D-039). */
  arcadeFindCovers: (ids: number[], download: boolean, reset = false) => invoke<number>("arcade_find_covers", { ids, download, reset }),
  arcadeRename: (id: number, title: string) => invoke<void>("arcade_rename", { id, title }),
  arcadeReorder: (ids: number[]) => invoke<void>("arcade_reorder", { ids }),
  /** Brings back the store games taken off the list. */
  arcadeUnhide: () => invoke<number>("arcade_unhide"),
  /** Turns or mirrors a photo in Digitify only, never in its file (D-033). */
  pictureSetView: (id: number, view: PictureView) => invoke<void>("picture_set_view", { id, view }),
  /** An item's cover as its collection's (an album's) cover; null goes back to the collage. */
  collectionSetCover: (id: number, item: number | null) => invoke<void>("collection_set_cover", { id, item }),
  /** Linux: the local page that hosts YouTube's player (D-032); null on Windows. */
  onlineEmbedHost: () => invoke<string | null>("online_embed_host"),
  readerOpen: (id: number) => invoke<Opened>("reader_open", { id }),
  ebookProgressSave: (id: number, cfi: string, fraction: number, finished: boolean) =>
    invoke<void>("ebook_progress_save", { id, cfi, fraction, finished }),
  imagePreviews: (paths: string[]) => invoke<(string | null)[]>("image_previews", { paths }),
  bookFromImages: (book: { title: string; category: string; paths: string[]; mode: ImportMode }) => invoke<number>("book_from_images", { book }),
  pagesArrange: (version: number, files: number[], trashRemoved: boolean) => invoke<void>("pages_arrange", { version, files, trashRemoved }),
  chaptersGet: (id: number) => invoke<Chapter[]>("chapters_get", { id }),
  chaptersSet: (id: number, chapters: Chapter[]) => invoke<void>("chapters_set", { id, chapters }),
  seriesGet: (id: number) => invoke<Series | null>("series_get", { id }),
  bookmarksList: (id: number) => invoke<Bookmark[]>("bookmarks_list", { id }),
  bookmarkAdd: (id: number, locator: BookmarkLocator, label: string | null) => invoke<Bookmark>("bookmark_add", { id, locator, label }),
  bookmarkRename: (id: number, label: string | null) => invoke<void>("bookmark_rename", { id, label }),
  bookmarkRemove: (id: number) => invoke<void>("bookmark_remove", { id }),
  progressSave: (id: number, page: number, pages: number) => invoke<void>("progress_save", { id, page, pages }),
  categoriesArrange: (order: string[], hidden: string[]) => invoke<void>("categories_arrange", { order, hidden }),
  dashboard: () => invoke<Dashboard>("dashboard_get"),
  item: (id: number) => invoke<ItemDetail>("item_get", { id }),
  itemUpdate: (id: number, edit: ItemEdit) => invoke<void>("item_update", { id, edit }),
  itemCreate: (item: ItemEdit, physical: VersionInput | null) =>
    invoke<number>("item_create", { item: { item, physical } }),
  itemSetFavorite: (id: number, favorite: boolean) => invoke<void>("item_set_favorite", { id, favorite }),
  itemSetCover: (id: number, path: string) => invoke<void>("item_set_cover", { id, path }),
  itemsSetCover: (ids: number[], path: string) => invoke<void>("items_set_cover", { ids, path }),
  itemRemove: (ids: number[], trashManagedCopies: boolean) =>
    invoke<RemoveReport>("item_remove", { ids, trashManagedCopies }),
  versionSave: (version: VersionInput) => invoke<number>("version_save", { version }),
  versionDelete: (id: number) => invoke<void>("version_delete", { id }),
  fileReveal: (id: number) => invoke<void>("file_reveal", { id }),

  importStart: (paths: string[], mode: ImportMode, category: string | null) =>
    invoke<number>("import_start", { request: { paths, mode, category } }),
  importCancel: (jobId: number) => invoke<void>("import_cancel", { jobId }),

  playerOpen: (path: string) => invoke<void>("player_open", { path }),
  playerCommand: (args: unknown[]) => invoke<void>("player_command", { args }),
  playerSetRect: (rect: Rect) => invoke<void>("player_set_rect", { ...rect }),
  playerClose: () => invoke<void>("player_close"),
  playerAddSubtitle: (path: string) => invoke<void>("player_add_subtitle", { path }),
  itemSetBackdrop: (id: number, path: string | null) => invoke<void>("item_set_backdrop", { id, path }),
  drivesList: () => invoke<DriveInfo[]>("drives_list"),
  driveEject: (letter: string) => invoke<void>("drive_eject", { letter }),
  discContents: (letter: string, path: string | null) => invoke<DiscContents>("disc_contents", { letter, path }),
  discPlay: (letter: string, title: number, volume: number) => invoke<{ title: string; episode: string }>("disc_play", { letter, title, volume }),
  cdRip: (letter: string, request: RipRequest) => invoke<number>("cd_rip", { letter, request }),
  discImport: (letter: string, title: number) => invoke<number>("disc_import", { letter, title }),
  discJobCancel: (id: number) => invoke<void>("disc_job_cancel", { id }),
  musicTracks: (filter: TrackFilter) => invoke<Track[]>("music_tracks", { filter }),
  musicArtists: () => invoke<Artist[]>("music_artists"),
  musicSetFavorite: (id: number, favorite: boolean) => invoke<void>("music_set_favorite", { id, favorite }),
  trackUpdate: (id: number, edit: { title: string; artist: string | null; number: number | null }) => invoke<void>("track_update", { id, edit }),
  musicPlayed: (id: number) => invoke<void>("music_played", { id }),
  playlistsList: () => invoke<Playlist[]>("playlists_list"),
  playlistCreate: (name: string, tracks: number[]) => invoke<number>("playlist_create", { name, tracks }),
  playlistRename: (id: number, name: string) => invoke<void>("playlist_rename", { id, name }),
  playlistDelete: (id: number) => invoke<void>("playlist_delete", { id }),
  playlistAdd: (id: number, tracks: number[]) => invoke<void>("playlist_add", { id, tracks }),
  trackPlaylists: (id: number) => invoke<number[]>("track_playlists", { id }),
  playlistRemove: (id: number, track: number) => invoke<void>("playlist_remove", { id, track }),
  playlistSet: (id: number, tracks: number[]) => invoke<void>("playlist_set", { id, tracks }),
  musicPlay: (tracks: number[], start: number, volume: number) => invoke<QueueEntry[]>("music_play", { tracks, start, volume }),
  musicEnqueue: (tracks: number[], next: boolean, volume: number) => invoke<QueueEntry[]>("music_enqueue", { tracks, next, volume }),
  musicCommand: (args: unknown[]) => invoke<void>("music_command", { args }),
  musicStop: () => invoke<void>("music_stop"),
  watchOpen: (id: number, part: number | null, volume: number) => invoke<WatchTarget>("watch_open", { id, part, volume }),
  watchProgressSave: (id: number, part: number | null, seconds: number, duration: number) =>
    invoke<void>("watch_progress_save", { id, part, seconds, duration }),
  watchMark: (id: number, part: number | null, watched: boolean) => invoke<void>("watch_mark", { id, part, watched }),
  episodesList: (id: number) => invoke<Episode[]>("episodes_list", { id }),

  devMode: () => invoke<string | null>("dev_mode"),
  devReport: (name: string, report: unknown) => invoke<string>("dev_report", { name, report }),
  devExit: () => invoke<void>("dev_exit"),
};

/** Running on Linux (WebKitGTK), where some things differ from Windows (D-031). */
export const onLinux = typeof navigator !== "undefined" && /Linux/.test(navigator.userAgent) && !/Android/.test(navigator.userAgent);

/** The core's private `digitify` scheme: `http://digitify.localhost` on Windows, `digitify://localhost` elsewhere. */
const MEDIA = onLinux ? "digitify://localhost" : "http://digitify.localhost";

/** How a disc drive is named: "E:" on Windows, "sr0" on Linux (its device, `/dev/sr0`). */
export function driveName(letter: string): string {
  return /^\d$/.test(letter) ? `sr${letter}` : `${letter}:`;
}

/** Arcade's consoles (D-034, D-101), in their default order: the emulators' own, then the ones
 *  RetroArch plays; "other" gathers RetroArch's consoles without a view of their own. */
export const ARCADE_CONSOLES = [
  "wii", "wiiu", "gamecube", "n64", "switch", "ps1", "ps2", "ps3", "psp", "ds", "3ds",
  "nes", "snes", "gb", "gbc", "gba", "sms", "genesis", "segacd", "gamegear", "saturn", "dreamcast", "ogxbox", "x360", "pce", "arcade", "atari2600", "other",
] as const;
export type ArcadeConsole = (typeof ARCADE_CONSOLES)[number];
/** Arcade (D-034): a console a game is for, or "pc". */
export type ArcadePlatform = ArcadeConsole | "pc";
/** The store a PC game came from (D-037). */
export type ArcadeStore = "steam" | "epic" | "xbox" | "gog" | "ubisoft" | "ea" | "battlenet" | "rockstar" | "riot" | "amazon" | "itch" | "heroic" | "lutris";
export type ArcadeEmulator =
  | "dolphin"
  | "project64"
  | "rmg"
  | "duckstation"
  | "pcsx2"
  | "rpcs3"
  | "melonds"
  | "desmume"
  | "mesen"
  | "fceux"
  | "nestopia"
  | "snes9x"
  | "zsnes"
  | "mgba"
  | "fusion"
  | "nulldc"
  | "ares"
  | "ppsspp"
  | "flycast"
  | "cemu"
  | "azahar"
  | "xemu"
  | "xenia"
  | "ryujinx"
  | "retroarch";

export interface ArcadeFolder {
  /** For folders added in Digitify; null for an emulator's own. */
  id: number | null;
  path: string;
  recursive: boolean;
  exists: boolean;
}

export interface ArcadeEmulatorStatus {
  key: ArcadeEmulator;
  name: string;
  platforms: ArcadePlatform[];
  /** False where it doesn't exist (Project64 on Linux). */
  available: boolean;
  /** Where it was found (a path, or "Flatpak <id>"). */
  found: string | null;
  /** Pointed at by hand. */
  picked: boolean;
  /** Its game folders are set in Arcade instead of read from its settings (D-035). */
  customFolders: boolean;
  folders: ArcadeFolder[];
  /** Set aside by the user: not looked for nor used (D-117). */
  ignored: boolean;
  /** Its own icon from its program on this computer, as a data URL (D-123). */
  icon: string | null;
}

/** A cover found for a game, to choose from (D-118). */
export interface ArcadeCoverChoice {
  index: number;
  source: string;
  /** A small JPEG of it, as a data URL. */
  preview: string;
  width: number;
  height: number;
}

export interface ArcadeStatus {
  emulators: ArcadeEmulatorStatus[];
  folders: ArcadeFolder[];
  running: number | null;
  games: number;
  /** PC stores read for installed games (D-037). */
  stores: { key: ArcadeStore; name: string; found: string | null; games: number }[];
  /** Store games taken off the list (still installed). */
  hidden: number;
  /** Each console and the emulators that play it, in Arcade's order (D-111). */
  consoles: { key: ArcadeConsole; players: ArcadeEmulator[] }[];
}

export interface ArcadeGame {
  id: number;
  title: string;
  platform: ArcadePlatform;
  gameId: string | null;
  path: string;
  size: number | null;
  coverKey: string | null;
  coverColor: string | null;
  isFavorite: boolean;
  /** Time played in all, including `extraSeconds` (D-043). */
  playSeconds: number;
  /** Time played outside Digitify, added by hand. */
  extraSeconds: number;
  /** The user's rating (1-5) and note (D-049). */
  rating: number | null;
  note: string | null;
  playCount: number;
  lastPlayedAt: string | null;
  addedAt: string;
  missing: boolean;
  /** Place in the custom order (D-035). */
  position: number | null;
  /** For PC games, the store it came from (D-037); none for a program added by hand (D-107). */
  store: ArcadeStore | null;
  /** From RetroArch's playlists: RetroArch starts it with its core (D-101). */
  retroarch: boolean;
}

export interface ArcadeScanReport {
  found: number;
  added: number;
  missing: number;
  coversQueued: number;
}

/** A photo's own file (D-033), served by the core's private `digitify` scheme. */
export function pictureUrl(itemId: number): string {
  return `${MEDIA}/picture/${itemId}`;
}

/** A turn or mirror picked in the image viewer (D-033). */
export interface PictureView {
  rotate: 0 | 90 | 180 | 270;
  flipH: boolean;
  flipV: boolean;
}

/** Artwork served by the core's private `digitify` scheme. */
export function artworkUrl(key: string, size: "thumb" | "cover" = "thumb"): string {
  return `${MEDIA}/${size}/${key}`;
}

/** A page of an open book, at least `width` device pixels wide (the core rounds widths up). */
/** An audio CD track straight from the disc, as WAV. */
export function cdTrackUrl(letter: string, track: number): string {
  return `${MEDIA}/cd/${letter}/${track}`;
}

/** The ebook file of a digital copy, for the ebook reader. */
export function bookUrl(versionId: number): string {
  return `${MEDIA}/book/${versionId}`;
}

export function pageUrl(versionId: number, index: number, width: number): string {
  return `${MEDIA}/page/${versionId}/${index}?w=${Math.round(width)}`;
}

/** A track of the current ambient playlist (only files the user chose are served). */
export function ambientUrl(generation: number, id: number): string {
  return `${MEDIA}/ambient/${generation}/${id}`;
}

/** Tauri rejects with plain strings from Rust errors; normalize for display. */
export function errorText(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}

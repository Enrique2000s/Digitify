import { invoke } from "@tauri-apps/api/core";

export type Handler = "book" | "comic" | "video" | "audio" | "generic";
export type Ownership = "physical" | "digital" | "physicalOnly" | "digitalOnly";
export type SortKey = "title" | "added" | "year" | "creator" | "relevance" | "shelf";
export type ImportMode = "reference" | "copy";
export type FieldKind = "text" | "longtext" | "number" | "date" | "rating" | "boolean" | "choice" | "url";

export interface NamedRef {
  id: number;
  name: string;
}

/** A custom field; item values live in `metadata.custom[key]`. */
export interface FieldDef {
  key: string;
  label: string;
  kind: FieldKind;
  choices: string[];
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
  fields: FieldDef[];
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
}

export interface QueryParams {
  category?: string | null;
  /** A collection and everything inside it. */
  collection?: number | null;
  shelf?: number | null;
  tag?: number | null;
  search?: string | null;
  favorites?: boolean;
  ownership?: Ownership | null;
  sort?: SortKey | null;
  offset: number;
  limit: number;
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
}

export interface Dashboard {
  featured: ItemCard | null;
  continueItems: ItemCard[];
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
  itemId: number;
  versionId: number;
  title: string;
  direction: "ltr" | "rtl";
  /** Pixel sizes (points for PDFs): the reader lays pages out before they load. */
  pages: { width: number; height: number }[];
  /** Where reading stopped last time. */
  position: number;
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
  shelves: NamedRef[];
  progress: number | null;
}

export interface Tag {
  id: number;
  name: string;
  itemCount: number;
}

export interface Shelf {
  id: number;
  name: string;
  description: string | null;
  itemCount: number;
  covers: TileCover[];
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
  | { op: "addToShelf"; shelf: number }
  | { op: "removeFromShelf"; shelf: number }
  | { op: "move"; category: string; collection: number | null }
  | { op: "setYear"; year: number | null }
  | { op: "setSeries"; series: string | null }
  | { op: "setDirection"; direction: "ltr" | "rtl" };

export interface FieldInput {
  key?: string | null;
  label: string;
  kind: FieldKind;
  choices: string[];
}

export interface CategoryInput {
  name: string;
  icon: string;
  /** Only when creating: a category's kind of media never changes. */
  handler?: Handler | null;
  readingDirection?: "ltr" | "rtl" | null;
  fields: FieldInput[];
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
  tags: () => invoke<Tag[]>("tags_list"),
  itemTagsSet: (id: number, names: string[]) => invoke<void>("item_tags_set", { id, names }),
  tagRename: (id: number, name: string) => invoke<void>("tag_rename", { id, name }),
  tagDelete: (id: number) => invoke<void>("tag_delete", { id }),
  shelves: () => invoke<Shelf[]>("shelves_list"),
  shelfCreate: (shelf: { name: string; description: string | null }) => invoke<number>("shelf_create", { shelf }),
  shelfUpdate: (id: number, shelf: { name: string; description: string | null }) => invoke<void>("shelf_update", { id, shelf }),
  shelfDelete: (id: number) => invoke<void>("shelf_delete", { id }),
  collections: (category: string, parent: number | null) => invoke<CollectionLevel>("collections_list", { category, parent }),
  collectionTree: (category: string) => invoke<CollectionNode[]>("collection_tree", { category }),
  collectionCreate: (category: string, parent: number | null, name: string) => invoke<number>("collection_create", { category, parent, name }),
  collectionRename: (id: number, name: string) => invoke<void>("collection_rename", { id, name }),
  collectionMove: (id: number, parent: number | null) => invoke<void>("collection_move", { id, parent }),
  collectionDelete: (id: number) => invoke<void>("collection_delete", { id }),
  itemsBulk: (ids: number[], ops: BulkOp[]) => invoke<number>("items_bulk", { ids, ops }),
  readerOpen: (id: number) => invoke<ReaderBook>("reader_open", { id }),
  progressSave: (id: number, page: number, pages: number) => invoke<void>("progress_save", { id, page, pages }),
  categoryCreate: (category: CategoryInput) => invoke<string>("category_create", { category }),
  categoryUpdate: (key: string, category: CategoryInput) => invoke<void>("category_update", { key, category }),
  categoryDelete: (key: string, moveTo: string | null) => invoke<void>("category_delete", { key, moveTo }),
  categoriesArrange: (order: string[], hidden: string[]) => invoke<void>("categories_arrange", { order, hidden }),
  dashboard: () => invoke<Dashboard>("dashboard_get"),
  item: (id: number) => invoke<ItemDetail>("item_get", { id }),
  itemUpdate: (id: number, edit: ItemEdit) => invoke<void>("item_update", { id, edit }),
  itemCreate: (item: ItemEdit, physical: VersionInput | null) =>
    invoke<number>("item_create", { item: { item, physical } }),
  itemSetFavorite: (id: number, favorite: boolean) => invoke<void>("item_set_favorite", { id, favorite }),
  itemSetCover: (id: number, path: string) => invoke<void>("item_set_cover", { id, path }),
  itemRemove: (ids: number[], trashManagedCopies: boolean) =>
    invoke<RemoveReport>("item_remove", { ids, trashManagedCopies }),
  versionSave: (version: VersionInput) => invoke<number>("version_save", { version }),
  versionDelete: (id: number) => invoke<void>("version_delete", { id }),
  fileReveal: (id: number) => invoke<void>("file_reveal", { id }),

  importStart: (paths: string[], mode: ImportMode, category: string | null) =>
    invoke<number>("import_start", { request: { paths, mode, category } }),
  importCancel: (jobId: number) => invoke<void>("import_cancel", { jobId }),
  itemAttachFiles: (itemId: number, paths: string[], mode: ImportMode) =>
    invoke<number>("item_attach_files", { itemId, paths, mode }),

  playerOpen: (path: string) => invoke<void>("player_open", { path }),
  playerCommand: (args: unknown[]) => invoke<void>("player_command", { args }),
  playerSetRect: (rect: Rect) => invoke<void>("player_set_rect", { ...rect }),
  playerClose: () => invoke<void>("player_close"),

  devMode: () => invoke<string | null>("dev_mode"),
  devReport: (name: string, report: unknown) => invoke<string>("dev_report", { name, report }),
  devExit: () => invoke<void>("dev_exit"),
};

/** Artwork served by the core's private `digitify` scheme (Windows form of the URL). */
export function artworkUrl(key: string, size: "thumb" | "cover" = "thumb"): string {
  return `http://digitify.localhost/${size}/${key}`;
}

/** A page of an open book, at least `width` device pixels wide (the core rounds widths up). */
export function pageUrl(versionId: number, index: number, width: number): string {
  return `http://digitify.localhost/page/${versionId}/${index}?w=${Math.round(width)}`;
}

/** A track of the current ambient playlist (only files the user chose are served). */
export function ambientUrl(generation: number, id: number): string {
  return `http://digitify.localhost/ambient/${generation}/${id}`;
}

/** Tauri rejects with plain strings from Rust errors; normalize for display. */
export function errorText(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return "Something went wrong.";
}

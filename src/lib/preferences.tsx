import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, ARCADE_CONSOLES, type ArcadeConsole, type ArcadeEmulator, type ArcadeStore, type CoverShape, type ImportMode, type MusicSource, type Ownership, type SortKey } from "./api";
import { accentVariables } from "./color";
import { sanitizeShortcuts, setCustomShortcuts, type ShortcutMap } from "./shortcuts";

export type ThemeChoice = "dark" | "light" | "system";
export type MotionChoice = "system" | "full" | "reduced" | "off";
export type Layout = "grid" | "list" | "shelf" | "detailed" | "carousel";
export const LAYOUTS: Layout[] = ["grid", "shelf", "list", "detailed", "carousel"];
/** The overall style (D-016, D-023): Breeze, or Cinematic as an option. */
export type Look = "breeze" | "cinematic";
/** Breeze's color variants (D-023). Midnight is always dark. */
export type Palette = "breeze" | "sunset" | "midnight" | "contrast";
/** What the shelves in the shelf view are made of (D-023). */
export type ShelfLook = "breeze" | "wood" | "glass" | "metal";

/** Each section's own color, when colors per section are on (D-054). */
export const SECTION_COLORS: Record<string, string> = {
  pictures: "#0ea5e9",
  music: "#16a34a",
  videos: "#ea580c",
  video: "#dc2626",
  books: "#2563eb",
  comics: "#d97706",
  manga: "#db2777",
  arcade: "#7c3aed",
};
export const SECTION_COLOR_NAMES: Record<string, string> = {
  pictures: "Pictures",
  music: "Music",
  videos: "Videos",
  video: "Movies & Series",
  books: "Books",
  comics: "Comics",
  manga: "Manga",
  arcade: "Arcade",
};

/** Home's sections (D-023), in their default order. */
export const HOME_SECTIONS = [
  "discs",
  "tiles",
  "featured",
  "featuredGame",
  "upNext",
  "favorites",
  "favoriteGames",
  "because",
  "continueWatching",
  "continuePlaying",
  "continueReading",
  "recentlyAdded",
  "recentlyOpened",
  "stats",
] as const;
/** Earlier default orders: a Home still in one of them moves to the current default. */
const OLD_HOME_ORDERS = [
  // (Shelves, D-029, left Home; these read as they are once their "shelves" is dropped.)
  "tiles,featured,continueWatching,continueReading,recentlyOpened,recentlyAdded,favorites,discs,stats",
  "tiles,featured,continueWatching,continueReading,recentlyOpened,recentlyAdded,favorites,stats",
  // Before Arcade's sections (D-041, D-042).
  "discs,tiles,featured,favorites,continueWatching,continueReading,recentlyOpened,recentlyAdded,stats",
  "discs,tiles,featured,continuePlaying,favorites,continueWatching,continueReading,recentlyOpened,recentlyAdded,favoriteGames,featuredGame,stats",
  // Before Up next (D-050).
  "discs,tiles,featured,featuredGame,favorites,favoriteGames,continueWatching,continuePlaying,continueReading,recentlyAdded,recentlyOpened,stats",
  // Before Later and Because you liked (D-062, D-064).
  "discs,tiles,featured,featuredGame,upNext,favorites,favoriteGames,continueWatching,continuePlaying,continueReading,recentlyAdded,recentlyOpened,stats",
];
export type HomeSection = (typeof HOME_SECTIONS)[number];
export interface HomeLayout {
  order: HomeSection[];
  hidden: HomeSection[];
}

/** Ambient music (decision D-016). */
export interface MusicPreferences {
  /** Play or pause, from the title bar capsule or Settings. */
  enabled: boolean;
  /** 0–100. */
  volume: number;
  muted: boolean;
  /** Digitify's own "Morning Lounge", or music the user picked. */
  source: "lounge" | "custom";
  sources: MusicSource[];
  shuffle: boolean;
  pauseWhenMinimized: boolean;
  /** The reader is a quiet place by default. */
  pauseWhileReading: boolean;
}

/** How page-based items are shown (comics, manga, scans, PDFs). */
export interface ReaderPreferences {
  /** One page, two facing pages, or every page in one scrolling strip. */
  mode: "single" | "spread" | "scroll";
  /** Whole page on screen, or pages as wide as the window. */
  fit: "page" | "width";
  /** In two-page mode, the first page (usually the cover) stands alone. */
  coverAlone: boolean;
  /** Page turns: slide, fade, a 3D turn, a page curl (D-021), or none. */
  transition: "slide" | "fade" | "turn" | "curl" | "none";
  /** Page brightness, percent (40–100). */
  brightness: number;
  /** Dimmer, warmer pages for reading in the dark. */
  night: boolean;
  /** Behind the pages: "night", "black", "gray", "paper", or a color as #rrggbb. */
  background: string;
}

/** How reflowable ebooks are laid out (EPUB, MOBI, AZW3, FB2). */
export interface EbookPreferences {
  /** One column, two facing columns when the window is wide enough, or one long scroll. */
  layout: "single" | "spread" | "scroll";
  theme: "paper" | "sepia" | "night";
  /** The book's own fonts, or one font throughout. */
  font: "book" | "serif" | "sans";
  /** Text size, percent. */
  size: number;
  /** Line spacing. */
  spacing: number;
  /** How wide a column of text may grow. */
  width: "narrow" | "medium" | "wide";
  justify: boolean;
  /** Percent (40–100). */
  brightness: number;
}

export interface Preferences {
  /** The visual identity the appearance settings belong to (a marker for settings saved before D-016). */
  style: "breeze";
  look: Look;
  palette: Palette;
  theme: ThemeChoice;
  accent: string;
  motion: MotionChoice;
  /** Light mode for slower computers: no blur, reflections, heavy shadows or animations (D-030). */
  lightMode: boolean;
  /** The window opens maximized (D-046); off, it opens at its regular size. */
  startMaximized: boolean;
  /** Closing the window keeps Digitify running in the tray (D-059), off by default. */
  closeToTray: boolean;
  /** When the app opens, offer to continue the last thing left halfway (D-068). */
  resumeOnOpen: boolean;
  /** Closing the window (tray off) asks first (D-080). */
  confirmClose: boolean;
  /** With the tray on, holding the window's X quits Digitify outright (D-085). */
  holdToQuit: boolean;
  /** What's new after an update (D-081): shown unless turned off; `seen` is the last version shown. */
  whatsNew: { show: boolean; seen: string | null };
  /** Library's Everything view (D-074): off, every item is in its own category only. */
  showEverything: boolean;
  /** The Library section opened last (D-075), opened again by the Library button. */
  libraryScope: string | null;
  /** The readers' night filter (D-069): an optional schedule, and how warm. */
  nightFilter: NightFilter;
  /** Monthly goals in Statistics (D-052): items finished, and hours of each activity; 0 is no goal. */
  goals: Goals;
  /** Automatic backups (D-056): how often, a folder to copy them to (another drive), how many to keep. */
  autoBackup: { every: "off" | "daily" | "weekly" | "monthly"; folder: string | null; keep: number };
  /** A color of its own for each section (D-054), off by default; Breeze only. */
  sectionColors: { enabled: boolean; colors: Record<string, string> };
  /** Cover width in the grid and shelf views, in pixels. */
  cardSize: number;
  /** Last layout used per view (all, favorites, a category key, search), or for every view under "*". */
  layouts: Record<string, Layout>;
  /** The same layout and copies filter in every view (under "*"), rather than one per view. */
  syncViews: boolean;
  /** Last filter (All, Digital, Online, Collections) per view, or under "*". */
  ownership: Record<string, Ownership | "" | "collections">;
  /** Last sort per view ("books", "all", "collection:3", "shelf:5"…). */
  sorts: Record<string, SortKey>;
  /** How albums and videos are shown unless an item has its own shape. */
  /** Default cover shapes: music square or CD; Videos horizontal or vertical (Movies & Series are always vertical, D-027). */
  coverShapes: { audio: "square" | "disc"; videos: "poster" | "landscape" };
  /** Big Picture (D-025): moving with the selection or with a cursor, and the cursor's speed. */
  /** Big Picture: how to move around, the cursor's speed, and its startup animation (D-070). */
  bigPicture: { navigation: "focus" | "cursor"; cursorSpeed: number; intro: boolean };
  shelfStyle: "covers" | "spines";
  shelfLook: ShelfLook;
  importMode: "ask" | ImportMode;
  music: MusicPreferences;
  /** Soft tones when pointing at and pressing things. */
  interfaceSounds: boolean;
  reader: ReaderPreferences;
  ebook: EbookPreferences;
  /** Where the video and music players' volume was left (0–100), so they start there. */
  volumes: { video: number; music: number };
  /** Keys the user changed in Settings › Keyboard; everything else keeps its default. */
  shortcuts: ShortcutMap;
  /** Home's sections: their order, and the ones hidden. */
  home: HomeLayout;
  /** A photo shown behind Home (D-033), by item id; none for the plain page. */
  homeWallpaper: number | null;
  /** Seconds each photo stays up in the image viewer's slideshow. */
  slideshowSeconds: number;
  /** Arcade (D-034): covers from GameTDB, the Nintendo 64 emulator, and how the games are shown. */
  arcade: ArcadePreferences;
}

/** Arcade's views (D-038): everything, PC or ROM games, one store, one console, favorites. */
/** "others": PC games added by hand (D-115), from no store. */
export type ArcadeFilter = "all" | "all-pc" | "all-roms" | ArcadeStore | "others" | ArcadeConsole | "favorites";

/** Their default order; "all" stands in for "all-pc" and "all-roms" when they're combined. */
export const ARCADE_FILTER_ORDER: ArcadeFilter[] = ["all-pc", "all-roms", "steam", "epic", "xbox", "gog", "ubisoft", "ea", "battlenet", "amazon", "itch", "heroic", "lutris", "others", ...ARCADE_CONSOLES, "favorites"];

export interface ArcadePreferences {
  downloadCovers: boolean;
  /** The emulator chosen for each console (Emulators & folders › Consoles, D-111); a console not
   *  here plays in the first emulator found in Arcade's order. */
  playsIn: Partial<Record<ArcadeConsole, ArcadeEmulator>>;
  /** The view shown. */
  platform: ArcadeFilter;
  /** The views' order and the hidden ones (Settings › Arcade). */
  filterOrder: ArcadeFilter[];
  hiddenFilters: ArcadeFilter[];
  /** "All PC games" and "All ROM games" as one "All games" view. */
  combineAll: boolean;
  /** What Digitify does while a game runs (D-041): stays open with its music silenced (the default;
   *  the music can be switched back on), hides and comes back when the game ends, or quits. */
  whilePlaying: "stay" | "hide" | "quit";
  sort: "title" | "played" | "most" | "added" | "rating" | "custom";
}

/** The page color under each look and palette, for accent text contrast. */
const PAGE_BACKGROUNDS: Record<Palette | "cinematic", { light: string; dark: string }> = {
  breeze: { light: "#edf1f5", dark: "#0f1620" },
  sunset: { light: "#f6ede4", dark: "#1c1320" },
  midnight: { light: "#000000", dark: "#000000" },
  contrast: { light: "#ffffff", dark: "#000000" },
  cinematic: { light: "#f3f1ed", dark: "#0c0d10" },
};

/** Each look's own default accent: Breeze's sky blue, Cinematic's amber (D-015). */
export const LOOK_ACCENTS: Record<Look, string> = { breeze: "#1592d0", cinematic: "#e0a43a" };
/** Breeze palettes' own accents: Sunset is coral, the others keep sky blue. */
export const PALETTE_ACCENTS: Record<Palette, string> = { breeze: "#1592d0", sunset: "#ef5f4f", midnight: "#1592d0", contrast: "#1592d0" };

export const DEFAULT_MUSIC: MusicPreferences = {
  enabled: true,
  volume: 40,
  muted: false,
  source: "lounge",
  sources: [],
  shuffle: true,
  pauseWhenMinimized: true,
  pauseWhileReading: true,
};

export const DEFAULT_READER: ReaderPreferences = {
  mode: "single",
  fit: "page",
  coverAlone: true,
  transition: "slide",
  brightness: 100,
  night: false,
  background: "night",
};
export const READER_BACKGROUNDS = ["night", "black", "gray", "paper"];

export const EBOOK_SIZES = [70, 80, 90, 100, 110, 120, 135, 150, 175, 200];
export const EBOOK_SPACINGS = [1.3, 1.5, 1.8];

export const DEFAULT_EBOOK: EbookPreferences = {
  layout: "spread",
  theme: "paper",
  font: "book",
  size: 100,
  spacing: 1.5,
  width: "medium",
  justify: true,
  brightness: 100,
};

export const DEFAULT_PREFERENCES: Preferences = {
  style: "breeze",
  look: "breeze",
  palette: "breeze",
  theme: "light",
  accent: "#1592d0",
  motion: "system",
  lightMode: false,
  startMaximized: true,
  closeToTray: true,
  resumeOnOpen: true,
  showEverything: false,
  confirmClose: true,
  holdToQuit: true,
  whatsNew: { show: true, seen: null },
  libraryScope: null,
  nightFilter: { schedule: false, from: "21:00", to: "07:00", strength: 35 },
  goals: { finished: 0, read: 0, watch: 0, listen: 0, play: 0 },
  sectionColors: { enabled: false, colors: { ...SECTION_COLORS } },
  autoBackup: { every: "off", folder: null, keep: 8 },
  cardSize: 160,
  layouts: {},
  syncViews: true,
  ownership: {},
  sorts: {},
  coverShapes: { audio: "square", videos: "landscape" },
  bigPicture: { navigation: "focus", cursorSpeed: 1000, intro: true },
  shelfStyle: "covers",
  shelfLook: "breeze",
  importMode: "ask",
  music: DEFAULT_MUSIC,
  interfaceSounds: true,
  reader: DEFAULT_READER,
  ebook: DEFAULT_EBOOK,
  volumes: { video: 35, music: 35 },
  shortcuts: {},
  home: { order: [...HOME_SECTIONS], hidden: [] },
  homeWallpaper: null,
  slideshowSeconds: 5,
  arcade: {
    downloadCovers: true,
    playsIn: {},
    platform: "all-pc",
    filterOrder: [...ARCADE_FILTER_ORDER],
    hiddenFilters: [],
    combineAll: false,
    whilePlaying: "stay",
    sort: "title",
  },
};

type Raw<T> = { [K in keyof T]?: unknown };

function picker<T>(raw: unknown, defaults: T) {
  const value = (raw && typeof raw === "object" ? raw : {}) as Raw<T>;
  return <K extends keyof T>(key: K, valid: (v: unknown) => boolean): T[K] =>
    valid(value[key]) ? (value[key] as T[K]) : defaults[key];
}

const isBoolean = (v: unknown) => typeof v === "boolean";
const isBrightness = (v: unknown) => typeof v === "number" && v >= 40 && v <= 100;

function isMusicSource(v: unknown): v is MusicSource {
  const source = v as Partial<Record<string, unknown>> | null;
  if (!source || typeof source !== "object") return false;
  if (source.kind === "file" || source.kind === "folder") return typeof source.path === "string";
  return source.kind === "item" && typeof source.id === "number" && typeof source.title === "string";
}

function sanitizeMusic(raw: unknown): MusicPreferences {
  const pick = picker(raw, DEFAULT_MUSIC);
  return {
    enabled: pick("enabled", isBoolean),
    volume: Math.round(pick("volume", (v) => typeof v === "number" && v >= 0 && v <= 100)),
    muted: pick("muted", isBoolean),
    source: pick("source", (v) => v === "lounge" || v === "custom"),
    sources: pick("sources", Array.isArray).filter(isMusicSource),
    shuffle: pick("shuffle", isBoolean),
    pauseWhenMinimized: pick("pauseWhenMinimized", isBoolean),
    pauseWhileReading: pick("pauseWhileReading", isBoolean),
  };
}

function sanitizeReader(raw: unknown): ReaderPreferences {
  const pick = picker(raw, DEFAULT_READER);
  return {
    mode: pick("mode", (v) => v === "single" || v === "spread" || v === "scroll"),
    fit: pick("fit", (v) => v === "page" || v === "width"),
    coverAlone: pick("coverAlone", isBoolean),
    transition: pick("transition", (v) => ["slide", "fade", "turn", "curl", "none"].includes(v as string)),
    brightness: pick("brightness", isBrightness),
    night: pick("night", isBoolean),
    background: pick("background", (v) => READER_BACKGROUNDS.includes(v as string) || (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v))),
  };
}

function sanitizeEbook(raw: unknown): EbookPreferences {
  const pick = picker(raw, DEFAULT_EBOOK);
  return {
    layout: pick("layout", (v) => v === "single" || v === "spread" || v === "scroll"),
    theme: pick("theme", (v) => v === "paper" || v === "sepia" || v === "night"),
    font: pick("font", (v) => v === "book" || v === "serif" || v === "sans"),
    size: pick("size", (v) => EBOOK_SIZES.includes(v as number)),
    spacing: pick("spacing", (v) => EBOOK_SPACINGS.includes(v as number)),
    width: pick("width", (v) => v === "narrow" || v === "medium" || v === "wide"),
    justify: pick("justify", isBoolean),
    brightness: pick("brightness", isBrightness),
  };
}

function sanitizeVolumes(raw: unknown): Preferences["volumes"] {
  const pick = picker(raw, DEFAULT_PREFERENCES.volumes);
  const isVolume = (v: unknown) => typeof v === "number" && v >= 0 && v <= 100;
  return { video: Math.round(pick("video", isVolume)), music: Math.round(pick("music", isVolume)) };
}

function sanitizeBigPicture(raw: unknown): Preferences["bigPicture"] {
  const value = (raw && typeof raw === "object" ? raw : {}) as { navigation?: unknown; cursorSpeed?: unknown; intro?: unknown };
  return {
    intro: typeof value.intro === "boolean" ? value.intro : true,
    navigation: value.navigation === "cursor" ? "cursor" : "focus",
    cursorSpeed: typeof value.cursorSpeed === "number" && value.cursorSpeed >= 300 && value.cursorSpeed <= 3000 ? value.cursorSpeed : 1000,
  };
}

function sanitizeAutoBackup(raw: unknown): Preferences["autoBackup"] {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const every = ["off", "daily", "weekly", "monthly"].includes(value.every as string) ? (value.every as Preferences["autoBackup"]["every"]) : "off";
  const folder = typeof value.folder === "string" && value.folder.trim() ? value.folder : null;
  const keep = typeof value.keep === "number" && value.keep >= 1 ? Math.min(100, Math.round(value.keep)) : 8;
  return { every, folder, keep };
}

function sanitizeSectionColors(raw: unknown): Preferences["sectionColors"] {
  const value = (raw && typeof raw === "object" ? raw : {}) as { enabled?: unknown; colors?: Record<string, unknown> };
  const colors = { ...SECTION_COLORS };
  for (const key of Object.keys(SECTION_COLORS)) {
    const c = value.colors?.[key];
    if (typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c)) colors[key] = c;
  }
  return { enabled: value.enabled === true, colors };
}

export interface NightFilter {
  /** Comes on by itself between `from` and `to` ("HH:MM", may run past midnight). */
  schedule: boolean;
  from: string;
  to: string;
  /** How warm, 10-80 (%). */
  strength: number;
}

const isTime = (v: unknown): v is string => typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

function sanitizeNightFilter(raw: unknown): NightFilter {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_PREFERENCES.nightFilter;
  return {
    schedule: typeof value.schedule === "boolean" ? value.schedule : d.schedule,
    from: isTime(value.from) ? value.from : d.from,
    to: isTime(value.to) ? value.to : d.to,
    strength: typeof value.strength === "number" ? Math.min(80, Math.max(10, Math.round(value.strength))) : d.strength,
  };
}

/** A category's tabs (D-094): its media, its collections, its favorites. */
export const CATEGORY_TABS = ["media", "collections", "favorites"] as const;
export type CategoryTab = (typeof CATEGORY_TABS)[number];

export interface Goals {
  finished: number;
  read: number;
  watch: number;
  listen: number;
  play: number;
}

function sanitizeGoals(raw: unknown): Goals {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const n = (k: keyof Goals, max: number) => (typeof value[k] === "number" && (value[k] as number) >= 0 ? Math.min(Math.round(value[k] as number), max) : 0);
  return { finished: n("finished", 999), read: n("read", 744), watch: n("watch", 744), listen: n("listen", 744), play: n("play", 744) };
}

const isArcadeFilter = (v: unknown): v is ArcadeFilter => v === "all" || ARCADE_FILTER_ORDER.includes(v as ArcadeFilter);

/** The emulator chosen per console (D-111); the older single choices (Nintendo 64, Nintendo DS,
 *  NES, Game Boy) carry over. */
function sanitizePlaysIn(value: Record<string, unknown>): Partial<Record<ArcadeConsole, ArcadeEmulator>> {
  const out: Partial<Record<ArcadeConsole, ArcadeEmulator>> = {};
  const saved = value.playsIn && typeof value.playsIn === "object" ? (value.playsIn as Record<string, unknown>) : null;
  if (saved) {
    for (const [console, emulator] of Object.entries(saved)) {
      if (ARCADE_CONSOLES.includes(console as ArcadeConsole) && typeof emulator === "string" && /^[a-z0-9]{2,24}$/.test(emulator)) out[console as ArcadeConsole] = emulator as ArcadeEmulator;
    }
    return out;
  }
  if (value.n64 === "rmg") out.n64 = "rmg";
  if (value.ds === "desmume") out.ds = "desmume";
  if (value.nes === "fceux") out.nes = "fceux";
  if (value.gb === "mesen") out.gb = out.gbc = out.gba = "mesen";
  return out;
}

function sanitizeArcade(raw: unknown): ArcadePreferences {
  const pick = picker(raw, DEFAULT_PREFERENCES.arcade);
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  // Views saved before D-038: "pc" is now All PC games.
  const saved = value.platform === "pc" ? "all-pc" : value.platform;
  let order = Array.isArray(value.filterOrder) ? [...new Set(value.filterOrder.filter((f): f is ArcadeFilter => isArcadeFilter(f) && f !== "all"))] : [];
  // Views added later join at their default place.
  for (const [index, filter] of ARCADE_FILTER_ORDER.entries()) if (!order.includes(filter)) order.splice(Math.min(index, order.length), 0, filter);
  order = order.filter((f) => ARCADE_FILTER_ORDER.includes(f));
  return {
    downloadCovers: pick("downloadCovers", isBoolean),
    playsIn: sanitizePlaysIn(value),
    platform: isArcadeFilter(saved) ? saved : DEFAULT_PREFERENCES.arcade.platform,
    filterOrder: order,
    hiddenFilters: Array.isArray(value.hiddenFilters) ? [...new Set(value.hiddenFilters.filter(isArcadeFilter))] : [],
    combineAll: pick("combineAll", isBoolean),
    whilePlaying: pick("whilePlaying", (v) => v === "stay" || v === "hide" || v === "quit"),
    sort: pick("sort", (v) => ["title", "played", "most", "added", "rating", "custom"].includes(v as string)),
  };
}

function sanitizeShapes(raw: unknown): Preferences["coverShapes"] {
  const value = (raw && typeof raw === "object" ? raw : {}) as { audio?: unknown; videos?: unknown };
  return { audio: value.audio === "disc" ? "disc" : "square", videos: value.videos === "poster" ? "poster" : "landscape" };
}

/** The image viewer's slideshow speeds, in seconds per photo. */
export const SLIDESHOW_SECONDS = [3, 5, 8, 12, 20];

/** Movies & Series: its covers are always vertical (D-027). */
export const FILMS = "video";

/** The shape an item's cover is shown in: its own, or the default for its kind. */
export function coverShapeOf(item: { handler: string; category?: string | null; coverShape?: CoverShape | null; collection?: unknown }, defaults: Preferences["coverShapes"]): CoverShape | "book" {
  // A collection among the items is as wide as a horizontal video (D-030).
  if (item.collection) return "landscape";
  if (item.handler === "audio") return item.coverShape === "disc" || item.coverShape === "square" ? item.coverShape : defaults.audio;
  // A photo is wide, tall or square, as the core reads it from its proportions (D-033).
  if (item.handler === "image") return item.coverShape === "landscape" || item.coverShape === "poster" ? item.coverShape : "square";
  if (item.handler === "video") {
    if (item.category === FILMS) return "poster";
    return item.coverShape === "poster" || item.coverShape === "landscape" ? item.coverShape : defaults.videos;
  }
  return "book";
}

export const SHAPE_ASPECT: Record<CoverShape | "book", number> = { square: 1, disc: 1, poster: 2 / 3, landscape: 16 / 9, book: 2 / 3 };

/** The cover shape of an item, with the user's defaults. */
export function useCoverShape() {
  const { preferences } = usePreferences();
  return (item: { handler: string; category?: string | null; coverShape?: CoverShape | null; collection?: unknown; aspect?: number | null }) => {
    const shape = coverShapeOf(item, preferences.coverShapes);
    // A photo keeps its own proportions, so photos side by side share one height (D-073).
    const own = item.handler === "image" && !item.collection && item.aspect && item.aspect > 0 ? item.aspect : null;
    return { shape, aspect: own ?? SHAPE_ASPECT[shape] };
  };
}

const isHomeSection = (v: unknown): v is HomeSection => HOME_SECTIONS.includes(v as HomeSection);

function sanitizeHome(raw: unknown): HomeLayout {
  const value = (raw && typeof raw === "object" ? raw : {}) as Raw<HomeLayout>;
  let order = Array.isArray(value.order) ? [...new Set(value.order.filter(isHomeSection))] : [];
  if (OLD_HOME_ORDERS.includes(order.join(","))) order = [...HOME_SECTIONS];
  // Sections added in later versions join at their default place.
  for (const [index, section] of HOME_SECTIONS.entries()) {
    if (!order.includes(section)) order.splice(Math.min(index, order.length), 0, section);
  }
  const hidden = Array.isArray(value.hidden) ? [...new Set(value.hidden.filter(isHomeSection))] : [];
  return { order, hidden };
}

function sanitize(raw: unknown): Preferences {
  const pick = picker(raw, DEFAULT_PREFERENCES);
  // Settings saved under the earlier Cinematic identity (D-015) start from Breeze's own theme and
  // accent once; everything else carries over.
  const breeze = (raw as Raw<Preferences> | null)?.style === "breeze";
  return {
    style: "breeze",
    look: pick("look", (v) => v === "breeze" || v === "cinematic"),
    palette: pick("palette", (v) => ["breeze", "sunset", "midnight", "contrast"].includes(v as string)),
    theme: breeze ? pick("theme", (v) => v === "dark" || v === "light" || v === "system") : DEFAULT_PREFERENCES.theme,
    accent: breeze ? pick("accent", (v) => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v)) : DEFAULT_PREFERENCES.accent,
    motion: pick("motion", (v) => ["system", "full", "reduced", "off"].includes(v as string)),
    lightMode: pick("lightMode", isBoolean),
    startMaximized: pick("startMaximized", isBoolean),
    closeToTray: pick("closeToTray", isBoolean),
    resumeOnOpen: pick("resumeOnOpen", isBoolean),
    showEverything: pick("showEverything", isBoolean),
    confirmClose: pick("confirmClose", isBoolean),
    holdToQuit: pick("holdToQuit", isBoolean),
    whatsNew: (() => {
      const w = ((raw as Raw<Preferences>)?.whatsNew ?? {}) as { show?: unknown; seen?: unknown };
      return { show: typeof w.show === "boolean" ? w.show : true, seen: typeof w.seen === "string" ? w.seen : null };
    })(),
    libraryScope: pick("libraryScope", (v) => v === null || (typeof v === "string" && v.length > 0 && v.length < 64)),
    nightFilter: sanitizeNightFilter((raw as Raw<Preferences>)?.nightFilter),
    goals: sanitizeGoals((raw as Raw<Preferences>)?.goals),
    sectionColors: sanitizeSectionColors((raw as Raw<Preferences>)?.sectionColors),
    autoBackup: sanitizeAutoBackup((raw as Raw<Preferences>)?.autoBackup),
    cardSize: pick("cardSize", (v) => typeof v === "number" && v >= 110 && v <= 260),
    layouts: pick("layouts", (v) => !!v && typeof v === "object"),
    syncViews: pick("syncViews", isBoolean),
    // Only Digital and Online are left (D-029); "On the shelf" and "Not digitized" fall back to All.
    ownership: Object.fromEntries(
      Object.entries(pick("ownership", (v) => !!v && typeof v === "object") as Record<string, unknown>).filter(([, v]) => v === "digital" || v === "online" || v === "collections"),
    ) as Record<string, Ownership | "" | "collections">,
    sorts: pick("sorts", (v) => !!v && typeof v === "object"),
    coverShapes: sanitizeShapes((raw as Raw<Preferences>)?.coverShapes),
    bigPicture: sanitizeBigPicture((raw as Raw<Preferences>)?.bigPicture),
    shelfStyle: pick("shelfStyle", (v) => v === "covers" || v === "spines"),
    shelfLook: pick("shelfLook", (v) => ["breeze", "wood", "glass", "metal"].includes(v as string)),
    importMode: pick("importMode", (v) => v === "ask" || v === "reference" || v === "copy"),
    music: sanitizeMusic((raw as Raw<Preferences>)?.music),
    interfaceSounds: pick("interfaceSounds", isBoolean),
    reader: sanitizeReader((raw as Raw<Preferences>)?.reader),
    ebook: sanitizeEbook((raw as Raw<Preferences>)?.ebook),
    volumes: sanitizeVolumes((raw as Raw<Preferences>)?.volumes),
    shortcuts: sanitizeShortcuts((raw as Raw<Preferences>)?.shortcuts),
    home: sanitizeHome((raw as Raw<Preferences>)?.home),
    homeWallpaper: pick("homeWallpaper", (v) => v === null || (typeof v === "number" && Number.isInteger(v) && v > 0)),
    slideshowSeconds: pick("slideshowSeconds", (v) => typeof v === "number" && SLIDESHOW_SECONDS.includes(v)),
    arcade: sanitizeArcade((raw as Raw<Preferences>)?.arcade),
  };
}

type Change = Partial<Preferences> | ((current: Preferences) => Partial<Preferences>);

interface PreferencesContext {
  preferences: Preferences;
  resolvedTheme: "dark" | "light";
  update: (change: Change) => void;
  /** The section on screen, for colors per section (D-054); null outside one. */
  setSection: (section: string | null) => void;
}

const Context = createContext<PreferencesContext | null>(null);

function useSystemDark(): boolean {
  const query = useMemo(() => window.matchMedia("(prefers-color-scheme: dark)"), []);
  const [dark, setDark] = useState(query.matches);
  useEffect(() => {
    const listener = (event: MediaQueryListEvent) => setDark(event.matches);
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }, [query]);
  return dark;
}

export function PreferencesProvider({ initial, children }: { initial: unknown; children: ReactNode }) {
  const [preferences, setPreferences] = useState(() => sanitize(initial));
  const systemDark = useSystemDark();
  // Midnight is a dark palette whatever the theme says.
  const breezePalette = preferences.look === "breeze" ? preferences.palette : "breeze";
  const resolvedTheme =
    breezePalette === "midnight" ? "dark" : preferences.theme === "system" ? (systemDark ? "dark" : "light") : preferences.theme;
  const saveTimer = useRef(0);
  const [section, setSection] = useState<string | null>(null);
  // Colors per section (D-054): the section's own color stands in for the accent, in Breeze.
  const sectionColor = preferences.sectionColors.enabled && preferences.look === "breeze" && section ? preferences.sectionColors.colors[section] : undefined;
  const accent = sectionColor ?? preferences.accent;
  // Handlers read the shortcuts outside React, so they're current before any key is pressed.
  setCustomShortcuts(preferences.shortcuts);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = resolvedTheme;
    root.dataset.look = preferences.look;
    root.dataset.palette = breezePalette;
    root.dataset.motion = preferences.motion === "system" ? "" : preferences.motion;
    root.dataset.perf = preferences.lightMode ? "light" : "";
    const page = PAGE_BACKGROUNDS[preferences.look === "cinematic" ? "cinematic" : breezePalette][resolvedTheme];
    const ratio = breezePalette === "contrast" ? 7 : 4.5;
    for (const [name, value] of Object.entries(accentVariables(accent, resolvedTheme, page, ratio))) {
      root.style.setProperty(name, value);
    }
  }, [resolvedTheme, preferences.look, breezePalette, preferences.motion, preferences.lightMode, accent]);

  const update = useCallback((change: Change) => {
    setPreferences((current) => {
      const next = { ...current, ...(typeof change === "function" ? change(current) : change) };
      window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        api.preferencesSet(next).catch((error) => console.error("could not save preferences", error));
      }, 300);
      return next;
    });
  }, []);

  const value = useMemo(() => ({ preferences, resolvedTheme, update, setSection }), [preferences, resolvedTheme, update]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function usePreferences(): PreferencesContext {
  const context = useContext(Context);
  if (!context) throw new Error("usePreferences must be used inside PreferencesProvider");
  return context;
}

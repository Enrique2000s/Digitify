import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, type CoverShape, type ImportMode, type MusicSource, type Ownership, type SortKey } from "./api";
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

/** Home's sections (D-023), in their default order. */
export const HOME_SECTIONS = [
  "discs",
  "tiles",
  "featured",
  "favorites",
  "shelves",
  "continueWatching",
  "continueReading",
  "recentlyOpened",
  "recentlyAdded",
  "stats",
] as const;
/** Earlier default orders: a Home still in one of them moves to the current default. */
const OLD_HOME_ORDERS = [
  "tiles,featured,continueWatching,continueReading,shelves,recentlyOpened,recentlyAdded,favorites,discs,stats",
  "tiles,featured,continueWatching,continueReading,shelves,recentlyOpened,recentlyAdded,favorites,stats",
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
  /** Cover width in the grid and shelf views, in pixels. */
  cardSize: number;
  /** Last layout used per view (all, favorites, a category key, search), or for every view under "*". */
  layouts: Record<string, Layout>;
  /** The same layout and copies filter in every view (under "*"), rather than one per view. */
  syncViews: boolean;
  /** Last copies filter (All, On the shelf, Digital, Not digitized) per view, or under "*". */
  ownership: Record<string, Ownership | "">;
  /** Last sort per view ("books", "all", "collection:3", "shelf:5"…). */
  sorts: Record<string, SortKey>;
  /** How albums and videos are shown unless an item has its own shape. */
  coverShapes: { audio: "square" | "disc"; video: "poster" | "landscape" };
  /** The music category's tab, opened again next time. */
  musicTab: string;
  /** Big Picture (D-025): moving with the selection or with a cursor, and the cursor's speed. */
  bigPicture: { navigation: "focus" | "cursor"; cursorSpeed: number };
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
  cardSize: 160,
  layouts: {},
  syncViews: true,
  ownership: {},
  sorts: {},
  coverShapes: { audio: "square", video: "poster" },
  musicTab: "albums",
  bigPicture: { navigation: "focus", cursorSpeed: 1000 },
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
  const value = (raw && typeof raw === "object" ? raw : {}) as { navigation?: unknown; cursorSpeed?: unknown };
  return {
    navigation: value.navigation === "cursor" ? "cursor" : "focus",
    cursorSpeed: typeof value.cursorSpeed === "number" && value.cursorSpeed >= 300 && value.cursorSpeed <= 3000 ? value.cursorSpeed : 1000,
  };
}

function sanitizeShapes(raw: unknown): Preferences["coverShapes"] {
  const value = (raw && typeof raw === "object" ? raw : {}) as { audio?: unknown; video?: unknown };
  return { audio: value.audio === "disc" ? "disc" : "square", video: value.video === "landscape" ? "landscape" : "poster" };
}

/** The shape an item's cover is shown in: its own, or the default for its kind. */
export function coverShapeOf(item: { handler: string; coverShape?: CoverShape | null }, defaults: Preferences["coverShapes"]): CoverShape | "book" {
  if (item.handler === "audio") return item.coverShape === "disc" || item.coverShape === "square" ? item.coverShape : defaults.audio;
  if (item.handler === "video") return item.coverShape === "poster" || item.coverShape === "landscape" ? item.coverShape : defaults.video;
  return "book";
}

export const SHAPE_ASPECT: Record<CoverShape | "book", number> = { square: 1, disc: 1, poster: 2 / 3, landscape: 16 / 9, book: 2 / 3 };

/** The cover shape of an item, with the user's defaults. */
export function useCoverShape() {
  const { preferences } = usePreferences();
  return (item: { handler: string; coverShape?: CoverShape | null }) => {
    const shape = coverShapeOf(item, preferences.coverShapes);
    return { shape, aspect: SHAPE_ASPECT[shape] };
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
    cardSize: pick("cardSize", (v) => typeof v === "number" && v >= 110 && v <= 260),
    layouts: pick("layouts", (v) => !!v && typeof v === "object"),
    syncViews: pick("syncViews", isBoolean),
    ownership: pick("ownership", (v) => !!v && typeof v === "object"),
    sorts: pick("sorts", (v) => !!v && typeof v === "object"),
    coverShapes: sanitizeShapes((raw as Raw<Preferences>)?.coverShapes),
    musicTab: pick("musicTab", (v) => typeof v === "string" && v.length < 20),
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
  };
}

type Change = Partial<Preferences> | ((current: Preferences) => Partial<Preferences>);

interface PreferencesContext {
  preferences: Preferences;
  resolvedTheme: "dark" | "light";
  update: (change: Change) => void;
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
  // Handlers read the shortcuts outside React, so they're current before any key is pressed.
  setCustomShortcuts(preferences.shortcuts);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = resolvedTheme;
    root.dataset.look = preferences.look;
    root.dataset.palette = breezePalette;
    root.dataset.motion = preferences.motion === "system" ? "" : preferences.motion;
    const page = PAGE_BACKGROUNDS[preferences.look === "cinematic" ? "cinematic" : breezePalette][resolvedTheme];
    const ratio = breezePalette === "contrast" ? 7 : 4.5;
    for (const [name, value] of Object.entries(accentVariables(preferences.accent, resolvedTheme, page, ratio))) {
      root.style.setProperty(name, value);
    }
  }, [resolvedTheme, preferences.look, breezePalette, preferences.motion, preferences.accent]);

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

  const value = useMemo(() => ({ preferences, resolvedTheme, update }), [preferences, resolvedTheme, update]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function usePreferences(): PreferencesContext {
  const context = useContext(Context);
  if (!context) throw new Error("usePreferences must be used inside PreferencesProvider");
  return context;
}

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, type ImportMode, type MusicSource } from "./api";
import { accentVariables } from "./color";

export type ThemeChoice = "dark" | "light" | "system";
export type MotionChoice = "system" | "full" | "reduced" | "off";
export type Layout = "grid" | "list" | "shelf";

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
  transition: "slide" | "fade" | "none";
}

export interface Preferences {
  /** The visual identity the appearance settings belong to. */
  style: "breeze";
  theme: ThemeChoice;
  accent: string;
  motion: MotionChoice;
  /** Cover width in the grid and shelf views, in pixels. */
  cardSize: number;
  /** Last layout used per view (all, favorites, a category key, search). */
  layouts: Record<string, Layout>;
  shelfStyle: "covers" | "spines";
  importMode: "ask" | ImportMode;
  music: MusicPreferences;
  /** Soft tones when pointing at and pressing things. */
  interfaceSounds: boolean;
  reader: ReaderPreferences;
}

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

export const DEFAULT_READER: ReaderPreferences = { mode: "single", fit: "page", coverAlone: true, transition: "slide" };

export const DEFAULT_PREFERENCES: Preferences = {
  style: "breeze",
  theme: "light",
  accent: "#1592d0",
  motion: "system",
  cardSize: 160,
  layouts: {},
  shelfStyle: "covers",
  importMode: "ask",
  music: DEFAULT_MUSIC,
  interfaceSounds: true,
  reader: DEFAULT_READER,
};

type Raw<T> = { [K in keyof T]?: unknown };

function picker<T>(raw: unknown, defaults: T) {
  const value = (raw && typeof raw === "object" ? raw : {}) as Raw<T>;
  return <K extends keyof T>(key: K, valid: (v: unknown) => boolean): T[K] =>
    valid(value[key]) ? (value[key] as T[K]) : defaults[key];
}

const isBoolean = (v: unknown) => typeof v === "boolean";

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
    transition: pick("transition", (v) => v === "slide" || v === "fade" || v === "none"),
  };
}

function sanitize(raw: unknown): Preferences {
  const pick = picker(raw, DEFAULT_PREFERENCES);
  // Settings saved under the earlier Cinematic identity (D-015) start from Breeze's own theme and
  // accent once; everything else carries over.
  const breeze = (raw as Raw<Preferences> | null)?.style === "breeze";
  return {
    style: "breeze",
    theme: breeze ? pick("theme", (v) => v === "dark" || v === "light" || v === "system") : DEFAULT_PREFERENCES.theme,
    accent: breeze ? pick("accent", (v) => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v)) : DEFAULT_PREFERENCES.accent,
    motion: pick("motion", (v) => ["system", "full", "reduced", "off"].includes(v as string)),
    cardSize: pick("cardSize", (v) => typeof v === "number" && v >= 110 && v <= 260),
    layouts: pick("layouts", (v) => !!v && typeof v === "object"),
    shelfStyle: pick("shelfStyle", (v) => v === "covers" || v === "spines"),
    importMode: pick("importMode", (v) => v === "ask" || v === "reference" || v === "copy"),
    music: sanitizeMusic((raw as Raw<Preferences>)?.music),
    interfaceSounds: pick("interfaceSounds", isBoolean),
    reader: sanitizeReader((raw as Raw<Preferences>)?.reader),
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
  const resolvedTheme = preferences.theme === "system" ? (systemDark ? "dark" : "light") : preferences.theme;
  const saveTimer = useRef(0);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = resolvedTheme;
    root.dataset.motion = preferences.motion === "system" ? "" : preferences.motion;
    for (const [name, value] of Object.entries(accentVariables(preferences.accent, resolvedTheme))) {
      root.style.setProperty(name, value);
    }
  }, [resolvedTheme, preferences.motion, preferences.accent]);

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

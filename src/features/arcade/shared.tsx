import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { api, ARCADE_CONSOLES, artworkUrl, errorText, onLinux, type ArcadeConsole, type ArcadeGame, type ArcadePlatform, type ArcadeStore } from "../../lib/api";
import { usePreferences, type ArcadeFilter, type ArcadePreferences } from "../../lib/preferences";

export const PLATFORM_NAMES: Record<ArcadePlatform, string> = {
  gamecube: "GameCube",
  wii: "Wii",
  n64: "Nintendo 64",
  ps1: "PlayStation",
  ps2: "PlayStation 2",
  ps3: "PlayStation 3",
  ds: "Nintendo DS",
  nes: "NES",
  snes: "Super Nintendo",
  gb: "Game Boy",
  gbc: "Game Boy Color",
  gba: "Game Boy Advance",
  "3ds": "Nintendo 3DS",
  sms: "Master System",
  genesis: "Mega Drive / Genesis",
  segacd: "Sega CD",
  gamegear: "Game Gear",
  saturn: "Saturn",
  dreamcast: "Dreamcast",
  psp: "PSP",
  pce: "PC Engine",
  wiiu: "Wii U",
  switch: "Nintendo Switch",
  ogxbox: "Xbox (original)",
  x360: "Xbox 360",
  arcade: "Arcade",
  atari2600: "Atari 2600",
  other: "Other consoles",
  pc: "PC",
};
export const PLATFORM_SHORT: Record<ArcadePlatform, string> = {
  gamecube: "GC",
  wii: "Wii",
  n64: "N64",
  ps1: "PS1",
  ps2: "PS2",
  ps3: "PS3",
  ds: "DS",
  nes: "NES",
  snes: "SNES",
  gb: "GB",
  gbc: "GBC",
  gba: "GBA",
  "3ds": "3DS",
  sms: "SMS",
  genesis: "MD",
  segacd: "SCD",
  gamegear: "GG",
  saturn: "Saturn",
  dreamcast: "DC",
  psp: "PSP",
  pce: "PCE",
  wiiu: "Wii U",
  switch: "Switch",
  ogxbox: "Xbox",
  x360: "360",
  arcade: "Arcade",
  atari2600: "2600",
  other: "Retro",
  pc: "PC",
};
export const STORE_NAMES: Record<ArcadeStore, string> = {
  steam: "Steam",
  epic: "Epic Games",
  xbox: "Xbox",
  gog: "GOG",
  ubisoft: "Ubisoft Connect",
  ea: "EA app",
  battlenet: "Battle.net",
  rockstar: "Rockstar Games",
  riot: "Riot Games",
  amazon: "Amazon Games",
  itch: "itch.io",
  heroic: "Heroic",
  lutris: "Lutris",
};

/** Box art proportions: disc cases are tall, Nintendo 64 and Super Nintendo boxes wide, PlayStation's
 *  jewel cases and handheld boxes about square, PC capsules 2:3. */
export const PLATFORM_ASPECT: Record<ArcadePlatform, number> = {
  gamecube: 0.71,
  wii: 0.71,
  n64: 1.38,
  ps1: 1,
  ps2: 0.7,
  ps3: 0.86,
  ds: 0.9,
  nes: 0.72,
  snes: 1.38,
  gb: 1,
  gbc: 1,
  gba: 1,
  "3ds": 0.88,
  sms: 0.72,
  genesis: 0.7,
  segacd: 1,
  gamegear: 0.72,
  saturn: 0.62,
  dreamcast: 1,
  psp: 0.58,
  pce: 1,
  wiiu: 0.71,
  switch: 0.62,
  ogxbox: 0.7,
  x360: 0.7,
  arcade: 0.75,
  atari2600: 0.72,
  other: 0.75,
  pc: 0.667,
};

/** A game's console, or for a PC game its store ("Steam"). */
export function consoleOf(game: ArcadeGame): string {
  return game.platform === "pc" && game.store ? STORE_NAMES[game.store] : PLATFORM_NAMES[game.platform];
}

/** The short badge on a game's box. */
export function badgeOf(game: ArcadeGame): string {
  // Epic Games by its full name (D-122); the longer names shortened.
  const short: Partial<Record<ArcadeStore, string>> = { ubisoft: "Ubisoft", ea: "EA", amazon: "Amazon", rockstar: "Rockstar", riot: "Riot" };
  return game.platform === "pc" && game.store ? (short[game.store] ?? STORE_NAMES[game.store]) : PLATFORM_SHORT[game.platform];
}

/** Arcade's views (D-038), with what each one holds. */
export const FILTER_LABELS: Record<ArcadeFilter, string> = {
  all: "All games",
  "all-pc": "PC games",
  "all-roms": "ROM games",
  steam: "Steam",
  epic: "Epic Games",
  xbox: "Xbox",
  gog: "GOG",
  ubisoft: "Ubisoft Connect",
  ea: "EA app",
  battlenet: "Battle.net",
  rockstar: "Rockstar Games",
  riot: "Riot Games",
  amazon: "Amazon Games",
  itch: "itch.io",
  heroic: "Heroic",
  lutris: "Lutris",
  // PC games added by their program (D-115).
  others: "Others",
  ...(Object.fromEntries(ARCADE_CONSOLES.map((key) => [key, PLATFORM_NAMES[key]])) as Record<ArcadeConsole, string>),
  favorites: "Favorites",
};

export function inFilter(game: ArcadeGame, filter: ArcadeFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "all-pc":
      return game.platform === "pc";
    case "all-roms":
      return game.platform !== "pc";
    case "others":
      return game.platform === "pc" && !game.store;
    case "steam":
    case "epic":
    case "xbox":
    case "gog":
    case "ubisoft":
    case "ea":
    case "battlenet":
    case "rockstar":
    case "riot":
    case "amazon":
    case "itch":
    case "heroic":
    case "lutris":
      return game.store === filter;
    case "favorites":
      return game.isFavorite;
    default:
      return game.platform === filter;
  }
}

/** Whether a view exists on this system (Epic and Xbox are Windows-only; Heroic is for Linux). */
export function filterAvailable(filter: ArcadeFilter): boolean {
  if (["epic", "xbox", "gog", "ubisoft", "ea", "battlenet", "rockstar", "riot", "amazon"].includes(filter)) return !onLinux;
  if (filter === "heroic" || filter === "lutris") return onLinux;
  return true;
}

/** Views that are always there; a store's or console's view shows only once it has a game (D-101). */
const ALWAYS: ArcadeFilter[] = ["all", "all-pc", "all-roms", "favorites"];

/** The store and console views that have at least one game; `null` while games are loading. */
export function filledFilters(games: ArcadeGame[] | undefined): Set<ArcadeFilter> | null {
  if (!games) return null;
  const filled = new Set<ArcadeFilter>();
  for (const game of games) {
    if (game.missing) continue;
    filled.add(game.platform === "pc" ? (game.store ?? "others") : game.platform);
  }
  return filled;
}

/** The views in their order: on this system, hidden ones left out, PC and ROM combined if asked,
 *  and (given `filled`) only the store and console views with games. */
export function arcadeFilters(arcade: ArcadePreferences, withHidden = false, filled: Set<ArcadeFilter> | null = null): ArcadeFilter[] {
  const out: ArcadeFilter[] = [];
  for (const filter of arcade.filterOrder) {
    if (!filterAvailable(filter)) continue;
    if (filled && !ALWAYS.includes(filter) && !filled.has(filter)) continue;
    if (arcade.combineAll && (filter === "all-pc" || filter === "all-roms")) {
      if (!out.includes("all") && (withHidden || !arcade.hiddenFilters.includes("all"))) out.push("all");
      continue;
    }
    if (!withHidden && arcade.hiddenFilters.includes(filter)) continue;
    out.push(filter);
  }
  return out;
}

/** The views shown and the one in use (the saved one, or the first shown when it isn't). */
export function useArcadeFilters() {
  const { preferences, update } = usePreferences();
  const games = useQuery({ queryKey: ["arcade-games"], queryFn: api.arcadeGames });
  const filters = arcadeFilters(preferences.arcade, false, filledFilters(games.data));
  const current: ArcadeFilter = filters.includes(preferences.arcade.platform) ? preferences.arcade.platform : (filters[0] ?? "all");
  const choose = (filter: ArcadeFilter) => update((c) => ({ arcade: { ...c.arcade, platform: filter } }));
  return { filters, current, choose };
}

export const SORTS: { key: ArcadePreferences["sort"]; label: string }[] = [
  { key: "title", label: "Title" },
  { key: "played", label: "Recently played" },
  { key: "most", label: "Most played" },
  { key: "added", label: "Recently added" },
  { key: "rating", label: "Your rating" },
  { key: "custom", label: "Custom order" },
];

/** Arcade's status and games, kept fresh by the core's events (scans, covers, games starting and ending). */
export function useArcade() {
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: ["arcade-status"], queryFn: api.arcadeStatus });
  const games = useQuery({ queryKey: ["arcade-games"], queryFn: api.arcadeGames });
  // A store game asked to start, until it shows up (or doesn't) (D-037).
  const [starting, setStarting] = useState<{ id: number; store: string } | null>(null);
  const [notSeen, setNotSeen] = useState<number | null>(null);
  useEffect(() => {
    const refresh = () => {
      void queryClient.invalidateQueries({ queryKey: ["arcade-status"] });
      void queryClient.invalidateQueries({ queryKey: ["arcade-games"] });
    };
    const changed = listen("arcade-changed", refresh);
    const session = listen<{ starting?: number; store?: string; running?: number | null; notSeen?: number }>("arcade-session", (event) => {
      const p = event.payload ?? {};
      if (p.starting != null) {
        setStarting({ id: p.starting, store: p.store ?? "its store" });
        setNotSeen(null);
      } else {
        setStarting(null);
        if (p.notSeen != null) setNotSeen(p.notSeen);
      }
      refresh();
    });
    return () => {
      void changed.then((off) => off());
      void session.then((off) => off());
    };
  }, [queryClient]);
  return { status, games, starting, notSeen, clearNotSeen: () => setNotSeen(null) };
}

/** The games shown, filtered, searched and sorted as the preferences say. */
export function useShownGames(games: ArcadeGame[] | undefined, search: string) {
  const { preferences } = usePreferences();
  const { sort } = preferences.arcade;
  const { current: platform } = useArcadeFilters();
  return useMemo(() => {
    const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const list = (games ?? []).filter(
      (game) =>
        !game.missing &&
        inFilter(game, platform) &&
        words.every((word) => game.title.toLowerCase().includes(word) || game.gameId?.toLowerCase() === word),
    );
    const byTitle = (a: ArcadeGame, b: ArcadeGame) => a.title.localeCompare(b.title, undefined, { sensitivity: "base", numeric: true });
    const sorters: Record<ArcadePreferences["sort"], (a: ArcadeGame, b: ArcadeGame) => number> = {
      title: byTitle,
      played: (a, b) => (b.lastPlayedAt ?? "").localeCompare(a.lastPlayedAt ?? "") || byTitle(a, b),
      most: (a, b) => b.playSeconds - a.playSeconds || byTitle(a, b),
      rating: (a, b) => (b.rating ?? 0) - (a.rating ?? 0) || byTitle(a, b),
      added: (a, b) => b.addedAt.localeCompare(a.addedAt) || b.id - a.id,
      // Placed games first, in their places; the rest after, by title (D-035).
      custom: (a, b) => (a.position ?? Infinity) - (b.position ?? Infinity) || byTitle(a, b),
    };
    return [...list].sort(sorters[sort]);
  }, [games, platform, sort, search]);
}

/** Arcade's games that match a search (D-105): every word in the title, the console, the store or the game's ID. */
export function matchingGames(games: ArcadeGame[] | undefined, q: string): ArcadeGame[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return (games ?? [])
    .filter((game) => !game.missing)
    .filter((game) => {
      const text = `${game.title} ${consoleOf(game)} ${game.store ? STORE_NAMES[game.store] : ""} ${game.gameId ?? ""}`.toLowerCase();
      return words.every((word) => text.includes(word));
    })
    .sort((a, b) => Number(!a.title.toLowerCase().includes(words[0])) - Number(!b.title.toLowerCase().includes(words[0])) || a.title.localeCompare(b.title, undefined, { sensitivity: "base", numeric: true }));
}

/**
 * Adds a PC game by its program (D-107): asks for the program, adds it, and gives its id (null when
 * nothing was chosen). From Arcade, Emulators & folders and Home's Add menu (D-124).
 */
export async function addProgramGame(downloadCovers: boolean): Promise<number | null> {
  const path = await openDialog({ multiple: false, title: "Choose the game's program", filters: onLinux ? undefined : [{ name: "Programs", extensions: ["exe"] }] });
  if (typeof path !== "string") return null;
  return api.arcadeAddProgram(path, downloadCovers);
}

/** Starting a game, with its error (a missing emulator, a moved file) kept to show. */
export function useLaunch() {
  const { preferences } = usePreferences();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const launch = async (game: ArcadeGame) => {
    setError(null);
    try {
      await api.arcadeLaunch(game.id, preferences.arcade.whilePlaying, preferences.arcade.playsIn);
      void queryClient.invalidateQueries({ queryKey: ["arcade-status"] });
    } catch (reason) {
      setError(errorText(reason));
    }
  };
  return { launch, error, clearError: () => setError(null) };
}

/** "3 h 20 min", "12 min", "under a minute". */
export function playTime(seconds: number): string {
  if (seconds < 60) return seconds > 0 ? "under a minute" : "not played yet";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return hours > 0 ? `${hours} h${minutes ? ` ${minutes} min` : ""}` : `${minutes} min`;
}

export function lastPlayed(at: string | null): string | null {
  if (!at) return null;
  const date = new Date(at);
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return date.toLocaleDateString(undefined, { dateStyle: "medium" });
}

/** A game's box art, or a drawn box with its title and console when it has none. */
export function GameCover({ game, size = "thumb" }: { game: ArcadeGame; size?: "thumb" | "cover" }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [game.coverKey]);
  if (game.coverKey && !failed) {
    return <img className="arcade-cover-img" src={artworkUrl(game.coverKey, size)} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setFailed(true)} />;
  }
  return (
    <span className="arcade-cover-blank" data-platform={game.platform} data-store={game.store ?? undefined}>
      <span className="arcade-cover-console">{consoleOf(game)}</span>
      <span className="arcade-cover-title">{game.title}</span>
    </span>
  );
}

/**
 * Moves a game within the games shown (one console, a search) and gives back the whole custom
 * order: the shown games trade places among themselves, the others keep theirs (D-037).
 */
export function reorderWithin(all: ArcadeGame[], shown: ArcadeGame[], dragged: number, target: number, after: boolean): number[] {
  const byCustom = [...all].sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity) || a.title.localeCompare(b.title, undefined, { sensitivity: "base", numeric: true }));
  const shownIds = new Set(shown.map((g) => g.id));
  const subset = shown.map((g) => g.id).filter((id) => id !== dragged);
  const at = subset.indexOf(target);
  if (at < 0) return byCustom.map((g) => g.id);
  subset.splice(after ? at + 1 : at, 0, dragged);
  // The shown games go back into the places shown games had, in their new order.
  let next = 0;
  return byCustom.map((g) => (shownIds.has(g.id) ? subset[next++] : g.id));
}

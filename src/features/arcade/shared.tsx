import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { api, artworkUrl, errorText, onLinux, type ArcadeGame, type ArcadePlatform, type ArcadeStore } from "../../lib/api";
import { usePreferences, type ArcadeFilter, type ArcadePreferences } from "../../lib/preferences";

export const PLATFORM_NAMES: Record<ArcadePlatform, string> = { gamecube: "GameCube", wii: "Wii", n64: "Nintendo 64", pc: "PC" };
export const PLATFORM_SHORT: Record<ArcadePlatform, string> = { gamecube: "GC", wii: "Wii", n64: "N64", pc: "PC" };
export const STORE_NAMES: Record<ArcadeStore, string> = { steam: "Steam", epic: "Epic Games", xbox: "Xbox", heroic: "Heroic" };

/** Box art proportions: GameCube and Wii cases are tall; Nintendo 64 boxes are wide; PC capsules 2:3. */
export const PLATFORM_ASPECT: Record<ArcadePlatform, number> = { gamecube: 0.71, wii: 0.71, n64: 1.38, pc: 0.667 };

/** A game's console, or for a PC game its store ("Steam"). */
export function consoleOf(game: ArcadeGame): string {
  return game.platform === "pc" && game.store ? STORE_NAMES[game.store] : PLATFORM_NAMES[game.platform];
}

/** The short badge on a game's box. */
export function badgeOf(game: ArcadeGame): string {
  return game.platform === "pc" && game.store ? (game.store === "epic" ? "Epic" : STORE_NAMES[game.store]) : PLATFORM_SHORT[game.platform];
}

/** Arcade's views (D-038), with what each one holds. */
export const FILTER_LABELS: Record<ArcadeFilter, string> = {
  all: "All games",
  "all-pc": "All PC games",
  "all-roms": "All ROM games",
  steam: "Steam",
  epic: "Epic Games",
  xbox: "Xbox",
  heroic: "Heroic",
  wii: "Wii",
  gamecube: "GameCube",
  n64: "Nintendo 64",
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
    case "steam":
    case "epic":
    case "xbox":
    case "heroic":
      return game.store === filter;
    case "favorites":
      return game.isFavorite;
    default:
      return game.platform === filter;
  }
}

/** Whether a view exists on this system (Epic and Xbox are Windows-only; Heroic is for Linux). */
export function filterAvailable(filter: ArcadeFilter): boolean {
  if (filter === "epic" || filter === "xbox") return !onLinux;
  if (filter === "heroic") return onLinux;
  return true;
}

/** The views in their order: on this system, hidden ones left out, PC and ROM combined if asked. */
export function arcadeFilters(arcade: ArcadePreferences, withHidden = false): ArcadeFilter[] {
  const out: ArcadeFilter[] = [];
  for (const filter of arcade.filterOrder) {
    if (!filterAvailable(filter)) continue;
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
  const filters = arcadeFilters(preferences.arcade);
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

/** Starting a game, with its error (a missing emulator, a moved file) kept to show. */
export function useLaunch() {
  const { preferences } = usePreferences();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const launch = async (game: ArcadeGame) => {
    setError(null);
    try {
      await api.arcadeLaunch(game.id, preferences.arcade.n64, preferences.arcade.whilePlaying);
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

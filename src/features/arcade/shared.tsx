import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { api, artworkUrl, errorText, type ArcadeGame, type ArcadePlatform } from "../../lib/api";
import { usePreferences, type ArcadePreferences } from "../../lib/preferences";

export const PLATFORM_NAMES: Record<ArcadePlatform, string> = { gamecube: "GameCube", wii: "Wii", n64: "Nintendo 64" };
export const PLATFORM_SHORT: Record<ArcadePlatform, string> = { gamecube: "GC", wii: "Wii", n64: "N64" };

/** Box art proportions: GameCube and Wii cases are tall; Nintendo 64 boxes are wide. */
export const PLATFORM_ASPECT: Record<ArcadePlatform, number> = { gamecube: 0.71, wii: 0.71, n64: 1.38 };

export const PLATFORM_FILTERS: { key: ArcadePreferences["platform"]; label: string }[] = [
  { key: "all", label: "All games" },
  { key: "gamecube", label: "GameCube" },
  { key: "wii", label: "Wii" },
  { key: "n64", label: "Nintendo 64" },
  { key: "favorites", label: "Favorites" },
];

export const SORTS: { key: ArcadePreferences["sort"]; label: string }[] = [
  { key: "title", label: "Title" },
  { key: "played", label: "Recently played" },
  { key: "most", label: "Most played" },
  { key: "added", label: "Recently added" },
  { key: "custom", label: "Custom order" },
];

/** Arcade's status and games, kept fresh by the core's events (scans, covers, games starting and ending). */
export function useArcade() {
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: ["arcade-status"], queryFn: api.arcadeStatus });
  const games = useQuery({ queryKey: ["arcade-games"], queryFn: api.arcadeGames });
  useEffect(() => {
    const refresh = () => {
      void queryClient.invalidateQueries({ queryKey: ["arcade-status"] });
      void queryClient.invalidateQueries({ queryKey: ["arcade-games"] });
    };
    const changed = listen("arcade-changed", refresh);
    const session = listen("arcade-session", refresh);
    return () => {
      void changed.then((off) => off());
      void session.then((off) => off());
    };
  }, [queryClient]);
  return { status, games };
}

/** The games shown, filtered, searched and sorted as the preferences say. */
export function useShownGames(games: ArcadeGame[] | undefined, search: string) {
  const { preferences } = usePreferences();
  const { platform, sort } = preferences.arcade;
  return useMemo(() => {
    const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const list = (games ?? []).filter(
      (game) =>
        !game.missing &&
        (platform === "all" || (platform === "favorites" ? game.isFavorite : game.platform === platform)) &&
        words.every((word) => game.title.toLowerCase().includes(word) || game.gameId?.toLowerCase() === word),
    );
    const byTitle = (a: ArcadeGame, b: ArcadeGame) => a.title.localeCompare(b.title, undefined, { sensitivity: "base", numeric: true });
    const sorters: Record<ArcadePreferences["sort"], (a: ArcadeGame, b: ArcadeGame) => number> = {
      title: byTitle,
      played: (a, b) => (b.lastPlayedAt ?? "").localeCompare(a.lastPlayedAt ?? "") || byTitle(a, b),
      most: (a, b) => b.playSeconds - a.playSeconds || byTitle(a, b),
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
      await api.arcadeLaunch(game.id, preferences.arcade.n64);
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
    <span className="arcade-cover-blank" data-platform={game.platform}>
      <span className="arcade-cover-console">{PLATFORM_NAMES[game.platform]}</span>
      <span className="arcade-cover-title">{game.title}</span>
    </span>
  );
}

import { useSharpArtwork, coverViewOf, framedStyle } from "../../components/common";
import { pickPrograms } from "./ProgramPicker";
import { useEffect, useMemo, useState } from "react";
import { BadgeCheck, Heart } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { api, ARCADE_CONSOLES, errorText, onLinux, type ArcadeConsole, type ArcadeGame, type ArcadePlatform, type ArcadeScanReport, type ArcadeStatus, type ArcadeStore } from "../../lib/api";
import { plural } from "../../lib/format";
import { usePreferences, type ArcadeFilter, type ArcadePreferences } from "../../lib/preferences";
import { hasPlatformLogo, PlatformLogo } from "./logos";

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
  minecraft: "Minecraft",
  itch: "itch.io",
  heroic: "Heroic",
  lutris: "Lutris",
};

/** Box art proportions: disc cases are tall, Nintendo 64 and Super Nintendo boxes wide, PlayStation's
 *  jewel cases and handheld boxes about square, PC capsules 2:3. */
/** The shape of a store's own cover art (D-149): Steam's library capsules are 600 × 900, Epic's
 *  (and Heroic's) 3 : 4, GOG's vertical covers 342 × 482; the others as Steam's. */
// Epic's (and Heroic's) games have the same box as Steam's and the other PC games' (D-184), their
// launcher's taller art filling it.
const STORE_ASPECT: Partial<Record<ArcadeStore, number>> = { gog: 0.71 };

/** A game's box shape: its store's cover for a PC game, its console's box for the others. */
export function gameAspect(game: Pick<ArcadeGame, "platform" | "store">): number {
  return game.platform === "pc" ? (game.store && STORE_ASPECT[game.store]) || PLATFORM_ASPECT.pc : PLATFORM_ASPECT[game.platform];
}

// Each console's box art shape (width ÷ height), measured on libretro-thumbnails' US boxes (D-148).
export const PLATFORM_ASPECT: Record<ArcadePlatform, number> = {
  gamecube: 0.71,
  wii: 0.71,
  n64: 1.38,
  ps1: 1,
  ps2: 0.71,
  ps3: 0.86,
  ds: 1.12,
  nes: 0.7,
  snes: 1.41,
  gb: 1,
  gbc: 1,
  gba: 1,
  "3ds": 1.13,
  sms: 0.71,
  genesis: 0.7,
  segacd: 0.6,
  gamegear: 0.71,
  saturn: 0.63,
  dreamcast: 1,
  psp: 0.58,
  pce: 1,
  wiiu: 0.71,
  switch: 0.62,
  ogxbox: 0.71,
  x360: 0.71,
  arcade: 0.75,
  atari2600: 0.73,
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

/** A game's badge on its box, as Settings › Arcade says (D-148): its console's or store's logo and
 *  name, the logo alone (the name where there's no logo), or none. */
export function GameBadge({ game }: { game: ArcadeGame }) {
  const { preferences } = usePreferences();
  const style = preferences.arcade.badge;
  if (style === "none") return null;
  const logoOnly = style === "logo" && hasPlatformLogo(game);
  return (
    <span className={`arcade-badge${logoOnly ? " logo-only" : ""}`} data-platform={game.platform} data-store={game.store ?? undefined} title={logoOnly ? badgeOf(game) : undefined}>
      <PlatformLogo game={game} />
      {logoOnly ? <span className="sr-only">{badgeOf(game)}</span> : badgeOf(game)}
    </span>
  );
}

/** A game's marks on its box (D-166, D-169): completed and favorite, two round badges at the bottom
 *  right; bigger in Big Picture. One drawing for Arcade, Home and Big Picture. */
export function GameMarks({ game, big = false }: { game: Pick<ArcadeGame, "completedAt" | "isFavorite">; big?: boolean }) {
  return (
    <>
      {game.completedAt && (
        <span className="arcade-completed" title="Completed">
          <BadgeCheck size={big ? 19 : 15} strokeWidth={2.4} aria-label="Completed" />
        </span>
      )}
      {game.isFavorite && (
        <span className="arcade-fav" title="Favorite">
          <Heart size={big ? 17 : 13} fill="currentColor" strokeWidth={2.4} aria-label="Favorite" />
        </span>
      )}
    </>
  );
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
  minecraft: "Minecraft",
  itch: "itch.io",
  heroic: "Heroic",
  lutris: "Lutris",
  // PC games added by their program (D-115).
  others: "Other PC",
  ...(Object.fromEntries(ARCADE_CONSOLES.map((key) => [key, PLATFORM_NAMES[key]])) as Record<ArcadeConsole, string>),
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
    // Minecraft's games are Xbox games too (D-154); Linux has no Xbox view, so there they keep their own.
    case "xbox":
      return game.store === "xbox" || (game.store === "minecraft" && !onLinux);
    case "steam":
    case "epic":
    case "gog":
    case "ubisoft":
    case "ea":
    case "battlenet":
    case "rockstar":
    case "riot":
    case "amazon":
    case "minecraft":
    case "itch":
    case "heroic":
    case "lutris":
      return game.store === filter;
    default:
      return game.platform === filter;
  }
}

/** Whether a view exists on this system (Epic and Xbox are Windows-only; Heroic is for Linux). */
export function filterAvailable(filter: ArcadeFilter): boolean {
  if (["epic", "xbox", "gog", "ubisoft", "ea", "battlenet", "rockstar", "riot", "amazon"].includes(filter)) return !onLinux;
  if (filter === "heroic" || filter === "lutris" || filter === "minecraft") return onLinux;
  return true;
}

/** Views that are always there; a store's or console's view shows only once it has a game (D-101). */
const ALWAYS: ArcadeFilter[] = ["all", "all-pc", "all-roms"];

/** The store and console views that have at least one game; `null` while games are loading. */
export function filledFilters(games: ArcadeGame[] | undefined): Set<ArcadeFilter> | null {
  if (!games) return null;
  const filled = new Set<ArcadeFilter>();
  for (const game of games) {
    if (game.missing) continue;
    filled.add(game.platform === "pc" ? (game.store === "minecraft" && !onLinux ? "xbox" : (game.store ?? "others")) : game.platform);
  }
  return filled;
}

/**
 * Steam's hours by themselves (D-183): with the option on (Emulators & folders › Launchers › Steam,
 * the default), the time Steam records comes in a moment after Digitify opens and every ten minutes
 * after, the same way "Use Steam's hours" brings it in by hand (only ever up to Steam's total).
 */
export function SteamHoursAuto() {
  const { preferences } = usePreferences();
  const queryClient = useQueryClient();
  const on = preferences.arcade.steamHoursAuto;
  useEffect(() => {
    if (!on) return;
    const bring = () =>
      void api
        .arcadeSteamHoursApply()
        .then((changed) => {
          if (changed > 0) {
            void queryClient.invalidateQueries({ queryKey: ["arcade-games"] });
            void queryClient.invalidateQueries({ queryKey: ["arcade-steam-hours"] });
            void queryClient.invalidateQueries({ queryKey: ["stats"] });
          }
        })
        .catch(() => {});
    const first = window.setTimeout(bring, 15_000);
    const every = window.setInterval(bring, 10 * 60_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(every);
    };
  }, [on, queryClient]);
  return null;
}

/** The views in their order: on this system, hidden ones left out, PC and ROM combined if asked,
 *  and (given `filled`) only the store and console views with games. */
export function arcadeFilters(arcade: ArcadePreferences, withHidden = false, filled: Set<ArcadeFilter> | null = null): ArcadeFilter[] {
  const out: ArcadeFilter[] = [];
  // All games stands in for PC games and ROM games (D-183): one or the other two, never all three.
  const allGames = !arcade.hiddenFilters.includes("all");
  for (const filter of arcade.filterOrder) {
    if (!filterAvailable(filter)) continue;
    if (filter === "all" && !allGames) continue;
    if ((filter === "all-pc" || filter === "all-roms") && allGames) continue;
    if (filled && !arcade.showEmptyViews && !ALWAYS.includes(filter) && !filled.has(filter)) continue;
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

// Title first, and the default (D-170).
export const SORTS: { key: ArcadePreferences["sort"]; label: string }[] = [
  { key: "title", label: "Title" },
  { key: "played", label: "Recently played" },
  { key: "most", label: "Most played" },
  { key: "added", label: "Recently added" },
  { key: "rating", label: "Your rating" },
  { key: "console", label: "Console" },
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

/** The view a game belongs to: its store's (Others for a program added by hand) or its console's. */
export function consoleKey(game: Pick<ArcadeGame, "platform" | "store">): ArcadeFilter {
  return game.platform === "pc" ? (game.store ?? "others") : game.platform;
}

/** The games shown, filtered, searched and sorted as the preferences say; `scope` (a collection's,
 *  D-148) takes the place of the console view. */
export function useShownGames(games: ArcadeGame[] | undefined, search: string, scope: ((game: ArcadeGame) => boolean) | null = null) {
  const { preferences } = usePreferences();
  const { sort, filterOrder } = preferences.arcade;
  const { current: platform } = useArcadeFilters();
  return useMemo(() => {
    const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const list = (games ?? []).filter(
      (game) =>
        !game.missing &&
        (scope ? scope(game) : inFilter(game, platform)) &&
        // Its own keywords count as its name (D-160).
        words.every((word) => game.title.toLowerCase().includes(word) || game.gameId?.toLowerCase() === word || game.keywords.some((k) => k.toLowerCase().includes(word))),
    );
    const byTitle = (a: ArcadeGame, b: ArcadeGame) => a.title.localeCompare(b.title, undefined, { sensitivity: "base", numeric: true });
    const place = (game: ArcadeGame) => {
      const at = filterOrder.indexOf(consoleKey(game));
      return at < 0 ? filterOrder.length : at;
    };
    const sorters: Record<ArcadePreferences["sort"], (a: ArcadeGame, b: ArcadeGame) => number> = {
      title: byTitle,
      played: (a, b) => (b.lastPlayedAt ?? "").localeCompare(a.lastPlayedAt ?? "") || byTitle(a, b),
      most: (a, b) => b.playSeconds - a.playSeconds || byTitle(a, b),
      rating: (a, b) => (b.rating ?? 0) - (a.rating ?? 0) || byTitle(a, b),
      // In the views' order (Settings › Arcade), then by title (D-149).
      console: (a, b) => place(a) - place(b) || byTitle(a, b),
      added: (a, b) => b.addedAt.localeCompare(a.addedAt) || b.id - a.id,
      // Placed games first, in their places; the rest after, by title (D-035).
      custom: (a, b) => (a.position ?? Infinity) - (b.position ?? Infinity) || byTitle(a, b),
    };
    return [...list].sort(sorters[sort]);
  }, [games, platform, sort, search, scope, filterOrder]);
}

/** Arcade's games that match a search (D-105): every word in the title, the console, the store or the game's ID. */
export function matchingGames(games: ArcadeGame[] | undefined, q: string): ArcadeGame[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return (games ?? [])
    .filter((game) => !game.missing)
    .filter((game) => {
      const text = `${game.title} ${consoleOf(game)} ${game.store ? STORE_NAMES[game.store] : ""} ${game.gameId ?? ""} ${game.keywords.join(" ")}`.toLowerCase();
      return words.every((word) => text.includes(word));
    })
    .sort((a, b) => Number(!a.title.toLowerCase().includes(words[0])) - Number(!b.title.toLowerCase().includes(words[0])) || a.title.localeCompare(b.title, undefined, { sensitivity: "base", numeric: true }));
}

/**
 * Adds a PC game by its program (D-107): asks for the program, adds it, and gives its id (null when
 * nothing was chosen). From Arcade, Emulators & folders and Home's Add menu (D-124).
 */
/** Adds games by their program (D-183): the list of programs on this computer to pick from, or Browse…; the first added. */
export async function addProgramGame(downloadCovers: boolean): Promise<number | null> {
  return pickPrograms(downloadCovers);
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

/**
 * A game's box art, or a drawn box with its title and console when it has none. A cover of another
 * shape than its console's box (another region's, a store's square art) shows whole, over a blur of
 * itself, never cut (D-148); `fill` covers the space anyway (a collage, a backdrop).
 */
export function GameCover({ game, size = "thumb", fill = false }: { game: ArcadeGame; size?: "thumb" | "cover"; fill?: boolean }) {
  const [failed, setFailed] = useState(false);
  const [whole, setWhole] = useState(false);
  // Sharp at any size (D-183): the full-size art once the cover is drawn bigger than the small copy.
  const sharp = useSharpArtwork(game.coverKey, size);
  useEffect(() => {
    setFailed(false);
    setWhole(false);
  }, [game.coverKey]);
  if (game.coverKey && !failed) {
    const src = sharp.src!;
    // Framed as adjusted (D-184): filling the box, zoomed and moved as chosen.
    const view = coverViewOf(game);
    if (view) {
      return (
        <span className="arcade-cover-img cover-view">
          <img ref={sharp.ref} src={src} alt="" decoding="async" draggable={false} style={framedStyle(view)} onError={() => setFailed(true)} />
        </span>
      );
    }
    if (whole) {
      return (
        <span className="arcade-cover-whole">
          <img className="arcade-cover-back" src={src} alt="" aria-hidden draggable={false} />
          <img ref={sharp.ref} className="arcade-cover-img" src={src} alt="" decoding="async" draggable={false} onError={() => setFailed(true)} />
        </span>
      );
    }
    const measure = (event: React.SyntheticEvent<HTMLImageElement>) => {
      // The launcher's own art fills the box, as Steam's does, never shown whole with bands (D-184).
      if (fill || game.store === "epic" || game.store === "heroic") return;
      const { naturalWidth: width, naturalHeight: height } = event.currentTarget;
      if (width > 0 && height > 0) setWhole(Math.abs(width / height / gameAspect(game) - 1) > 0.06);
    };
    return <img ref={sharp.ref} className="arcade-cover-img" src={src} alt="" loading="lazy" decoding="async" draggable={false} onLoad={measure} onError={() => setFailed(true)} />;
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

/** What can be done to several selected games at once. */
/**
 * Keywords for the selected games at once (D-162): one added to all of them, or one they have taken
 * out of all of them; each game keeps its other keywords.
 */
/** What a search for games found: "153 games found · 2 new · looking for 4 covers". */
export function scanSummary(report: ArcadeScanReport): string {
  const parts = [`${plural(report.found, "game")} found`];
  if (report.added) parts.push(`${report.added} new`);
  if (report.missing) parts.push(`${report.missing} missing`);
  if (report.coversQueued) parts.push(`looking for ${plural(report.coversQueued, "cover")}`);
  return parts.join(" · ");
}

/** "A, B or C" / "A, B and C". */
export function listOf(names: string[], joiner: "and" | "or"): string {
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} ${joiner} ${names.at(-1)}` : (names[0] ?? "");
}

/** The emulator a game starts in (D-111): RetroArch for its playlists' games, else the one chosen
 *  for its console if it's found, else the first found in Arcade's order. */
export function playsIn(game: ArcadeGame, arcade: ArcadePreferences, status: ArcadeStatus | undefined): string {
  if (game.retroarch) return "RetroArch";
  const players = status?.consoles.find((c) => c.key === game.platform)?.players ?? [];
  const found = players.filter((key) => status?.emulators.find((e) => e.key === key)?.found);
  // Its own emulator first (D-148).
  if (game.emulator) return status?.emulators.find((e) => e.key === game.emulator)?.name ?? game.emulator;
  const chosen = arcade.playsIn[game.platform as ArcadeConsole];
  const key = chosen && found.includes(chosen) ? chosen : (found[0] ?? players[0]);
  return status?.emulators.find((e) => e.key === key)?.name ?? "its emulator";
}

/** Each maker's consoles, in their order: the views' menus and Emulators & folders › Consoles group by them. */
export const CONSOLE_MAKERS: [string, readonly string[]][] = [
  ["Nintendo", ["wii", "wiiu", "gamecube", "n64", "switch", "ds", "3ds", "nes", "snes", "gb", "gbc", "gba"]],
  ["PlayStation", ["ps1", "ps2", "ps3", "psp"]],
  ["Sega", ["sms", "genesis", "segacd", "gamegear", "saturn", "dreamcast"]],
  ["Xbox consoles", ["ogxbox", "x360"]],
  ["More consoles", ["pce", "arcade", "atari2600", "other"]],
];

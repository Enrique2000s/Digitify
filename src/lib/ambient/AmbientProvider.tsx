import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ambientUrl, api, errorText, type MusicSource } from "../api";
import { usePreferences, type MenuMusic, type MusicPreferences } from "../preferences";
import { ambientEngine, type ChannelId, type ChannelSpec, type PieceName } from "./engine";

export interface PlaylistInfo {
  loading: boolean;
  tracks: number;
  unavailable: number;
  truncated: boolean;
  error: string | null;
}

/** The menus with music of their own (D-174). */
export type MenuId = Exclude<ChannelId, "main">;

interface AmbientContext {
  music: MusicPreferences;
  updateMusic: (change: Partial<MusicPreferences>) => void;
  /** Changes Settings' or Big Picture's own music (D-174). */
  updateMenuMusic: (menu: MenuId, change: Partial<MenuMusic>) => void;
  /** Each channel's playlist of the user's music, as the core resolved it. */
  playlists: Record<ChannelId, PlaylistInfo>;
  interfaceSounds: boolean;
  setInterfaceSounds: (on: boolean) => void;
  /** Music is running right now (not paused, held or out of tracks). It may be muted. */
  playing: boolean;
  title: string;
  status: string;
  /** The user's music is playing, so there is a next track to skip to. */
  canSkip: boolean;
  skip: () => void;
  playlist: PlaylistInfo;
  /** Pauses the music until the returned release is called (e.g. while a video plays). */
  hold: (reason: "video" | "media" | "reading" | "game" | "hidden") => () => void;
  /** A game from Arcade is running (D-041). */
  inGame: boolean;
  /** The menu music is silent for the game; it can be switched back on while the game runs. */
  gameSilenced: boolean;
  setGameSilenced: (silenced: boolean) => void;
  /** Arcade's session: `true` when a game starts (silencing the music), `false` when it ends. */
  setInGame: (running: boolean) => void;
  /** Menu music on or off, as Home's music button shows and switches it: during a game, only for
   *  the game; otherwise the saved preference. */
  musicOn: boolean;
  toggleMusic: () => void;
}

const Context = createContext<AmbientContext | null>(null);

const NO_PLAYLIST: PlaylistInfo = { loading: false, tracks: 0, unavailable: 0, truncated: false, error: null };

/** Each Digitify theme's name, as the music capsule shows it. */
const THEME_TITLES: Record<PieceName, string> = {
  lounge: "Digitify Main Menu Music",
  settings: "Digitify Settings Music",
  bigpicture: "Digitify Big Picture Music",
};

/** The menu a screen belongs to, by its path: Settings, Big Picture, or the rest. */
function menuOf(path: string): ChannelId {
  if (path === "/settings" || path.startsWith("/settings/")) return "settings";
  if (path === "/bp" || path.startsWith("/bp/")) return "bigpicture";
  return "main";
}

/**
 * The menu the window is in, from the router itself: moving between screens pushes history
 * entries, which fire no hashchange or popstate event, so the address alone isn't watched.
 */
function useMenu(): ChannelId {
  return useRouterState({ select: (state) => menuOf(state.location.pathname) });
}

/**
 * The user's music of one channel: the core resolves its files, folders and albums into a playlist
 * of its own (D-174: the main menu's, Settings' and Big Picture's don't replace each other).
 */
function useChannelPlaylist(id: ChannelId, wanted: boolean, sources: MusicSource[], shuffle: boolean): PlaylistInfo {
  const [playlist, setPlaylist] = useState<PlaylistInfo>(NO_PLAYLIST);
  const key = JSON.stringify(sources);
  useEffect(() => {
    if (!wanted) return;
    let alive = true;
    setPlaylist((current) => ({ ...current, loading: true, error: null }));
    api.ambientPlaylist(JSON.parse(key) as MusicSource[], id).then(
      (result) => {
        if (!alive) return;
        ambientEngine.setPlaylist(
          id,
          result.tracks.map((track) => ({ ...track, generation: result.generation, url: ambientUrl(result.generation, track.id) })),
        );
        setPlaylist({ loading: false, tracks: result.tracks.length, unavailable: result.unavailable, truncated: result.truncated, error: null });
      },
      (reason) => alive && setPlaylist({ ...NO_PLAYLIST, error: errorText(reason) }),
    );
    return () => {
      alive = false;
    };
  }, [id, wanted, key]);
  useEffect(() => ambientEngine.setShuffle(id, shuffle), [id, shuffle]);
  return playlist;
}

const HOVER_TARGETS = "[data-blip]";
const PRESS_TARGETS =
  'button, a[href], summary, select, input[type="checkbox"], input[type="radio"], [role="button"], [role="menuitem"], ' +
  '[role="menuitemradio"], [role="menuitemcheckbox"], [role="switch"], [role="tab"], [role="option"]';

/** A soft rising blip when pointing at tiles and covers, and a rounder pop when pressing anything. */
function useInterfaceSounds(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    let current: Element | null = null;
    let last = 0;
    const over = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      const target = event.target instanceof Element ? event.target.closest(HOVER_TARGETS) : null;
      if (target === current) return;
      current = target;
      const now = performance.now();
      if (!target || now - last < 70) return;
      last = now;
      ambientEngine.uiSound("hover");
    };
    const press = (element: Element | null) => {
      const target = element?.closest(PRESS_TARGETS);
      if (!target || target.matches(":disabled, [aria-disabled='true'], [data-disabled]")) return;
      ambientEngine.uiSound("press");
    };
    const down = (event: PointerEvent) => {
      if (event.button === 0 && event.target instanceof Element) press(event.target);
    };
    const key = (event: KeyboardEvent) => {
      if ((event.key === "Enter" || event.key === " ") && !event.repeat) press(document.activeElement);
    };
    document.addEventListener("pointerover", over);
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("pointerover", over);
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("keydown", key, true);
    };
  }, [enabled]);
}

/**
 * True while the window is minimized. WebView2 keeps `document.hidden` false then, so this asks the
 * window on resize and focus changes, and keeps asking while minimized in case an event is missed.
 */
function useMinimized(): boolean {
  const [minimized, setMinimized] = useState(false);
  useEffect(() => {
    const appWindow = getCurrentWindow();
    let alive = true;
    const check = () => {
      appWindow.isMinimized().then(
        (value) => alive && setMinimized(value),
        () => {},
      );
    };
    const listeners = [appWindow.onResized(check), appWindow.onFocusChanged(check)];
    return () => {
      alive = false;
      for (const unlisten of listeners) void unlisten.then((stop) => stop());
    };
  }, []);
  useEffect(() => {
    if (!minimized) return;
    const appWindow = getCurrentWindow();
    const timer = window.setInterval(() => {
      appWindow.isMinimized().then(
        (value) => !value && setMinimized(false),
        () => {},
      );
    }, 1500);
    return () => window.clearInterval(timer);
  }, [minimized]);
  return minimized;
}

/** Ambient music and interface sounds (decision D-016), for the whole window. */
export function AmbientProvider({ children }: { children: ReactNode }) {
  const { preferences, update } = usePreferences();
  const { music, interfaceSounds } = preferences;
  const [holds, setHolds] = useState<ReadonlyMap<symbol, string>>(new Map());
  // null: no game running; otherwise whether the music is silent for it (D-041).
  const [game, setGame] = useState<{ silenced: boolean } | null>(null);
  const minimized = useMinimized();
  const engine = useSyncExternalStore(ambientEngine.subscribe, ambientEngine.getState);
  const menu = useMenu();
  const play = music.enabled && holds.size === 0 && !game?.silenced && !(minimized && music.pauseWhenMinimized);
  useInterfaceSounds(interfaceSounds);

  // What each menu plays (D-174): the main menu its theme or the user's music; Settings and Big
  // Picture their own theme, the main menu's music, or music of their own.
  const mainSpec: ChannelSpec = music.source === "custom" ? { id: "main", mode: "custom", piece: "lounge" } : { id: "main", mode: "piece", piece: "lounge" };
  const menuSpec = (id: MenuId, own: MenuMusic): ChannelSpec =>
    own.source === "main" ? mainSpec : own.source === "custom" ? { id, mode: "custom", piece: id } : { id, mode: "piece", piece: id };
  const specs: Record<ChannelId, ChannelSpec> = {
    main: mainSpec,
    settings: menuSpec("settings", music.settingsMusic),
    bigpicture: menuSpec("bigpicture", music.bigPictureMusic),
  };
  const active = specs[menu];
  const playlists: Record<ChannelId, PlaylistInfo> = {
    main: useChannelPlaylist("main", music.source === "custom", music.sources, music.shuffle),
    settings: useChannelPlaylist("settings", music.settingsMusic.source === "custom", music.settingsMusic.sources, music.settingsMusic.shuffle),
    bigpicture: useChannelPlaylist("bigpicture", music.bigPictureMusic.source === "custom", music.bigPictureMusic.sources, music.bigPictureMusic.shuffle),
  };
  const playlist = playlists[active.id];
  const custom = active.mode === "custom";
  const sources = active.id === "main" ? music.sources : active.id === "settings" ? music.settingsMusic.sources : music.bigPictureMusic.sources;

  useEffect(() => {
    ambientEngine.configure({ play, volume: music.volume, muted: music.muted, active: { id: active.id, mode: active.mode, piece: active.piece } });
  }, [play, active.id, active.mode, active.piece, music.volume, music.muted]);

  const track = custom ? engine.track : null;
  const details = useQuery({
    queryKey: ["ambient-track", track?.generation, track?.id],
    queryFn: () => api.ambientTrackInfo(track!.generation, track!.id),
    enabled: !!track,
    staleTime: Infinity,
  });

  const updateMusic = useCallback(
    (change: Partial<MusicPreferences>) => update((current) => ({ music: { ...current.music, ...change } })),
    [update],
  );
  const updateMenuMusic = useCallback(
    (which: MenuId, change: Partial<MenuMusic>) =>
      update((current) => {
        const key = which === "settings" ? "settingsMusic" : "bigPictureMusic";
        return { music: { ...current.music, [key]: { ...current.music[key], ...change } } };
      }),
    [update],
  );

  const setInterfaceSounds = useCallback(
    (on: boolean) => {
      update({ interfaceSounds: on });
      if (on) ambientEngine.uiSound("press");
    },
    [update],
  );

  const hold = useCallback((reason: string) => {
    const token = Symbol(reason);
    setHolds((current) => new Map(current).set(token, reason));
    return () =>
      setHolds((current) => {
        const next = new Map(current);
        next.delete(token);
        return next;
      });
  }, []);

  let title = THEME_TITLES[active.piece];
  let status = "Digitify original";
  if (custom) {
    title = details.data?.title ?? track?.title ?? "Your music";
    status = details.data?.artist ?? details.data?.album ?? "Your music";
  }
  if (!music.enabled) status = "Off";
  else if (game?.silenced) status = "Silent while you play";
  else if (holds.size > 0) status = "Paused while media plays";
  else if (custom && playlist.loading && !track) status = "Loading your music…";
  else if (custom && playlist.error) status = "Couldn't load your music";
  else if (custom && !playlist.loading && playlist.tracks === 0) {
    title = "Your music";
    status = sources.length ? "No playable music found" : "Choose music in Settings";
  } else if (custom && engine.failed) status = "Couldn't play your music";
  else if (!engine.unlocked) status = "Starts when you click";
  else if (music.muted || music.volume === 0) status = "Muted";

  const setInGame = useCallback((running: boolean) => setGame(running ? { silenced: true } : null), []);
  const setGameSilenced = useCallback((silenced: boolean) => setGame((current) => (current ? { silenced } : current)), []);
  const musicOn = music.enabled && !game?.silenced;
  const toggleMusic = useCallback(() => {
    if (game && music.enabled) setGame({ silenced: !game.silenced });
    else {
      update((current) => ({ music: { ...current.music, enabled: !current.music.enabled } }));
      if (game) setGame({ silenced: false });
    }
  }, [game, music.enabled, update]);

  const value = useMemo<AmbientContext>(
    () => ({
      music,
      updateMusic,
      updateMenuMusic,
      playlists,
      interfaceSounds,
      setInterfaceSounds,
      playing: engine.playing,
      title,
      status,
      canSkip: custom && engine.playing && playlist.tracks > 1,
      skip: () => ambientEngine.skip(),
      playlist,
      hold,
      inGame: game != null,
      gameSilenced: !!game?.silenced,
      setGameSilenced,
      setInGame,
      musicOn,
      toggleMusic,
    }),
    [music, updateMusic, updateMenuMusic, playlists.main, playlists.settings, playlists.bigpicture, interfaceSounds, setInterfaceSounds, engine.playing, title, status, custom, playlist, hold, game, setGameSilenced, setInGame, musicOn, toggleMusic],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useAmbient(): AmbientContext {
  const context = useContext(Context);
  if (!context) throw new Error("useAmbient must be used inside AmbientProvider");
  return context;
}

/** Pauses ambient music while the calling component is mounted and `active`. */
export function useAmbientHold(reason: "video" | "media" | "reading" | "game" | "hidden", active = true) {
  const { hold } = useAmbient();
  useEffect(() => (active ? hold(reason) : undefined), [hold, reason, active]);
}

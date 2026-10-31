import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ambientUrl, api, errorText, type MusicSource } from "../api";
import { usePreferences, type MusicPreferences } from "../preferences";
import { ambientEngine } from "./engine";

export interface PlaylistInfo {
  loading: boolean;
  tracks: number;
  unavailable: number;
  truncated: boolean;
  error: string | null;
}

interface AmbientContext {
  music: MusicPreferences;
  updateMusic: (change: Partial<MusicPreferences>) => void;
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
  hold: (reason: "video" | "media" | "reading") => () => void;
}

const Context = createContext<AmbientContext | null>(null);

const NO_PLAYLIST: PlaylistInfo = { loading: false, tracks: 0, unavailable: 0, truncated: false, error: null };

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
  const [playlist, setPlaylist] = useState<PlaylistInfo>(NO_PLAYLIST);
  const minimized = useMinimized();
  const engine = useSyncExternalStore(ambientEngine.subscribe, ambientEngine.getState);
  const custom = music.source === "custom";
  const play = music.enabled && holds.size === 0 && !(minimized && music.pauseWhenMinimized);
  useInterfaceSounds(interfaceSounds);

  // The user's music: the core resolves the chosen files, folders and albums into a playlist.
  const sourcesKey = JSON.stringify(music.sources);
  useEffect(() => {
    if (!custom) return;
    let alive = true;
    setPlaylist((current) => ({ ...current, loading: true, error: null }));
    api.ambientPlaylist(JSON.parse(sourcesKey) as MusicSource[]).then(
      (result) => {
        if (!alive) return;
        ambientEngine.setPlaylist(
          result.tracks.map((track) => ({ ...track, generation: result.generation, url: ambientUrl(result.generation, track.id) })),
        );
        setPlaylist({ loading: false, tracks: result.tracks.length, unavailable: result.unavailable, truncated: result.truncated, error: null });
      },
      (reason) => alive && setPlaylist({ ...NO_PLAYLIST, error: errorText(reason) }),
    );
    return () => {
      alive = false;
    };
  }, [custom, sourcesKey]);

  useEffect(() => ambientEngine.setShuffle(music.shuffle), [music.shuffle]);

  useEffect(() => {
    ambientEngine.configure({ play, mode: custom ? "custom" : "lounge", volume: music.volume, muted: music.muted });
  }, [play, custom, music.volume, music.muted]);

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

  let title = "Morning Lounge";
  let status = "Digitify original";
  if (custom) {
    title = details.data?.title ?? track?.title ?? "Your music";
    status = details.data?.artist ?? details.data?.album ?? "Your music";
  }
  if (!music.enabled) status = "Paused";
  else if (holds.size > 0) status = "Paused while media plays";
  else if (custom && playlist.loading && !track) status = "Loading your music…";
  else if (custom && playlist.error) status = "Couldn't load your music";
  else if (custom && !playlist.loading && playlist.tracks === 0) {
    title = "Your music";
    status = music.sources.length ? "No playable music found" : "Choose music in Settings";
  } else if (custom && engine.failed) status = "Couldn't play your music";
  else if (!engine.unlocked) status = "Starts when you click";
  else if (music.muted || music.volume === 0) status = "Muted";

  const value = useMemo<AmbientContext>(
    () => ({
      music,
      updateMusic,
      interfaceSounds,
      setInterfaceSounds,
      playing: engine.playing,
      title,
      status,
      canSkip: custom && engine.playing && playlist.tracks > 1,
      skip: () => ambientEngine.skip(),
      playlist,
      hold,
    }),
    [music, updateMusic, interfaceSounds, setInterfaceSounds, engine.playing, title, status, custom, playlist, hold],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useAmbient(): AmbientContext {
  const context = useContext(Context);
  if (!context) throw new Error("useAmbient must be used inside AmbientProvider");
  return context;
}

/** Pauses ambient music while the calling component is mounted and `active`. */
export function useAmbientHold(reason: "video" | "media" | "reading", active = true) {
  const { hold } = useAmbient();
  useEffect(() => (active ? hold(reason) : undefined), [hold, reason, active]);
}

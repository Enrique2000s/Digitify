import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { api, errorText, type QueueEntry, type Track } from "../api";
import { useAmbientHold } from "../ambient/AmbientProvider";
import { useActivity } from "../activity";
import { usePreferences } from "../preferences";

/** A message from the music player's mpv, forwarded by the core. */
interface MpvMessage {
  event?: string;
  name?: string;
  data?: unknown;
}

export type Repeat = "off" | "all" | "one";

interface Playback {
  /** mpv's playlist: the files in play order. */
  playlist: string[];
  index: number;
  paused: boolean;
  time: number;
  duration: number;
  volume: number;
  muted: boolean;
  repeat: Repeat;
  idle: boolean;
}

const IDLE: Playback = { playlist: [], index: -1, paused: true, time: 0, duration: 0, volume: 100, muted: false, repeat: "off", idle: true };

export interface MusicContext extends Playback {
  /** The queue in play order, as library tracks. */
  queue: Track[];
  current: Track | null;
  /** Something is queued: the title-bar capsule is the mini-player (D-020). */
  active: boolean;
  shuffled: boolean;
  error: string | null;
  play: (tracks: number[], start?: number) => Promise<void>;
  enqueue: (tracks: number[], next: boolean) => Promise<void>;
  toggle: () => void;
  pause: () => void;
  next: () => void;
  previous: () => void;
  seek: (seconds: number) => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  cycleRepeat: () => void;
  toggleShuffle: () => void;
  jump: (index: number) => void;
  remove: (index: number) => void;
  stop: () => void;
  /** Keeps a track's details (favorite, title) current after an edit. */
  updateTrack: (track: Track) => void;
}

const Context = createContext<MusicContext | null>(null);

const command = (args: unknown[]) => void api.musicCommand(args).catch(() => {});

function apply(state: Playback, name: string, data: unknown): Playback {
  switch (name) {
    case "pause":
      return { ...state, paused: data === true };
    case "time-pos":
      return typeof data === "number" ? { ...state, time: data } : state;
    case "duration":
      return typeof data === "number" ? { ...state, duration: data } : state;
    case "playlist-pos":
      return typeof data === "number" ? { ...state, index: data } : state;
    case "playlist":
      return Array.isArray(data) ? { ...state, playlist: (data as { filename: string }[]).map((entry) => entry.filename) } : state;
    case "volume":
      return typeof data === "number" ? { ...state, volume: data } : state;
    case "mute":
      return { ...state, muted: data === true };
    case "loop-file":
      return data === "inf" || data === true ? { ...state, repeat: "one" } : state.repeat === "one" ? { ...state, repeat: "off" } : state;
    case "loop-playlist":
      return data === "inf" || data === true ? { ...state, repeat: state.repeat === "one" ? "one" : "all" } : state.repeat === "all" ? { ...state, repeat: "off" } : state;
    case "idle-active":
      return { ...state, idle: data === true };
    default:
      return state;
  }
}

/** Library music (D-020): the queue, what's playing, and the controls, for every screen. */
export function MusicProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { preferences, update } = usePreferences();
  const startVolume = useRef(preferences.volumes.music);
  startVolume.current = preferences.volumes.music;
  const [playback, setPlayback] = useState<Playback>(IDLE);
  const [tracks, setTracks] = useState<Map<string, Track>>(new Map());
  const [shuffled, setShuffled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(playback);
  latest.current = playback;

  useEffect(() => {
    const unlisten = listen<MpvMessage>("music-event", ({ payload }) => {
      if (payload.event === "property-change" && payload.name) {
        const name = payload.name;
        setPlayback((state) => apply(state, name, payload.data));
      } else if (payload.event === "closed") {
        setPlayback(IDLE);
      }
    });
    return () => void unlisten.then((stop) => stop());
  }, []);

  const remember = (entries: QueueEntry[]) =>
    setTracks((current) => {
      const next = new Map(current);
      for (const entry of entries) next.set(entry.path, entry.track);
      return next;
    });

  // The volume is remembered for next time (mpv starts at it).
  useEffect(() => {
    if (playback.idle || playback.playlist.length === 0) return;
    const volume = Math.round(Math.min(100, playback.volume));
    if (volume === startVolume.current) return;
    const timer = window.setTimeout(() => update((current) => ({ volumes: { ...current.volumes, music: volume } })), 600);
    return () => window.clearTimeout(timer);
  }, [playback.volume, playback.idle, playback.playlist.length, update]);

  const queue = useMemo(() => playback.playlist.map((path) => tracks.get(path)).filter((t): t is Track => !!t), [playback.playlist, tracks]);
  const current = playback.index >= 0 ? (tracks.get(playback.playlist[playback.index]) ?? null) : null;
  const active = playback.playlist.length > 0 && !playback.idle;
  useAmbientHold("media", active && !playback.paused);
  useActivity(current?.itemId, "listen", active && !playback.paused);

  // "Recently played" counts a track once it starts.
  const played = useRef<string | null>(null);
  useEffect(() => {
    const path = playback.playlist[playback.index];
    const key = `${playback.index}:${path}`;
    const track = path ? tracks.get(path) : undefined;
    // The track's details can arrive after mpv starts it; count it once they're known.
    if (!track || playback.idle || played.current === key) return;
    played.current = key;
    void api
      .musicPlayed(track.id)
      .then(() => queryClient.invalidateQueries({ queryKey: ["tracks", { recent: true }] }))
      .catch(() => {});
  }, [playback.index, playback.playlist, playback.idle, tracks]);

  const play = useCallback(async (ids: number[], start = 0) => {
    setError(null);
    try {
      remember(await api.musicPlay(ids, start, startVolume.current));
      setShuffled(false);
    } catch (reason) {
      setError(errorText(reason));
    }
  }, []);
  const enqueue = useCallback(async (ids: number[], next: boolean) => {
    setError(null);
    try {
      remember(await api.musicEnqueue(ids, next, startVolume.current));
    } catch (reason) {
      setError(errorText(reason));
    }
  }, []);

  const value = useMemo<MusicContext>(
    () => ({
      ...playback,
      queue,
      current,
      active,
      shuffled,
      error,
      play,
      enqueue,
      toggle: () => command(["cycle", "pause"]),
      pause: () => command(["set_property", "pause", true]),
      next: () => command(["playlist-next", "force"]),
      previous: () => (latest.current.time > 3 ? command(["seek", 0, "absolute"]) : command(["playlist-prev", "force"])),
      seek: (seconds) => command(["seek", seconds, "absolute"]),
      setVolume: (volume) => command(["set_property", "volume", volume]),
      toggleMute: () => command(["cycle", "mute"]),
      cycleRepeat: () => {
        const next: Repeat = latest.current.repeat === "off" ? "all" : latest.current.repeat === "all" ? "one" : "off";
        command(["set_property", "loop-playlist", next === "all" ? "inf" : "no"]);
        command(["set_property", "loop-file", next === "one" ? "inf" : "no"]);
        setPlayback((state) => ({ ...state, repeat: next }));
      },
      toggleShuffle: () => {
        command([shuffled ? "playlist-unshuffle" : "playlist-shuffle"]);
        setShuffled(!shuffled);
      },
      jump: (index) => command(["playlist-play-index", index]),
      remove: (index) => command(["playlist-remove", index]),
      stop: () => {
        void api.musicStop().catch(() => {});
        setPlayback(IDLE);
      },
      updateTrack: (track) =>
        setTracks((current) => {
          const next = new Map(current);
          for (const [path, known] of current) if (known.id === track.id) next.set(path, track);
          return next;
        }),
    }),
    [playback, queue, current, active, shuffled, error, play, enqueue],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useMusic(): MusicContext {
  const context = useContext(Context);
  if (!context) throw new Error("useMusic must be used inside MusicProvider");
  return context;
}

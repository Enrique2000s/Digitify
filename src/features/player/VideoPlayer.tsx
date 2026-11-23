import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { listen } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Popover } from "radix-ui";
import {
  ArrowLeft,
  AudioLines,
  Captions,
  Check,
  Expand,
  Gauge,
  ListVideo,
  LoaderCircle,
  Pause,
  Play,
  Shrink,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  RotateCcw,
  PictureInPicture2,
  Bookmark as BookmarkIcon,
  Trash2,
} from "lucide-react";
import { Marquee } from "../../components/Marquee";
import { api, artworkUrl, errorText, onLinux, type WatchTarget } from "../../lib/api";
import { useAmbientHold } from "../../lib/ambient/AmbientProvider";
import { useMusic } from "../../lib/music/MusicProvider";
import { accentVariables } from "../../lib/color";
import { FILMS, usePreferences } from "../../lib/preferences";
import { libraryChanged, useItem } from "../../lib/queries";
import { Cover } from "../../components/common";
import { useCoverShape } from "../../lib/preferences";
import { useActivity } from "../../lib/activity";
import { VIDEO_PAD } from "../bigpicture/Launcher";
import { BpClock, PlayerHints, useButtonNames, usePlayerController, usePlayerHints } from "../bigpicture/consoleControls";
import { WindowButtons } from "../../components/TitleBar";
import { useBigPicture } from "../../lib/bigpicture";
import { SeekBar } from "../../components/SeekBar";
import { actionFor, hint, isTyping } from "../../lib/shortcuts";
import { useAutoHide, useFullscreen } from "../reader/chrome";
import { pip } from "../../lib/pip";
import { viewList } from "../../lib/routes";
import { setVideoMedia } from "../../lib/mediaKeys";
import { SleepTimerButton, sleepTimer } from "../../lib/sleepTimer";

/** A message from mpv's JSON IPC, forwarded by the core. */
interface MpvMessage {
  event?: string;
  name?: string;
  data?: unknown;
}

interface Track {
  id: number;
  type: "video" | "audio" | "sub";
  title?: string;
  lang?: string;
  codec?: string;
  external?: boolean;
  selected?: boolean;
}

interface Playback {
  time: number;
  duration: number;
  paused: boolean;
  volume: number;
  muted: boolean;
  speed: number;
  ended: boolean;
  tracks: Track[];
  chapters: { title?: string; time: number }[];
  chapter: number;
  /** mpv is seeking, or waiting for data. */
  seeking: boolean;
  buffering: boolean;
}

const EMPTY: Playback = { time: 0, duration: 0, paused: false, volume: 100, muted: false, speed: 1, ended: false, tracks: [], chapters: [], chapter: -1, seeking: false, buffering: false };
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const SAVE_EVERY_MS = 5000;
const NEXT_COUNTDOWN = 8;

function apply(state: Playback, name: string, data: unknown): Playback {
  switch (name) {
    case "time-pos":
      return typeof data === "number" ? { ...state, time: data } : state;
    case "duration":
      return typeof data === "number" ? { ...state, duration: data } : state;
    case "pause":
      return { ...state, paused: data === true };
    case "volume":
      return typeof data === "number" ? { ...state, volume: data } : state;
    case "mute":
      return { ...state, muted: data === true };
    case "speed":
      return typeof data === "number" ? { ...state, speed: data } : state;
    case "eof-reached":
      return { ...state, ended: data === true };
    case "track-list":
      return Array.isArray(data) ? { ...state, tracks: data as Track[] } : state;
    case "chapter-list":
      return Array.isArray(data) ? { ...state, chapters: data as Playback["chapters"] } : state;
    case "chapter":
      return typeof data === "number" ? { ...state, chapter: data } : state;
    case "seeking":
      return { ...state, seeking: data === true };
    case "paused-for-cache":
      return { ...state, buffering: data === true };
    default:
      return state;
  }
}

function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

function trackName(track: Track, index: number): string {
  const language = track.lang ? new Intl.DisplayNames(undefined, { type: "language" }).of(track.lang) ?? track.lang : null;
  const name = [track.title, language].filter(Boolean).join(" · ");
  return name || `${track.type === "sub" ? "Subtitles" : "Track"} ${index + 1}${track.external ? " (file)" : ""}`;
}

const command = (args: unknown[]) => void api.playerCommand(args).catch(() => {});

function Menu({ label, icon, open, onOpenChange, container, children }: {
  label: string;
  icon: React.ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  container: HTMLElement | null;
  children: React.ReactNode;
}) {
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>
        <button type="button" className="round-btn" aria-label={label} title={label}>
          {icon}
        </button>
      </Popover.Trigger>
      <Popover.Portal container={container}>
        <Popover.Content className="menu reader-panel watch-menu" side="top" align="end" sideOffset={14} collisionPadding={16}>
          <div className="watch-menu-title">{label}</div>
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function Choice({ selected, onSelect, children }: { selected: boolean; onSelect: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className="toc-item watch-choice" aria-current={selected ? "true" : undefined} onClick={onSelect}>
      <span className="watch-check">{selected && <Check size={14} />}</span>
      {children}
    </button>
  );
}

/** What the player shows: a library item (a film or an episode), or a title on a disc (D-022). */
type Source = { kind: "item"; id: string; part?: number } | { kind: "disc"; letter: string; title: number };

/** `/watch/$id`: films and series episodes. */
/** The item's artwork over the player while it opens and closes. */
function Curtain({ itemId, title, shown }: { itemId: number | null; title?: string; shown: boolean }) {
  const item = useItem(itemId ?? 0, itemId != null);
  const shapeOf = useCoverShape();
  const data = itemId != null ? item.data : undefined;
  const backdrop = data ? ((data.metadata as Record<string, unknown>).backdropKey as string | undefined) : undefined;
  const look = data ? shapeOf({ handler: data.handler, category: data.category, coverShape: (data.metadata as Record<string, unknown>).coverShape as never }) : null;
  return (
    <div className={`watch-curtain${shown ? "" : " gone"}`} aria-hidden={!shown}>
      {(backdrop || data?.coverKey) && (
        <div className="watch-curtain-backdrop" style={{ backgroundImage: `url(${backdrop ? artworkUrl(backdrop, "cover") : artworkUrl(data!.coverKey!)})` }} />
      )}
      <div className="watch-curtain-card">
        {data && look && (
          <div className="watch-curtain-cover" data-shape={look.shape} style={{ aspectRatio: look.aspect }}>
            <Cover item={data} size="cover" />
          </div>
        )}
        <strong>{title ?? data?.title ?? ""}</strong>
        <LoaderCircle size={28} className="spin" aria-label="Opening" />
      </div>
    </div>
  );
}

export function WatchPage() {
  const { id } = useParams({ from: "/watch/$id" });
  const { part } = useSearch({ from: "/watch/$id" });
  return <VideoPlayer source={{ kind: "item", id, part }} />;
}

/** `/disc/$letter/$title`: a DVD or Blu-ray title, played from the disc. */
export function DiscPlayPage() {
  const { letter, title } = useParams({ from: "/disc/$letter/$title" });
  return <VideoPlayer source={{ kind: "disc", letter, title: Number(title) }} />;
}

/** Moments of a film or an episode worth coming back to (D-063): add one here, jump to one, remove one. */
function VideoBookmarks({ itemId, partId, time, onSeek }: { itemId: number; partId: number | null; time: number; onSeek: (time: number) => void }) {
  const marks = useQuery({ queryKey: ["bookmarks", itemId], queryFn: () => api.bookmarksList(itemId) });
  const queryClient = useQueryClient();
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["bookmarks", itemId] });
  const here = (marks.data ?? []).filter((b) => "time" in b.locator && (b.locator.part ?? null) === (partId ?? null));
  return (
    <div className="video-marks">
      <button
        type="button"
        className="btn btn-sm"
        onClick={() => void api.bookmarkAdd(itemId, { time, part: partId }, clock(time)).then(refresh)}
      >
        <BookmarkIcon size={14} /> Bookmark {clock(time)}
      </button>
      {here.length === 0 ? (
        <p className="hint">No bookmarks here yet.</p>
      ) : (
        here.map((mark) => (
          <div key={mark.id} className="video-mark">
            <button type="button" className="menu-item" onClick={() => "time" in mark.locator && onSeek(mark.locator.time)}>
              <span className="toc-page">{"time" in mark.locator ? clock(mark.locator.time) : ""}</span>
              <input
                className="video-mark-label"
                defaultValue={mark.label ?? ""}
                aria-label="Bookmark name"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
                onBlur={(e) => void api.bookmarkRename(mark.id, e.target.value || null).then(refresh)}
              />
            </button>
            <button type="button" className="icon-btn" aria-label="Remove bookmark" onClick={() => void api.bookmarkRemove(mark.id).then(refresh)}>
              <Trash2 size={14} />
            </button>
          </div>
        ))
      )}
    </div>
  );
}

/** Films, episodes and disc titles, played by mpv under the window (Phase 3). */
function VideoPlayer({ source }: { source: Source }) {
  const id = source.kind === "item" ? source.id : "";
  const part = source.kind === "item" ? source.part : undefined;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { preferences, update } = usePreferences();
  useAmbientHold("video", true);
  // Library music stops for a video, as ambient music does.
  const music = useMusic();
  useEffect(() => {
    if (music.active && !music.paused) music.pause();
  }, []);
  const { shown, poke, barProps } = useAutoHide();
  const [fullscreen, toggleFullscreen] = useFullscreen();

  const root = useRef<HTMLDivElement>(null);
  const latestLayout = useRef({ shown: true, menu: false, ready: false });
  const placeRef = useRef<(() => void) | null>(null);
  const surface = useRef<HTMLDivElement>(null);
  const [target, setTarget] = useState<WatchTarget | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playback, setPlayback] = useState<Playback>(EMPTY);
  const [menu, setMenu] = useState<"speed" | "audio" | "subs" | "chapters" | "marks" | null>(null);
  const [resumed, setResumed] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const latest = useRef(playback);
  latest.current = playback;
  // Set when the video moves to the corner (D-053): mpv keeps running instead of closing.
  const keepRunning = useRef(false);

  // The player opens and closes behind a curtain with the item's artwork, so moving between the
  // library and a video is one continuous picture instead of the app vanishing into black while
  // mpv starts (and back).
  const [ready, setReady] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const close = useCallback(() => {
    setLeaving(true);
    window.setTimeout(
      () => {
        if (window.history.length > 1) window.history.back();
        else if (source.kind === "disc") void navigate({ to: "/discs" });
        else void navigate({ to: "/item/$id", params: { id } });
      },
      document.documentElement.dataset.motion === "off" ? 0 : 180,
    );
  }, [navigate, id]);
  // To the corner (D-053): the video keeps playing small while you browse.
  const toCorner = useCallback(() => {
    if (!target || target.itemId === 0) return;
    keepRunning.current = true;
    const now = latest.current;
    pip.set({ target, time: now.time, duration: now.duration, paused: now.paused });
    if (window.history.length > 1) window.history.back();
    else void navigate({ to: "/item/$id", params: { id: String(target.itemId) } });
  }, [target, navigate]);
  const playPart = useCallback(
    (partId: number) => void navigate({ to: "/watch/$id", params: { id }, search: { part: partId }, replace: true }),
    [navigate, id],
  );
  // Back (D-141): by default the video keeps playing in a corner while you browse; with the
  // setting off it closes, and the corner has its own button beside Back. Discs, full screen,
  // Big Picture and a video that has ended just close.

  // ------------------------------------------------------------------ opening and events

  useEffect(() => {
    const unlisten = listen<MpvMessage>("player-event", ({ payload }) => {
      if (payload.event === "property-change" && payload.name) {
        const name = payload.name;
        setPlayback((state) => apply(state, name, payload.data));
      } else if (payload.event === "end-file" && (payload as { reason?: string }).reason === "error") {
        setError("This video can't be played. The file may be damaged, or use a format mpv can't read.");
      }
    });
    return () => void unlisten.then((stop) => stop());
  }, []);

  useEffect(() => {
    let cancelled = false;
    setTarget(null);
    setReady(false);
    setError(null);
    setPlayback(EMPTY);
    setCountdown(null);
    // A video coming back from the corner (D-053): take over its running session.
    const corner = pip.get();
    if (source.kind === "item" && corner && corner.target.itemId === Number(id) && (part == null || corner.target.partId === part)) {
      pip.set(null);
      setTarget(corner.target);
      setResumed(false);
      setPlayback({ ...EMPTY, time: corner.time, duration: corner.duration, paused: corner.paused });
      setReady(true);
      return () => {
        if (!keepRunning.current) void api.playerClose().catch(() => {});
      };
    }
    const opening: Promise<WatchTarget> =
      source.kind === "disc"
        ? api.discPlay(source.letter, source.title, preferences.volumes.video).then((disc) => ({
            itemId: 0,
            partId: null,
            title: disc.title,
            episode: disc.episode,
            start: 0,
            previous: null,
            next: null,
            nextLabel: null,
          }))
        : api.watchOpen(Number(id), part ?? null, preferences.volumes.video);
    opening.then(
      (opened) => {
        if (cancelled) return;
        setTarget(opened);
        setResumed(opened.start > 0);
      },
      (reason) => !cancelled && setError(errorText(reason)),
    );
    return () => {
      cancelled = true;
      if (!keepRunning.current) void api.playerClose().catch(() => {});
    };
  }, [id, part, source.kind === "disc" ? `${source.letter}:${source.title}` : ""]);

  // The curtain lifts on the first frame (mpv reports a position), or after a moment regardless.
  useEffect(() => {
    if (target && playback.time > 0) setReady(true);
  }, [target, playback.time]);
  useEffect(() => {
    if (!target) return;
    const timer = window.setTimeout(() => setReady(true), 4000);
    return () => window.clearTimeout(timer);
  }, [target]);

  useEffect(() => {
    if (!target) return;
    document.documentElement.classList.add("video-mode");
    if (onLinux) document.documentElement.classList.add("on-linux");
    return () => document.documentElement.classList.remove("video-mode", "on-linux");
  }, [target]);

  // Keep the native video surface exactly under the surface element (physical pixels).
  useLayoutEffect(() => {
    const element = surface.current;
    if (!target || !element) return;
    const place = () => {
      const r = element.getBoundingClientRect();
      const scale = window.devicePixelRatio;
      let { left, top, width, height } = r;
      // On Linux the video window covers the page (D-031): it waits behind the curtain, gives way
      // to an open menu, and leaves room for the bars while they show.
      if (onLinux) {
        const bars = latestLayout.current;
        if (!bars.ready || bars.menu) {
          left = -10;
          top = -10;
          width = 1;
          height = 1;
        } else if (bars.shown && root.current) {
          const upper = root.current.querySelector(".reader-bar.top")?.getBoundingClientRect();
          const lower = root.current.querySelector(".watch-bar")?.getBoundingClientRect();
          const from = upper ? Math.max(top, upper.bottom) : top;
          const to = lower ? Math.min(top + height, lower.top - 8) : top + height;
          top = from;
          height = Math.max(1, to - from);
        }
      }
      void api
        .playerSetRect({ x: Math.round(left * scale), y: Math.round(top * scale), width: Math.round(width * scale), height: Math.round(height * scale) })
        .catch(() => {});
    };
    placeRef.current = place;
    place();
    const observer = new ResizeObserver(place);
    observer.observe(element);
    window.addEventListener("resize", place);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [target]);

  // ------------------------------------------------------------------ progress and what comes next

  const save = useCallback(
    (playbackNow: Playback) => {
      // Disc titles aren't library items, so there's no progress to keep.
      if (!target || target.itemId === 0 || playbackNow.duration <= 0) return Promise.resolve();
      const seconds = playbackNow.ended ? playbackNow.duration : playbackNow.time;
      return api.watchProgressSave(target.itemId, target.partId, seconds, playbackNow.duration).catch(() => {});
    },
    [target],
  );
  useEffect(() => {
    if (!target) return;
    const timer = window.setInterval(() => {
      if (!latest.current.paused && latest.current.time > 0) void save(latest.current);
    }, SAVE_EVERY_MS);
    return () => {
      window.clearInterval(timer);
      void save(latest.current).finally(() => libraryChanged(queryClient));
    };
  }, [target, save, queryClient]);

  useEffect(() => {
    if (!playback.ended || !target) return;
    void save(playback);
    // The sleep timer waits for the end of the episode (D-061): it stops here, no next episode.
    if (sleepTimer.atEnd()) {
      sleepTimer.set(null);
      return;
    }
    if (target.next) setCountdown(NEXT_COUNTDOWN);
  }, [playback.ended]);
  useEffect(() => {
    if (countdown === null || !target?.next) return;
    if (countdown <= 0) {
      playPart(target.next);
      return;
    }
    const timer = window.setTimeout(() => setCountdown(countdown - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [countdown, target, playPart]);
  useEffect(() => {
    if (!resumed) return;
    const timer = window.setTimeout(() => setResumed(false), 7000);
    return () => window.clearTimeout(timer);
  }, [resumed]);

  useActivity(target?.itemId, "watch", !!target && !playback.paused && !playback.ended);
  // In Big Picture the controller plays, seeks, changes the volume and closes, and A brings the
  // controls to move through like a console (D-071).
  const driving = usePlayerController(root, VIDEO_PAD, poke);
  const bigPicture = useBigPicture();
  // In Videos, previous and next are the videos before and after this one in the library view it
  // was opened from (D-091). Movies & Series stay with what's playing (D-174): a movie has no
  // previous or next, a series only its own episodes.
  const watched = useItem(Number(id) || 0, source.kind === "item" && !!id);
  const inFilms = watched.data?.category === FILMS;
  const list = useQuery({
    queryKey: ["video-list", id],
    enabled: source.kind === "item" && !!id && watched.isSuccess && !inFilms,
    staleTime: Infinity,
    // Online videos play in their service's player, not here, so previous and next pass them by;
    // past the last video it goes round to the first, and before the first to the last (D-140).
    queryFn: () => viewList(Number(id), "video", true).catch(() => null),
  });
  const at = list.data ? list.data.indexOf(Number(id)) : -1;
  const count = list.data?.length ?? 0;
  const listPrevious = !inFilms && at >= 0 && count > 1 ? list.data![(at - 1 + count) % count] : null;
  const listNext = !inFilms && at >= 0 && count > 1 ? list.data![(at + 1) % count] : null;
  const openVideo = (other: number) => void navigate({ to: "/watch/$id", params: { id: String(other) }, replace: true });
  const goNext = () => (target?.next ? playPart(target.next) : listNext != null ? openVideo(listNext) : undefined);
  const goPrevious = () => (target?.previous ? playPart(target.previous) : listPrevious != null ? openVideo(listPrevious) : undefined);
  const hasNext = !!target?.next || listNext != null;
  const hasPrevious = !!target?.previous || listPrevious != null;
  // A movie (or a one-episode series) shows no previous and next at all (D-174).
  const stepping = !inFilms || hasNext || hasPrevious;
  const canCorner = !!target && target.itemId !== 0 && !fullscreen && !bigPicture;
  const backCorners = preferences.videoBackToCorner && canCorner && !playback.ended;
  const back = () => (backCorners ? toCorner() : close());
  const buttons = useButtonNames();
  const hints = usePlayerHints(driving, [
    { keys: [buttons.x], label: "Play / pause" },
    { keys: ["LB", "RB"], label: "Skip" },
    { keys: ["RT"], label: "Next episode" },
  ]);

  // A seek or a wait for data that takes a moment shows a spinner, so it's clear the click landed.
  const waiting = playback.seeking || playback.buffering;
  useEffect(() => {
    if (!waiting) {
      setBusy(false);
      return;
    }
    const timer = window.setTimeout(() => setBusy(true), 350);
    return () => window.clearTimeout(timer);
  }, [waiting]);

  // The volume is remembered for next time (mpv starts at it).
  useEffect(() => {
    if (!target) return;
    const volume = Math.round(Math.min(100, playback.volume));
    if (volume === preferences.volumes.video) return;
    const timer = window.setTimeout(() => update((current) => ({ volumes: { ...current.volumes, video: volume } })), 600);
    return () => window.clearTimeout(timer);
  }, [playback.volume, target]);

  // ------------------------------------------------------------------ keyboard

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event)) return;
      const action = actionFor(event, "video");
      if ((event.target as HTMLElement | null)?.closest?.(".reader-panel") && action !== "video.close") return;
      const now = latest.current;
      switch (action) {
        case "video.playPause":
          togglePlay();
          break;
        case "video.back":
        case "video.forward":
        case "video.backLong":
        case "video.forwardLong": {
          const seconds = { "video.back": -5, "video.forward": 5, "video.backLong": -30, "video.forwardLong": 30 }[action];
          command(["seek", seconds, "relative+exact"]);
          break;
        }
        case "video.volumeUp":
          command(["set_property", "volume", Math.min(100, now.volume + 5)]);
          break;
        case "video.volumeDown":
          command(["set_property", "volume", Math.max(0, now.volume - 5)]);
          break;
        case "video.mute":
          command(["cycle", "mute"]);
          break;
        case "video.subtitles":
          command(["cycle", "sub"]);
          break;
        case "video.fullscreen":
          void toggleFullscreen();
          break;
        case "video.nextEpisode":
          goNext();
          break;
        case "video.close":
          if (menu) setMenu(null);
          else if (fullscreen) void toggleFullscreen();
          else back();
          break;
        default:
          return;
      }
      event.preventDefault();
      poke();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleFullscreen, fullscreen, close, poke, menu, target, playPart, backCorners, toCorner]);

  // ------------------------------------------------------------------ view

  const duration = playback.duration;
  const audio = playback.tracks.filter((t) => t.type === "audio");
  const subs = playback.tracks.filter((t) => t.type === "sub");
  const showBars = shown || driving || playback.paused || menu !== null || !target || countdown !== null;
  // What the Linux video window keeps clear of (see `place`), read when it's placed again.
  latestLayout.current = { shown: showBars, menu: menu !== null, ready: ready && !leaving };
  useEffect(() => {
    if (onLinux) placeRef.current?.();
  }, [showBars, menu, ready, leaving]);
  // Picking an option closes its menu.
  const choose = (_: void) => setMenu(null);
  // At the end, the play button starts the video again from the beginning.
  function togglePlay() {
    if (latest.current.ended) {
      setCountdown(null);
      command(["seek", 0, "absolute+exact"]);
      command(["set_property", "pause", false]);
    } else {
      command(["cycle", "pause"]);
    }
  }
  // The keyboard's and headphones' media keys, and the system's now-playing card (D-058).
  const togglePlayRef = useRef(togglePlay);
  togglePlayRef.current = togglePlay;
  useEffect(() => {
    if (!target) return;
    setVideoMedia({
      title: target.title,
      subtitle: target.episode,
      paused: playback.paused,
      toggle: () => togglePlayRef.current(),
      play: () => command(["set_property", "pause", false]),
      pause: () => command(["set_property", "pause", true]),
      next: hasNext ? goNext : undefined,
      previous: hasPrevious ? goPrevious : undefined,
    });
  }, [target, playback.paused, playPart]);
  useEffect(() => () => setVideoMedia(null), []);
  // Dragging previews with fast keyframe seeks; letting go (or a click) lands on the exact frame.
  const seek = (seconds: number, exact: boolean) => command(["seek", seconds, exact ? "absolute+exact" : "absolute+keyframes"]);
  const loadSubtitles = async () => {
    setMenu(null);
    const picked = await openDialog({ multiple: false, title: "Choose a subtitle file", filters: [{ name: "Subtitles", extensions: ["srt", "ass", "ssa", "vtt", "sub", "sup", "idx"] }] });
    if (typeof picked === "string") await api.playerAddSubtitle(picked).catch((reason) => setError(errorText(reason)));
  };

  return (
    <div
      ref={root}
      className={`reader watch${showBars ? "" : " calm"}${target ? "" : " loading"}`}
      style={accentVariables(preferences.accent, "dark") as CSSProperties}
      onMouseMove={poke}
    >
      <div ref={surface} className="watch-surface" onClick={() => target && togglePlay()} onDoubleClick={() => void toggleFullscreen()} />
      <Curtain itemId={source.kind === "item" ? Number(id) : null} title={target?.title} shown={(!ready || leaving) && !error} />

      {target && busy && (
        <div className="watch-busy" aria-label="Loading">
          <LoaderCircle size={30} className="spin" />
        </div>
      )}

      {!target && (
        <div className="reader-message">
          {error ? (
            <>
              <h1 className="display">This can't be played</h1>
              <p>{error}</p>
              <button type="button" className="btn" onClick={close}>
                Back
              </button>
            </>
          ) : null}
        </div>
      )}

      <header className={`reader-bar top${showBars ? "" : " hidden"}`} data-tauri-drag-region {...barProps}>
        <button
          type="button"
          className="round-btn"
          aria-label={backCorners ? "Back, the video keeps playing in a corner" : "Close the player"}
          title={backCorners ? `Back: keeps playing in a corner while you browse${hint("video.close")}` : `Close${hint("video.close")}`}
          onClick={back}
        >
          <ArrowLeft size={18} strokeWidth={2.6} />
        </button>
        {canCorner && !preferences.videoBackToCorner && (
          <button type="button" className="round-btn" aria-label="Keep watching in a corner" title="Keep watching in a corner while you browse" onClick={toCorner}>
            <PictureInPicture2 size={18} strokeWidth={2.4} />
          </button>
        )}
        <div className="reader-title" data-tauri-drag-region>
          <Marquee className="reader-name" text={target?.title ?? "Opening…"} />
          {target?.episode && <Marquee className="reader-sub" text={target.episode} />}
        </div>
        <span className="appbar-drag" data-tauri-drag-region />
        {bigPicture && <BpClock />}
        {!fullscreen && <WindowButtons />}
      </header>

      {target && (
        <footer className={`reader-bar bottom watch-bar${showBars ? "" : " hidden"}`} {...barProps}>
          <div className="watch-seek">
            <SeekBar time={playback.time} duration={duration} marks={playback.chapters} clock={clock} timeClassName="watch-time" onSeek={seek} />
          </div>
          <div className="watch-controls">
            {stepping && (
              <button type="button" className="round-btn" aria-label={target.previous || !listPrevious ? "Previous episode" : "Previous video"} disabled={!hasPrevious} onClick={goPrevious}>
                <SkipBack size={17} />
              </button>
            )}
            <button
              type="button"
              className="round-btn watch-play"
              data-bp-autofocus
              aria-label={playback.ended ? "Watch again" : playback.paused ? "Play" : "Pause"}
              title={playback.ended ? "Watch again" : undefined}
              onClick={togglePlay}
            >
              {playback.ended ? <RotateCcw size={20} /> : playback.paused ? <Play size={20} /> : <Pause size={20} />}
            </button>
            {stepping && (
              <button type="button" className="round-btn" aria-label={target.next || !listNext ? "Next episode" : "Next video"} title={target.nextLabel ?? undefined} disabled={!hasNext} onClick={goNext}>
                <SkipForward size={17} />
              </button>
            )}
            <button type="button" className="round-btn" aria-label={playback.muted ? "Unmute" : "Mute"} onClick={() => command(["cycle", "mute"])}>
              {playback.muted ? <VolumeX size={17} /> : <Volume2 size={17} />}
            </button>
            <input
              type="range"
              className="watch-volume"
              aria-label="Volume"
              min={0}
              max={100}
              value={Math.min(100, playback.volume)}
              style={{ "--fill": `${Math.min(100, playback.volume)}%` } as CSSProperties}
              onChange={(event) => command(["set_property", "volume", Number(event.target.value)])}
            />
            <span className="watch-time watch-volume-value">{Math.round(Math.min(100, playback.volume))}%</span>
            <span className="appbar-drag" />
            {playback.chapters.length > 1 && (
              <Menu label="Chapters" icon={<ListVideo size={17} />} open={menu === "chapters"} onOpenChange={(o) => setMenu(o ? "chapters" : null)} container={root.current}>
                {playback.chapters.map((chapter, index) => (
                  <Choice key={index} selected={playback.chapter === index} onSelect={() => choose(command(["set_property", "chapter", index]))}>
                    {chapter.title || `Chapter ${index + 1}`} <span className="toc-page">{clock(chapter.time)}</span>
                  </Choice>
                ))}
              </Menu>
            )}
            {target.itemId !== 0 && (
              <Menu label="Bookmarks" icon={<BookmarkIcon size={17} />} open={menu === "marks"} onOpenChange={(o) => setMenu(o ? "marks" : null)} container={root.current}>
                <VideoBookmarks itemId={target.itemId} partId={target.partId} time={playback.time} onSeek={(t) => choose(command(["seek", t, "absolute+exact"]))} />
              </Menu>
            )}
            <SleepTimerButton className="round-btn" endLabel="End of this episode" />
            <Menu label="Subtitles" icon={<Captions size={17} />} open={menu === "subs"} onOpenChange={(o) => setMenu(o ? "subs" : null)} container={root.current}>
              <Choice selected={!subs.some((t) => t.selected)} onSelect={() => choose(command(["set_property", "sid", "no"]))}>
                Off
              </Choice>
              {subs.map((track, index) => (
                <Choice key={track.id} selected={!!track.selected} onSelect={() => choose(command(["set_property", "sid", track.id]))}>
                  {trackName(track, index)}
                </Choice>
              ))}
              <button type="button" className="btn btn-sm watch-load" onClick={() => void loadSubtitles()}>
                Load a subtitle file…
              </button>
            </Menu>
            {audio.length > 1 && (
              <Menu label="Audio" icon={<AudioLines size={17} />} open={menu === "audio"} onOpenChange={(o) => setMenu(o ? "audio" : null)} container={root.current}>
                {audio.map((track, index) => (
                  <Choice key={track.id} selected={!!track.selected} onSelect={() => choose(command(["set_property", "aid", track.id]))}>
                    {trackName(track, index)}
                  </Choice>
                ))}
              </Menu>
            )}
            <Menu label="Speed" icon={<Gauge size={17} />} open={menu === "speed"} onOpenChange={(o) => setMenu(o ? "speed" : null)} container={root.current}>
              {SPEEDS.map((speed) => (
                <Choice key={speed} selected={Math.abs(playback.speed - speed) < 0.01} onSelect={() => choose(command(["set_property", "speed", speed]))}>
                  {speed === 1 ? "Normal" : `${speed}×`}
                </Choice>
              ))}
            </Menu>
            {!bigPicture && (
              <button type="button" className="round-btn" aria-label={fullscreen ? "Leave full screen" : "Full screen"} title={`Full screen${hint("video.fullscreen")}`} onClick={() => void toggleFullscreen()}>
                {fullscreen ? <Shrink size={17} /> : <Expand size={17} />}
              </button>
            )}
          </div>
        </footer>
      )}
      <PlayerHints shown={showBars} hints={hints} />

      {resumed && target && (
        <div className="ebook-link watch-note" role="status">
          <div>
            <strong>Resumed at {clock(target.start)}</strong>
          </div>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              command(["seek", 0, "absolute"]);
              setResumed(false);
            }}
          >
            Start over
          </button>
        </div>
      )}

      {countdown !== null && target?.next && (
        <div className="watch-next" role="status">
          <span className="eyebrow">Next episode in {countdown}</span>
          <strong>{target.nextLabel}</strong>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="btn btn-primary" onClick={() => playPart(target.next!)}>
              <Play size={16} /> Play now
            </button>
            <button type="button" className="btn" onClick={() => setCountdown(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

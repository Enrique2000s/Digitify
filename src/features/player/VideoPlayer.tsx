import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { useQueryClient } from "@tanstack/react-query";
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
} from "lucide-react";
import { api, errorText, type WatchTarget } from "../../lib/api";
import { useAmbientHold } from "../../lib/ambient/AmbientProvider";
import { useMusic } from "../../lib/music/MusicProvider";
import { accentVariables } from "../../lib/color";
import { usePreferences } from "../../lib/preferences";
import { libraryChanged } from "../../lib/queries";
import { WindowButtons } from "../../components/TitleBar";
import { useAutoHide, useFullscreen } from "../reader/chrome";

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
}

const EMPTY: Playback = { time: 0, duration: 0, paused: false, volume: 100, muted: false, speed: 1, ended: false, tracks: [], chapters: [], chapter: -1 };
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
  const surface = useRef<HTMLDivElement>(null);
  const [target, setTarget] = useState<WatchTarget | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playback, setPlayback] = useState<Playback>(EMPTY);
  const [scrub, setScrub] = useState<number | null>(null);
  const [menu, setMenu] = useState<"speed" | "audio" | "subs" | "chapters" | null>(null);
  const [resumed, setResumed] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const latest = useRef(playback);
  latest.current = playback;

  const close = useCallback(() => {
    if (window.history.length > 1) window.history.back();
    else if (source.kind === "disc") void navigate({ to: "/discs" });
    else void navigate({ to: "/item/$id", params: { id } });
  }, [navigate, id]);
  const playPart = useCallback(
    (partId: number) => void navigate({ to: "/watch/$id", params: { id }, search: { part: partId }, replace: true }),
    [navigate, id],
  );

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
    setError(null);
    setPlayback(EMPTY);
    setCountdown(null);
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
      void api.playerClose().catch(() => {});
    };
  }, [id, part, source.kind === "disc" ? `${source.letter}:${source.title}` : ""]);

  useEffect(() => {
    if (!target) return;
    document.documentElement.classList.add("video-mode");
    return () => document.documentElement.classList.remove("video-mode");
  }, [target]);

  // Keep the native video surface exactly under the surface element (physical pixels).
  useLayoutEffect(() => {
    const element = surface.current;
    if (!target || !element) return;
    const place = () => {
      const r = element.getBoundingClientRect();
      const scale = window.devicePixelRatio;
      void api
        .playerSetRect({ x: Math.round(r.left * scale), y: Math.round(r.top * scale), width: Math.round(r.width * scale), height: Math.round(r.height * scale) })
        .catch(() => {});
    };
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
      const element = event.target as HTMLElement | null;
      if (element instanceof HTMLInputElement && element.type !== "range") return;
      if (element?.closest?.(".reader-panel") && event.key !== "Escape") return;
      const now = latest.current;
      switch (event.key) {
        case " ":
        case "k":
          command(["cycle", "pause"]);
          break;
        case "ArrowLeft":
          command(["seek", event.shiftKey ? -30 : -5, "relative"]);
          break;
        case "ArrowRight":
          command(["seek", event.shiftKey ? 30 : 5, "relative"]);
          break;
        case "ArrowUp":
          command(["set_property", "volume", Math.min(100, now.volume + 5)]);
          break;
        case "ArrowDown":
          command(["set_property", "volume", Math.max(0, now.volume - 5)]);
          break;
        case "m":
          command(["cycle", "mute"]);
          break;
        case "c":
          command(["cycle", "sub"]);
          break;
        case "f":
        case "F11":
          void toggleFullscreen();
          break;
        case "N":
          if (target?.next) playPart(target.next);
          break;
        case "Escape":
          if (menu) setMenu(null);
          else if (fullscreen) void toggleFullscreen();
          else close();
          break;
        default:
          return;
      }
      event.preventDefault();
      poke();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleFullscreen, fullscreen, close, poke, menu, target, playPart]);

  // ------------------------------------------------------------------ view

  const position = scrub ?? playback.time;
  const duration = playback.duration;
  const audio = playback.tracks.filter((t) => t.type === "audio");
  const subs = playback.tracks.filter((t) => t.type === "sub");
  const sliderFill = duration > 0 ? (position / duration) * 100 : 0;
  const showBars = shown || playback.paused || menu !== null || !target || countdown !== null;
  // Picking an option closes its menu.
  const choose = (_: void) => setMenu(null);
  const commitScrub = () => {
    if (scrub === null) return;
    command(["seek", scrub, "absolute"]);
    setScrub(null);
  };
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
      <div ref={surface} className="watch-surface" onClick={() => target && command(["cycle", "pause"])} onDoubleClick={() => void toggleFullscreen()} />

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
          ) : (
            <LoaderCircle size={34} className="spin" aria-label="Opening" />
          )}
        </div>
      )}

      <header className={`reader-bar top${showBars ? "" : " hidden"}`} data-tauri-drag-region {...barProps}>
        <button type="button" className="round-btn" aria-label="Close the player" title="Close (Esc)" onClick={close}>
          <ArrowLeft size={18} strokeWidth={2.6} />
        </button>
        <div className="reader-title" data-tauri-drag-region>
          <strong>{target?.title ?? "Opening…"}</strong>
          {target?.episode && <span>{target.episode}</span>}
        </div>
        <span className="appbar-drag" data-tauri-drag-region />
        {!fullscreen && <WindowButtons />}
      </header>

      {target && (
        <footer className={`reader-bar bottom watch-bar${showBars ? "" : " hidden"}`} {...barProps}>
          <div className="watch-seek">
            <span className="watch-time">{clock(position)}</span>
            <div className="watch-track">
              <input
                type="range"
                className="reader-slider"
                aria-label="Position"
                min={0}
                max={duration || 0}
                step={0.1}
                value={Math.min(position, duration || 0)}
                style={{ "--fill": `${sliderFill}%` } as CSSProperties}
                onChange={(event) => setScrub(Number(event.target.value))}
                onPointerUp={commitScrub}
                onKeyUp={commitScrub}
              />
              {duration > 0 &&
                playback.chapters.slice(1).map((chapter, index) => (
                  <span key={index} className="watch-tick" style={{ left: `${(chapter.time / duration) * 100}%` }} title={chapter.title} />
                ))}
            </div>
            <span className="watch-time">{clock(duration)}</span>
          </div>
          <div className="watch-controls">
            <button type="button" className="round-btn" aria-label="Previous episode" disabled={!target.previous} onClick={() => target.previous && playPart(target.previous)}>
              <SkipBack size={17} />
            </button>
            <button type="button" className="round-btn watch-play" aria-label={playback.paused ? "Play" : "Pause"} onClick={() => command(["cycle", "pause"])}>
              {playback.paused ? <Play size={20} /> : <Pause size={20} />}
            </button>
            <button type="button" className="round-btn" aria-label="Next episode" title={target.nextLabel ?? undefined} disabled={!target.next} onClick={() => target.next && playPart(target.next)}>
              <SkipForward size={17} />
            </button>
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
            <button type="button" className="round-btn" aria-label={fullscreen ? "Leave full screen" : "Full screen"} title="Full screen (F)" onClick={() => void toggleFullscreen()}>
              {fullscreen ? <Shrink size={17} /> : <Expand size={17} />}
            </button>
          </div>
        </footer>
      )}

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

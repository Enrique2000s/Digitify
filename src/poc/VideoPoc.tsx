import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api } from "../lib/api";

/** A message from mpv's JSON IPC, forwarded by the core. */
interface MpvMessage {
  event?: string;
  name?: string;
  data?: unknown;
}

interface Playback {
  time: number;
  duration: number;
  paused: boolean;
  volume: number;
  muted: boolean;
  title: string;
}

const EMPTY: Playback = { time: 0, duration: 0, paused: false, volume: 100, muted: false, title: "" };

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
    case "media-title":
      return typeof data === "string" ? { ...state, title: data } : state;
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

const command = (args: unknown[]) => void api.playerCommand(args).catch(() => {});

async function toggleFullscreen() {
  const window = getCurrentWindow();
  await window.setFullscreen(!(await window.isFullscreen()));
}

export function VideoPoc({ initialPath, onExit }: { initialPath: string | null; onExit: () => void }) {
  const [pathInput, setPathInput] = useState(initialPath ?? "");
  const [path, setPath] = useState<string | null>(initialPath);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playback, setPlayback] = useState<Playback>(EMPTY);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [scrub, setScrub] = useState<number | null>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef(0);
  const latest = useRef(playback);
  const automated = initialPath !== null;

  useEffect(() => {
    latest.current = playback;
  }, [playback]);

  // Automated run (DIGITIFY_POC=video:<path>): drive the player through the UI's own command path,
  // resize and go fullscreen while snapshots are recorded, then report and exit.
  useEffect(() => {
    if (!ready || !automated) return;
    const win = getCurrentWindow();
    const snapshots: Record<string, unknown>[] = [];
    const snap = (label: string) => snapshots.push({ label, ...latest.current, at: Math.round(performance.now()) });
    const steps: [number, () => unknown][] = [
      [1500, () => {
        command(["seek", 30, "absolute"]);
        command(["set_property", "pause", true]);
      }],
      [4500, () => snap("after seek to 0:30 + pause")],
      [5000, () => win.setSize(new LogicalSize(960, 600))],
      [7500, () => snap("after resize to 960x600")],
      [8000, () => win.setFullscreen(true)],
      [10500, () => snap("fullscreen")],
      [11000, async () => {
        await win.setFullscreen(false);
        await win.setSize(new LogicalSize(1280, 800));
        command(["set_property", "pause", false]);
      }],
      [13500, () => snap("restored + resumed")],
      [14000, async () => {
        await api.devReport("video", { path, snapshots });
        await api.devExit();
      }],
    ];
    const timers = steps.map(([at, step]) => window.setTimeout(() => void step(), at));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [ready, automated, path]);

  useEffect(() => {
    const unlisten = listen<MpvMessage>("player-event", ({ payload }) => {
      if (payload.event === "property-change" && payload.name) {
        const name = payload.name;
        setPlayback((state) => apply(state, name, payload.data));
      } else if (payload.event === "closed") {
        setReady(false);
      }
    });
    return () => {
      void unlisten.then((stop) => stop());
    };
  }, []);

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    setError(null);
    setPlayback(EMPTY);
    api.playerOpen(path).then(
      () => !cancelled && setReady(true),
      (reason) => !cancelled && setError(String(reason)),
    );
    return () => {
      cancelled = true;
      setReady(false);
      void api.playerClose().catch(() => {});
    };
  }, [path]);

  // While a video is open, the page is transparent so mpv's picture shows through.
  useEffect(() => {
    if (!ready) return;
    document.documentElement.classList.add("video-mode");
    return () => document.documentElement.classList.remove("video-mode");
  }, [ready]);

  // Keep the native video surface exactly under the surface element (physical pixels).
  useLayoutEffect(() => {
    const el = surfaceRef.current;
    if (!ready || !el) return;
    const place = () => {
      const r = el.getBoundingClientRect();
      const scale = window.devicePixelRatio;
      void api
        .playerSetRect({
          x: Math.round(r.left * scale),
          y: Math.round(r.top * scale),
          width: Math.round(r.width * scale),
          height: Math.round(r.height * scale),
        })
        .catch(() => {});
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(el);
    window.addEventListener("resize", place);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [ready]);

  const showControls = useCallback(() => {
    setControlsVisible(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setControlsVisible(false), 2500);
  }, []);

  const close = useCallback(async () => {
    const window = getCurrentWindow();
    if (await window.isFullscreen()) await window.setFullscreen(false);
    setPath(null);
    onExit();
  }, [onExit]);

  useEffect(() => {
    if (!ready) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement && event.target.type !== "range") return;
      switch (event.key) {
        case " ":
        case "k":
          event.preventDefault();
          command(["cycle", "pause"]);
          break;
        case "ArrowLeft":
          event.preventDefault();
          command(["seek", -5, "relative"]);
          break;
        case "ArrowRight":
          event.preventDefault();
          command(["seek", 5, "relative"]);
          break;
        case "m":
          command(["cycle", "mute"]);
          break;
        case "f":
          void toggleFullscreen();
          break;
        case "Escape":
          void getCurrentWindow()
            .isFullscreen()
            .then((full) => (full ? getCurrentWindow().setFullscreen(false) : close()));
          break;
        default:
          return;
      }
      showControls();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ready, close, showControls]);

  const commitScrub = () => {
    if (scrub === null) return;
    command(["seek", scrub, "absolute"]);
    setScrub(null);
  };

  const open = (event: FormEvent) => {
    event.preventDefault();
    const value = pathInput.trim().replace(/^"(.*)"$/, "$1");
    if (value) setPath(value);
  };

  const visible = controlsVisible || playback.paused || !ready;
  const position = scrub ?? playback.time;

  return (
    <div className={`player${visible ? " show-controls" : ""}`} onMouseMove={showControls}>
      <div
        ref={surfaceRef}
        className="player-surface"
        onClick={() => ready && command(["cycle", "pause"])}
        onDoubleClick={() => void toggleFullscreen()}
      />

      {!path && (
        <div className="player-open">
          <form onSubmit={open}>
            <h1>Video proof of concept</h1>
            <label htmlFor="video-path">Path to a video file</label>
            <input
              id="video-path"
              value={pathInput}
              placeholder="C:\path\to\video.mkv"
              onChange={(event) => setPathInput(event.target.value)}
              autoFocus
            />
            <p className="hint">Generate test media with scripts\make-samples.ps1, then use samples\sample-1080p.mkv.</p>
            <div className="row">
              <button type="submit">Play</button>
              <button type="button" onClick={onExit}>Back</button>
            </div>
          </form>
        </div>
      )}

      {error && (
        <div className="player-error" role="alert">
          {error}
        </div>
      )}

      {path && (
        <>
          <div className="player-top">
            <button type="button" className="icon" aria-label="Back" onClick={() => void close()}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
            <span className="player-title">{playback.title || path}</span>
          </div>
          <div className="player-bottom">
            <button
              type="button"
              className="icon"
              aria-label={playback.paused ? "Play" : "Pause"}
              onClick={() => command(["cycle", "pause"])}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d={playback.paused ? "M8 5v14l11-7z" : "M7 5h4v14H7zM13 5h4v14h-4z"} />
              </svg>
            </button>
            <span className="time">{clock(position)}</span>
            <input
              className="seek"
              type="range"
              aria-label="Seek"
              min={0}
              max={playback.duration || 0}
              step={0.1}
              value={Math.min(position, playback.duration || 0)}
              onChange={(event) => setScrub(Number(event.target.value))}
              onPointerUp={commitScrub}
              onKeyUp={commitScrub}
            />
            <span className="time">{clock(playback.duration)}</span>
            <button
              type="button"
              className="icon"
              aria-label={playback.muted ? "Unmute" : "Mute"}
              onClick={() => command(["cycle", "mute"])}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d={playback.muted ? "M11 5 6 9H2v6h4l5 4zM22 9l-6 6M16 9l6 6" : "M11 5 6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14"} />
              </svg>
            </button>
            <input
              className="volume"
              type="range"
              aria-label="Volume"
              min={0}
              max={130}
              value={playback.volume}
              onChange={(event) => command(["set_property", "volume", Number(event.target.value)])}
            />
            <button type="button" className="icon" aria-label="Toggle fullscreen" onClick={() => void toggleFullscreen()}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
              </svg>
            </button>
          </div>
        </>
      )}
    </div>
  );
}

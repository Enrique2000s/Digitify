import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Maximize2, Pause, Play, X } from "lucide-react";
import { api, onLinux } from "../../lib/api";
import { pip, usePip } from "../../lib/pip";
import { setVideoMedia } from "../../lib/mediaKeys";
import { useAmbientHold } from "../../lib/ambient/AmbientProvider";
import { libraryChanged } from "../../lib/queries";

const WIDTH = 384;
const HEIGHT = 216;
const SAVE_EVERY_MS = 10_000;

/**
 * The video in the corner (D-053): mpv keeps playing in a small frame at the bottom right while
 * you browse. On Windows the picture sits under the window, so the page gets a hole there; on
 * Linux it sits above the page in the frame. Play/pause, make it big again, or close it.
 */
export function FloatingVideo() {
  const session = usePip();
  if (!session) return null;
  return <Floating key={`${session.target.itemId}:${session.target.partId ?? ""}`} />;
}

function Floating() {
  const session = pip.get()!;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const frame = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(session.paused);
  const state = useRef({ time: session.time, duration: session.duration, paused: session.paused, ended: false });
  useAmbientHold("video", true);

  // The page is see-through where the frame is (Windows), and the picture goes there.
  useLayoutEffect(() => {
    const element = frame.current;
    if (!element) return;
    const root = document.documentElement;
    root.classList.add("pip-mode");
    if (onLinux) root.classList.add("on-linux");
    const place = () => {
      const r = element.getBoundingClientRect();
      root.style.setProperty("--pip-x", `${r.left}px`);
      root.style.setProperty("--pip-y", `${r.top}px`);
      root.style.setProperty("--pip-w", `${r.width}px`);
      root.style.setProperty("--pip-h", `${r.height}px`);
      const s = window.devicePixelRatio;
      void api.playerSetRect({ x: Math.round(r.left * s), y: Math.round(r.top * s), width: Math.round(r.width * s), height: Math.round(r.height * s) }).catch(() => {});
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(document.body);
    window.addEventListener("resize", place);
    // Placed again once the card has slid into place (it moves while it arrives).
    const card = element.closest(".pip");
    card?.addEventListener("animationend", place);
    const settle = window.setTimeout(place, 400);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
      card?.removeEventListener("animationend", place);
      window.clearTimeout(settle);
      root.classList.remove("pip-mode");
      if (!root.classList.contains("video-mode")) root.classList.remove("on-linux");
    };
  }, []);

  const save = useCallback(() => {
    const { time, duration, ended } = state.current;
    if (session.target.itemId === 0 || duration <= 0) return Promise.resolve();
    return api.watchProgressSave(session.target.itemId, session.target.partId, ended ? duration : time, duration).catch(() => {});
  }, [session.target]);

  const close = useCallback(() => {
    void save().finally(() => libraryChanged(queryClient));
    void api.playerClose().catch(() => {});
    pip.set(null);
  }, [save, queryClient]);

  useEffect(() => {
    const off = listen<{ event?: string; name?: string; data?: unknown }>("player-event", ({ payload }) => {
      if (payload.event === "property-change") {
        if (payload.name === "time-pos" && typeof payload.data === "number") state.current.time = payload.data;
        if (payload.name === "duration" && typeof payload.data === "number") state.current.duration = payload.data;
        if (payload.name === "pause") {
          state.current.paused = payload.data === true;
          setPaused(payload.data === true);
        }
        if (payload.name === "eof-reached" && payload.data === true) {
          state.current.ended = true;
          close();
        }
      }
    });
    const timer = window.setInterval(() => {
      if (!state.current.paused) void save();
    }, SAVE_EVERY_MS);
    return () => {
      void off.then((stop) => stop());
      window.clearInterval(timer);
    };
  }, [save, close]);

  // The media keys reach the corner video too (D-058).
  useEffect(() => {
    setVideoMedia({
      title: session.target.title,
      subtitle: session.target.episode,
      paused,
      toggle: () => void api.playerCommand(["cycle", "pause"]).catch(() => {}),
      play: () => void api.playerCommand(["set_property", "pause", false]).catch(() => {}),
      pause: () => void api.playerCommand(["set_property", "pause", true]).catch(() => {}),
      stop: close,
    });
  }, [paused, session.target, close]);
  useEffect(() => () => setVideoMedia(null), []);

  const expand = () => {
    // The player takes the running session back.
    pip.set({ ...session, time: state.current.time, duration: state.current.duration, paused: state.current.paused });
    void navigate({ to: "/watch/$id", params: { id: String(session.target.itemId) }, search: session.target.partId != null ? { part: session.target.partId } : {} });
  };

  return (
    <div className="pip" role="region" aria-label="Video in the corner">
      <div ref={frame} className="pip-frame" style={{ width: WIDTH, height: HEIGHT }} onDoubleClick={expand} />
      <div className="pip-bar">
        <div className="pip-title">
          <strong>{session.target.title}</strong>
          {session.target.episode && <span>{session.target.episode}</span>}
        </div>
        <button type="button" className="icon-btn" aria-label={paused ? "Play" : "Pause"} title={paused ? "Play" : "Pause"} onClick={() => void api.playerCommand(["cycle", "pause"]).catch(() => {})}>
          {paused ? <Play size={16} /> : <Pause size={16} />}
        </button>
        <button type="button" className="icon-btn" aria-label="Back to the full player" title="Back to the full player" onClick={expand}>
          <Maximize2 size={16} />
        </button>
        <button type="button" className="icon-btn" aria-label="Close the video" title="Close the video" onClick={close}>
          <X size={16} />
        </button>
      </div>
    </div>
  );
}

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Maximize2, Pause, Play, X } from "lucide-react";
import { Marquee } from "../../components/Marquee";
import { api, onLinux } from "../../lib/api";
import { pip, usePip } from "../../lib/pip";
import { setVideoMedia } from "../../lib/mediaKeys";
import { useAmbientHold } from "../../lib/ambient/AmbientProvider";
import { libraryChanged } from "../../lib/queries";
import { usePreferences } from "../../lib/preferences";

const WIDTH = 384;
const HEIGHT = 216;
const SAVE_EVERY_MS = 10_000;

/**
 * The video in the corner (D-053): mpv keeps playing in a small frame in a corner while you
 * browse. On Windows the picture sits under the window, so the page gets a hole there; on Linux it
 * sits above the page in the frame. Play/pause, make it big again, or close it. Dragged by its bar,
 * it follows the mouse and settles in the nearest corner when let go, and stays there (D-145).
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
  const card = useRef<HTMLDivElement>(null);
  const { preferences, update } = usePreferences();
  const corner = preferences.pipCorner;
  /** Places the picture where the frame is; set by the layout effect below. */
  const placeNow = useRef<() => void>(() => {});
  const [paused, setPaused] = useState(session.paused);
  const state = useRef({ time: session.time, duration: session.duration, paused: session.paused, ended: false });
  useAmbientHold("video", true);

  // The page is see-through where the frame is (Windows), and the picture goes there. The hole only
  // ever opens where the picture surely is (D-146): while it's being moved, over where it was and
  // where it's going both, and over its new place once it's there. Opened ahead of the picture,
  // the window showed the desktop through it for a moment when the video was dragged quickly.
  useLayoutEffect(() => {
    const element = frame.current;
    if (!element) return;
    const root = document.documentElement;
    root.classList.add("pip-mode");
    if (onLinux) root.classList.add("on-linux");
    type Box = { x: number; y: number; w: number; h: number };
    const hole = (box: Box | null) => {
      root.style.setProperty("--pip-x", `${box ? box.x : -10}px`);
      root.style.setProperty("--pip-y", `${box ? box.y : -10}px`);
      root.style.setProperty("--pip-w", `${box ? box.w : 1}px`);
      root.style.setProperty("--pip-h", `${box ? box.h : 1}px`);
    };
    const overlap = (a: Box | null, b: Box | null): Box | null => {
      if (!a || !b) return null;
      const x = Math.max(a.x, b.x);
      const y = Math.max(a.y, b.y);
      const w = Math.min(a.x + a.w, b.x + b.w) - x;
      const h = Math.min(a.y + a.h, b.y + b.h) - y;
      return w > 0 && h > 0 ? { x, y, w, h } : null;
    };
    const same = (a: Box | null, b: Box | null) => !!a && !!b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
    /** Where the picture is, where it's being sent, and where the frame is now. */
    let at: Box | null = null;
    let sending: Box | null = null;
    let wanted: Box | null = null;
    let gone = false;
    const step = () => {
      if (gone || !wanted) return;
      hole(sending ? overlap(overlap(at, sending), wanted) : same(at, wanted) ? wanted : overlap(at, wanted));
      if (sending || same(at, wanted)) return;
      const to = wanted;
      sending = to;
      const s = window.devicePixelRatio;
      void api
        .playerSetRect({ x: Math.round(to.x * s), y: Math.round(to.y * s), width: Math.round(to.w * s), height: Math.round(to.h * s) })
        .catch(() => {})
        .finally(() => {
          at = to;
          sending = null;
          // The page shows the new hole a frame later; the picture is already there by then.
          requestAnimationFrame(step);
        });
    };
    const place = () => {
      const r = element.getBoundingClientRect();
      wanted = { x: r.left, y: r.top, w: r.width, h: r.height };
      step();
    };
    placeNow.current = place;
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
      gone = true;
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

  // Dragging (D-145): the card follows the mouse, the picture with it; let go, it settles in the
  // nearest corner, gliding there from where it was dropped.
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const dropped = useRef<DOMRect | null>(null);
  const follow = (ms: number) => {
    const end = performance.now() + ms;
    const tick = () => {
      placeNow.current();
      if (performance.now() < end) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  const settleFrom = (from: DOMRect) => {
    const element = card.current;
    if (!element) return;
    element.style.transition = "none";
    element.style.transform = "none";
    const to = element.getBoundingClientRect();
    element.style.transform = `translate(${from.left - to.left}px, ${from.top - to.top}px)`;
    void element.offsetWidth;
    element.style.transition = "transform 260ms var(--ease)";
    element.style.transform = "none";
    follow(320);
  };
  useLayoutEffect(() => {
    const from = dropped.current;
    dropped.current = null;
    if (from) settleFrom(from);
  }, [corner]);
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
    // No text selection or native drag may start (either would cancel this one).
    event.preventDefault();
    window.getSelection()?.removeAllRanges();
    drag.current = { x: event.clientX, y: event.clientY, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const moving = drag.current;
    const element = card.current;
    if (!moving || !element) return;
    const dx = event.clientX - moving.x;
    const dy = event.clientY - moving.y;
    if (!moving.moved && Math.hypot(dx, dy) < 4) return;
    moving.moved = true;
    element.classList.add("dragging");
    element.style.animation = "none";
    element.style.transition = "none";
    element.style.transform = `translate(${dx}px, ${dy}px)`;
    placeNow.current();
  };
  const onPointerUp = () => {
    const moving = drag.current;
    drag.current = null;
    const element = card.current;
    if (!moving?.moved || !element) return;
    element.classList.remove("dragging");
    const from = element.getBoundingClientRect();
    const next = `${from.top + from.height / 2 < window.innerHeight / 2 ? "t" : "b"}${from.left + from.width / 2 < window.innerWidth / 2 ? "l" : "r"}` as typeof corner;
    if (next === corner) settleFrom(from);
    else {
      dropped.current = from;
      update({ pipCorner: next });
    }
  };

  const expand = () => {
    // The player takes the running session back.
    pip.set({ ...session, time: state.current.time, duration: state.current.duration, paused: state.current.paused });
    void navigate({ to: "/watch/$id", params: { id: String(session.target.itemId) }, search: session.target.partId != null ? { part: session.target.partId } : {} });
  };

  return (
    <div ref={card} className="pip" data-corner={corner} role="region" aria-label="Video in the corner" onDragStart={(event) => event.preventDefault()}>
      <div ref={frame} className="pip-frame" style={{ width: WIDTH, height: HEIGHT }} onDoubleClick={expand} />
      <div className="pip-bar" title="Drag to move it to another corner" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
        <div className="pip-title">
          <Marquee className="pip-name" text={session.target.title} />
          {session.target.episode && <Marquee className="pip-sub" text={session.target.episode} />}
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

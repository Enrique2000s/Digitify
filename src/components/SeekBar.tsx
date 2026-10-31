import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

/** How often a drag asks the player for a fresh frame. */
const DRAG_SEEK_MS = 70;
/** After a seek, the bar stays at the target until the player reports a time this close to it… */
const ARRIVED_WITHIN = 1.5;
/** …or this long has passed. */
const HOLD_MS = 3000;

export interface SeekMark {
  time: number;
  title?: string;
}

/**
 * A position bar for the video and music players. Clicking jumps straight to a spot; dragging
 * previews as it goes (`exact` false, so the player can use fast keyframe seeks) and lands
 * exactly where it's let go. After a seek, the bar holds the target until the player catches up,
 * so it never snaps back to where playback was.
 */
export function SeekBar({
  time,
  duration,
  onSeek,
  marks = [],
  clock,
  timeClassName,
  step = 5,
}: {
  time: number;
  duration: number;
  onSeek: (seconds: number, exact: boolean) => void;
  marks?: SeekMark[];
  clock: (seconds: number) => string;
  timeClassName?: string;
  /** Seconds the arrow keys move. */
  step?: number;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const scrubRef = useRef<number | null>(null);
  const lastSent = useRef(0);
  const trailing = useRef(0);
  const [scrub, setScrub] = useState<number | null>(null);
  const [held, setHeld] = useState<number | null>(null);
  const [hover, setHover] = useState<{ x: number; seconds: number } | null>(null);

  // The player has caught up with the last seek (or never will): follow it again.
  useEffect(() => {
    if (held !== null && Math.abs(time - held) < ARRIVED_WITHIN) setHeld(null);
  }, [time, held]);
  useEffect(() => {
    if (held === null) return;
    const timer = window.setTimeout(() => setHeld(null), HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [held]);
  useEffect(() => () => window.clearTimeout(trailing.current), []);

  const position = Math.min(scrub ?? held ?? time, duration || 0);
  const fill = duration > 0 ? (position / duration) * 100 : 0;

  const at = (clientX: number) => {
    const r = bar.current?.getBoundingClientRect();
    if (!r || r.width <= 0 || duration <= 0) return { x: 0, seconds: 0 };
    const x = Math.min(Math.max(clientX - r.left, 0), r.width);
    return { x, seconds: (x / r.width) * duration };
  };
  const preview = (seconds: number) => {
    scrubRef.current = seconds;
    window.clearTimeout(trailing.current);
    const send = () => {
      lastSent.current = performance.now();
      if (dragging.current && scrubRef.current !== null) onSeek(scrubRef.current, false);
    };
    const wait = DRAG_SEEK_MS - (performance.now() - lastSent.current);
    if (wait <= 0) send();
    else trailing.current = window.setTimeout(send, wait);
  };
  const land = (seconds: number) => {
    window.clearTimeout(trailing.current);
    onSeek(seconds, true);
    setHeld(seconds);
  };
  const finish = () => {
    if (!dragging.current) return;
    dragging.current = false;
    const seconds = scrubRef.current;
    scrubRef.current = null;
    setScrub(null);
    if (seconds !== null) land(seconds);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || duration <= 0) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragging.current = true;
    const { seconds } = at(event.clientX);
    scrubRef.current = seconds;
    setScrub(seconds);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const point = at(event.clientX);
    setHover(point);
    if (!dragging.current) return;
    setScrub(point.seconds);
    preview(point.seconds);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (duration <= 0) return;
    const from = held ?? time;
    const to = {
      ArrowLeft: from - step,
      ArrowDown: from - step,
      ArrowRight: from + step,
      ArrowUp: from + step,
      PageDown: from - step * 6,
      PageUp: from + step * 6,
      Home: 0,
      End: duration - 0.5,
    }[event.key];
    if (to === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    land(Math.min(Math.max(to, 0), duration));
  };

  const hoverMark = hover && [...marks].reverse().find((mark) => mark.time <= hover.seconds);
  return (
    <>
      <span className={timeClassName}>{clock(position)}</span>
      <div
        ref={bar}
        className={`seek${scrub !== null ? " dragging" : ""}`}
        role="slider"
        tabIndex={0}
        aria-label="Position"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(position)}
        aria-valuetext={`${clock(position)} of ${clock(duration)}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finish}
        onPointerCancel={finish}
        onLostPointerCapture={finish}
        onPointerLeave={() => setHover(null)}
        onKeyDown={onKeyDown}
      >
        <div className="seek-track">
          <div className="seek-fill" style={{ width: `${fill}%` }} />
          {duration > 0 &&
            marks
              .filter((mark) => mark.time > 0 && mark.time < duration)
              .map((mark, index) => <span key={index} className="seek-mark watch-tick" style={{ left: `${(mark.time / duration) * 100}%` }} />)}
        </div>
        <div className="seek-thumb" style={{ left: `${fill}%` }} />
        {hover && duration > 0 && (
          <div className="seek-hover" style={{ left: hover.x }}>
            {hoverMark?.title && <span>{hoverMark.title}</span>}
            {clock(hover.seconds)}
          </div>
        )}
      </div>
      <span className={timeClassName}>{clock(duration)}</span>
    </>
  );
}

import { useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type RefObject } from "react";

/** `list` with the item at `from` moved to `to`. */
export function arrayMove<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

interface Drag {
  from: number;
  to: number;
  /** How far the dragged row has moved, in pixels. */
  dy: number;
  /** How far the rows it passes step aside. */
  shift: number;
}

const SETTLE = "transform 170ms cubic-bezier(0.2, 0.7, 0.2, 1)";

/** Follows the pointer on the window, so the drag goes on even if a virtualized row is re-rendered. */
function followPointer(_target: HTMLElement, _pointerId: number, onMove: (event: PointerEvent) => void, onEnd: () => void) {
  const end = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", end);
    window.removeEventListener("pointercancel", end);
    document.documentElement.classList.remove("reordering");
    onEnd();
  };
  document.documentElement.classList.add("reordering");
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", end);
  window.addEventListener("pointercancel", end);
}

function rowStyle(drag: Drag | null, index: number, extra = 0): CSSProperties | undefined {
  if (!drag) return undefined;
  const { from, to, dy, shift } = drag;
  if (index === from) return { transform: `translateY(${dy + extra}px)`, zIndex: 20, transition: "none", boxShadow: "var(--pop-shadow)", position: "relative" };
  if (from < to && index > from && index <= to) return { transform: `translateY(${-shift}px)`, transition: SETTLE };
  if (to < from && index >= to && index < from) return { transform: `translateY(${shift}px)`, transition: SETTLE };
  return { transition: SETTLE };
}

/**
 * Reordering a short vertical list by dragging a row's handle (the rows are the list element's
 * children marked `data-reorder`). The other rows step aside as it passes; letting go calls
 * `onMove(from, to)`.
 */
export function useReorder(onMove: (from: number, to: number) => void) {
  const listRef = useRef<HTMLElement | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);

  const start = (from: number) => (event: ReactPointerEvent<HTMLElement>) => {
    const list = listRef.current;
    if (event.button !== 0 || !list) return;
    event.preventDefault();
    const rects = [...list.querySelectorAll<HTMLElement>(":scope > [data-reorder]")].map((row) => row.getBoundingClientRect());
    if (!rects[from]) return;
    const gap = rects.length > 1 ? Math.max(0, rects[1].top - rects[0].bottom) : 0;
    const shift = rects[from].height + gap;
    const y0 = event.clientY;
    let state: Drag = { from, to: from, dy: 0, shift };
    setDrag(state);
    followPointer(
      event.currentTarget,
      event.pointerId,
      (move) => {
        const dy = move.clientY - y0;
        const center = rects[from].top + rects[from].height / 2 + dy;
        // The new place: how many of the other rows are above the dragged one's middle.
        const to = rects.filter((rect, i) => i !== from && rect.top + rect.height / 2 < center).length;
        state = { from, to, dy, shift };
        setDrag(state);
      },
      () => {
        setDrag(null);
        if (state.to !== state.from) onMove(state.from, state.to);
      },
    );
  };

  return {
    listRef: listRef as RefObject<never>,
    dragging: drag?.from ?? null,
    /** Props for a row's drag handle. */
    handle: (index: number) => ({ onPointerDown: start(index), className: "drag-handle", title: "Drag to reorder", role: "presentation" as const }),
    style: (index: number) => rowStyle(drag, index),
  };
}

/**
 * The same for a long, virtualized list of rows `rowHeight` tall inside `scroller`: the list
 * scrolls by itself while a row is dragged near its top or bottom edge.
 */
export function useVirtualReorder(rowHeight: number, scroller: RefObject<HTMLElement | null>, onMove: (from: number, to: number) => void) {
  const [drag, setDrag] = useState<(Drag & { scrolled: number }) | null>(null);

  const start = (from: number, count: number) => (event: ReactPointerEvent<HTMLElement>) => {
    const box = scroller.current;
    if (event.button !== 0 || !box) return;
    event.preventDefault();
    const y0 = event.clientY;
    const top0 = box.scrollTop;
    let pointerY = y0;
    let state = { from, to: from, dy: 0, shift: rowHeight, scrolled: 0 };
    const update = () => {
      const scrolled = box.scrollTop - top0;
      const dy = pointerY - y0;
      const to = Math.max(0, Math.min(count - 1, Math.round(from + (dy + scrolled) / rowHeight)));
      state = { from, to, dy, shift: rowHeight, scrolled };
      setDrag(state);
    };
    let frame = 0;
    const edgeScroll = () => {
      const rect = box.getBoundingClientRect();
      const speed = pointerY < rect.top + 48 ? -(rect.top + 48 - pointerY) / 3 : pointerY > rect.bottom - 48 ? (pointerY - (rect.bottom - 48)) / 3 : 0;
      if (speed) {
        box.scrollTop += Math.max(-24, Math.min(24, speed));
        update();
      }
      frame = requestAnimationFrame(edgeScroll);
    };
    frame = requestAnimationFrame(edgeScroll);
    setDrag(state);
    followPointer(
      event.currentTarget,
      event.pointerId,
      (move) => {
        pointerY = move.clientY;
        update();
      },
      () => {
        cancelAnimationFrame(frame);
        setDrag(null);
        if (state.to !== state.from) onMove(state.from, state.to);
      },
    );
  };

  return {
    dragging: drag?.from ?? null,
    handle: (index: number, count: number) => ({ onPointerDown: start(index, count), className: "drag-handle", title: "Drag to reorder", role: "presentation" as const }),
    style: (index: number) => rowStyle(drag, index, drag?.scrolled ?? 0),
  };
}

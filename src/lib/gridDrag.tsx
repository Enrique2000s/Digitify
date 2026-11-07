import { createContext, useContext, useMemo, type PointerEvent as ReactPointerEvent } from "react";

/**
 * Dragging cards to a new place in a grid, list or shelf (custom order: the Library, D-024; Arcade,
 * D-034). Pointer events rather than HTML drag and drop, which the window's file drop takes over.
 *
 * A press becomes a drag after the pointer moves a few pixels (a click stays a click); a copy of the
 * card follows the pointer, the card under it shows where the dragged one will go (before or after
 * it), and the view scrolls by itself near its top and bottom edges. Works with virtualized views:
 * the target is whatever card is under the pointer.
 */
export interface GridDrag {
  /** Called with the dragged card, the card it was dropped on, and whether it goes after that card. */
  onDrop: (dragged: number, target: number, after: boolean) => void;
}

const Context = createContext<GridDrag | null>(null);

export function GridDragProvider({ value, children }: { value: GridDrag | null; children: React.ReactNode }) {
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/** Props that make a card draggable while a provider above enables dragging; none otherwise. */
export function useGridDragProps(id: number) {
  const drag = useContext(Context);
  return useMemo(() => (drag && id > 0 ? dragProps(id, drag.onDrop) : {}), [drag, id]);
}

const THRESHOLD = 6;
const EDGE = 70;

export function dragProps(id: number, onDrop: GridDrag["onDrop"]) {
  return {
    "data-drag-id": id,
    // Links and images would otherwise start the browser's own drag.
    onDragStart: (event: React.DragEvent) => event.preventDefault(),
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      // Controls inside a card (a play button, say) keep their own press.
      if (event.button !== 0 || (event.target as HTMLElement).closest("input, select, textarea, [data-no-drag]")) return;
      startDrag(event, id, onDrop);
    },
  };
}

function startDrag(down: ReactPointerEvent<HTMLElement>, id: number, onDrop: GridDrag["onDrop"]) {
  const source = down.currentTarget;
  const x0 = down.clientX;
  const y0 = down.clientY;
  const pointer = down.pointerId;
  let ghost: HTMLElement | null = null;
  let target: { el: HTMLElement; after: boolean } | null = null;
  let last = { x: x0, y: y0 };
  let frame = 0;
  const scroller = scrollParent(source);
  const rect = source.getBoundingClientRect();

  const mark = (next: typeof target) => {
    if (target && (target.el !== next?.el || target.after !== next?.after)) target.el.classList.remove("drop-before", "drop-after");
    target = next;
    if (target) target.el.classList.add(target.after ? "drop-after" : "drop-before");
  };

  const locate = () => {
    if (!ghost) return;
    ghost.style.transform = `translate(${last.x - x0}px, ${last.y - y0}px) rotate(-2deg)`;
    const under = document.elementFromPoint(last.x, last.y)?.closest<HTMLElement>("[data-drag-id]");
    if (!under || under === source) return mark(null);
    const box = under.getBoundingClientRect();
    // Rows (lists) split top and bottom; grids and shelves split left and right.
    const wide = box.width > box.height * 2.2;
    const after = wide ? last.y > box.top + box.height / 2 : last.x > box.left + box.width / 2;
    mark({ el: under, after });
  };

  // Scrolls while the pointer is near the view's top or bottom edge.
  const tick = () => {
    frame = 0;
    if (!ghost || !scroller) return;
    const box = scroller.getBoundingClientRect();
    const speed = last.y < box.top + EDGE ? -(box.top + EDGE - last.y) : last.y > box.bottom - EDGE ? last.y - (box.bottom - EDGE) : 0;
    if (speed) {
      scroller.scrollTop += Math.max(-24, Math.min(24, speed / 3));
      locate();
      frame = requestAnimationFrame(tick);
    }
  };

  const move = (event: PointerEvent) => {
    if (event.pointerId !== pointer) return;
    last = { x: event.clientX, y: event.clientY };
    if (!ghost) {
      if (Math.hypot(last.x - x0, last.y - y0) < THRESHOLD) return;
      ghost = source.cloneNode(true) as HTMLElement;
      ghost.classList.add("drag-ghost");
      Object.assign(ghost.style, { position: "fixed", left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`, margin: "0", zIndex: "1000", pointerEvents: "none" });
      document.body.appendChild(ghost);
      source.classList.add("drag-source");
      document.documentElement.classList.add("dragging-cards");
    }
    event.preventDefault();
    locate();
    if (!frame) frame = requestAnimationFrame(tick);
  };

  const end = (event: PointerEvent) => {
    if (event.pointerId !== pointer) return;
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", end);
    window.removeEventListener("pointercancel", end);
    if (frame) cancelAnimationFrame(frame);
    if (!ghost) return; // a plain click
    ghost.remove();
    source.classList.remove("drag-source");
    document.documentElement.classList.remove("dragging-cards");
    // The click that follows a drag doesn't open the card.
    const swallow = (click: MouseEvent) => {
      click.preventDefault();
      click.stopPropagation();
    };
    window.addEventListener("click", swallow, { capture: true, once: true });
    window.setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
    const dropped = target;
    mark(null);
    if (event.type === "pointerup" && dropped) {
      const targetId = Number(dropped.el.dataset.dragId);
      if (targetId && targetId !== id) onDrop(id, targetId, dropped.after);
    }
  };

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", end);
  window.addEventListener("pointercancel", end);
}

function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight) return node;
  }
  return null;
}

/** `ids` with `dragged` moved before or after `target`. */
export function moved(ids: number[], dragged: number, target: number, after: boolean): number[] {
  const rest = ids.filter((id) => id !== dragged);
  const at = rest.indexOf(target);
  if (at < 0) return ids;
  rest.splice(after ? at + 1 : at, 0, dragged);
  return rest;
}

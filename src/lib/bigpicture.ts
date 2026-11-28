import { useSyncExternalStore } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * Big Picture (D-025): a full-screen interface for the TV, driven by a controller. Whether it's on
 * is kept for the session, so the readers and the player opened from it know to listen to the
 * controller and to stay full screen.
 */
const KEY = "digitify:big-picture";
const listeners = new Set<() => void>();
let active = (() => {
  try {
    return sessionStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
})();

function set(on: boolean) {
  active = on;
  try {
    if (on) sessionStorage.setItem(KEY, "1");
    else sessionStorage.removeItem(KEY);
  } catch {
    // Private storage can be unavailable; the flag still holds for this page.
  }
  document.documentElement.classList.toggle("bp-mode", on);
  listeners.forEach((listener) => listener());
}
if (active) document.documentElement.classList.add("bp-mode");

export function bigPictureActive(): boolean {
  return active;
}

export function useBigPicture(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => active,
  );
}

/** Set when Big Picture is entered, so its page plays the startup animation once (D-070). */
let introPending = false;
export function takeIntro(): boolean {
  const pending = introPending;
  introPending = false;
  return pending;
}

export async function enterBigPicture(go: () => void) {
  introPending = !active;
  set(true);
  go();
  await getCurrentWindow().setFullscreen(true).catch(() => {});
}

export async function exitBigPicture(go: () => void) {
  set(false);
  go();
  await getCurrentWindow().setFullscreen(false).catch(() => {});
}

// ------------------------------------------------------------------ moving the selection

const FOCUSABLE = "[data-bp-focus]:not([disabled])";

function visible(element: HTMLElement): boolean {
  const r = element.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(element).visibility !== "hidden";
}

/** The selectable elements inside `root`. */
export function focusables(root: ParentNode, selector = FOCUSABLE): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(selector)].filter(visible);
}

function select(element: HTMLElement) {
  element.focus({ preventScroll: true });
  element.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
}

/** Selects the first selectable element (or the one marked `data-bp-autofocus`). */
export function focusFirst(root: ParentNode) {
  const list = focusables(root);
  const first = list.find((e) => e.hasAttribute("data-bp-autofocus")) ?? list[0];
  if (first) select(first);
}

/** The nearest ancestor that scrolls up and down, if any. */
function scrollParent(element: HTMLElement): HTMLElement | null {
  for (let e = element.parentElement; e; e = e.parentElement) {
    const overflow = getComputedStyle(e).overflowY;
    if ((overflow === "auto" || overflow === "scroll") && e.scrollHeight > e.clientHeight + 1) return e;
  }
  return null;
}

/**
 * Moves the selection to the nearest selectable element in a direction (D-184):
 * - up and down go to the next row first (the nearest band of elements ahead), then to the one most
 *   in line with the current one, so no row is skipped for one further on that's more in line;
 * - elements in the same row (or column) never count as above or below (or beside), whatever their
 *   heights, so the selection can't bounce between covers of different shapes;
 * - after the right stick has scrolled the selection out of sight, it starts again from what's on
 *   screen;
 * - it never jumps past what hasn't been seen: when the next element is more than a screen away
 *   (a tall panel between), the page scrolls toward it instead, a step at a time.
 * Returns false when there's nothing that way.
 */
export function moveFocus(root: HTMLElement, direction: "up" | "down" | "left" | "right", selector = FOCUSABLE): boolean {
  const list = focusables(root, selector);
  const current = document.activeElement instanceof HTMLElement && root.contains(document.activeElement) && document.activeElement.matches(selector) ? document.activeElement : null;
  if (!current) {
    const first = list.find((e) => e.hasAttribute("data-bp-autofocus")) ?? list[0];
    if (first) select(first);
    return !!first;
  }
  const from = current.getBoundingClientRect();
  const height = window.innerHeight;
  // Scrolled out of sight (the right stick): the element on screen nearest the middle, toward the
  // direction pressed.
  if (from.bottom < 0 || from.top > height) {
    // Only within what scrolled (the page), not the top bar that stays on screen.
    const area = scrollParent(current);
    let near: HTMLElement | null = null;
    let nearest = Infinity;
    for (const candidate of list) {
      if (area && !area.contains(candidate)) continue;
      const r = candidate.getBoundingClientRect();
      if (r.bottom <= 0 || r.top >= height || r.right <= 0 || r.left >= window.innerWidth) continue;
      const y = r.top + r.height / 2;
      const target = direction === "down" ? height * 0.25 : direction === "up" ? height * 0.75 : height / 2;
      const distance = Math.abs(y - target) + Math.abs(r.left - from.left) * 0.25;
      if (distance < nearest) {
        nearest = distance;
        near = candidate;
      }
    }
    if (near) {
      select(near);
      return true;
    }
  }
  const cx = from.left + from.width / 2;
  const cy = from.top + from.height / 2;
  const vertical = direction === "up" || direction === "down";
  const found: { element: HTMLElement; along: number; across: number }[] = [];
  for (const candidate of list) {
    if (candidate === current || candidate.contains(current) || current.contains(candidate)) continue;
    const r = candidate.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const overlapY = Math.min(from.bottom, r.bottom) - Math.max(from.top, r.top);
    const overlapX = Math.min(from.right, r.right) - Math.max(from.left, r.left);
    const sameRow = overlapY > 0.5 * Math.min(from.height, r.height);
    const sameColumn = overlapX > 0.5 * Math.min(from.width, r.width);
    const gapX = Math.max(0, r.left - from.right, from.left - r.right);
    const gapY = Math.max(0, r.top - from.bottom, from.top - r.bottom);
    switch (direction) {
      case "down":
        if (sameRow || y <= cy + 2) continue;
        found.push({ element: candidate, along: Math.max(0, r.top - from.bottom), across: overlapX > 0 ? 0 : gapX });
        break;
      case "up":
        if (sameRow || y >= cy - 2) continue;
        found.push({ element: candidate, along: Math.max(0, from.top - r.bottom), across: overlapX > 0 ? 0 : gapX });
        break;
      case "right":
        if (sameColumn || x <= cx + 2) continue;
        found.push({ element: candidate, along: Math.max(0, r.left - from.right), across: overlapY > 0 ? 0 : gapY });
        break;
      default:
        if (sameColumn || x >= cx - 2) continue;
        found.push({ element: candidate, along: Math.max(0, from.left - r.right), across: overlapY > 0 ? 0 : gapY });
    }
  }
  if (!found.length) return false;
  let best: (typeof found)[number];
  if (vertical) {
    // The next row: those starting within a little of the nearest, then the most in line.
    const nearest = Math.min(...found.map((f) => f.along));
    const row = found.filter((f) => f.along <= nearest + 48);
    best = row.reduce((a, b) => (b.across < a.across || (b.across === a.across && b.along < a.along) ? b : a));
  } else {
    // Sideways: in the same row when there is one, else the nearest.
    const inRow = found.filter((f) => f.across === 0);
    best = (inRow.length ? inRow : found).reduce((a, b) => (b.along + b.across * 2.5 < a.along + a.across * 2.5 ? b : a));
  }
  // Never past what hasn't been seen: a tall stretch between (a panel with nothing to select) is
  // scrolled through first.
  if (vertical && best.along > height * 0.85) {
    const scroller = scrollParent(best.element);
    if (scroller) {
      scroller.scrollBy({ top: (direction === "down" ? 1 : -1) * height * 0.6, behavior: "smooth" });
      return true;
    }
  }
  select(best.element);
  return true;
}

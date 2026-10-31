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

export async function enterBigPicture(go: () => void) {
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
export function focusables(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(visible);
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

/**
 * Moves the selection to the nearest selectable element in a direction: the closest one ahead,
 * preferring those in line with the current one.
 */
export function moveFocus(root: HTMLElement, direction: "up" | "down" | "left" | "right"): boolean {
  const list = focusables(root);
  const current = document.activeElement instanceof HTMLElement && root.contains(document.activeElement) && document.activeElement.matches(FOCUSABLE) ? document.activeElement : null;
  if (!current) {
    focusFirst(root);
    return true;
  }
  const from = current.getBoundingClientRect();
  const cx = from.left + from.width / 2;
  const cy = from.top + from.height / 2;
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const candidate of list) {
    if (candidate === current || candidate.contains(current) || current.contains(candidate)) continue;
    const r = candidate.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    // How far ahead the candidate is, and how far off the line of travel (0 when they overlap).
    const overlapY = Math.min(from.bottom, r.bottom) - Math.max(from.top, r.top) > 0;
    const overlapX = Math.min(from.right, r.right) - Math.max(from.left, r.left) > 0;
    let along: number;
    let across: number;
    switch (direction) {
      case "right":
        if (x <= cx + 2) continue;
        along = Math.max(0, r.left - from.right);
        across = overlapY ? 0 : Math.abs(y - cy);
        break;
      case "left":
        if (x >= cx - 2) continue;
        along = Math.max(0, from.left - r.right);
        across = overlapY ? 0 : Math.abs(y - cy);
        break;
      case "down":
        if (y <= cy + 2) continue;
        along = Math.max(0, r.top - from.bottom);
        across = overlapX ? 0 : Math.min(Math.abs(r.left - from.left), Math.abs(x - cx));
        break;
      default:
        if (y >= cy - 2) continue;
        along = Math.max(0, from.top - r.bottom);
        across = overlapX ? 0 : Math.min(Math.abs(r.left - from.left), Math.abs(x - cx));
    }
    const score = along + across * 2.5;
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  if (best) select(best);
  return !!best;
}

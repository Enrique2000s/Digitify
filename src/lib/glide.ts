import { useLayoutEffect, useRef } from "react";
import { motionAllowed } from "../features/reader/chrome";

/**
 * Where each named piece of the page was when its view went away, and when, so the same piece in
 * the next view can slide from there instead of jumping (D-096). Library's filter and layout
 * buttons, for one: a category with more tabs, or without the filter, puts them elsewhere.
 */
const last = new Map<string, { left: number; top: number; at: number }>();
const FRESH_MS = 700;

/** Slides an element from where its namesake was in the view before; fades it in if it's new. */
export function useGlide<T extends HTMLElement>(name: string) {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const now = el.getBoundingClientRect();
    const before = last.get(name);
    const fresh = !!before && performance.now() - before.at < FRESH_MS;
    if (motionAllowed() && fresh) {
      const dx = before.left - now.left;
      const dy = before.top - now.top;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
        el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: 300, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" });
      }
    } else if (motionAllowed() && !fresh && recentlyLeft()) {
      // Appearing where the view before had nothing like it (the filter, after Pictures).
      // After the pieces beside it have slid out of its way.
      el.animate([{ opacity: 0, transform: "translateX(-8px)" }, { opacity: 1, transform: "none" }], { duration: 220, delay: 200, easing: "ease-out", fill: "backwards" });
    }
    return () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0) last.set(name, { left: r.left, top: r.top, at: performance.now() });
      lastLeave = performance.now();
    };
  }, [name]);
  return ref;
}

/** When any glided piece last went away: a view change in progress, not a page just opened. */
let lastLeave = -Infinity;
const recentlyLeft = () => performance.now() - lastLeave < FRESH_MS;

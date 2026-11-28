import { useLayoutEffect, useRef } from "react";
import { motionAllowed } from "../features/reader/chrome";

/**
 * Where each named piece of the page was when its view went away, and when, so the same piece in
 * the next view can slide from there instead of jumping (D-096). Library's filter and layout
 * buttons, for one: a category with more tabs, or without the filter, puts them elsewhere.
 */
const last = new Map<string, { left: number; top: number; at: number }>();
const FRESH_MS = 700;

/**
 * A piece that just went away, drawn where it was for a moment (D-184): if the next view has its
 * namesake, that one takes over (and they cross-fade when they show different things, Books' kinds
 * becoming Movies & Series'); if not, the copy fades out instead of vanishing at once.
 */
const ghosts = new Map<string, HTMLElement>();
function leaveGhost(name: string, el: HTMLElement) {
  const r = el.getBoundingClientRect();
  if (!motionAllowed() || r.width === 0) return;
  ghosts.get(name)?.remove();
  const ghost = el.cloneNode(true) as HTMLElement;
  ghost.removeAttribute("id");
  ghost.setAttribute("aria-hidden", "true");
  ghost.classList.add("glide-ghost");
  Object.assign(ghost.style, { position: "fixed", left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, margin: "0", pointerEvents: "none", zIndex: "5" });
  document.body.appendChild(ghost);
  ghosts.set(name, ghost);
  const made = performance.now();
  // Unclaimed by the next view once it has drawn: fade away. Leaving the page altogether (no
  // glided piece came after it, Library to Home): just gone, not fading over the next page.
  requestAnimationFrame(() => {
    if (ghosts.get(name) !== ghost) return;
    ghosts.delete(name);
    if (lastMount < made) ghost.remove();
    else fadeOut(ghost);
  });
}
function fadeOut(ghost: HTMLElement) {
  ghost.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateX(-8px)" }], { duration: 200, easing: "ease-in", fill: "forwards" }).finished.then(
    () => ghost.remove(),
    () => ghost.remove(),
  );
}

/**
 * Slides an element from where its namesake was in the view before; fades it in if it's new, and
 * out when it goes (D-184).
 */
export function useGlide<T extends HTMLElement>(name: string) {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    lastMount = performance.now();
    const now = el.getBoundingClientRect();
    const before = last.get(name);
    const fresh = !!before && performance.now() - before.at < FRESH_MS;
    const ghost = ghosts.get(name);
    if (ghost) ghosts.delete(name);
    if (motionAllowed() && fresh) {
      const dx = before.left - now.left;
      const dy = before.top - now.top;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
        el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: 300, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" });
      }
      // The same piece showing something else: the old fades as the new comes in.
      if (ghost && ghost.textContent !== el.textContent) {
        el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, easing: "ease-out" });
        fadeOut(ghost);
      } else ghost?.remove();
    } else if (motionAllowed() && !fresh && recentlyLeft()) {
      ghost?.remove();
      // Appearing where the view before had nothing like it (the filter, after Pictures).
      // After the pieces beside it have slid out of its way.
      el.animate([{ opacity: 0, transform: "translateX(-8px)" }, { opacity: 1, transform: "none" }], { duration: 220, delay: 200, easing: "ease-out", fill: "backwards" });
    }
    return () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0) last.set(name, { left: r.left, top: r.top, at: performance.now() });
      lastLeave = performance.now();
      leaveGhost(name, el);
    };
  }, [name]);
  return ref;
}

/** When any glided piece last went away: a view change in progress, not a page just opened. */
let lastLeave = -Infinity;
/** When a glided piece last came in. */
let lastMount = -Infinity;
const recentlyLeft = () => performance.now() - lastLeave < FRESH_MS;

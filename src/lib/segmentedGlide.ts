import { useEffect } from "react";

/**
 * Button groups (`.segmented`: Library's sections, Arcade's views, layouts, filters, Music's tabs…)
 * get one highlight that slides to the chosen button instead of jumping (D-047). It follows
 * whichever child is chosen (`aria-pressed`, `aria-selected` or a router link's `data-status`),
 * and a group drawn again in a new view (changing category rebuilds the strip) starts its
 * highlight where the same group's was, so it still slides.
 */
const CHOSEN = ':scope > [aria-pressed="true"], :scope > [aria-selected="true"], :scope > [data-status="active"]';
/** The title bar's Home / Library / Arcade mark theirs as the current page (D-145). */
const CURRENT = ':scope > [aria-current="page"]';
const GROUPS = ".segmented, .appbar-nav";

/** Where each named group's highlight last was, so a redrawn group slides from there. */
const last = new Map<string, { x: number; y: number; w: number; h: number }>();

function place(group: HTMLElement) {
  let glider = group.querySelector<HTMLElement>(":scope > .seg-glider");
  const chosen = group.querySelector<HTMLElement>(group.classList.contains("appbar-nav") ? CURRENT : CHOSEN);
  const name = group.getAttribute("aria-label") ?? "";
  if (!glider) {
    glider = document.createElement("span");
    glider.className = "seg-glider";
    glider.setAttribute("aria-hidden", "true");
    group.prepend(glider);
    group.classList.add("glide");
    // Start where this group's highlight was (or at the chosen button), without a transition.
    const from = last.get(name);
    if (from) {
      glider.style.transition = "none";
      glider.style.width = `${from.w}px`;
      glider.style.height = `${from.h}px`;
      glider.style.transform = `translate(${from.x}px, ${from.y}px)`;
      void glider.offsetWidth;
      glider.style.transition = "";
    } else if (chosen) {
      glider.style.transition = "none";
      glider.style.width = `${chosen.offsetWidth}px`;
      glider.style.height = `${chosen.offsetHeight}px`;
      glider.style.transform = `translate(${chosen.offsetLeft}px, ${chosen.offsetTop}px)`;
      void glider.offsetWidth;
      glider.style.transition = "";
    }
  }
  if (!chosen) {
    glider.style.opacity = "0";
    return;
  }
  const at = { x: chosen.offsetLeft, y: chosen.offsetTop, w: chosen.offsetWidth, h: chosen.offsetHeight };
  glider.style.opacity = "1";
  glider.style.width = `${at.w}px`;
  glider.style.height = `${at.h}px`;
  glider.style.transform = `translate(${at.x}px, ${at.y}px)`;
  if (name) last.set(name, at);
}

/** Keeps every button group's highlight on its chosen button, for the whole window. */
export function useSegmentedGlide() {
  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => document.querySelectorAll<HTMLElement>(GROUPS).forEach(place));
    };
    const observer = new MutationObserver((records) => {
      // Our own highlight moving isn't a change to follow.
      if (records.every((r) => (r.target as HTMLElement).classList?.contains("seg-glider"))) return;
      update();
    });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-pressed", "aria-selected", "data-status", "aria-current"] });
    const resized = new ResizeObserver(update);
    resized.observe(document.body);
    window.addEventListener("resize", update);
    document.fonts?.ready.then(update);
    update();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      resized.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);
}

import { useCallback, useEffect, useRef } from "react";
import { api } from "./api";

/** Reading counts only while someone is plausibly reading: within this long of the last page turn or input. */
const READING_IDLE_MS = 5 * 60 * 1000;
const TICK_MS = 5000;
const REPORT_SECONDS = 30;

/**
 * Records time spent with an item for Home's statistics (Phase 5): while a video or music plays
 * (`active`), or while a reader is open, in view and in use. Returns `nudge`, which a reader calls
 * when the page turns (input inside an ebook's pages doesn't reach the window).
 */
export function useActivity(itemId: number | null | undefined, kind: "read" | "watch" | "listen", active: boolean): () => void {
  const lastInput = useRef(performance.now());
  const nudge = useCallback(() => {
    lastInput.current = performance.now();
  }, []);

  useEffect(() => {
    if (!itemId || !active) return;
    let pending = 0;
    let last = performance.now();
    const report = () => {
      const seconds = Math.round(pending);
      if (seconds <= 0) return;
      pending = 0;
      void api.activityAdd(itemId, kind, seconds).catch(() => {});
    };
    const tick = () => {
      const now = performance.now();
      const counts = kind !== "read" || (document.visibilityState === "visible" && now - lastInput.current < READING_IDLE_MS);
      if (counts) pending += Math.min(now - last, TICK_MS * 2) / 1000;
      last = now;
      if (pending >= REPORT_SECONDS) report();
    };
    const onInput = () => (lastInput.current = performance.now());
    if (kind === "read") {
      lastInput.current = performance.now();
      for (const name of ["keydown", "pointermove", "pointerdown", "wheel"]) window.addEventListener(name, onInput, { passive: true });
    }
    const timer = window.setInterval(tick, TICK_MS);
    return () => {
      window.clearInterval(timer);
      tick();
      report();
      if (kind === "read") for (const name of ["keydown", "pointermove", "pointerdown", "wheel"]) window.removeEventListener(name, onInput);
    };
  }, [itemId, kind, active]);
  return nudge;
}

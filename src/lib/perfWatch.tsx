import { useEffect, useRef, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { Gauge, X } from "lucide-react";
import { usePreferences } from "./preferences";
import { useAmbient } from "./ambient/AmbientProvider";

/** How long Digitify settles before it's watched, and each look at how smoothly it draws. */
const SETTLE_MS = 15_000;
const WINDOW_MS = 4_000;
/** Struggling: under 24 frames a second, or a third of the frames late, three looks in a row. */
const MIN_FPS = 24;
const SLOW_SHARE = 0.33;
const STRIKES = 3;

/**
 * Light mode by itself (D-129). Digitify watches how smoothly it draws (frames a second, and how
 * many come late) while it's in front and in use; when this computer struggles to keep up for a
 * while, it turns light mode on (fewer effects and animations) and says so, with a way back.
 * Not while a game, a video or a disc plays (those draw on their own), and only until it's been
 * turned off once by hand: then the choice is the user's.
 */
export function PerfWatch() {
  const { preferences, update } = usePreferences();
  const { inGame } = useAmbient();
  const path = useRouterState({ select: (state) => state.location.pathname });
  const [notice, setNotice] = useState(false);
  const playing = /^\/(watch|disc|lab|view)\b/.test(path);
  const active = preferences.autoLightMode && !preferences.lightMode && !inGame && !playing;
  const strikes = useRef(0);

  useEffect(() => {
    if (!active) {
      strikes.current = 0;
      return;
    }
    let frame = 0;
    let last = 0;
    let started = performance.now();
    let frames = 0;
    let slow = 0;
    let elapsed = 0;
    const settle = window.setTimeout(() => {
      const tick = (now: number) => {
        frame = requestAnimationFrame(tick);
        const delta = last ? now - last : 0;
        last = now;
        // Hidden, minimized or asleep: a long gap isn't slowness.
        if (document.visibilityState !== "visible" || !document.hasFocus() || delta > 1000) {
          frames = slow = elapsed = 0;
          started = now;
          return;
        }
        frames += 1;
        elapsed += delta;
        if (delta > 50) slow += 1;
        if (now - started >= WINDOW_MS) {
          const fps = (frames / elapsed) * 1000;
          const struggling = frames > 20 && (fps < MIN_FPS || slow / frames > SLOW_SHARE);
          strikes.current = struggling ? strikes.current + 1 : 0;
          if (strikes.current >= STRIKES) {
            strikes.current = 0;
            update({ lightMode: true });
            setNotice(true);
          }
          frames = slow = elapsed = 0;
          started = now;
        }
      };
      frame = requestAnimationFrame(tick);
    }, SETTLE_MS);
    return () => {
      window.clearTimeout(settle);
      cancelAnimationFrame(frame);
    };
  }, [active, update]);

  if (!notice) return null;
  return (
    <div className="achievement-notice perf-notice" role="status">
      <span className="achievement-medal" aria-hidden>
        <Gauge size={22} />
      </span>
      <div>
        <strong>Performance mode is on</strong>
        <span>This computer was struggling to keep up, so Digitify turned off its heavier effects and animations. Settings › General can turn it back off.</span>
      </div>
      <button
        type="button"
        className="btn btn-sm"
        onClick={() => {
          // Back as it was, and not again by itself: the user decided.
          update({ lightMode: false, autoLightMode: false });
          setNotice(false);
        }}
      >
        Turn it off
      </button>
      <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => setNotice(false)}>
        <X size={16} />
      </button>
    </div>
  );
}

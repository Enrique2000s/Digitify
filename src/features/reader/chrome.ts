import { bigPictureActive } from "../../lib/bigpicture";
import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

const appWindow = getCurrentWindow();

/** Whether animations may play: the app's motion setting, or the system's when it follows it. */
export function motionAllowed(): boolean {
  // Light mode (slower computers) plays no animations either.
  if (document.documentElement.dataset.perf === "light") return false;
  const choice = document.documentElement.dataset.motion;
  if (choice === "reduced" || choice === "off") return false;
  return choice === "full" || !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Full screen for a reader. Leaving the reader leaves full screen too. */
export function useFullscreen() {
  const [fullscreen, setFullscreen] = useState(false);
  const toggle = useCallback(async () => {
    const next = !(await appWindow.isFullscreen());
    await appWindow.setFullscreen(next);
    setFullscreen(next);
  }, []);
  useEffect(
    () => () => {
      void appWindow.isFullscreen().then((on) => {
        // In Big Picture the whole app stays full screen.
        if (on && !bigPictureActive()) void appWindow.setFullscreen(false);
      });
    },
    [],
  );
  return [fullscreen, toggle] as const;
}

/** Reader controls that hide while reading, come back when the pointer moves, and stay while pointed at. */
export function useAutoHide() {
  const [shown, setShown] = useState(true);
  const hideTimer = useRef(0);
  const hold = useRef(false);
  const poke = useCallback(() => {
    setShown(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => !hold.current && setShown(false), 2600);
  }, []);
  useEffect(() => {
    poke();
    return () => window.clearTimeout(hideTimer.current);
  }, [poke]);
  const barProps = {
    onMouseEnter: () => {
      hold.current = true;
    },
    onMouseLeave: () => {
      hold.current = false;
      poke();
    },
  };
  return { shown, setShown, poke, barProps };
}

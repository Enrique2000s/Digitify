import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

const appWindow = getCurrentWindow();

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
        if (on) void appWindow.setFullscreen(false);
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

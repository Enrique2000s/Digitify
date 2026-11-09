import { useEffect, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAmbient } from "../lib/ambient/AmbientProvider";
import { useMusic } from "../lib/music/MusicProvider";
import { actionFor, allowedWhileTyping, isTyping } from "../lib/shortcuts";

/** The shortcuts that work everywhere (Settings › Keyboard › Everywhere). */
export function AppShortcuts() {
  const navigate = useNavigate();
  const music = useMusic();
  const ambient = useAmbient();
  const latest = useRef({ music, ambient });
  latest.current = { music, ambient };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || (isTyping(event) && !allowedWhileTyping(event))) return;
      const action = actionFor(event, "app");
      if (!action) return;
      const { music, ambient } = latest.current;
      switch (action) {
        case "app.search":
          window.dispatchEvent(new Event("digitify:search"));
          break;
        // The command palette (D-048) opens on its event.
        case "app.palette":
          window.dispatchEvent(new Event("digitify:palette"));
          break;
        case "app.home":
          void navigate({ to: "/" });
          break;
        case "app.settings":
          void navigate({ to: "/settings" });
          break;
        // Library music only: the menu music is switched on and off, not paused.
        case "app.musicPause":
          if (!music.active) return;
          music.toggle();
          break;
        case "app.musicNext":
          if (music.active) music.next();
          else if (ambient.canSkip) ambient.skip();
          break;
        case "app.musicPrevious":
          if (!music.active) return;
          music.previous();
          break;
      }
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);
  return null;
}

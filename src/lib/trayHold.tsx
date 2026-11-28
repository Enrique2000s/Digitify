import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api } from "./api";
import { useAmbientHold } from "./ambient/AmbientProvider";
import { useMusic } from "./music/MusicProvider";

/**
 * Closed to the tray (D-076): the window is away, so nothing plays. The music and a video pause and
 * the menu music is held; opening Digitify again plays the music on from where it stopped. (Its
 * Play / Pause in the tray's menu still works, for someone who wants it.) Started hidden with the
 * computer, it stays quiet until it's opened.
 */
export function TrayHold() {
  const music = useMusic();
  const latest = useRef(music);
  latest.current = music;
  const [hidden, setHidden] = useState(false);
  // The computer locked (D-183): the menu music waits until it's unlocked.
  const [locked, setLocked] = useState(false);
  const resume = useRef(false);
  useAmbientHold("hidden", hidden || locked);

  useEffect(() => {
    void getCurrentWindow()
      .isVisible()
      .then((visible) => !visible && setHidden(true))
      .catch(() => {});
    const offHidden = listen("app-hidden", () => {
      const m = latest.current;
      resume.current = m.active && !m.paused;
      if (resume.current) m.pause();
      void api.playerCommand(["set_property", "pause", true]).catch(() => {});
      setHidden(true);
    });
    const offShown = listen("app-shown", () => {
      setHidden(false);
      if (resume.current && latest.current.paused) latest.current.toggle();
      resume.current = false;
    });
    const offLocked = listen<boolean>("session-locked", (event) => setLocked(event.payload));
    return () => {
      void offHidden.then((off) => off());
      void offShown.then((off) => off());
      void offLocked.then((off) => off());
    };
  }, []);
  return null;
}

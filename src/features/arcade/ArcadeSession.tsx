import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useAmbientHold } from "../../lib/ambient/AmbientProvider";
import { useMusic } from "../../lib/music/MusicProvider";

/**
 * While an Arcade game runs (D-035), Digitify is hidden by the core and stays silent: the menu
 * music is held and the music player paused. When the game closes, both carry on where they were.
 */
export function ArcadeSession() {
  const [playing, setPlaying] = useState(false);
  const music = useMusic();
  const latest = useRef(music);
  latest.current = music;
  const resumeMusic = useRef(false);
  useAmbientHold("game", playing);

  useEffect(() => {
    const off = listen<{ running: number | null }>("arcade-session", (event) => {
      const running = event.payload?.running != null;
      setPlaying(running);
      const player = latest.current;
      if (running) {
        resumeMusic.current = player.active && !player.paused;
        if (resumeMusic.current) player.pause();
      } else if (resumeMusic.current) {
        resumeMusic.current = false;
        if (player.paused) player.toggle();
      }
    });
    return () => void off.then((stop) => stop());
  }, []);
  return null;
}

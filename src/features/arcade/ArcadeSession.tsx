import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { api } from "../../lib/api";
import { useAmbientHold } from "../../lib/ambient/AmbientProvider";
import { useMusic } from "../../lib/music/MusicProvider";
import { usePreferences } from "../../lib/preferences";

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

  // A game installed or removed in a store (D-037): Arcade looks again by itself.
  const queryClient = useQueryClient();
  const { preferences } = usePreferences();
  const downloadCovers = useRef(preferences.arcade.downloadCovers);
  downloadCovers.current = preferences.arcade.downloadCovers;
  useEffect(() => {
    const off = listen("arcade-stores-changed", () => {
      void api
        .arcadeScan(downloadCovers.current)
        .then(() => {
          void queryClient.invalidateQueries({ queryKey: ["arcade-games"] });
          void queryClient.invalidateQueries({ queryKey: ["arcade-status"] });
        })
        .catch(() => {});
    });
    return () => void off.then((stop) => stop());
  }, [queryClient]);

  useEffect(() => {
    const off = listen<{ running?: number | null }>("arcade-session", (event) => {
      // Only a game that runs (or ended) matters here, not one still being started by its store.
      if (!event.payload || !("running" in event.payload)) return;
      const running = event.payload.running != null;
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

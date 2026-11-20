import { useCallback } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMusic } from "../../lib/music/MusicProvider";

/**
 * Plays songs and opens the music player's screen (D-142), as Big Picture does: every Play that
 * starts music (a song's page, a song in a list, Music's Play and Shuffle, a playlist's) goes there.
 * Its Back returns to where Play was pressed.
 */
export function usePlayAndShow(): (tracks: number[], start?: number) => Promise<void> {
  const music = useMusic();
  const navigate = useNavigate();
  return useCallback(
    async (tracks: number[], start = 0) => {
      await music.play(tracks, start);
      void navigate({ to: "/now-playing" });
    },
    [music, navigate],
  );
}

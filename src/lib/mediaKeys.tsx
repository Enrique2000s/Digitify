import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useMusic } from "./music/MusicProvider";

/** What a video player does with the media keys while it plays (D-058). */
export interface VideoMediaHandler {
  title: string;
  subtitle?: string | null;
  /** Its cover, for the system's "now playing" card (D-168). */
  coverKey?: string | null;
  paused: boolean;
  toggle: () => void;
  play: () => void;
  pause: () => void;
  next?: () => void;
  previous?: () => void;
  stop?: () => void;
}

let video: VideoMediaHandler | null = null;
const changed = new Set<() => void>();

/** The video player (full or in the corner) takes the media keys while it's there. */
export function setVideoMedia(handler: VideoMediaHandler | null) {
  video = handler;
  changed.forEach((f) => f());
}

type NowPlaying = {
  title: string | null;
  artist: string | null;
  album: string | null;
  coverKey: string | null;
  /** Which default cover shows when there's none (D-169). */
  kind: "music" | "video" | null;
  duration: number | null;
  state: "playing" | "paused" | "stopped";
};
const report = (now: NowPlaying) => void invoke("media_now_playing", { now }).catch(() => {});

/**
 * The keyboard's and headphones' media keys and the system's "now playing" card (D-058): a video
 * when one plays, otherwise the library's music.
 */
export function MediaKeys() {
  const music = useMusic();
  const latest = useRef(music);
  latest.current = music;
  const last = useRef("");

  useEffect(() => {
    const send = () => {
      const m = latest.current;
      const now: NowPlaying = video
        ? { title: video.title, artist: video.subtitle ?? null, album: null, coverKey: video.coverKey ?? null, kind: "video", duration: null, state: video.paused ? "paused" : "playing" }
        : m.active && m.current
          ? {
              title: m.current.title,
              artist: m.current.artist ?? null,
              album: m.current.album ?? null,
              coverKey: m.current.coverKey ?? null,
              kind: "music",
              duration: m.current.durationMs ? m.current.durationMs / 1000 : null,
              state: m.paused ? "paused" : "playing",
            }
          : { title: null, artist: null, album: null, coverKey: null, kind: null, duration: null, state: "stopped" };
      const key = JSON.stringify(now);
      if (key === last.current) return;
      last.current = key;
      report(now);
    };
    send();
    changed.add(send);
    return () => void changed.delete(send);
  });

  useEffect(() => {
    const off = listen<string>("media-key", ({ payload }) => {
      if (video) {
        const v = video;
        ({ play: v.play, pause: v.pause, toggle: v.toggle, next: v.next, previous: v.previous, stop: v.stop ?? v.pause })[payload as "play"]?.();
        return;
      }
      const m = latest.current;
      if (!m.active) return;
      if (payload === "toggle") m.toggle();
      else if (payload === "play" && m.paused) m.toggle();
      else if (payload === "pause" && !m.paused) m.pause();
      else if (payload === "next") m.next();
      else if (payload === "previous") m.previous();
      else if (payload === "stop") m.pause();
    });
    return () => void off.then((stop) => stop());
  }, []);
  return null;
}

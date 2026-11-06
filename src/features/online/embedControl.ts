import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

export interface EmbedState {
  playing: boolean;
  /** Seconds, when the player reports it. */
  time: number | null;
  duration: number | null;
}

/**
 * Play, pause and seek a service's embedded player from Digitify's own buttons (Big Picture's,
 * driven by a controller), through the messages each embed accepts: YouTube's IFrame API
 * (`enablejsapi=1`), SoundCloud's Widget API, and Spotify's embed. The embed keeps its own controls.
 */
export function useEmbedControl(frame: RefObject<HTMLIFrameElement | null>, provider: string) {
  const [state, setState] = useState<EmbedState>({ playing: false, time: null, duration: null });
  const latest = useRef(state);
  latest.current = state;

  const post = useCallback(
    (message: object) => {
      const target = frame.current?.contentWindow;
      if (!target) return;
      // YouTube and SoundCloud read JSON text; Spotify's embed reads the object.
      target.postMessage(provider === "spotify" ? message : JSON.stringify(message), "*");
    },
    [frame, provider],
  );

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!frame.current || event.source !== frame.current.contentWindow) return;
      let data: Record<string, unknown> | null = null;
      if (typeof event.data === "string") {
        try {
          data = JSON.parse(event.data);
        } catch {
          return;
        }
      } else if (event.data && typeof event.data === "object") {
        data = event.data as Record<string, unknown>;
      }
      if (!data) return;
      if (provider === "youtube") {
        const info = data.info as Record<string, unknown> | number | undefined;
        if (data.event === "infoDelivery" && info && typeof info === "object") {
          setState((s) => ({
            playing: typeof info.playerState === "number" ? info.playerState === 1 || info.playerState === 3 : s.playing,
            time: typeof info.currentTime === "number" ? info.currentTime : s.time,
            duration: typeof info.duration === "number" ? info.duration : s.duration,
          }));
        } else if (data.event === "onStateChange" && typeof info === "number") {
          setState((s) => ({ ...s, playing: info === 1 || info === 3 }));
        }
      } else if (provider === "soundcloud") {
        const value = data.value as Record<string, unknown> | undefined;
        if (data.method === "playProgress" && value) setState((s) => ({ ...s, playing: true, time: Number(value.currentPosition) / 1000 }));
        else if (data.method === "play") setState((s) => ({ ...s, playing: true }));
        else if (data.method === "pause" || data.method === "finish") setState((s) => ({ ...s, playing: false }));
        else if (data.method === "getDuration" && typeof data.value === "number") setState((s) => ({ ...s, duration: (data!.value as number) / 1000 }));
      } else if (provider === "spotify") {
        const payload = data.payload as Record<string, unknown> | undefined;
        if (data.type === "playback_update" && payload) {
          setState({
            playing: payload.isPaused === false,
            time: typeof payload.position === "number" ? payload.position / 1000 : null,
            duration: typeof payload.duration === "number" ? payload.duration / 1000 : null,
          });
        }
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [frame, provider]);

  /** Call when the embed has loaded: asks it to report its state. */
  const onLoad = useCallback(() => {
    if (provider === "youtube") post({ event: "listening", id: 1, channel: "widget" });
    if (provider === "soundcloud") {
      for (const name of ["playProgress", "play", "pause", "finish"]) post({ method: "addEventListener", value: name });
      post({ method: "getDuration" });
    }
  }, [post, provider]);

  const toggle = useCallback(() => {
    if (provider === "youtube") post({ event: "command", func: latest.current.playing ? "pauseVideo" : "playVideo", args: [] });
    else if (provider === "soundcloud") post({ method: "toggle" });
    else post({ command: "toggle" });
    setState((s) => ({ ...s, playing: !s.playing }));
  }, [post, provider]);

  const seek = useCallback(
    (by: number) => {
      const to = Math.max(0, (latest.current.time ?? 0) + by);
      if (provider === "youtube") post({ event: "command", func: "seekTo", args: [to, true] });
      else if (provider === "soundcloud") post({ method: "seekTo", value: to * 1000 });
      else post({ command: "seek", timestamp: to * 1000 });
      setState((s) => ({ ...s, time: to }));
    },
    [post, provider],
  );

  return { state, onLoad, toggle, seek };
}

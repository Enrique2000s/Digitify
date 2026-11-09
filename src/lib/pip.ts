import { useSyncExternalStore } from "react";
import type { WatchTarget } from "./api";

/**
 * A video playing in the corner while you browse (D-053). The player hands its running mpv
 * session over instead of closing it, and takes it back when the corner video is made big again.
 */
export interface PipSession {
  target: WatchTarget;
  /** Where playback was when it moved to the corner (or back). */
  time: number;
  duration: number;
  paused: boolean;
}

let session: PipSession | null = null;
const listeners = new Set<() => void>();

export const pip = {
  get: () => session,
  set(next: PipSession | null) {
    session = next;
    listeners.forEach((l) => l());
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export function usePip(): PipSession | null {
  return useSyncExternalStore(pip.subscribe, pip.get);
}

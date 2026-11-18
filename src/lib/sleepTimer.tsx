import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Popover } from "radix-ui";
import { Moon } from "lucide-react";
import { api } from "./api";
import { useMusic } from "./music/MusicProvider";

/**
 * The sleep timer (D-061): music and videos stop by themselves after a while, or at the end of
 * what's playing, fading out over the last 20 seconds.
 */
type Timer = { endsAt: number; minutes: number } | { endOf: true } | null;

let timer: Timer = null;
const listeners = new Set<() => void>();
const set = (next: Timer) => {
  timer = next;
  listeners.forEach((l) => l());
};
export const sleepTimer = {
  get: () => timer,
  set,
  subscribe: (l: () => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  /** Whether it waits for the end of the track or episode. */
  atEnd: () => !!timer && "endOf" in timer,
};
export const useSleepTimer = () => useSyncExternalStore(sleepTimer.subscribe, sleepTimer.get);

const FADE_SECONDS = 20;

/** Stops music and video, then gives the volume back. */
function stopAll(music: ReturnType<typeof useMusic>, musicVolume: number | null) {
  if (music.active && !music.paused) music.pause();
  void api.playerCommand(["set_property", "pause", true]).catch(() => {});
  window.setTimeout(() => {
    if (musicVolume != null) music.setVolume(musicVolume);
    void api.playerCommand(["set_property", "volume", 100]).catch(() => {});
  }, 600);
}

/** Runs the timer for the whole window: the countdown, the fade, the stop. */
export function SleepTimerRunner() {
  const music = useMusic();
  const latest = useRef(music);
  latest.current = music;
  const current = useSleepTimer();
  const fadeFrom = useRef<number | null>(null);
  const trackAtStart = useRef<number | null>(null);

  useEffect(() => {
    fadeFrom.current = null;
    trackAtStart.current = latest.current.current?.id ?? null;
    if (!current || "endOf" in current) return;
    const tick = window.setInterval(() => {
      const left = (current.endsAt - Date.now()) / 1000;
      const m = latest.current;
      if (left <= 0) {
        window.clearInterval(tick);
        stopAll(m, fadeFrom.current);
        set(null);
      } else if (left <= FADE_SECONDS) {
        if (fadeFrom.current == null) fadeFrom.current = m.volume;
        const share = left / FADE_SECONDS;
        if (m.active) m.setVolume(Math.round(fadeFrom.current * share));
        void api.playerCommand(["set_property", "volume", Math.round(100 * share)]).catch(() => {});
      }
    }, 1000);
    return () => window.clearInterval(tick);
  }, [current]);

  // At the end of the track: when the next one starts, stop.
  const id = music.current?.id ?? null;
  useEffect(() => {
    if (!current || !("endOf" in current)) return;
    if (trackAtStart.current != null && id !== trackAtStart.current) {
      latest.current.pause();
      set(null);
    }
  }, [id, current]);
  return null;
}

const CHOICES = [15, 30, 45, 60, 90];

/** The moon button: choose when to stop, see the time left, or turn it off. */
export function SleepTimerButton({ className = "icon-btn", size = 17, endLabel = "End of this track" }: { className?: string; size?: number; endLabel?: string }) {
  const current = useSleepTimer();
  const [, setNow] = useState(0);
  useEffect(() => {
    if (!current || "endOf" in current) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [current]);
  const left = current && !("endOf" in current) ? Math.max(0, Math.ceil((current.endsAt - Date.now()) / 60000)) : null;
  const label = !current ? "Sleep timer" : "endOf" in current ? `Stops at the ${endLabel.replace(/^End of /, "end of ")}` : `Stops in ${left} min`;
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" className={`${className} sleep-trigger`} aria-pressed={!!current} aria-label={label} title={label}>
          <Moon size={size} />
          {left != null && <span className="sleep-left">{left}</span>}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="menu sleep-menu" sideOffset={8} collisionPadding={16}>
          <div className="menu-label">Stop playing</div>
          {CHOICES.map((m) => (
            <Popover.Close asChild key={m}>
              <button type="button" className="menu-item" onClick={() => set({ endsAt: Date.now() + m * 60_000, minutes: m })}>
                In {m} minutes
              </button>
            </Popover.Close>
          ))}
          <Popover.Close asChild>
            <button type="button" className="menu-item" onClick={() => set({ endOf: true })}>
              {endLabel}
            </button>
          </Popover.Close>
          {current && (
            <Popover.Close asChild>
              <button type="button" className="menu-item danger" onClick={() => set(null)}>
                Turn off the timer
              </button>
            </Popover.Close>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

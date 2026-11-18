import { useEffect, useState, useSyncExternalStore } from "react";
import { SunMoon } from "lucide-react";
import { usePreferences, type NightFilter } from "./preferences";

/**
 * The night reading filter (D-069): a warm tone over the readers' pages, easier on the eyes at
 * night. The readers' button turns it on or off; with a schedule it also comes on by itself in
 * those hours. What the button chose holds until the app closes.
 */
let override: boolean | null = null;
const listeners = new Set<() => void>();
const setOverride = (next: boolean | null) => {
  override = next;
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/** Whether `now` falls in the schedule's hours (which may run past midnight). */
export function inSchedule(filter: NightFilter, now = new Date()): boolean {
  if (!filter.schedule) return false;
  const at = now.getHours() * 60 + now.getMinutes();
  const from = minutes(filter.from);
  const to = minutes(filter.to);
  return from <= to ? at >= from && at < to : at >= from || at < to;
}

export function useNightFilter() {
  const { preferences } = usePreferences();
  const filter = preferences.nightFilter;
  const chosen = useSyncExternalStore(subscribe, () => override);
  const [scheduled, setScheduled] = useState(() => inSchedule(filter));
  useEffect(() => {
    setScheduled(inSchedule(filter));
    if (!filter.schedule) return;
    const t = window.setInterval(() => setScheduled(inSchedule(filter)), 30_000);
    return () => window.clearInterval(t);
  }, [filter]);
  const active = chosen ?? scheduled;
  return { active, strength: filter.strength, toggle: () => setOverride(!active) };
}

/** The warm layer itself, over a reader's pages and under its bars. */
export function NightFilterLayer() {
  const { active, strength } = useNightFilter();
  return <div className={`night-filter${active ? " on" : ""}`} style={{ "--night": strength / 100 } as React.CSSProperties} aria-hidden />;
}

/** The readers' button. */
export function NightFilterButton() {
  const { active, toggle } = useNightFilter();
  const label = active ? "Night filter on: click to turn it off" : "Night filter: a warm tone, easier on the eyes at night";
  return (
    <button type="button" className="round-btn" aria-pressed={active} aria-label={label} title={label} onClick={toggle}>
      <SunMoon size={17} />
    </button>
  );
}

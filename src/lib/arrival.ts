import { useEffect, useState } from "react";

/** How many of each named part are on screen, and when the last one went away. */
const shown = new Map<string, number>();
const gone = new Map<string, number>();

/**
 * Whether a part of a page is arriving, or only being redrawn in place (D-045). Changing category
 * or Music tab rebuilds the view, but Library's header, its buttons and a title that stays the
 * same come back at once in the same place: they should hold still, and only animate when they
 * really arrive (coming from Home or Arcade, or a title that changed), as Arcade's page does.
 * The new view draws while the old one is still there, so a part still on screen (or gone a
 * moment ago) is a redraw.
 */
export function useArrival(name: string): boolean {
  const [arriving] = useState(() => (shown.get(name) ?? 0) === 0 && performance.now() - (gone.get(name) ?? -Infinity) > 400);
  useEffect(() => {
    shown.set(name, (shown.get(name) ?? 0) + 1);
    return () => {
      shown.set(name, Math.max(0, (shown.get(name) ?? 1) - 1));
      gone.set(name, performance.now());
    };
  }, [name]);
  return arriving;
}

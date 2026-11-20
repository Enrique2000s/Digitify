import { LoaderCircle } from "lucide-react";
import { useBusy } from "../lib/busy";

/** "Working…" while something you asked for takes a moment (D-143), in the app and Big Picture. */
export function BusyIndicator() {
  const busy = useBusy();
  if (!busy) return null;
  return (
    <div className="busy-indicator" role="status" aria-live="polite">
      <LoaderCircle size={16} className="spin" aria-hidden /> {busy}
    </div>
  );
}

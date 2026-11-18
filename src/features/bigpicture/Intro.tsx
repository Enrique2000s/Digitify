import { useEffect, useRef, useState } from "react";
import { ambientEngine } from "../../lib/ambient/engine";
import { motionAllowed } from "../reader/chrome";

/** How long the intro runs before it fades into Home (ms). */
const LENGTH = 3000;
const FADE = 650;

/**
 * Big Picture's startup (D-070): the Digitify logo draws itself in the accent color, a sweep of
 * light crosses it, a chord sounds, and it opens onto Home. Any button, key or click skips it.
 */
export function BigPictureIntro({ onDone }: { onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);
  const done = useRef(false);
  const finish = () => {
    if (done.current) return;
    done.current = true;
    setLeaving(true);
    window.setTimeout(onDone, FADE);
  };
  useEffect(() => {
    // Without motion it's only a brief still of the logo and the chord.
    const still = !motionAllowed();
    ambientEngine.introSound();
    const t = window.setTimeout(finish, still ? 1200 : LENGTH);
    const skip = (event: Event) => {
      event.preventDefault();
      finish();
    };
    window.addEventListener("keydown", skip, true);
    window.addEventListener("pointerdown", skip, true);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("keydown", skip, true);
      window.removeEventListener("pointerdown", skip, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className={`bp-intro${leaving ? " leaving" : ""}`} role="presentation" aria-hidden>
      <div className="bp-intro-glow" />
      <div className="bp-intro-mark">
        <svg viewBox="0 0 34 34" className="bp-intro-logo">
          <defs>
            <linearGradient id="bp-intro-sweep" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0.35" stopColor="#ffffff" stopOpacity="0" />
              <stop offset="0.5" stopColor="#ffffff" stopOpacity="0.85" />
              <stop offset="0.65" stopColor="#ffffff" stopOpacity="0" />
            </linearGradient>
            <clipPath id="bp-intro-clip">
              <rect x="1" y="1" width="32" height="32" rx="11" />
            </clipPath>
          </defs>
          <rect className="bp-intro-tile" x="1" y="1" width="32" height="32" rx="11" />
          <path className="bp-intro-gloss" d="M12 1h10a11 11 0 0 1 11 11v3H1v-3A11 11 0 0 1 12 1z" />
          <rect className="bp-intro-bar one" x="9" y="10" width="4" height="15" rx="2" />
          <rect className="bp-intro-bar two" x="14.5" y="12.5" width="4" height="12.5" rx="2" />
          <circle className="bp-intro-ring" cx="24" cy="20.5" r="4.4" pathLength={100} />
          <g clipPath="url(#bp-intro-clip)">
            <rect className="bp-intro-shine" x="-34" y="0" width="34" height="34" fill="url(#bp-intro-sweep)" />
          </g>
        </svg>
        <div className="bp-intro-words">
          <span className="bp-intro-name">Digitify</span>
          <span className="bp-intro-sub">Big Picture</span>
        </div>
      </div>
    </div>
  );
}

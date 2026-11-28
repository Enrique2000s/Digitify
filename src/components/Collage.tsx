import { useEffect, useRef, useState, type CSSProperties } from "react";
import { artworkUrl, pictureUrl, type TileCover } from "../lib/api";
import { useCoverShape } from "../lib/preferences";
import { motionAllowed } from "../features/reader/chrome";

/** How long each set of covers stays on a Home tile, and how long the outgoing set takes to leave (ms). */
const ROTATE_EVERY = 8000;
const LEAVE = 600;

/** Three covers of `pool` from `start`, going round. */
const windowOf = (pool: TileCover[], start: number) => (pool.length <= 3 ? pool : [0, 1, 2].map((i) => pool[(start + i) % pool.length]));

/**
 * A Home Shortcut's covers, moving on through its pool (D-177): every few seconds the three shown
 * float up and fade as the next three rise into place. All the cards change at the same moment
 * (D-184), on the clock, so Home and Big Picture change together too; `turn` only sets a card a few
 * hundredths of a second after the one before it, so the row changes as one wave from left to right.
 * Each visit starts somewhere else in the pool; without animations (performance mode, reduced
 * motion) that's the only change, so nothing moves while you look.
 */
export function RotatingCollage({ covers: given, turn = 0 }: { covers: TileCover[]; turn?: number }) {
  // Each picture once (an album's songs share theirs), so a new set always looks new.
  const covers = given.filter((cover, i) => given.findIndex((other) => other.key === cover.key) === i);
  const [start, setStart] = useState(() => (covers.length > 3 ? Math.floor(Math.random() * covers.length) : 0));
  const [leaving, setLeaving] = useState<{ id: number; covers: TileCover[] } | null>(null);
  const current = useRef({ covers, start });
  current.current = { covers, start };
  const key = covers.map((c) => c.key).join("|");
  useEffect(() => {
    if (covers.length <= 3 || !motionAllowed()) return;
    let timer = 0;
    let clear = 0;
    const next = () => {
      const { covers: pool, start: from } = current.current;
      if (!document.hidden) {
        setLeaving({ id: Date.now(), covers: windowOf(pool, from) });
        setStart((from + 3) % pool.length);
        window.clearTimeout(clear);
        clear = window.setTimeout(() => setLeaving(null), LEAVE + 200);
      }
      schedule();
    };
    // On the clock: every card changes at the same moment, each a touch after the one on its left.
    const schedule = () => {
      timer = window.setTimeout(() => {
        next();
      }, ROTATE_EVERY - (Date.now() % ROTATE_EVERY) + turn * 70);
    };
    schedule();
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(clear);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, turn]);
  const shown = windowOf(covers, start % Math.max(covers.length, 1));
  return (
    <>
      {leaving && (
        <div key={leaving.id} className="tile-collage leaving" aria-hidden>
          <Collage covers={leaving.covers} />
        </div>
      )}
      <div key={`${start}-${key}`} className="tile-collage">
        <Collage covers={shown} />
      </div>
    </>
  );
}

/**
 * Up to three covers fanned out on a tile's screen (home tiles, shelves, collections), each in the
 * shape it has in its category (D-127): a video's wide frame, a photo's own proportions, a film's
 * poster, an album's square. Centred in the screen (D-130), the middle one in front and a little
 * larger, the others tilted out and lower; on hover they fan apart and rise.
 */
export function Collage({ covers }: { covers: TileCover[] }) {
  const shapeOf = useCoverShape();
  const shown = covers.slice(0, 3);
  const n = shown.length;
  const centers = [[50], [38, 62], [27, 50, 73]][n - 1] ?? [];
  const tilts = [[0], [-6, 6], [-9, 0, 9]][n - 1] ?? [];
  const sides = [[0], [-1, 1], [-1, 0, 1]][n - 1] ?? [];
  return shown.map((cover, i) => {
    // A game keeps its own box's shape (D-183); the rest the shape they have in their category.
    const aspect = cover.box ?? shapeOf({ handler: cover.handler, category: cover.category ?? null, coverShape: cover.coverShape ?? null, aspect: cover.aspect ?? null }).aspect;
    const front = sides[i] === 0;
    // Each kind of shape one height, so they sit together; the one in front a step larger.
    const height = (aspect > 1.2 ? 56 : aspect > 0.9 ? 68 : 80) * (front && n > 1 ? 1.06 : 1);
    const style = {
      left: `${centers[i]}%`,
      top: "52%",
      height: `${height}%`,
      aspectRatio: String(aspect),
      zIndex: front ? 2 : 1,
      "--tilt": `${tilts[i]}deg`,
      "--side": sides[i],
      "--drop": front ? "0%" : "5%",
      "--n": i,
      background: cover.color ?? undefined,
    } as CSSProperties;
    return (
      <div key={`${cover.key}-${i}`} className="tile-cover" style={style}>
        <img src={cover.gif ? pictureUrl(cover.gif) : artworkUrl(cover.key)} alt="" loading="lazy" decoding="async" draggable={false} />
      </div>
    );
  });
}

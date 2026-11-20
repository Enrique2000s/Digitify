import type { CSSProperties } from "react";
import { artworkUrl, type TileCover } from "../lib/api";
import { useCoverShape } from "../lib/preferences";

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
    const { aspect } = shapeOf({ handler: cover.handler, category: cover.category ?? null, coverShape: cover.coverShape ?? null, aspect: cover.aspect ?? null });
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
        <img src={artworkUrl(cover.key)} alt="" loading="lazy" decoding="async" draggable={false} />
      </div>
    );
  });
}

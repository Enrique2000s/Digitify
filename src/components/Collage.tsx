import type { CSSProperties } from "react";
import { artworkUrl, type TileCover } from "../lib/api";
import { aspectFor } from "./common";

/** Up to three covers fanned out on a tile's screen (home tiles, shelves, collections). */
export function Collage({ covers }: { covers: TileCover[] }) {
  const lefts = [[36], [22, 50], [8, 35, 62]][covers.length - 1] ?? [];
  const tilts = [[0], [-5, 5], [-7, 0, 7]][covers.length - 1] ?? [];
  return covers.slice(0, 3).map((cover, i) => {
    const square = aspectFor(cover.handler) === 1;
    const style = {
      left: `${lefts[i]}%`,
      top: square ? "22%" : "12%",
      width: square ? "30%" : "28%",
      aspectRatio: square ? "1" : "2 / 3",
      "--tilt": `${tilts[i]}deg`,
      background: cover.color ?? undefined,
    } as CSSProperties;
    return (
      <div key={`${cover.key}-${i}`} className="tile-cover" style={style}>
        <img src={artworkUrl(cover.key)} alt="" loading="lazy" decoding="async" draggable={false} />
      </div>
    );
  });
}

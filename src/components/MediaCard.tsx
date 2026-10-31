import { memo } from "react";
import { Link } from "@tanstack/react-router";
import { Check, Star } from "lucide-react";
import type { ItemCard } from "../lib/api";
import { useSelectable } from "../lib/selection";
import { Cover } from "./common";
import { useCoverShape } from "../lib/preferences";

/** The physical case band (Blu-ray blue, DVD black) shown on video covers you own on disc. */
export function caseBand(item: ItemCard): "bluray" | "dvd" | null {
  if (!item.hasPhysical) return null;
  if (item.formats.some((f) => f === "bluray" || f === "uhd-bluray" || f === "bluray-3d")) return "bluray";
  if (item.formats.includes("dvd")) return "dvd";
  return null;
}

/** A cover card. In a library view (`index` given) it also takes part in multi-select. */
export const MediaCard = memo(function MediaCard({ item, width, index, transitionName }: { item: ItemCard; width?: number; index?: number; transitionName?: string }) {
  const band = caseBand(item);
  const subtitle = [item.subtitle, item.year].filter(Boolean).join(" · ");
  const { selecting, checked, props } = useSelectable(item.id, index);
  const { shape, aspect } = useCoverShape()(item);
  return (
    <Link to="/item/$id" params={{ id: String(item.id) }} className="card" style={width ? { width } : undefined} data-blip {...props}>
      <div className="card-art" data-shape={shape} style={{ aspectRatio: aspect, ...(transitionName ? { viewTransitionName: transitionName } : {}) }}>
        <Cover item={item} />
        {band && <div className={`card-case ${band}`}>{band === "bluray" ? "BLU-RAY" : "DVD"}</div>}
        {(item.isFavorite || item.missing) && (
          <div className="card-badges" style={band ? { top: 28 } : undefined}>
            {item.missing && <span className="chip warning">Missing</span>}
            {item.isFavorite && (
              <span className="fav" aria-label="Favorite">
                <Star size={14} fill="currentColor" strokeWidth={0} />
              </span>
            )}
          </div>
        )}
        {item.progress != null && item.progress > 0 && (
          <div className="card-progress">
            <span style={{ width: `${Math.round(item.progress * 100)}%` }} />
          </div>
        )}
        {selecting && (
          <span className={`card-check${checked ? " on" : ""}`} aria-hidden>
            {checked && <Check size={16} strokeWidth={3.2} />}
          </span>
        )}
      </div>
      <div className="card-title">{item.title}</div>
      <div className="card-sub">{subtitle || " "}</div>
    </Link>
  );
});

/** Placeholder with the same footprint while a page of cards loads. */
export function CardSkeleton({ width, aspect }: { width: number; aspect: number }) {
  return (
    <div className="card" style={{ width }} aria-hidden>
      <div className="card-art" style={{ aspectRatio: aspect, boxShadow: "none" }} />
      <div className="card-title">&nbsp;</div>
      <div className="card-sub">&nbsp;</div>
    </div>
  );
}

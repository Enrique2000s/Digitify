import { memo } from "react";
import { Marquee } from "./Marquee";
import { Link } from "@tanstack/react-router";
import { itemPath } from "../lib/routes";
import { Check, Cloud, FileWarning, Star } from "lucide-react";
import type { ItemCard } from "../lib/api";
import { useSelectable } from "../lib/selection";
import { Cover } from "./common";
import { useCoverShape } from "../lib/preferences";
import { FilmTag, FormatTag, SourceTag, sourceProps } from "./SourceTag";
import { CoverPreview } from "./CoverPreview";

/** The case band (Blu-ray blue, DVD black) on a film or series that came from a disc (its disc format, D-029). */
export function caseBand(item: ItemCard): "bluray" | "dvd" | null {
  if (!item.discFormat) return null;
  return item.discFormat === "dvd" ? "dvd" : "bluray";
}

/** Finished: watched, read or marked so (D-178). */
export const isFinished = (item: { progress?: number | null; completed?: boolean }) => !!item.completed || (item.progress ?? 0) >= 0.999;

/** The small check on a finished item's cover, bottom right, in the progress bar's color (D-178). */
export function DoneBadge({ size = 13 }: { size?: number }) {
  return (
    <span className="done-badge" title="Finished" aria-label="Finished">
      <Check size={size} strokeWidth={3.4} />
    </span>
  );
}

/**
 * How far along an item is, on its cover (D-178): a bar while it's under way, the small check once
 * it's finished; nothing for Videos, which always play from the start and keep no progress.
 */
export function ProgressMark({ item, className = "card-progress" }: { item: { progress?: number | null; completed?: boolean; category?: string | null }; className?: string }) {
  if (item.category === "videos") return null;
  if (isFinished(item)) return <DoneBadge />;
  if (!item.progress || item.progress <= 0) return null;
  return (
    <div className={className}>
      <span style={{ width: `${Math.round(item.progress * 100)}%` }} />
    </div>
  );
}

/**
 * A file that can't be found (D-184): over the middle of its cover, whatever the cover's shape,
 * the cover a little dimmed behind it, instead of a chip in a corner.
 */
export function MissingMark() {
  return (
    <span className="missing-mark" title="The file can't be found at its saved location">
      <span>
        <FileWarning size={15} strokeWidth={2.6} aria-hidden /> Missing file
      </span>
    </span>
  );
}

/**
 * What a cover shows on it besides the picture (D-184): its service, its kind (Movie, Comic…), its
 * format, and its badges (missing, online, favorite) and how far along it is. The Spotlight shows
 * the same as the cards.
 */
export function CoverMarks({ item }: { item: ItemCard }) {
  return (
    <>
      <SourceTag service={item.source} />
      <FilmTag item={item} />
      <FormatTag item={item} />
      {(item.isFavorite || item.online) && (
        <div className="card-badges">
          
          {item.online && (
            <span className="online-badge" title="Online: plays in its service's player and needs a connection" aria-label="Online">
              <Cloud size={13} strokeWidth={2.6} />
            </span>
          )}
          {item.isFavorite && (
            <span className="fav" aria-label="Favorite">
              <Star size={14} fill="currentColor" strokeWidth={0} />
            </span>
          )}
        </div>
      )}
      <ProgressMark item={item} />
      {item.missing && <MissingMark />}
    </>
  );
}

/** A cover card. In a library view (`index` given) it also takes part in multi-select. */
export const MediaCard = memo(function MediaCard({ item, width, index, transitionId }: { item: ItemCard; width?: number; index?: number; transitionId?: number }) {
  const band = caseBand(item);
  const subtitle = [item.subtitle, item.year].filter(Boolean).join(" · ");
  const { selecting, checked, props } = useSelectable(item.id, index);
  const { shape, aspect } = useCoverShape()(item);
  return (
    <Link to={itemPath(item)} params={{ id: String(item.id) }} className="card" style={width ? { width } : undefined} data-blip {...props}>
      <div className="card-art" data-shape={shape} data-vt={transitionId} style={{ aspectRatio: aspect }} {...sourceProps(item.source)}>
        <Cover item={item} />
        <CoverPreview item={item} />
        <SourceTag service={item.source} />
        <FilmTag item={item} />
        <FormatTag item={item} />
        {band && <div className={`card-case ${band}`}>{band === "bluray" ? "BLU-RAY" : "DVD"}</div>}
        {(item.isFavorite || item.online) && (
          <div className="card-badges" style={band ? { top: 28 } : undefined}>
            
            {item.online && (
              <span className="online-badge" title="Online: plays in its service's player and needs a connection" aria-label="Online">
                <Cloud size={13} strokeWidth={2.6} />
              </span>
            )}
            {item.isFavorite && (
              <span className="fav" aria-label="Favorite">
                <Star size={14} fill="currentColor" strokeWidth={0} />
              </span>
            )}
          </div>
        )}
        <ProgressMark item={item} />
        {item.missing && <MissingMark />}
        {selecting && (
          <span className={`card-check${checked ? " on" : ""}`} aria-hidden>
            {checked && <Check size={16} strokeWidth={3.2} />}
          </span>
        )}
      </div>
      <div className="card-title">
        <Marquee hover text={item.title} />
      </div>
      {/* Always one line, so cards with and without a year line up. */}
      <div className="card-sub">{subtitle || "\u00a0"}</div>
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

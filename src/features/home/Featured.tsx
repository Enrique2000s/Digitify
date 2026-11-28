import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { itemPath } from "../../lib/routes";
import { Award } from "lucide-react";
import { api, artworkUrl, type ItemCard } from "../../lib/api";
import { Cover } from "../../components/common";
import { CoverMarks } from "../../components/MediaCard";
import { sourceProps } from "../../components/SourceTag";
import { useCoverShape } from "../../lib/preferences";

/**
 * "Featured today" (D-023): one item from the library, big, with its description; a new one each
 * day. The whole card opens it (D-184), as in Big Picture, and its cover carries its tags and badges
 * as a card's does.
 */
export function Featured({ item }: { item: ItemCard }) {
  const blurb = useQuery({ queryKey: ["blurb", item.id], queryFn: () => api.blurbs([item.id]).then((list) => list[0] ?? null) });
  const { shape, aspect } = useCoverShape()(item);
  return (
    <Link to={itemPath(item)} params={{ id: String(item.id) }} className="featured-card featured-link" aria-label={`Featured today: ${item.title}`} style={item.coverColor ? { ["--tint" as string]: item.coverColor } : undefined} data-blip>
      {item.coverKey && (
        <div className="featured-backdrop" aria-hidden>
          {/* A plain picture: it fills the blurred backdrop whatever the item's kind (D-042). */}
          <img src={artworkUrl(item.coverKey, "cover")} alt="" />
        </div>
      )}
      <div className="featured-cover" data-shape={shape} style={{ aspectRatio: aspect, height: shape === "landscape" ? 104 : undefined }} {...sourceProps(item.source)}>
        <Cover item={item} size="cover" />
        <CoverMarks item={item} />
      </div>
      <div className="featured-body">
        <span className="featured-eyebrow-row">
          <span className="featured-eyebrow">
            <Award size={16} strokeWidth={2.6} aria-hidden /> Featured today
          </span>
          <span className="section-source">(Library)</span>
        </span>
        <h2 className="display featured-title">{item.title}</h2>
        {(item.subtitle || item.year) && <p className="featured-sub">{[item.subtitle, item.year].filter(Boolean).join(" · ")}</p>}
        {blurb.data && blurb.data.facts.length > 0 && <p className="featured-facts">{blurb.data.facts.join(" · ")}</p>}
        {blurb.data?.description && <p className="featured-description">{blurb.data.description}</p>}
      </div>
    </Link>
  );
}

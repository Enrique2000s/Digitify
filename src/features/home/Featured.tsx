import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { BookOpen, Info, Play, Sparkles } from "lucide-react";
import { api, type ItemCard } from "../../lib/api";
import { Cover } from "../../components/common";
import { useCoverShape } from "../../lib/preferences";

/** "Featured today" (D-023): one item from the library, big, with its description; a new one each day. */
export function Featured({ item }: { item: ItemCard }) {
  const blurb = useQuery({ queryKey: ["blurb", item.id], queryFn: () => api.blurbs([item.id]).then((list) => list[0] ?? null) });
  const { shape, aspect } = useCoverShape()(item);
  const progress = item.progress ?? 0;
  const started = progress > 0.01 && progress < 0.999;
  const readable = item.hasDigital && !item.missing && (item.handler === "book" || item.handler === "comic");
  const watchable = item.hasDigital && !item.missing && item.handler === "video";
  return (
    <div className="featured-card" style={item.coverColor ? { ["--tint" as string]: item.coverColor } : undefined}>
      {item.coverKey && (
        <div className="featured-backdrop" aria-hidden>
          <Cover item={item} size="cover" />
        </div>
      )}
      <Link to="/item/$id" params={{ id: String(item.id) }} className="featured-cover" data-shape={shape} style={{ aspectRatio: aspect, height: shape === "landscape" ? 170 : undefined }} tabIndex={-1} data-blip>
        <Cover item={item} size="cover" />
      </Link>
      <div className="featured-body">
        <span className="featured-eyebrow">
          <Sparkles size={15} strokeWidth={2.6} aria-hidden /> Featured today
        </span>
        <h2 className="display featured-title">{item.title}</h2>
        {(item.subtitle || item.year) && <p className="featured-sub">{[item.subtitle, item.year].filter(Boolean).join(" · ")}</p>}
        {blurb.data && blurb.data.facts.length > 0 && <p className="featured-facts">{blurb.data.facts.join(" · ")}</p>}
        {blurb.data?.description && <p className="featured-description">{blurb.data.description}</p>}
        <div className="featured-actions">
          {readable && (
            <Link to="/read/$id" params={{ id: String(item.id) }} className="btn btn-primary">
              <BookOpen size={17} /> {started ? "Continue reading" : "Read"}
            </Link>
          )}
          {watchable && (
            <Link to="/watch/$id" params={{ id: String(item.id) }} className="btn btn-primary">
              <Play size={17} /> {started ? "Resume" : "Play"}
            </Link>
          )}
          <Link to="/item/$id" params={{ id: String(item.id) }} className={readable || watchable ? "btn" : "btn btn-primary"}>
            <Info size={17} /> Details
          </Link>
        </div>
      </div>
    </div>
  );
}

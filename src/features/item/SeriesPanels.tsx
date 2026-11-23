import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { CSSProperties } from "react";
import { api, type Handler } from "../../lib/api";
import { Cover } from "../../components/common";
import { DoneBadge } from "../../components/MediaCard";

/** The other volumes of the item's series, in reading order (D-019). */
export function SeriesPanel({ itemId, handler }: { itemId: number; handler: Handler }) {
  const series = useQuery({ queryKey: ["series", itemId], queryFn: () => api.seriesGet(itemId) });
  if (!series.data) return null;
  const { name, entries, index } = series.data;
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>In this series</h2>
        <span className="muted">
          {name} · {index + 1} of {entries.length}
        </span>
      </div>
      <div className="series-strip">
        {entries.map((entry, position) => (
          <Link
            key={entry.id}
            to="/item/$id"
            params={{ id: String(entry.id) }}
            className="series-entry"
            style={handler === "image" && entry.aspect ? { flexBasis: Math.round(138 * entry.aspect) } : undefined}
            aria-current={position === index ? "page" : undefined}
            title={entry.title}
          >
            {/* Pictures keep their own proportions, all one height (D-178). */}
            <div className="series-cover" style={handler === "image" && entry.aspect ? { aspectRatio: String(entry.aspect), width: Math.round(138 * entry.aspect) } : undefined}>
              <Cover item={{ title: entry.title, coverKey: entry.coverKey, handler, id: entry.id, formats: entry.format ? [entry.format] : undefined }} />
              {entry.completed ? (
                <DoneBadge size={11} />
              ) : (
                entry.progress != null &&
                entry.progress > 0 && <span className="series-progress" style={{ "--fill": `${entry.progress * 100}%` } as CSSProperties} />
              )}
            </div>
            <span>{entry.label ?? entry.title}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

/** A page-based book's chapters, each opening the reader where it starts. */
export function ChaptersPanel({ itemId }: { itemId: number }) {
  const chapters = useQuery({ queryKey: ["chapters", itemId], queryFn: () => api.chaptersGet(itemId) });
  if (!chapters.data?.length) return null;
  return (
    <section className="panel">
      <h2>Chapters</h2>
      <ol className="tracks">
        {chapters.data.map((chapter, index) => (
          <li key={`${chapter.page}:${index}`} style={{ paddingLeft: chapter.depth * 16 }}>
            <span className="no">{index + 1}</span>
            <Link to="/read/$id" params={{ id: String(itemId) }} search={{ page: chapter.page }} className="chapter-link">
              {chapter.title || "Untitled"}
            </Link>
            <span className="muted">p. {chapter.page + 1}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

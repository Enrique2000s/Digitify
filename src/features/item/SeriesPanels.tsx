import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { CSSProperties } from "react";
import { api, type Handler } from "../../lib/api";
import { Cover } from "../../components/common";

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
            aria-current={position === index ? "page" : undefined}
            title={entry.title}
          >
            <div className="series-cover">
              <Cover item={{ title: entry.title, coverKey: entry.coverKey, handler }} />
              {entry.progress != null && entry.progress > 0 && (
                <span className="series-progress" style={{ "--fill": `${(entry.completed ? 1 : entry.progress) * 100}%` } as CSSProperties} />
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

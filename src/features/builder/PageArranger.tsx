import { useState } from "react";
import { ChevronLeft, ChevronRight, ImageOff, X } from "lucide-react";

export interface ArrangedPage {
  /** A file path (new books) or a file id (existing books). */
  key: string;
  name: string;
  /** A preview to show, once loaded. */
  src: string | null;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Pages in natural file-name order ("page 2" before "page 10"). */
export function byName(pages: ArrangedPage[]): ArrangedPage[] {
  return [...pages].sort((a, b) => collator.compare(a.name, b.name));
}

function moved(pages: ArrangedPage[], from: number, to: number): ArrangedPage[] {
  const next = [...pages];
  const [page] = next.splice(from, 1);
  next.splice(to, 0, page);
  return next;
}

/**
 * A grid of pages to put in reading order: drag a page to its place, or use its arrows. Dragging
 * uses pointer events because the window's own file drop (for importing) takes over HTML drag and
 * drop in the WebView.
 */
export function PageArranger({ pages, onChange }: { pages: ArrangedPage[]; onChange: (pages: ArrangedPage[]) => void }) {
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null);
  const targetAt = (x: number, y: number) => {
    const tile = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-page-index]");
    return tile ? Number(tile.dataset.pageIndex) : null;
  };
  return (
    <ol
      className={`arranger${drag ? " dragging" : ""}`}
      onPointerMove={(event) => {
        if (!drag) return;
        const over = targetAt(event.clientX, event.clientY);
        if (over !== null && over !== drag.over) setDrag({ ...drag, over });
      }}
      onPointerUp={() => {
        if (drag && drag.over !== drag.from) onChange(moved(pages, drag.from, drag.over));
        setDrag(null);
      }}
      onPointerCancel={() => setDrag(null)}
    >
      {pages.map((page, index) => (
        <li
          key={page.key}
          data-page-index={index}
          className={drag?.from === index ? "lifted" : drag && drag.over === index ? (drag.over < drag.from ? "drop-before" : "drop-after") : undefined}
          onPointerDown={(event) => {
            if (event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
            event.currentTarget.parentElement?.setPointerCapture(event.pointerId);
            setDrag({ from: index, over: index });
          }}
        >
          <div className="arranger-thumb">{page.src ? <img src={page.src} alt="" draggable={false} /> : <ImageOff size={22} aria-hidden />}</div>
          <div className="arranger-meta">
            <span className="arranger-number">{index + 1}</span>
            <span className="arranger-name" title={page.name}>
              {page.name}
            </span>
          </div>
          <div className="arranger-actions">
            <button type="button" className="icon-btn" aria-label={`Move page ${index + 1} earlier`} disabled={index === 0} onClick={() => onChange(moved(pages, index, index - 1))}>
              <ChevronLeft size={15} />
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label={`Move page ${index + 1} later`}
              disabled={index === pages.length - 1}
              onClick={() => onChange(moved(pages, index, index + 1))}
            >
              <ChevronRight size={15} />
            </button>
            <button type="button" className="icon-btn" aria-label={`Take page ${index + 1} out of the book`} onClick={() => onChange(pages.filter((_, i) => i !== index))}>
              <X size={15} />
            </button>
          </div>
        </li>
      ))}
    </ol>
  );
}

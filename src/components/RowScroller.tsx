import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * A row of Home that scrolls sideways (D-184), with arrows at its ends as Big Picture's rows have:
 * each shows only while there's more that way, and moves the row most of its width.
 */
export function RowScroller({ className = "", children }: { className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [ends, setEnds] = useState({ left: false, right: false });
  useEffect(() => {
    const row = ref.current;
    if (!row) return;
    const update = () => setEnds({ left: row.scrollLeft > 4, right: row.scrollLeft + row.clientWidth < row.scrollWidth - 4 });
    update();
    row.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(row);
    for (const child of row.children) observer.observe(child);
    return () => {
      row.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [children]);
  const by = (direction: number) => ref.current?.scrollBy({ left: direction * ref.current.clientWidth * 0.8, behavior: "smooth" });
  return (
    <div className="row-scroll-wrap">
      <div ref={ref} className={`row-scroller ${className}`.trim()}>
        {children}
      </div>
      <button type="button" className={`row-arrow left${ends.left ? " shown" : ""}`} aria-label="Scroll left" tabIndex={ends.left ? 0 : -1} onClick={() => by(-1)}>
        <ChevronLeft size={22} strokeWidth={2.6} />
      </button>
      <button type="button" className={`row-arrow right${ends.right ? " shown" : ""}`} aria-label="Scroll right" tabIndex={ends.right ? 0 : -1} onClick={() => by(1)}>
        <ChevronRight size={22} strokeWidth={2.6} />
      </button>
    </div>
  );
}

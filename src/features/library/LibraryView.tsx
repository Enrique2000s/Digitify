import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Popover } from "radix-ui";
import { Check, ChevronLeft, ChevronRight, GalleryHorizontalEnd, Heart, LayoutGrid, LayoutList, LibraryBig, List, ListChecks, Paintbrush, Plus } from "lucide-react";
import { api, type Blurb, type ItemCard, type Ownership, type QueryParams, type SortKey } from "../../lib/api";
import { spineColors } from "../../lib/color";
import { formatLabel } from "../../lib/format";
import { usePreferences, type Layout } from "../../lib/preferences";
import { usePagedItems, type PageCache } from "../../lib/queries";
import { actionFor, isTyping } from "../../lib/shortcuts";
import { SelectionProvider, useSelectable, useSelection, useSelectionState } from "../../lib/selection";
import { AddMenu } from "../../components/AddMenu";
import { CategoryStrip } from "../../components/CategoryStrip";
import { aspectFor, CardSizeSlider, Cover } from "../../components/common";
import { CardSkeleton, caseBand, MediaCard } from "../../components/MediaCard";
import { SHELF_LOOKS, ShelfLookPicker } from "../../components/ShelfLookPicker";
import { BulkBar } from "./BulkBar";

const GAP = 22;

function useSize(ref: React.RefObject<HTMLElement | null>): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

function useWidth(ref: React.RefObject<HTMLElement | null>): number {
  return useSize(ref).width;
}

/** Keeps the pages for the rendered rows loaded. */
function useEnsureRows(cache: PageCache, total: number, perRow: number, rows: { index: number }[]) {
  const first = rows.length ? rows[0].index * perRow : 0;
  const last = rows.length ? Math.min(total, (rows[rows.length - 1].index + 1) * perRow) - 1 : -1;
  useEffect(() => {
    if (last >= first) cache.ensure(first, last);
  }, [cache, first, last]);
}

interface ViewProps {
  cache: PageCache;
  total: number;
  square: boolean;
}

function GridView({ cache, total, square }: ViewProps) {
  const { preferences } = usePreferences();
  const scroll = useRef<HTMLDivElement>(null);
  const width = useWidth(scroll);
  const cardWidth = preferences.cardSize;
  const aspect = square ? 1 : 2 / 3;
  const columns = Math.max(1, Math.floor((width + GAP) / (cardWidth + GAP)));
  const rowHeight = Math.round(cardWidth / aspect) + 44 + GAP;
  const virtualizer = useVirtualizer({
    count: Math.ceil(total / columns),
    getScrollElement: () => scroll.current,
    estimateSize: () => rowHeight,
    overscan: 3,
  });
  useEffect(() => virtualizer.measure(), [virtualizer, rowHeight]);
  const rows = virtualizer.getVirtualItems();
  useEnsureRows(cache, total, columns, rows);

  return (
    <div ref={scroll} className="view-scroll">
      <div className="view-canvas" style={{ height: virtualizer.getTotalSize() }}>
        {rows.map((row) => (
          <div
            key={row.key}
            className="grid-row"
            style={{ transform: `translateY(${row.start}px)`, gridTemplateColumns: `repeat(${columns}, ${cardWidth}px)`, columnGap: GAP }}
          >
            {Array.from({ length: columns }, (_, column) => {
              const index = row.index * columns + column;
              if (index >= total) return null;
              const item = cache.get(index);
              return item ? (
                <div key={index} className="grid-cell" style={{ width: cardWidth }}>
                  <MediaCard item={item} index={index} />
                </div>
              ) : (
                <CardSkeleton key={index} width={cardWidth} aspect={aspect} />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function ListView({ cache, total }: ViewProps) {
  const scroll = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({ count: total, getScrollElement: () => scroll.current, estimateSize: () => 58, overscan: 10 });
  const rows = virtualizer.getVirtualItems();
  useEnsureRows(cache, total, 1, rows);
  return (
    <>
      <div className="list-head eyebrow" aria-hidden>
        <span />
        <span>Title</span>
        <span>Creator</span>
        <span>Year</span>
        <span>Copies</span>
        <span>Category</span>
      </div>
      <div ref={scroll} className="view-scroll">
        <div className="view-canvas" style={{ height: virtualizer.getTotalSize() }}>
          {rows.map((row) => {
            const item = cache.get(row.index);
            if (!item) return <div key={row.key} className="list-row" style={{ top: row.start, height: 54 }} />;
            return <ListRow key={row.key} item={item} index={row.index} top={row.start} />;
          })}
        </div>
      </div>
    </>
  );
}

function ListRow({ item, index, top }: { item: ItemCard; index: number; top: number }) {
  const { selecting, checked, props } = useSelectable(item.id, index);
  return (
              <Link
                to="/item/$id"
                params={{ id: String(item.id) }}
                className="list-row"
                style={{ top, height: 54 }}
                {...props}
              >
                <span className="thumb">
                  {selecting ? (
                    <span className={`row-check${checked ? " on" : ""}`} aria-hidden>
                      {checked && <Check size={16} strokeWidth={3.2} />}
                    </span>
                  ) : (
                    <Cover item={item} />
                  )}
                </span>
                <span className="title">
                  {item.title}
                  {item.missing && (
                    <span className="chip warning" style={{ marginLeft: 8 }}>
                      Missing
                    </span>
                  )}
                </span>
                <span className="cell">{item.subtitle}</span>
                <span className="cell">{item.year ?? ""}</span>
                <span className="cell">{item.formats.map(formatLabel).join(", ")}</span>
                <span className="cell" style={{ textTransform: "capitalize" }}>
                  {item.category}
                </span>
              </Link>
  );
}

/** Stable pseudo-random number in [0, 1) per item, for spine widths and heights. */
function jitter(id: number, salt: number): number {
  const x = Math.sin(id * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function ShelfItem({ item, index, height, spines }: { item: ItemCard; index: number; height: number; spines: boolean }) {
  const band = caseBand(item);
  const { selecting, checked, props } = useSelectable(item.id, index);
  const check = selecting && (
    <span className={`card-check${checked ? " on" : ""}`} aria-hidden>
      {checked && <Check size={15} strokeWidth={3.2} />}
    </span>
  );
  if (spines && item.handler !== "audio") {
    const colors = spineColors(item.coverColor);
    const width = Math.round(height * (0.14 + jitter(item.id, 1) * 0.1));
    const spineHeight = Math.round(height * (0.86 + jitter(item.id, 2) * 0.14));
    return (
      <Link to="/item/$id" params={{ id: String(item.id) }} className="shelf-item" title={item.title} data-blip {...props}>
        <div className="spine" style={{ width, height: spineHeight, ...colors }}>
          <span>{item.title}</span>
        </div>
        {check}
      </Link>
    );
  }
  const aspect = aspectFor(item.handler);
  return (
    <Link to="/item/$id" params={{ id: String(item.id) }} className="shelf-item" title={item.title} data-blip {...props}>
      <div className="shelf-cover" style={{ height: aspect === 1 ? height * 0.78 : height, aspectRatio: aspect, position: "relative" }}>
        <Cover item={item} />
        {band && <div className={`card-case ${band}`}>{band === "bluray" ? "BLU-RAY" : "DVD"}</div>}
      </div>
      {check}
    </Link>
  );
}

function ShelfView({ cache, total, square }: ViewProps) {
  const { preferences } = usePreferences();
  const scroll = useRef<HTMLDivElement>(null);
  const width = useWidth(scroll);
  const spines = preferences.shelfStyle === "spines";
  const height = Math.round(preferences.cardSize * 1.4);
  // Shelves fill with as many items as fit at their usual width (album covers are square, shown at
  // 78% of the height; books and films 2:3; spines vary) and sit centered. When a shelf mixing
  // categories comes out a little wide, its items narrow slightly (see .shelf-item) rather than
  // anything being cut at the edge.
  const cover = square ? height * 0.78 : height * (2 / 3);
  const slot = (spines && !square ? Math.round(height * 0.2) + 4 : Math.ceil(cover)) + (spines && !square ? 0 : 16);
  const perShelf = Math.max(1, Math.floor((width - 50 + 16) / slot));
  const shelfHeight = height + 22 + 12 + 26;
  const shelves = Math.ceil(total / perShelf);
  const virtualizer = useVirtualizer({ count: shelves, getScrollElement: () => scroll.current, estimateSize: () => shelfHeight, overscan: 2 });
  useEffect(() => virtualizer.measure(), [virtualizer, shelfHeight]);
  const rows = virtualizer.getVirtualItems();
  useEnsureRows(cache, total, perShelf, rows);

  return (
    <div ref={scroll} className={`view-scroll shelves shelves-${preferences.shelfLook}`}>
      <div className="view-canvas" style={{ height: virtualizer.getTotalSize() + 8 }}>
        {rows.map((row) => (
          <div
            key={row.key}
            className={`shelf${row.index === 0 ? " first" : ""}${row.index === shelves - 1 ? " last" : ""}`}
            style={{ top: row.start, height: shelfHeight, paddingTop: 22 }}
          >
            <div className="shelf-items" style={{ height, gap: spines ? 4 : 16 }}>
              {Array.from({ length: perShelf }, (_, i) => {
                const index = row.index * perShelf + i;
                if (index >= total) return null;
                const item = cache.get(index);
                return item ? <ShelfItem key={index} item={item} index={index} height={height} spines={spines} /> : null;
              })}
            </div>
            <div className="shelf-plank" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ detailed view (Phase 5)

/** Blurbs (description, tags, facts) for the items on screen, fetched as they scroll into view. */
function useBlurbs(ids: number[]): Map<number, Blurb> {
  const store = useRef(new Map<number, Blurb>());
  const asked = useRef(new Set<number>());
  const [, rerender] = useState(0);
  const missing = ids.filter((id) => !asked.current.has(id)).join(",");
  useEffect(() => {
    if (!missing) return;
    const timer = window.setTimeout(() => {
      const wanted = missing.split(",").map(Number);
      for (const id of wanted) asked.current.add(id);
      void api.blurbs(wanted).then(
        (list) => {
          for (const blurb of list) store.current.set(blurb.id, blurb);
          rerender((n) => n + 1);
        },
        () => wanted.forEach((id) => asked.current.delete(id)),
      );
    }, 60);
    return () => window.clearTimeout(timer);
  }, [missing]);
  return store.current;
}

function DetailedRow({ item, index, top, height, blurb }: { item: ItemCard; index: number; top: number; height: number; blurb: Blurb | undefined }) {
  const band = caseBand(item);
  const { selecting, checked, props } = useSelectable(item.id, index);
  const progress = item.progress ?? 0;
  const ownership = item.hasPhysical && item.hasDigital ? "On the shelf and digital" : item.hasPhysical ? "On the shelf" : "Digital";
  return (
    <Link to="/item/$id" params={{ id: String(item.id) }} className="detail-row" style={{ top, height }} data-blip {...props}>
      <div className="detail-cover" style={{ height: height - 26, aspectRatio: aspectFor(item.handler) }}>
        <Cover item={item} />
        {band && <div className={`card-case ${band}`}>{band === "bluray" ? "BLU-RAY" : "DVD"}</div>}
        {selecting && (
          <span className={`card-check${checked ? " on" : ""}`} aria-hidden>
            {checked && <Check size={15} strokeWidth={3.2} />}
          </span>
        )}
      </div>
      <div className="detail-body">
        <div className="detail-title">
          <strong>{item.title}</strong>
          {item.isFavorite && <Heart size={15} fill="currentColor" className="detail-heart" aria-label="Favorite" />}
          {item.missing && <span className="chip warning">Missing</span>}
        </div>
        {(item.subtitle || item.year) && <div className="detail-sub">{[item.subtitle, item.year].filter(Boolean).join(" · ")}</div>}
        <div className="detail-facts">
          <span className="chip">{item.category}</span>
          {item.formats.slice(0, 3).map((format) => (
            <span key={format} className="chip">
              {formatLabel(format)}
            </span>
          ))}
          {blurb?.facts.map((fact) => (
            <span key={fact} className="detail-fact">
              {fact}
            </span>
          ))}
          <span className="detail-fact">{ownership}</span>
        </div>
        {blurb?.description ? <p className="detail-description">{blurb.description}</p> : blurb && <p className="detail-description none">No description yet.</p>}
        {blurb && blurb.tags.length > 0 && (
          <div className="detail-tags">
            {blurb.tags.slice(0, 8).map((tag) => (
              <span key={tag} className="detail-tag">
                #{tag}
              </span>
            ))}
          </div>
        )}
      </div>
      {progress > 0 && (
        <div className="detail-progress" title={progress >= 0.999 ? "Finished" : `${Math.round(progress * 100)}%`}>
          <span style={{ width: `${Math.min(100, progress * 100)}%` }} />
        </div>
      )}
    </Link>
  );
}

/** Rows with big artwork, the description, facts and tags (the brief's "Detailed view"). */
function DetailedView({ cache, total }: ViewProps) {
  const { preferences } = usePreferences();
  const scroll = useRef<HTMLDivElement>(null);
  const rowHeight = Math.round(preferences.cardSize * 1.05) + 26;
  const virtualizer = useVirtualizer({ count: total, getScrollElement: () => scroll.current, estimateSize: () => rowHeight + 14, overscan: 4 });
  useEffect(() => virtualizer.measure(), [virtualizer, rowHeight]);
  const rows = virtualizer.getVirtualItems();
  useEnsureRows(cache, total, 1, rows);
  const blurbs = useBlurbs(rows.map((row) => cache.get(row.index)?.id).filter((id): id is number => id != null));
  return (
    <div ref={scroll} className="view-scroll">
      <div className="view-canvas" style={{ height: virtualizer.getTotalSize() }}>
        {rows.map((row) => {
          const item = cache.get(row.index);
          if (!item) return <div key={row.key} className="detail-row skeleton" style={{ top: row.start, height: rowHeight }} />;
          return <DetailedRow key={row.key} item={item} index={row.index} top={row.start} height={rowHeight} blurb={blurbs.get(item.id)} />;
        })}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ carousel view (Phase 5)

/** Covers in a 3D row: the one in front is big, its neighbours turn away. Arrow keys, the wheel,
 * dragging, clicking a cover or the slider move along; Enter or a click on the front cover opens it. */
function CarouselView({ cache, total }: ViewProps) {
  const navigate = useNavigate();
  const stage = useRef<HTMLDivElement>(null);
  const { width, height } = useSize(stage);
  const [index, setIndex] = useState(0);
  const go = useCallback((next: number) => setIndex(Math.max(0, Math.min(total - 1, Math.round(next)))), [total]);
  const current = cache.get(index);
  const latest = useRef({ index, current });
  latest.current = { index, current };

  useEffect(() => {
    if (index > total - 1) setIndex(Math.max(0, total - 1));
    if (total > 0) cache.ensure(Math.max(0, index - 14), Math.min(total - 1, index + 14));
  }, [cache, index, total]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event) || (event.target as HTMLElement | null)?.closest?.("[role=dialog], .menu")) return;
      const action = actionFor(event, "library");
      const { index, current } = latest.current;
      if (action === "library.carouselPrevious") go(index - 1);
      else if (action === "library.carouselNext") go(index + 1);
      else if (action === "library.carouselOpen" && current) void navigate({ to: "/item/$id", params: { id: String(current.id) } });
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, navigate]);

  // The wheel moves one cover per notch; a drag moves with the pointer.
  const wheel = useRef(0);
  const onWheel = (event: React.WheelEvent) => {
    wheel.current += Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (Math.abs(wheel.current) >= 60) {
      go(index + Math.sign(wheel.current));
      wheel.current = 0;
    }
  };
  const coverHeight = Math.max(150, Math.min(460, Math.round(height * 0.68)));
  const spacing = coverHeight * 0.3;
  const drag = useRef<{ x: number; from: number; moved: boolean } | null>(null);
  const onPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    drag.current = { x: event.clientX, from: index, moved: false };
  };
  const onPointerMove = (event: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !(event.buttons & 1)) return;
    const dx = event.clientX - d.x;
    if (Math.abs(dx) > 6) d.moved = true;
    if (d.moved) go(d.from - dx / spacing);
  };
  const onClickCapture = (event: React.MouseEvent) => {
    if (drag.current?.moved) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  const reach = Math.min(9, Math.ceil(width / 2 / spacing) + 1);
  const shown: number[] = [];
  for (let i = Math.max(0, index - reach); i <= Math.min(total - 1, index + reach); i++) shown.push(i);
  return (
    <div className="carousel">
      <div
        ref={stage}
        className="carousel-stage"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => {
          // After a drag, the click that follows is swallowed (onClickCapture), then the drag ends.
          if (drag.current?.moved) window.setTimeout(() => (drag.current = null), 0);
          else drag.current = null;
        }}
        onClickCapture={onClickCapture}
      >
        {height > 0 &&
          shown.map((i) => {
            const item = cache.get(i);
            const d = i - index;
            const side = Math.sign(d);
            const far = Math.abs(d);
            const x = d === 0 ? 0 : side * (coverHeight * 0.5 + (far - 1) * spacing);
            const style = {
              "--x": `${x}px`,
              "--z": `${d === 0 ? 90 : -60 - far * 14}px`,
              "--turn": `${d === 0 ? 0 : -side * 58}deg`,
              zIndex: 100 - far,
              opacity: far > reach - 1 ? 0 : 1,
              height: coverHeight,
              aspectRatio: item ? aspectFor(item.handler) : 2 / 3,
              bottom: Math.max(40, (height - coverHeight) / 2 + 10),
            } as CSSProperties;
            return item ? (
              <CarouselCover key={i} item={item} index={i} front={d === 0} style={style} onPick={() => go(i)} />
            ) : (
              <div key={i} className="carousel-item skeleton" style={style} />
            );
          })}
        <button type="button" className="round-btn carousel-arrow left" aria-label="Previous" disabled={index <= 0} onClick={() => go(index - 1)}>
          <ChevronLeft size={20} />
        </button>
        <button type="button" className="round-btn carousel-arrow right" aria-label="Next" disabled={index >= total - 1} onClick={() => go(index + 1)}>
          <ChevronRight size={20} />
        </button>
      </div>
      <div className="carousel-info">
        <strong className="carousel-title">{current?.title ?? " "}</strong>
        <span className="carousel-sub">{current ? [current.subtitle, current.year].filter(Boolean).join(" · ") || " " : " "}</span>
        <div className="carousel-scrub">
          <input
            type="range"
            aria-label="Position in the carousel"
            min={0}
            max={Math.max(0, total - 1)}
            value={index}
            style={{ "--fill": `${total > 1 ? (index / (total - 1)) * 100 : 0}%` } as CSSProperties}
            onChange={(event) => go(Number(event.target.value))}
          />
          <span className="carousel-count">
            {(index + 1).toLocaleString()} of {total.toLocaleString()}
          </span>
        </div>
      </div>
    </div>
  );
}

function CarouselCover({ item, index, front, style, onPick }: { item: ItemCard; index: number; front: boolean; style: CSSProperties; onPick: () => void }) {
  const band = caseBand(item);
  const { selecting, checked, props } = useSelectable(item.id, index);
  return (
    <Link
      to="/item/$id"
      params={{ id: String(item.id) }}
      className={`carousel-item${front ? " front" : ""}`}
      style={style}
      title={item.title}
      draggable={false}
      tabIndex={front ? 0 : -1}
      {...props}
      onClick={(event) => {
        // A cover at the side comes to the front first; the front one opens (or is selected).
        if (!front && !selecting) {
          event.preventDefault();
          onPick();
          return;
        }
        (props as { onClick?: (event: React.MouseEvent) => void }).onClick?.(event);
      }}
    >
      <Cover item={item} />
      {band && <div className={`card-case ${band}`}>{band === "bluray" ? "BLU-RAY" : "DVD"}</div>}
      {selecting && (
        <span className={`card-check${checked ? " on" : ""}`} aria-hidden>
          {checked && <Check size={15} strokeWidth={3.2} />}
        </span>
      )}
    </Link>
  );
}

const SHELF_SORT = { value: "shelf" as SortKey, label: "Shelf order" };

const SORTS: { value: SortKey; label: string }[] = [
  { value: "title", label: "Title" },
  { value: "added", label: "Recently added" },
  { value: "year", label: "Year" },
  { value: "creator", label: "Creator" },
];

const OWNERSHIP: { value: Ownership | ""; label: string }[] = [
  { value: "", label: "All" },
  { value: "physical", label: "On the shelf" },
  { value: "digital", label: "Digital" },
  { value: "physicalOnly", label: "Not digitized" },
];

/** The "Select" toggle; Ctrl+A selects everything and Esc stops selecting. */
function SelectToggle({ base }: { base: Omit<QueryParams, "offset" | "limit"> }) {
  const selection = useSelection();
  useEffect(() => {
    if (!selection?.active) return;
    const onKey = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLElement && event.target.closest("input, textarea, select, [role=dialog]");
      if (typing) return;
      const action = actionFor(event, "library");
      if (action === "library.stopSelecting") selection.stop();
      if (action === "library.selectAll") {
        event.preventDefault();
        void api.queryIds(base).then(selection.set, () => {});
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selection, base]);
  if (!selection) return null;
  return (
    <button type="button" className="btn btn-sm" aria-pressed={selection.active} onClick={selection.active ? selection.stop : selection.start}>
      <ListChecks size={15} /> {selection.active ? "Selecting" : "Select"}
    </button>
  );
}

/** A browsable, virtualized view of library items with layout, sort and ownership filters. */
export function LibraryView({
  viewKey,
  base,
  title,
  eyebrow,
  icon,
  description,
  actions,
  prelude,
  square,
  smart,
  empty,
}: {
  viewKey: string;
  base: Omit<QueryParams, "offset" | "limit">;
  title: string;
  eyebrow?: ReactNode;
  icon?: ReactNode;
  description?: string | null;
  /** Extra buttons next to "Add" (shelf, tag or collection actions). */
  actions?: ReactNode;
  /** Shown between the header and the toolbar (sub-collections). */
  prelude?: ReactNode;
  square?: boolean;
  /** A smart shelf: it orders and fills itself, so nothing can be taken off it by hand. */
  smart?: boolean;
  empty: ReactNode;
}) {
  const { preferences, update } = usePreferences();
  const onShelf = base.shelf != null;
  const [sort, setSort] = useState<SortKey | "">(base.search ? "" : onShelf ? "shelf" : "title");
  const [ownership, setOwnership] = useState<Ownership | "">("");
  const layout: Layout = preferences.layouts[viewKey] ?? "grid";
  const params = { ...base, sort: sort || null, ownership: ownership || null };
  const { cache, total, error } = usePagedItems(params);
  const selection = useSelectionState(cache);
  const sorts = onShelf ? [SHELF_SORT, ...SORTS] : SORTS;

  const setLayout = (next: Layout) => update({ layouts: { ...preferences.layouts, [viewKey]: next } });
  const [materials, setMaterials] = useState(false);

  return (
    <SelectionProvider value={selection}>
      <div className={`library-view${selection.active ? " selecting" : ""}`}>
        <div style={{ padding: "16px 40px 0" }}>
          <CategoryStrip />
          <div className="page-header">
            <div className="title-row">
              {icon && <span className="title-badge">{icon}</span>}
              <div>
                {eyebrow && <div className="eyebrow">{eyebrow}</div>}
                <h1 className="display">{title}</h1>
                <div className="count">
                  {total == null ? " " : `${total.toLocaleString()} ${total === 1 ? "item" : "items"}`}
                  {description && <span className="view-description"> · {description}</span>}
                </div>
              </div>
            </div>
            <div className="header-actions">
              {actions}
              <AddMenu align="end">
                <button type="button" className="btn btn-primary">
                  <Plus size={17} strokeWidth={2.6} /> Add
                </button>
              </AddMenu>
            </div>
          </div>
          {prelude}
          <div className="toolbar">
            <div className="segmented layout-switch" role="group" aria-label="Layout">
              {(
                [
                  ["grid", "Grid", LayoutGrid],
                  ["shelf", "Shelf", LibraryBig],
                  ["list", "List", List],
                  ["detailed", "Detailed", LayoutList],
                  ["carousel", "Carousel", GalleryHorizontalEnd],
                ] as const
              ).map(([value, label, Icon]) => (
                <button key={value} type="button" aria-pressed={layout === value} aria-label={label} title={label} onClick={() => setLayout(value)}>
                  <Icon size={16} aria-hidden />
                  {layout === value && <span className="layout-name">{label}</span>}
                </button>
              ))}
            </div>
            <div className="segmented" role="group" aria-label="Ownership">
              {OWNERSHIP.map((option) => (
                <button key={option.value} type="button" aria-pressed={ownership === option.value} onClick={() => setOwnership(option.value)}>
                  {option.label}
                </button>
              ))}
            </div>
            <div className="spacer" />
            {total != null && total > 0 && <SelectToggle base={params} />}
            {layout === "shelf" && (
              <>
                <div className="segmented" role="group" aria-label="Shelf style">
                  {(["covers", "spines"] as const).map((style) => (
                    <button key={style} type="button" aria-pressed={preferences.shelfStyle === style} onClick={() => update({ shelfStyle: style })}>
                      {style === "covers" ? "Covers" : "Spines"}
                    </button>
                  ))}
                </div>
                <Popover.Root open={materials} onOpenChange={setMaterials}>
                  <Popover.Trigger asChild>
                    <button type="button" className="btn btn-sm" aria-label="Shelf material" title="Shelf material">
                      <Paintbrush size={15} /> {SHELF_LOOKS.find((look) => look.value === preferences.shelfLook)?.name}
                    </button>
                  </Popover.Trigger>
                  <Popover.Portal>
                    <Popover.Content className="menu shelf-look-menu" align="end" sideOffset={8} collisionPadding={16}>
                      <ShelfLookPicker onPick={() => setMaterials(false)} />
                    </Popover.Content>
                  </Popover.Portal>
                </Popover.Root>
              </>
            )}
            {layout !== "list" && layout !== "carousel" && (
              <label className="inline">
                Size
                <CardSizeSlider value={preferences.cardSize} onChange={(cardSize) => update({ cardSize })} />
              </label>
            )}
            <label className="inline">
              Sort
              <select className="select" style={{ width: "auto", minHeight: 34 }} value={sort} onChange={(event) => setSort(event.target.value as SortKey | "")}>
                {base.search && <option value="">Best match</option>}
                {sorts.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
        {error && <div className="notice danger" style={{ margin: "0 40px" }}>{error}</div>}
        {total === 0 ? (
          <div style={{ padding: "8px 40px" }}>{empty}</div>
        ) : total != null && layout === "list" ? (
          <ListView cache={cache} total={total} square={!!square} />
        ) : total != null && layout === "shelf" ? (
          <ShelfView cache={cache} total={total} square={!!square} />
        ) : total != null && layout === "detailed" ? (
          <DetailedView cache={cache} total={total} square={!!square} />
        ) : total != null && layout === "carousel" ? (
          <CarouselView cache={cache} total={total} square={!!square} />
        ) : total != null ? (
          <GridView cache={cache} total={total} square={!!square} />
        ) : null}
        {total != null && <BulkBar base={params} total={total} shelf={smart ? undefined : (base.shelf ?? undefined)} />}
      </div>
    </SelectionProvider>
  );
}

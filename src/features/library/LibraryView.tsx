import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Check, LayoutGrid, LibraryBig, List, ListChecks, Plus } from "lucide-react";
import { api, type ItemCard, type Ownership, type QueryParams, type SortKey } from "../../lib/api";
import { spineColors } from "../../lib/color";
import { formatLabel } from "../../lib/format";
import { usePreferences, type Layout } from "../../lib/preferences";
import { usePagedItems, type PageCache } from "../../lib/queries";
import { SelectionProvider, useSelectable, useSelection, useSelectionState } from "../../lib/selection";
import { AddMenu } from "../../components/AddMenu";
import { CategoryStrip } from "../../components/CategoryStrip";
import { aspectFor, CardSizeSlider, Cover } from "../../components/common";
import { CardSkeleton, caseBand, MediaCard } from "../../components/MediaCard";
import { BulkBar } from "./BulkBar";

const GAP = 22;

function useWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
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
    <div ref={scroll} className="view-scroll">
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
      if (event.key === "Escape" && !typing) selection.stop();
      if (event.ctrlKey && event.key.toLowerCase() === "a" && !typing) {
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
            <div className="segmented" role="group" aria-label="Layout">
              {(
                [
                  ["grid", "Grid", LayoutGrid],
                  ["shelf", "Shelf", LibraryBig],
                  ["list", "List", List],
                ] as const
              ).map(([value, label, Icon]) => (
                <button key={value} type="button" aria-pressed={layout === value} onClick={() => setLayout(value)}>
                  <Icon size={15} aria-hidden /> {label}
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
              <div className="segmented" role="group" aria-label="Shelf style">
                {(["covers", "spines"] as const).map((style) => (
                  <button key={style} type="button" aria-pressed={preferences.shelfStyle === style} onClick={() => update({ shelfStyle: style })}>
                    {style === "covers" ? "Covers" : "Spines"}
                  </button>
                ))}
              </div>
            )}
            {layout !== "list" && (
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
        ) : total != null ? (
          <GridView cache={cache} total={total} square={!!square} />
        ) : null}
        {total != null && <BulkBar base={params} total={total} shelf={base.shelf ?? undefined} />}
      </div>
    </SelectionProvider>
  );
}

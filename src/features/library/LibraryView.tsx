import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { flushSync } from "react-dom";
import { motionAllowed } from "../reader/chrome";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Popover } from "radix-ui";
import { Check, ChevronLeft, ChevronRight, GalleryHorizontalEnd, GripVertical, Heart, LayoutGrid, LayoutList, LibraryBig, List, ListChecks, Paintbrush, Play, Plus, Search, Shuffle } from "lucide-react";
import { api, type Blurb, type ItemCard, type Ownership, type QueryParams, type SortKey } from "../../lib/api";
import { itemPath, photoContext } from "../../lib/routes";
import { GridDragProvider, moved } from "../../lib/gridDrag";
import { spineColors } from "../../lib/color";
import { formatLabel } from "../../lib/format";
import { coverShapeOf, FILMS, SHAPE_ASPECT, useCoverShape, usePreferences, type Layout } from "../../lib/preferences";
import { useMusic } from "../../lib/music/MusicProvider";
import { shuffled } from "../music/Tracks";
import { libraryChanged, useCollections, usePagedItems, type PageCache } from "../../lib/queries";
import { actionFor, isTyping } from "../../lib/shortcuts";
import { SelectionProvider, useSelectable, useSelection, useSelectionState } from "../../lib/selection";
import { AddMenu } from "../../components/AddMenu";
import { CategoryStrip } from "../../components/CategoryStrip";
import { useArrival } from "../../lib/arrival";
import { CardSizeSlider, Cover } from "../../components/common";
import { CardSkeleton, caseBand, MediaCard } from "../../components/MediaCard";
import { CollectionCard, collectionCard, CollectionCarouselItem, CollectionDetailRow, CollectionRowItem, CollectionShelfItem } from "../../components/CollectionCard";
import { SHELF_LOOKS, ShelfLookPicker } from "../../components/ShelfLookPicker";
import { BulkBar } from "./BulkBar";
import { SourceTag, sourceProps } from "../../components/SourceTag";
import { ArrangeDialog } from "./ArrangeDialog";
import type { CoverShape } from "../../lib/api";

const GAP = 22;

function useSize(ref: React.RefObject<HTMLElement | null>): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Measured at once (not only when the observer first reports), so a new layout draws complete
    // in its first frame, which is what a view transition captures.
    const style = getComputedStyle(el);
    const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    setSize({ width: el.clientWidth - padX, height: el.clientHeight - padY });
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

function useWidth(ref: React.RefObject<HTMLElement | null>): number {
  return useSize(ref).width;
}

/** What a view shows, by position: a page cache, possibly led by collections. */
interface CardSource {
  get(index: number): ItemCard | undefined;
  ensure(first: number, last: number): void;
}

/** A view's collections (D-030) first, then the query's items. */
/**
 * A view's cards: its collections, each at its place (first by default; anywhere among the items in
 * a custom order, D-036), and its items filling the other places in order.
 */
class LedSource implements CardSource {
  private readonly at: Map<number, ItemCard>;
  /** The collections' places, in order. */
  readonly slots: number[];
  constructor(
    lead: ItemCard[],
    places: Map<number, number> | null,
    private readonly items: PageCache | null,
  ) {
    const placed = lead.map((card, i) => [places?.get(card.id) ?? i, card] as const).sort((a, b) => a[0] - b[0]);
    // Places must be distinct and in reach; anything odd falls back to the next free place.
    const at = new Map<number, ItemCard>();
    for (const [place, card] of placed) {
      let p = Math.max(0, place);
      while (at.has(p)) p++;
      at.set(p, card);
    }
    this.at = at;
    this.slots = [...at.keys()].sort((a, b) => a - b);
  }
  /** How many collections stand before `index`. */
  private before(index: number): number {
    let lo = 0;
    let hi = this.slots.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.slots[mid] < index) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }
  get(index: number): ItemCard | undefined {
    return this.at.get(index) ?? this.items?.get(index - this.before(index));
  }
  ensure(first: number, last: number): void {
    if (!this.items) return;
    const from = Math.max(0, first - this.before(first));
    const to = last - this.before(last + 1);
    if (to >= from) this.items.ensure(from, to);
  }
}

/** Item aspects with the collections' (16:9) put in at their places. */
function withSlots(slots: number[], total: number, itemAspects: number[]): number[] {
  const out: number[] = [];
  const places = new Set(slots);
  let next = 0;
  for (let i = 0; i < total; i++) out.push(places.has(i) ? 16 / 9 : (itemAspects[next++] ?? itemAspects[itemAspects.length - 1] ?? 2 / 3));
  return out;
}

/** Keeps the pages for the rendered rows loaded. */
function useEnsureRows(cache: CardSource, total: number, perRow: number, rows: { index: number }[]) {
  const first = rows.length ? rows[0].index * perRow : 0;
  const last = rows.length ? Math.min(total, (rows[rows.length - 1].index + 1) * perRow) - 1 : -1;
  useEffect(() => {
    if (last >= first) cache.ensure(first, last);
  }, [cache, first, last]);
}

interface ViewProps {
  cache: CardSource;
  total: number;
  /** How many collections the view holds. */
  lead: number;
  /** Where they stand (D-036). */
  slots: number[];
  square: boolean;
  /** The view's usual cover shape (an item may have its own). */
  shape: CoverShape | "book";
  params: Omit<QueryParams, "offset" | "limit">;
}

/** Marks a cover with its item, so a layout change can move it from its old place to its new one. */
const vt = (id: number) => ({ "data-vt": id });

/**
 * Names the covers that are in view (and only those: ones scrolled out of sight would fly in over
 * the toolbar). Called before and after a layout change; the names are cleared once it's done.
 */
function nameCovers() {
  const area = document.querySelector<HTMLElement>(".library-view .view-scroll, .library-view .carousel-stage")?.getBoundingClientRect();
  document.querySelectorAll<HTMLElement>("[data-vt]").forEach((element) => {
    const r = element.getBoundingClientRect();
    const inView = !!area && r.width > 0 && r.bottom > area.top && r.top < area.bottom && r.right > area.left && r.left < area.right;
    element.style.viewTransitionName = inView ? `cover-${element.dataset.vt}` : "";
  });
}
function clearCoverNames() {
  document.querySelectorAll<HTMLElement>("[data-vt]").forEach((element) => (element.style.viewTransitionName = ""));
}

const SHAPE_CODES: Record<string, CoverShape> = { s: "square", d: "disc", p: "poster", l: "landscape" };
const HANDLER_CODES: Record<string, string> = { b: "book", c: "comic", v: "video", m: "video", a: "audio", g: "generic", i: "image" };

/** The aspect of each item in a view, in view order, from the core's two-letter codes (`m` is Movies & Series). */
function aspectsOf(codes: string, total: number, fallback: number, defaults: Parameters<typeof coverShapeOf>[1]): number[] {
  const aspects: number[] = [];
  for (let i = 0; i < total; i++) {
    const code = codes[i * 2];
    const handler = HANDLER_CODES[code];
    aspects.push(
      handler ? SHAPE_ASPECT[coverShapeOf({ handler, category: code === "m" ? FILMS : null, coverShape: SHAPE_CODES[codes[i * 2 + 1]] ?? null }, defaults)] : fallback,
    );
  }
  return aspects;
}

/**
 * Every card's proportions in view order (collections at their places): its kind's cover shape, or
 * a photo's own width / height (D-073). `onlyPhotos` when the view holds photos and nothing else,
 * so they can be laid out in justified rows.
 */
function useAspects(params: ViewProps["params"], slots: number[], total: number, lead: number, shape: ViewProps["shape"]) {
  const { preferences } = usePreferences();
  const shapes = useQuery({ queryKey: ["shapes", params], queryFn: () => api.queryShapes(params), staleTime: 30_000 });
  const photos = useQuery({ queryKey: ["aspects", params], queryFn: () => api.queryAspects(params), staleTime: 30_000 });
  return useMemo(() => {
    const codes = shapes.data ?? "";
    const count = total - lead;
    const base = aspectsOf(codes, count, SHAPE_ASPECT[shape], preferences.coverShapes);
    const own = photos.data ?? [];
    const merged = base.map((a, i) => (own[i] > 0 ? own[i] : a));
    let onlyPhotos = count > 0 && codes.length >= count * 2;
    let hasPhotos = false;
    for (let i = 0; i < count; i++) {
      if (codes[i * 2] === "i") hasPhotos = true;
      else onlyPhotos = false;
    }
    return { aspects: withSlots(slots, total, merged), onlyPhotos, hasPhotos };
  }, [shapes.data, photos.data, total, lead, slots, shape, preferences.coverShapes]);
}

/**
 * Covers in rows of the same height: vertical, square, round and horizontal covers sit side by side
 * at one height, each as wide as its shape needs (the view's kinds and shapes come from the core,
 * so every row is known before its cards load).
 */
function GridView({ cache, total, lead, slots, shape, params }: ViewProps) {
  const { preferences } = usePreferences();
  const scroll = useRef<HTMLDivElement>(null);
  const width = useWidth(scroll);
  const { aspects, onlyPhotos } = useAspects(params, slots, total, lead, shape);
  // One art height in every view, whatever its category, so a cover is the same size in Videos,
  // Music or Everything; each is as wide as its shape needs.
  const artHeight = Math.round(preferences.cardSize * 1.5);
  const layout = useMemo(() => {
    const natural = aspects.map((aspect) => Math.round(artHeight * aspect));
    const rows: number[] = [0];
    const rowWidths: number[] = [];
    let used = 0;
    natural.forEach((w, i) => {
      const need = used === 0 ? w : used + GAP + w;
      if (used > 0 && need > Math.max(width, w)) {
        rows.push(i);
        rowWidths.push(used);
        used = w;
      } else {
        used = need;
      }
    });
    rowWidths.push(used);
    rows.push(total);
    const widths = [...natural];
    const heights = rowWidths.map(() => artHeight);
    // Photos only (D-073): every full row is stretched to the view's width, its photos growing
    // together at one height (justified rows); the last row keeps the usual height.
    const MAX = 1.45;
    if (onlyPhotos && width > 0) {
      for (let r = 0; r < rowWidths.length - 1; r++) {
        const from = rows[r];
        const to = rows[r + 1];
        const gaps = GAP * (to - from - 1);
        const scale = Math.min(MAX, (width - gaps) / Math.max(1, rowWidths[r] - gaps));
        heights[r] = Math.round(artHeight * scale);
        let sum = 0;
        for (let i = from; i < to; i++) {
          widths[i] = Math.floor(natural[i] * scale);
          sum += widths[i];
        }
        // Rounding leftovers go to the last photo, so a full row ends exactly at the edge.
        const left = scale < MAX ? Math.max(0, width - gaps - sum) : 0;
        widths[to - 1] += left;
        rowWidths[r] = sum + left + gaps;
      }
    }
    // Every row centered on its own, so rows of different widths (mixed shapes, the last row)
    // don't leave one edge further out than another (D-043).
    const offsets = rowWidths.map((w) => Math.max(0, Math.floor((width - w) / 2)));
    return { widths, starts: rows, offsets, heights };
  }, [aspects, onlyPhotos, total, width, artHeight]);
  const rowCount = Math.max(0, layout.starts.length - 1);
  const rowHeight = (index: number) => (layout.heights[index] ?? artHeight) + 44 + GAP + 10;
  // Light mode draws fewer rows ahead of the scroll.
  const virtualizer = useVirtualizer({ count: rowCount, getScrollElement: () => scroll.current, estimateSize: rowHeight, overscan: preferences.lightMode ? 1 : 3 });
  useEffect(() => virtualizer.measure(), [virtualizer, layout, artHeight]);
  const rows = virtualizer.getVirtualItems();
  const first = rows.length ? layout.starts[rows[0].index] : 0;
  const last = rows.length ? layout.starts[rows[rows.length - 1].index + 1] - 1 : -1;
  useEffect(() => {
    if (last >= first) cache.ensure(first, last);
  }, [cache, first, last]);

  return (
    <div ref={scroll} className="view-scroll">
      <div className="view-canvas" style={{ height: virtualizer.getTotalSize() }}>
        {width > 0 &&
          rows.map((row) => {
            const from = layout.starts[row.index];
            const to = layout.starts[row.index + 1];
            return (
              <div key={row.key} className="grid-row flow" style={{ transform: `translateY(${row.start}px)`, left: layout.offsets[row.index] ?? 0, columnGap: GAP, ["--row" as string]: row.index }}>
                {Array.from({ length: to - from }, (_, k) => {
                  const index = from + k;
                  const item = cache.get(index);
                  const w = layout.widths[index];
                  return item?.collection ? (
                    <CollectionCard key={`c${item.id}`} item={item} width={w} index={index} />
                  ) : item ? (
                    <MediaCard key={index} item={item} index={index} width={w} transitionId={item.id} />
                  ) : (
                    <CardSkeleton key={index} width={w} aspect={w / (layout.heights[row.index] ?? artHeight)} />
                  );
                })}
              </div>
            );
          })}
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
            if (item.collection) return <CollectionRowItem key={`c${item.id}`} item={item} top={row.start} index={row.index} />;
            return <ListRow key={row.key} item={item} index={row.index} top={row.start} />;
          })}
        </div>
      </div>
    </>
  );
}

function ListRow({ item, index, top }: { item: ItemCard; index: number; top: number }) {
  const { selecting, checked, props } = useSelectable(item.id, index);
  const shapeOf = useCoverShape();
  return (
              <Link
                to={itemPath(item)}
                params={{ id: String(item.id) }}
                className="list-row"
                style={{ top, height: 54 }}
                {...props}
              >
                <span className="thumb" data-shape={shapeOf(item).shape} {...vt(item.id)} {...sourceProps(item.source)}>
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

/** A cover's size on a shelf `height` tall: square and round ones are a little lower, horizontal ones lower still. */
/** On a shelf, photos stand at one height, each as wide as it is (D-073). */
const PHOTO_ON_SHELF = 0.78;

function shelfBox(shape: CoverShape | "book", height: number): { height: number; width: number } {
  if (shape === "square" || shape === "disc") return { height: height * 0.78, width: height * 0.78 };
  if (shape === "landscape") return { height, width: height * (16 / 9) };
  return { height, width: height * (2 / 3) };
}

function ShelfItem({ item, index, height, spines }: { item: ItemCard; index: number; height: number; spines: boolean }) {
  const band = caseBand(item);
  const { shape, aspect } = useCoverShape()(item);
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
      <Link to={itemPath(item)} params={{ id: String(item.id) }} className="shelf-item" title={item.title} data-blip {...props}>
        <div className="spine" style={{ width, height: spineHeight, ...colors }} {...vt(item.id)}>
          <span>{item.title}</span>
        </div>
        {check}
      </Link>
    );
  }
  return (
    <Link to={itemPath(item)} params={{ id: String(item.id) }} className="shelf-item" title={item.title} data-blip {...props}>
      {/* Sized by width: if a full shelf narrows its covers, they shrink whole and keep their shape. */}
      <div className="shelf-cover" data-shape={shape} style={{ width: item.handler === "image" && item.aspect ? Math.round(height * PHOTO_ON_SHELF * aspect) : shelfBox(shape, height).width, aspectRatio: aspect, position: "relative" }} {...vt(item.id)} {...sourceProps(item.source)}>
        <Cover item={item} />
        <SourceTag service={item.source} />
        {band && <div className={`card-case ${band}`}>{band === "bluray" ? "BLU-RAY" : "DVD"}</div>}
      </div>
      {check}
    </Link>
  );
}

function ShelfView({ cache, total, lead, slots, square, shape, params }: ViewProps) {
  const { preferences } = usePreferences();
  const scroll = useRef<HTMLDivElement>(null);
  const width = useWidth(scroll);
  const spines = preferences.shelfStyle === "spines";
  const height = Math.round(preferences.cardSize * 1.4);
  const { aspects, hasPhotos } = useAspects(params, slots, total, lead, shape);
  // Shelves fill with as many items as fit at their usual width (album covers are square, shown at
  // 78% of the height; books and films 2:3; spines vary) and sit centered. When a shelf mixing
  // categories comes out a little wide, its items narrow slightly (see .shelf-item) rather than
  // anything being cut at the edge.
  const cover = shelfBox(square ? "square" : shape, height).width;
  const slot = (spines && !square ? Math.round(height * 0.2) + 4 : Math.ceil(cover)) + (spines && !square ? 0 : 16);
  const perShelf = Math.max(1, Math.floor((width - 50 + 16) / slot));
  const shelfHeight = height + 22 + 12 + 26;
  // With photos (D-073) each shelf holds as many as fit by their own widths; otherwise the same
  // number on every shelf.
  const starts = useMemo(() => {
    if (!hasPhotos || spines || width <= 0) return null;
    const room = width - 50 + 16;
    const out = [0];
    let used = 0;
    aspects.forEach((aspect, i) => {
      const w = Math.round(height * PHOTO_ON_SHELF * aspect) + 16;
      if (used > 0 && used + w > room) {
        out.push(i);
        used = 0;
      }
      used += w;
    });
    out.push(total);
    return out;
  }, [hasPhotos, spines, width, aspects, height, total]);
  const shelves = starts ? starts.length - 1 : Math.ceil(total / perShelf);
  const range = (shelf: number) => (starts ? [starts[shelf], starts[shelf + 1]] : [shelf * perShelf, Math.min(total, (shelf + 1) * perShelf)]);
  const virtualizer = useVirtualizer({ count: shelves, getScrollElement: () => scroll.current, estimateSize: () => shelfHeight, overscan: 2 });
  useEffect(() => virtualizer.measure(), [virtualizer, shelfHeight, starts]);
  const rows = virtualizer.getVirtualItems();
  const firstShown = rows.length ? range(rows[0].index)[0] : 0;
  const lastShown = rows.length ? range(rows[rows.length - 1].index)[1] - 1 : -1;
  useEffect(() => {
    if (lastShown >= firstShown) cache.ensure(firstShown, lastShown);
  }, [cache, firstShown, lastShown]);

  return (
    <div ref={scroll} className={`view-scroll shelves shelves-${preferences.shelfLook}`}>
      <div className="view-canvas" style={{ height: virtualizer.getTotalSize() + 8 }}>
        {rows.map((row) => (
          <div
            key={row.key}
            className={`shelf${row.index === 0 ? " first" : ""}${row.index === shelves - 1 ? " last" : ""}`}
            data-row={row.index}
            style={{ top: row.start, height: shelfHeight, paddingTop: 22 }}
          >
            <div className="shelf-items" style={{ height, gap: spines ? 4 : 16 }}>
              {Array.from({ length: range(row.index)[1] - range(row.index)[0] }, (_, i) => {
                const index = range(row.index)[0] + i;
                if (index >= total) return null;
                const item = cache.get(index);
                if (item?.collection) return <CollectionShelfItem key={`c${item.id}`} item={item} height={height * 0.78} index={index} />;
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
  const { shape, aspect } = useCoverShape()(item);
  const progress = item.progress ?? 0;
  const availability = item.online ? `Online on ${item.source ?? "the web"}` : item.hasDigital ? "Digital" : null;
  return (
    <Link to={itemPath(item)} params={{ id: String(item.id) }} className="detail-row" style={{ top, height }} data-blip {...props}>
      <div className="detail-cover" data-shape={shape} style={{ height: height - 26, aspectRatio: aspect }} {...vt(item.id)} {...sourceProps(item.source)}>
        <Cover item={item} />
        <SourceTag service={item.source} />
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
          {availability && <span className="detail-fact">{availability}</span>}
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
  const blurbs = useBlurbs(rows.map((row) => cache.get(row.index)?.id).filter((id): id is number => id != null && id > 0));
  return (
    <div ref={scroll} className="view-scroll">
      <div className="view-canvas" style={{ height: virtualizer.getTotalSize() }}>
        {rows.map((row) => {
          const item = cache.get(row.index);
          if (!item) return <div key={row.key} className="detail-row skeleton" style={{ top: row.start, height: rowHeight }} />;
          if (item.collection) return <CollectionDetailRow key={`c${item.id}`} item={item} top={row.start} height={rowHeight} index={row.index} />;
          return <DetailedRow key={row.key} item={item} index={row.index} top={row.start} height={rowHeight} blurb={blurbs.get(item.id)} />;
        })}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ carousel view (Phase 5)

/** Covers in a 3D row: the one in front is big, its neighbours turn away. Arrow keys, the wheel,
 * dragging, clicking a cover or the slider move along; Enter or a click on the front cover opens it.
 * Every cover's shape is known before its card loads (from the core), so posters, squares, CDs and
 * horizontal frames keep their places and sizes as they come in. */
function CarouselView({ cache, total, lead, slots, shape, params }: ViewProps) {
  const navigate = useNavigate();
  const { preferences } = usePreferences();
  const shapeOf = useCoverShape();
  const stage = useRef<HTMLDivElement>(null);
  const { width, height } = useSize(stage);
  const [index, setIndex] = useState(0);
  const last = Math.max(0, total - 1);
  const clamp = useCallback((value: number) => Math.max(0, Math.min(last, Math.round(value))), [last]);
  const go = useCallback((next: number) => setIndex(clamp(next)), [clamp]);
  // Relative moves build on the latest index, so quick presses never get lost.
  const step = useCallback((by: number) => setIndex((current) => clamp(current + by)), [clamp]);
  const current = cache.get(index);
  const latest = useRef(current);
  latest.current = current;
  const { aspects } = useAspects(params, slots, total, lead, shape);

  // A new sort or filter starts at the beginning; a shorter list keeps the index in range.
  const viewKey = JSON.stringify(params);
  useEffect(() => setIndex(0), [viewKey]);
  useEffect(() => {
    if (index > last) setIndex(last);
    if (total > 0) cache.ensure(Math.max(0, index - 14), Math.min(last, index + 14));
  }, [cache, index, last, total]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event) || (event.target as HTMLElement | null)?.closest?.("[role=dialog], .menu")) return;
      const action = actionFor(event, "library");
      const front = latest.current;
      if (action === "library.carouselPrevious") step(-1);
      else if (action === "library.carouselNext") step(1);
      else if (action === "library.carouselOpen" && front?.collection) void navigate({ to: "/library/$scope", params: { scope: front.category }, search: { collection: front.collection.id } });
      else if (action === "library.carouselOpen" && front) void navigate({ to: itemPath(front), params: { id: String(front.id) } });
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, navigate]);

  // The wheel moves one cover per notch (a trackpad's stream of small deltas adds up to one), and
  // no faster than the covers can turn.
  const wheel = useRef({ sum: 0, at: 0 });
  const onWheel = (event: React.WheelEvent) => {
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    const w = wheel.current;
    if (Math.sign(delta) !== Math.sign(w.sum)) w.sum = 0;
    w.sum += event.deltaMode === 1 ? delta * 40 : delta;
    const now = performance.now();
    if (Math.abs(w.sum) >= 60 && now - w.at > 110) {
      step(Math.sign(w.sum));
      w.sum = 0;
      w.at = now;
    }
  };
  const coverHeight = Math.max(150, Math.min(460, Math.round(height * 0.68)));
  const spacing = coverHeight * 0.3;
  const widthAt = (i: number) => {
    const item = cache.get(i);
    return coverHeight * (aspects[i] ?? (item ? shapeOf(item).aspect : 2 / 3));
  };
  const drag = useRef<{ x: number; from: number; moved: boolean } | null>(null);
  const onPointerDown = (event: React.PointerEvent) => {
    // The arrows and the slider are buttons of their own, never the start of a drag.
    if (event.button !== 0 || (event.target as HTMLElement).closest("button, input")) return;
    drag.current = { x: event.clientX, from: index, moved: false };
  };
  const onPointerMove = (event: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !(event.buttons & 1)) return;
    const dx = event.clientX - d.x;
    if (Math.abs(dx) > 6) d.moved = true;
    // One cover per half a front cover dragged, whatever its shape.
    if (d.moved) go(d.from - dx / Math.max(spacing, widthAt(d.from) * 0.5));
  };
  const onClickCapture = (event: React.MouseEvent) => {
    if (drag.current?.moved && !(event.target as HTMLElement).closest("button, input")) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  const reach = Math.min(preferences.lightMode ? 5 : 9, Math.ceil(width / 2 / spacing) + 1);
  const shown: number[] = [];
  for (let i = Math.max(0, index - reach); i <= Math.min(last, index + reach); i++) shown.push(i);
  // Covers keep one height; each sits clear of the one before it by both their turned widths, so a
  // horizontal frame next to a poster or a CD is neither squeezed nor far off.
  const turned = (i: number) => (widthAt(i) * 0.53) / 2;
  const offsets = new Map<number, number>([[index, 0]]);
  for (const side of [-1, 1]) {
    let x = widthAt(index) / 2;
    for (let far = 1; far <= reach; far++) {
      const i = index + side * far;
      if (i < 0 || i > last) break;
      x += far === 1 ? turned(i) + coverHeight * 0.06 : Math.max(spacing, (turned(i - side) + turned(i)) * 0.55);
      offsets.set(i, side * x);
    }
  }
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
        onPointerCancel={() => (drag.current = null)}
        onClickCapture={onClickCapture}
      >
        {height > 0 &&
          shown.map((i) => {
            const item = cache.get(i);
            const look = item ? shapeOf(item) : { shape: "book" as const, aspect: aspects[i] ?? 2 / 3 };
            const d = i - index;
            const side = Math.sign(d);
            const far = Math.abs(d);
            const x = offsets.get(i) ?? side * (coverHeight * 0.5 + (far - 1) * spacing);
            const style = {
              "--x": `${x}px`,
              "--z": `${d === 0 ? 90 : -60 - far * 14}px`,
              "--turn": `${d === 0 ? 0 : -side * 58}deg`,
              zIndex: 100 - far,
              opacity: far > reach - 1 ? 0 : 1,
              height: coverHeight,
              width: Math.round(widthAt(i)),
              bottom: Math.max(40, (height - coverHeight) / 2 + 10),
            } as CSSProperties;
            return item?.collection ? (
              <CollectionCarouselItem key={`c${item.id}`} item={item} front={d === 0} style={style} onPick={() => go(i)} />
            ) : item ? (
              <CarouselCover key={i} item={item} index={i} front={d === 0} shape={look.shape} style={style} onPick={() => go(i)} />
            ) : (
              <div key={i} className="carousel-item skeleton" style={style} />
            );
          })}
        <button type="button" className="round-btn carousel-arrow left" aria-label="Previous" disabled={index <= 0} onClick={() => step(-1)}>
          <ChevronLeft size={20} />
        </button>
        <button type="button" className="round-btn carousel-arrow right" aria-label="Next" disabled={index >= last} onClick={() => step(1)}>
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
            max={last}
            value={index}
            style={{ "--fill": `${total > 1 ? (index / last) * 100 : 0}%` } as CSSProperties}
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

function CarouselCover({ item, index, front, shape, style, onPick }: { item: ItemCard; index: number; front: boolean; shape: string; style: CSSProperties; onPick: () => void }) {
  const band = caseBand(item);
  const { selecting, checked, props } = useSelectable(item.id, index);
  return (
    <Link
      to={itemPath(item)}
      params={{ id: String(item.id) }}
      className={`carousel-item${front ? " front" : ""}`}
      data-shape={shape}
      style={style}
      {...vt(item.id)}
      {...sourceProps(item.source)}
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
      <SourceTag service={item.source} />
      {band && <div className={`card-case ${band}`}>{band === "bluray" ? "BLU-RAY" : "DVD"}</div>}
      {selecting && (
        <span className={`card-check${checked ? " on" : ""}`} aria-hidden>
          {checked && <Check size={15} strokeWidth={3.2} />}
        </span>
      )}
    </Link>
  );
}

const CUSTOM_SORT = { value: "custom" as SortKey, label: "Custom order" };

const SORTS: { value: SortKey; label: string }[] = [
  { value: "title", label: "Title" },
  { value: "added", label: "Recently added" },
  { value: "year", label: "Year" },
  { value: "creator", label: "Creator" },
  { value: "rating", label: "Your rating" },
];

/** For photos (D-033): by the date they were taken. */
const TAKEN_SORTS: { value: SortKey; label: string }[] = [
  { value: "takenDesc", label: "Date taken: Newest First" },
  { value: "takenAsc", label: "Date taken: Oldest First" },
];

/** For views that can hold music and video; items without a known length come last. */
const DURATION_SORTS: { value: SortKey; label: string }[] = [
  { value: "durationAsc", label: "Duration: Shortest First" },
  { value: "durationDesc", label: "Duration: Longest First" },
];

/** Play and Shuffle for a music view's tracks, in the view's order. */
function PlayAll({ params }: { params: Omit<QueryParams, "offset" | "limit"> }) {
  const music = useMusic();
  const [error, setError] = useState<string | null>(null);
  const start = async (mix: boolean) => {
    setError(null);
    try {
      const items = await api.queryIds(params);
      const tracks = (await api.musicTracks({ items })).map((track) => track.id);
      if (tracks.length) await music.play(mix ? shuffled(tracks) : tracks, 0);
    } catch (reason) {
      setError(String(reason));
    }
  };
  return (
    <>
      <button type="button" className="btn btn-primary" onClick={() => void start(false)}>
        <Play size={16} fill="currentColor" /> Play
      </button>
      <button type="button" className="btn" onClick={() => void start(true)}>
        <Shuffle size={16} /> Shuffle
      </button>
      {error && <span className="hint">{error}</span>}
    </>
  );
}

/** All, what has files in the library, and (in Music and Videos) what was added from a link and plays online (D-029). */
type Filter = Ownership | "" | "collections";
const OWNERSHIP: { value: Filter; label: string }[] = [
  { value: "", label: "All" },
  { value: "digital", label: "Digital" },
  { value: "online", label: "Online" },
  // Where the view has collections (D-030): "All" shows them first, "Collections" alone.
  { value: "collections", label: "Collections" },
];

/** The "Select" toggle; Ctrl+A selects everything and Esc stops selecting. */
function SelectToggle({ base, collections, itemsShown }: { base: Omit<QueryParams, "offset" | "limit">; collections: number[]; itemsShown: boolean }) {
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
        // Everything shown: the collections (negative ids) and the items.
        void (itemsShown ? api.queryIds(base) : Promise.resolve([] as number[])).then((ids) => selection.set([...collections, ...ids]), () => {});
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selection, base, collections, itemsShown]);
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
  titleExtra,
  beforeItems,
  square,
  handler,
  collections,
  empty,
}: {
  viewKey: string;
  base: Omit<QueryParams, "offset" | "limit">;
  title: string;
  eyebrow?: ReactNode;
  icon?: ReactNode;
  description?: string | null;
  /** Extra buttons next to "Add" (tag or collection actions). */
  actions?: ReactNode;
  /** Shown between the header and the toolbar. */
  prelude?: ReactNode;
  /** Shown beside the title (Music's tabs, D-044). */
  titleExtra?: ReactNode;
  /** Shown under the toolbar, above the items (a category's collections). */
  beforeItems?: ReactNode;
  square?: boolean;
  /** The kind of media of a category's view, for its usual cover shape. */
  handler?: string;
  /** A category (or collection) whose collections lead its items, and can be shown alone. */
  collections?: { category: string; parent: number | null };
  empty: ReactNode;
}) {
  const { preferences, update } = usePreferences();
  // The title slides in when it changes, not when the same title is redrawn (Music's tabs, D-045).
  const titleArriving = useArrival(`title:${title}`);
  // "Find in this view" (D-041, like Arcade's search): narrows the view by words; the search page
  // has its own.
  const [find, setFind] = useState("");
  const [finding, setFinding] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => setFinding(find.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [find]);
  useEffect(() => setFind(""), [viewKey]);
  // Layout and the filter are shared by every view unless Settings says otherwise.
  const shared = preferences.syncViews ? "*" : viewKey;
  const other = preferences.syncViews ? viewKey : "*";
  const layout: Layout = preferences.layouts[shared] ?? preferences.layouts[other] ?? "grid";
  // "Online" is offered where links are imported to: Music and Videos.
  const withOnline = handler === "audio" || base.category === "videos";
  const filters = OWNERSHIP.filter((option) => (option.value !== "online" || withOnline) && (option.value !== "collections" || !!collections));
  // Inside a collection the filter starts at "All" every time and isn't remembered (D-043).
  const inCollection = base.collection != null;
  const [collectionFilter, setCollectionFilter] = useState<Filter>("");
  useEffect(() => setCollectionFilter(""), [viewKey]);
  const remembered: Filter = inCollection ? collectionFilter : (preferences.ownership[shared] ?? preferences.ownership[other] ?? "");
  const filter: Filter = filters.some((option) => option.value === remembered) ? remembered : "";
  const ownership: Ownership | "" = filter === "collections" ? "" : filter;
  // The sort is remembered per view; a custom order belongs to its view too.
  const orderKey = base.search
    ? null
    : base.collection != null
      ? `collection:${base.collection}`
      : base.tag != null
        ? `tag:${base.tag}`
        : base.favorites
          ? "favorites"
          : (base.category ?? "all");
  // A view of books or comics alone has nothing to time.
  const timed =
    handler === "image"
      ? [...TAKEN_SORTS, ...SORTS.filter((s) => s.value !== "creator")]
      : handler !== "book" && handler !== "comic"
        ? [...SORTS, ...DURATION_SORTS, ...(base.category ? [] : TAKEN_SORTS)]
        : SORTS;
  const sorts = base.search ? timed : [...timed, CUSTOM_SORT];
  const [searchSort, setSearchSort] = useState<SortKey | "">("");
  const saved = orderKey ? preferences.sorts[orderKey] : undefined;
  const sort: SortKey | "" = base.search ? searchSort : saved && sorts.some((s) => s.value === saved) ? saved : handler === "image" ? "takenDesc" : "title";
  const setSort = (next: SortKey | "") => {
    if (!orderKey) setSearchSort(next);
    else if (next) update((current) => ({ sorts: { ...current.sorts, [orderKey]: next } }));
  };
  const params = { ...base, ...(finding && !base.search ? { search: finding } : {}), sort: sort || null, ownership: ownership || null, custom: sort === "custom" ? orderKey : null };
  // The image viewer steps through what this view shows (D-033).
  photoContext.params = params;
  const { cache, total: itemTotal, error } = usePagedItems(params);
  // The view's collections lead its items in "All", and are all there is in "Collections".
  const level = useCollections(collections?.category ?? "", collections?.parent ?? null, !!collections && (filter === "" || filter === "collections"));
  const leadCards = useMemo(
    () => (collections && (filter === "" || filter === "collections") ? (level.data?.children ?? []).map((c) => collectionCard(c, collections.category)) : []),
    [collections, filter, level.data],
  );
  const onlyCollections = filter === "collections";
  // In a custom order, collections stand where they were put among the items (D-036).
  const slotsQuery = useQuery({
    queryKey: ["custom-slots", params, leadCards.map((c) => c.id)],
    queryFn: () => api.customOrderSlots(params, leadCards.map((c) => c.id)),
    enabled: sort === "custom" && !!orderKey && leadCards.length > 0 && !onlyCollections,
  });
  const places = useMemo(() => (sort === "custom" && !onlyCollections && slotsQuery.data ? new Map(slotsQuery.data) : null), [sort, onlyCollections, slotsQuery.data]);
  const source = useMemo(() => new LedSource(leadCards, places, onlyCollections ? null : cache), [leadCards, places, onlyCollections, cache]);
  const waiting = itemTotal == null || (!!collections && (filter === "" || onlyCollections) && !level.data);
  const total = waiting ? null : leadCards.length + (onlyCollections ? 0 : itemTotal);
  const lead = leadCards.length;
  const selection = useSelectionState(source);
  // Entrance animations play for a moment after the view, filter or sort changes, not while scrolling.
  const stageKey = `${viewKey}:${filter}:${sort}:${finding}`;
  const [entering, setEntering] = useState(true);
  useEffect(() => {
    setEntering(true);
    const timer = window.setTimeout(() => setEntering(false), 1100);
    return () => window.clearTimeout(timer);
  }, [stageKey, layout]);
  const shape = coverShapeOf({ handler: handler ?? "book", category: base.category }, preferences.coverShapes);
  const arrangeable = !!orderKey && sort === "custom" && !finding;
  // In a custom order, covers can be dragged straight to a new place (not in the carousel, which
  // drags to turn, nor while selecting).
  const queryClient = useQueryClient();
  const cardDrag = useMemo(
    () =>
      arrangeable && !selection.active && layout !== "carousel"
        ? {
            onDrop: (dragged: number, target: number, after: boolean) => {
              void (async () => {
                // Items and collections in one order (D-036): the collections at their places.
                const items = await api.queryIds(params);
                const combined: number[] = [];
                const places = new Map(source.slots.map((slot) => [slot, source.get(slot)!.id] as const));
                let next = 0;
                for (let i = 0; i < items.length + places.size; i++) combined.push(places.get(i) ?? items[next++]);
                await api.customOrderSet(orderKey!, moved(combined.filter((id) => id !== undefined), dragged, target, after));
                libraryChanged(queryClient);
                void queryClient.invalidateQueries({ queryKey: ["custom-slots"] });
              })();
            },
          }
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [arrangeable, selection.active, layout, orderKey, JSON.stringify(params), queryClient, source],
  );
  const [arranging, setArranging] = useState(false);

  // Switching layouts moves each cover from its old place to its new one (a view transition).
  const setLayout = (next: Layout) => {
    const apply = () => update((current) => ({ layouts: { ...current.layouts, [shared]: next } }));
    if (next === layout || !document.startViewTransition || !motionAllowed()) return apply();
    nameCovers();
    const transition = document.startViewTransition(() => {
      flushSync(apply);
      nameCovers();
    });
    void transition.finished.finally(clearCoverNames);
  };
  const setOwnership = (next: Filter) => (inCollection ? setCollectionFilter(next) : update((current) => ({ ownership: { ...current.ownership, [shared]: next } })));
  const [materials, setMaterials] = useState(false);

  return (
    <SelectionProvider value={selection}>
      <GridDragProvider value={cardDrag}>
      <div className={`library-view${selection.active ? " selecting" : ""}${cardDrag ? " arranging-in-place" : ""}`}>
        <div style={{ padding: "16px 40px 0" }}>
          <CategoryStrip
            tools={
              <>
              {!base.search && (
                <label className="arcade-search view-find">
                  <Search size={15} aria-hidden />
                  <input type="search" placeholder="Find in this view" value={find} onChange={(event) => setFind(event.target.value)} aria-label="Find in this view" />
                </label>
              )}
              {layout !== "list" && layout !== "carousel" && (
                <label className="arcade-size">
                  <span>Size</span>
                  <CardSizeSlider value={preferences.cardSize} onChange={(cardSize) => update({ cardSize })} />
                </label>
              )}
              {total != null && total > 0 && <SelectToggle base={params} collections={leadCards.map((c) => c.id)} itemsShown={!onlyCollections} />}
              <label className="arcade-sort">
                <span>Sort</span>
                <select value={sort} onChange={(event) => setSort(event.target.value as SortKey | "")}>
                  {base.search && <option value="">Best match</option>}
                  {sorts.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              </>
            }
          />
          <div className="page-header">
            <div className={`title-row${titleArriving ? " arriving" : ""}`}>
              {icon && <span className="title-badge">{icon}</span>}
              <div>
                {eyebrow && <div className="eyebrow">{eyebrow}</div>}
                {/* Music's tabs go on the title's line, so the count under it can't push them (D-046). */}
                <div className="title-line">
                  <h1 className="display">{title}</h1>
                  {titleExtra}
                </div>
                <div className="count">
                  {itemTotal == null ? " " : onlyCollections ? `${lead.toLocaleString()} ${lead === 1 ? "collection" : "collections"}` : `${itemTotal.toLocaleString()} ${itemTotal === 1 ? "item" : "items"}`}
                  {!onlyCollections && lead > 0 && ` · ${lead.toLocaleString()} ${lead === 1 ? "collection" : "collections"}`}
                  {description && <span className="view-description"> · {description}</span>}
                </div>
              </div>
            </div>
            <div className="header-actions">
              {handler === "audio" && total != null && total > 0 && <PlayAll params={params} />}
              {actions}
              <AddMenu align="end">
                <button type="button" className={handler === "audio" ? "btn" : "btn btn-primary"}>
                  <Plus size={17} strokeWidth={2.6} /> Add
                </button>
              </AddMenu>
            </div>
          </div>
          {prelude}
          <div className="toolbar arcade-toolbar">
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
              {filters.map((option) => (
                <button key={option.value} type="button" aria-pressed={filter === option.value} onClick={() => setOwnership(option.value)}>
                  {option.label}
                </button>
              ))}
            </div>
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
            {arrangeable && total != null && total > 1 && (
              <button type="button" className="btn btn-sm" onClick={() => setArranging(true)}>
                <GripVertical size={15} /> Arrange…
              </button>
            )}
          </div>
        </div>
        {beforeItems && <div className="before-items">{beforeItems}</div>}
        {error && <div className="notice danger" style={{ margin: "0 40px" }}>{error}</div>}
        {/* A new view, filter or sort comes in with its items rising into place (D-030). */}
        <div className={`view-stage${entering ? " entering" : ""}`} key={stageKey}>
        {total === 0 ? (
          <div style={{ padding: "8px 40px" }}>{empty}</div>
        ) : total != null && layout === "list" ? (
          <ListView cache={source} total={total} lead={lead} slots={source.slots} square={!!square} shape={shape} params={params} />
        ) : total != null && layout === "shelf" ? (
          <ShelfView cache={source} total={total} lead={lead} slots={source.slots} square={!!square} shape={shape} params={params} />
        ) : total != null && layout === "detailed" ? (
          <DetailedView cache={source} total={total} lead={lead} slots={source.slots} square={!!square} shape={shape} params={params} />
        ) : total != null && layout === "carousel" ? (
          <CarouselView cache={source} total={total} lead={lead} slots={source.slots} square={!!square} shape={shape} params={params} />
        ) : total != null ? (
          <GridView cache={source} total={total} lead={lead} slots={source.slots} square={!!square} shape={shape} params={params} />
        ) : null}
        </div>
        {arranging && orderKey && (
          <ArrangeDialog
            base={{ ...base, ownership: null }}
            view={orderKey}
            title={title}
            onClose={() => setArranging(false)}
          />
        )}
        {itemTotal != null && <BulkBar base={params} total={onlyCollections ? lead : itemTotal + lead} collections={leadCards.map((c) => c.id)} itemsShown={!onlyCollections} />}
      </div>
      </GridDragProvider>
    </SelectionProvider>
  );
}

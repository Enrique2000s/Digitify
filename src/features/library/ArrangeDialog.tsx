import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDownToLine, ArrowUpToLine, GripVertical, LoaderCircle } from "lucide-react";
import { api, errorText, type ItemCard, type QueryParams, type SortKey } from "../../lib/api";
import { libraryChanged } from "../../lib/queries";
import { arrayMove, useVirtualReorder } from "../../lib/reorder";
import { useCoverShape } from "../../lib/preferences";
import { Cover, Dialog } from "../../components/common";

const ROW = 58;

/** Cards for the ids on screen, fetched as they scroll into view. */
function useCards(ids: number[]): Map<number, ItemCard> {
  const store = useRef(new Map<number, ItemCard>());
  const asked = useRef(new Set<number>());
  const [, rerender] = useState(0);
  const missing = ids.filter((id) => !asked.current.has(id)).join(",");
  useEffect(() => {
    if (!missing) return;
    const wanted = missing.split(",").map(Number);
    for (const id of wanted) asked.current.add(id);
    void api.cards(wanted).then(
      (cards) => {
        for (const card of cards) store.current.set(card.id, card);
        rerender((n) => n + 1);
      },
      () => wanted.forEach((id) => asked.current.delete(id)),
    );
  }, [missing]);
  return store.current;
}

const STARTS: [SortKey, string][] = [
  ["title", "Title"],
  ["added", "Recently added"],
  ["year", "Year"],
  ["creator", "Creator"],
];

/**
 * "Arrange…": a view's items in their custom order (or a shelf's own order), to drag into place,
 * send to the top or bottom, or start again from another sort.
 */
export function ArrangeDialog({
  base,
  view,
  shelf,
  title,
  onClose,
}: {
  base: Omit<QueryParams, "offset" | "limit">;
  view: string;
  /** A hand-made shelf: its own order is what's arranged. */
  shelf?: number;
  title: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const shapeOf = useCoverShape();
  const [order, setOrder] = useState<number[] | null>(null);
  const [changed, setChanged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const load = (sort: SortKey) =>
    api.queryIds({ ...base, sort, custom: view }).then(
      (ids) => setOrder(ids),
      (reason) => setError(errorText(reason)),
    );
  useEffect(() => {
    void load(shelf != null ? "shelf" : "custom");
  }, []);

  const list = order ?? [];
  const move = (from: number, to: number) => {
    setOrder((current) => (current ? arrayMove(current, from, to) : current));
    setChanged(true);
  };
  const reorder = useVirtualReorder(ROW, scroller, move);
  const virtual = useVirtualizer({
    count: list.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW,
    overscan: 8,
    // The row being dragged stays rendered while the list scrolls under it.
    rangeExtractor: (range) => {
      const indexes = defaultRangeExtractor(range);
      const dragged = reorder.dragging;
      return dragged != null && !indexes.includes(dragged) ? [...indexes, dragged].sort((a, b) => a - b) : indexes;
    },
  });
  const rows = virtual.getVirtualItems();
  const cards = useCards(rows.map((row) => list[row.index]).filter((id) => id != null));

  const save = async () => {
    if (!order) return;
    setBusy(true);
    try {
      if (shelf != null) await api.shelfOrderSet(shelf, order);
      else await api.customOrderSet(view, order);
      libraryChanged(queryClient);
      onClose();
    } catch (reason) {
      setError(errorText(reason));
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={`Arrange “${title}”`}
      description="Drag items by their handle into the order you like, or send one to the top or the bottom. Items added later go after these."
      wide
      footer={
        <>
          <span className="arrange-start">
            Start from
            {STARTS.map(([sort, label]) => (
              <button
                key={sort}
                type="button"
                className="btn btn-sm"
                onClick={() => {
                  void load(sort);
                  setChanged(true);
                }}
              >
                {label}
              </button>
            ))}
          </span>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={!changed || busy} onClick={() => void save()}>
            Save order
          </button>
        </>
      }
    >
      {order === null ? (
        <div className="arrange-loading">
          <LoaderCircle className="spin" size={26} aria-label="Loading" />
        </div>
      ) : (
        <div ref={scroller} className="arrange-list">
          <div style={{ height: virtual.getTotalSize(), position: "relative" }}>
            {rows.map((row) => {
              const id = list[row.index];
              const card = cards.get(id);
              const look = card ? shapeOf(card) : null;
              return (
                <div
                  key={id}
                  className={`arrange-row${reorder.dragging === row.index ? " dragging" : ""}`}
                  style={{ position: "absolute", top: row.start, left: 0, right: 0, height: ROW - 6, ...reorder.style(row.index) }}
                >
                  <span {...reorder.handle(row.index, list.length)} aria-label={`Drag ${card?.title ?? "item"}`}>
                    <GripVertical size={18} />
                  </span>
                  <span className="arrange-number">{row.index + 1}</span>
                  <span className="arrange-thumb" data-shape={look?.shape}>
                    {card && <Cover item={card} />}
                  </span>
                  <span className="arrange-title">
                    <strong>{card?.title ?? " "}</strong>
                    <span>{card ? [card.subtitle, card.year].filter(Boolean).join(" · ") : ""}</span>
                  </span>
                  <button type="button" className="icon-btn" aria-label="Move to the top" title="Move to the top" disabled={row.index === 0} onClick={() => move(row.index, 0)}>
                    <ArrowUpToLine size={16} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="Move to the bottom"
                    title="Move to the bottom"
                    disabled={row.index === list.length - 1}
                    onClick={() => move(row.index, list.length - 1)}
                  >
                    <ArrowDownToLine size={16} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {error && <div className="dialog-error">{error}</div>}
    </Dialog>
  );
}

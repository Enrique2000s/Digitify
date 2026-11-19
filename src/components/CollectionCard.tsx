import type { CSSProperties } from "react";
import { Link } from "@tanstack/react-router";
import { Check, Folder } from "lucide-react";
import { useSelectable } from "../lib/selection";
import type { Collection, ItemCard } from "../lib/api";
import { Collage } from "./Collage";

/**
 * A collection shown among a view's items (D-030): first in "All", alone in "Collections", as wide
 * as a horizontal video. It stands in a view's list as an `ItemCard` with `collection` set (and a
 * negative id), so every layout can place it like any cover.
 */
export function collectionCard(collection: Collection, category: string): ItemCard {
  return {
    id: -collection.id,
    title: collection.name,
    subtitle: `${collection.itemCount.toLocaleString()} ${collection.itemCount === 1 ? "item" : "items"}`,
    year: null,
    category,
    handler: "generic",
    coverKey: null,
    coverColor: null,
    isFavorite: false,
    formats: [],
    hasPhysical: false,
    hasDigital: false,
    missing: false,
    progress: null,
    coverShape: "landscape",
    online: false,
    source: null,
    discFormat: null,
    collection: { id: collection.id, covers: collection.covers, itemCount: collection.itemCount, childCount: collection.childCount },
  };
}

function Art({ item }: { item: ItemCard }) {
  const c = item.collection!;
  return (
    <span className={`collection-art screen-${c.id % 5}`}>
      {c.covers.length > 0 ? (
        <Collage covers={c.covers} />
      ) : (
        <span className="collection-empty">
          <Folder size={34} strokeWidth={2.2} aria-hidden />
        </span>
      )}
      <span className="collection-badge">
        <Folder size={13} strokeWidth={2.6} aria-hidden /> Collection
      </span>
    </span>
  );
}

const to = (item: ItemCard) => ({ to: "/library/$scope" as const, params: { scope: item.category }, search: { tab: "collections", collection: item.collection!.id } });

/** The tick on a selected collection, like an item's (D-036). */
function Tick({ selecting, checked }: { selecting: boolean; checked: boolean }) {
  if (!selecting) return null;
  return (
    <span className={`card-check${checked ? " on" : ""}`} aria-hidden>
      {checked && <Check size={15} strokeWidth={3.2} />}
    </span>
  );
}

/** A collection in the grid: a horizontal cover with its first items fanned out, its name and count. */
export function CollectionCard({ item, width, index }: { item: ItemCard; width?: number; index?: number }) {
  const { selecting, checked, props } = useSelectable(item.id, index);
  return (
    <Link {...to(item)} className="card collection-card" style={width ? { width } : undefined} data-blip {...props}>
      <div className="card-art" data-shape="landscape" data-vt={`c${item.collection!.id}`} style={{ aspectRatio: 16 / 9, position: "relative" }}>
        <Art item={item} />
        <Tick selecting={selecting} checked={checked} />
      </div>
      <div className="card-title">{item.title}</div>
      <div className="card-sub">{item.subtitle}</div>
    </Link>
  );
}

/** A collection as a row of the list view. */
export function CollectionRowItem({ item, top, index }: { item: ItemCard; top: number; index?: number }) {
  const { selecting, checked, props } = useSelectable(item.id, index);
  return (
    <Link {...to(item)} className="list-row collection-list-row" style={{ top, height: 54 }} {...props}>
      <span className="thumb" data-shape="landscape" data-vt={`c${item.collection!.id}`} style={{ position: "relative" }}>
        <Art item={item} />
        <Tick selecting={selecting} checked={checked} />
      </span>
      <span className="title">{item.title}</span>
      <span className="cell">{item.subtitle}</span>
      <span className="cell" />
      <span className="cell" />
      <span className="cell">Collection</span>
    </Link>
  );
}

/** A collection standing on a shelf. */
export function CollectionShelfItem({ item, height, index }: { item: ItemCard; height: number; index?: number }) {
  const { selecting, checked, props } = useSelectable(item.id, index);
  return (
    <Link {...to(item)} className="shelf-item" title={item.title} data-blip {...props}>
      <div className="shelf-cover collection-shelf" data-shape="landscape" data-vt={`c${item.collection!.id}`} style={{ width: height * (16 / 9), aspectRatio: 16 / 9, position: "relative" }}>
        <Art item={item} />
        <Tick selecting={selecting} checked={checked} />
      </div>
    </Link>
  );
}

/** A collection in the detailed view. */
export function CollectionDetailRow({ item, top, height, index }: { item: ItemCard; top: number; height: number; index?: number }) {
  const { selecting, checked, props } = useSelectable(item.id, index);
  return (
    <Link {...to(item)} className="detail-row" style={{ top, height }} data-blip {...props}>
      <div className="detail-cover" data-shape="landscape" data-vt={`c${item.collection!.id}`} style={{ height: height - 26, aspectRatio: 16 / 9, position: "relative" }}>
        <Art item={item} />
        <Tick selecting={selecting} checked={checked} />
      </div>
      <div className="detail-body">
        <div className="detail-title">
          <strong>{item.title}</strong>
        </div>
        <div className="detail-facts">
          <span className="chip">Collection</span>
          <span className="detail-fact">{item.subtitle}</span>
        </div>
      </div>
    </Link>
  );
}

/** A collection in the carousel: the front one opens, a side one comes to the front. */
export function CollectionCarouselItem({ item, front, style, onPick }: { item: ItemCard; front: boolean; style: CSSProperties; onPick: () => void }) {
  return (
    <Link
      {...to(item)}
      className={`carousel-item collection-carousel${front ? " front" : ""}`}
      data-vt={`c${item.collection!.id}`}
      data-shape="landscape"
      style={style}
      title={item.title}
      draggable={false}
      tabIndex={front ? 0 : -1}
      onClick={(event) => {
        if (!front) {
          event.preventDefault();
          onPick();
        }
      }}
    >
      <Art item={item} />
    </Link>
  );
}

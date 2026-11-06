import type { CSSProperties } from "react";
import { Link } from "@tanstack/react-router";
import { Folder } from "lucide-react";
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

const to = (item: ItemCard) => ({ to: "/library/$scope" as const, params: { scope: item.category }, search: { collection: item.collection!.id } });

/** A collection in the grid: a horizontal cover with its first items fanned out, its name and count. */
export function CollectionCard({ item, width }: { item: ItemCard; width?: number }) {
  return (
    <Link {...to(item)} className="card collection-card" style={width ? { width } : undefined} data-blip>
      <div className="card-art" data-shape="landscape" style={{ aspectRatio: 16 / 9 }}>
        <Art item={item} />
      </div>
      <div className="card-title">{item.title}</div>
      <div className="card-sub">{item.subtitle}</div>
    </Link>
  );
}

/** A collection as a row of the list view. */
export function CollectionRowItem({ item, top }: { item: ItemCard; top: number }) {
  return (
    <Link {...to(item)} className="list-row collection-list-row" style={{ top, height: 54 }}>
      <span className="thumb" data-shape="landscape">
        <Art item={item} />
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
export function CollectionShelfItem({ item, height }: { item: ItemCard; height: number }) {
  return (
    <Link {...to(item)} className="shelf-item" title={item.title} data-blip>
      <div className="shelf-cover collection-shelf" data-shape="landscape" style={{ width: height * (16 / 9), aspectRatio: 16 / 9, position: "relative" }}>
        <Art item={item} />
      </div>
    </Link>
  );
}

/** A collection in the detailed view. */
export function CollectionDetailRow({ item, top, height }: { item: ItemCard; top: number; height: number }) {
  const c = item.collection!;
  return (
    <Link {...to(item)} className="detail-row" style={{ top, height }} data-blip>
      <div className="detail-cover" data-shape="landscape" style={{ height: height - 26, aspectRatio: 16 / 9 }}>
        <Art item={item} />
      </div>
      <div className="detail-body">
        <div className="detail-title">
          <strong>{item.title}</strong>
        </div>
        <div className="detail-facts">
          <span className="chip">Collection</span>
          <span className="detail-fact">{item.subtitle}</span>
          {c.childCount > 0 && <span className="detail-fact">{c.childCount === 1 ? "1 collection inside" : `${c.childCount} collections inside`}</span>}
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

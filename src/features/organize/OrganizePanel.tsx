import { Fragment, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronRight, FolderInput, ListPlus } from "lucide-react";
import type { ItemDetail } from "../../lib/api";
import { MoveDialog } from "./dialogs";
import { ShelfMenu } from "./ShelfMenu";
import { TagEditor } from "./TagEditor";

/** Category › collection links for an item's home. */
export function HomePath({ item }: { item: ItemDetail }) {
  return (
    <span className="crumbs">
      <Link to="/library/$scope" params={{ scope: item.category }}>
        {item.categoryName}
      </Link>
      {item.collectionPath.map((collection) => (
        <Fragment key={collection.id}>
          <ChevronRight size={14} strokeWidth={2.6} aria-hidden />
          <Link to="/library/$scope" params={{ scope: item.category }} search={{ collection: collection.id }}>
            {collection.name}
          </Link>
        </Fragment>
      ))}
    </span>
  );
}

/** Where an item lives (category and collection), the shelves it's on, and its tags. */
export function OrganizePanel({ item }: { item: ItemDetail }) {
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const member = new Set(item.shelves.map((shelf) => shelf.id));
  return (
    <section className="panel organize">
      <h2>Organize</h2>
      <div className="organize-row">
        <span className="organize-label">Home</span>
        <div className="organize-value">
          <HomePath item={item} />
          <button type="button" className="btn btn-sm" onClick={() => setMoving(true)}>
            <FolderInput size={14} /> Move…
          </button>
        </div>
      </div>
      <div className="organize-row">
        <span className="organize-label">Shelves</span>
        <div className="organize-value">
          {item.shelves.map((shelf) => (
            <Link key={shelf.id} to="/shelf/$id" params={{ id: String(shelf.id) }} className="chip">
              {shelf.name}
            </Link>
          ))}
          <ShelfMenu ids={[item.id]} member={member} onError={setError}>
            <button type="button" className="btn btn-sm">
              <ListPlus size={14} /> {item.shelves.length ? "Shelves" : "Add to shelf"}
            </button>
          </ShelfMenu>
        </div>
      </div>
      <div className="organize-row">
        <span className="organize-label">Tags</span>
        <TagEditor item={item} />
      </div>
      {error && <div className="dialog-error">{error}</div>}
      <MoveDialog
        open={moving}
        onOpenChange={setMoving}
        ids={[item.id]}
        title={`Move “${item.title}”`}
        initialCategory={item.category}
        initialCollection={item.collectionPath.at(-1)?.id ?? null}
      />
    </section>
  );
}

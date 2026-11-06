import { Fragment, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronRight, FolderInput } from "lucide-react";
import type { ItemDetail } from "../../lib/api";
import { MoveDialog } from "./dialogs";
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

/** Where an item lives (category and collection), and its tags. */
export function OrganizePanel({ item }: { item: ItemDetail }) {
  const [moving, setMoving] = useState(false);
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
        <span className="organize-label">Tags</span>
        <TagEditor item={item} />
      </div>
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

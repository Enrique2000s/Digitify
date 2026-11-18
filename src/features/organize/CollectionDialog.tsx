import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog as RadixDialog } from "radix-ui";
import { FolderOpen, Pencil, Trash, X } from "lucide-react";
import { api, type Category } from "../../lib/api";
import { libraryChanged, useCollections } from "../../lib/queries";
import { usePreferences } from "../../lib/preferences";
import { photoContext } from "../../lib/routes";
import { plural } from "../../lib/format";
import { MediaCard } from "../../components/MediaCard";
import { ConfirmDialog, NameDialog } from "./dialogs";

/**
 * A collection opened like a folder (D-090): its items in a window over the category, with its
 * name, how many it holds, and Rename and Delete. Collections are one level only, so there's
 * nothing more inside to get lost in. Closing it (or Back) returns to the category as it was.
 */
export function CollectionDialog({ category, id, onClose }: { category: Category; id: number; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { preferences } = usePreferences();
  const level = useCollections(category.key, null);
  const info = level.data?.children.find((c) => c.id === id);
  const sort = preferences.sorts[category.key] ?? "title";
  const params = { category: category.key, collection: id, sort };
  const items = useQuery({ queryKey: ["collection-items", id, sort], queryFn: () => api.query({ ...params, offset: 0, limit: 1000 }) });
  const [dialog, setDialog] = useState<"rename" | "delete" | null>(null);
  // Photos opened from here step through this folder.
  photoContext.params = params;
  const name = info?.name ?? "Collection";
  const total = items.data?.total ?? info?.itemCount ?? 0;
  const size = Math.round(preferences.cardSize * 0.95);
  return (
    <RadixDialog.Root open onOpenChange={(open) => !open && onClose()}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="dialog-overlay" />
        <RadixDialog.Content className="dialog collection-window" aria-describedby={undefined}>
          <header className="collection-window-head">
            <span className="collection-window-icon" aria-hidden>
              <FolderOpen size={24} strokeWidth={2.2} />
            </span>
            <div className="collection-window-title">
              <RadixDialog.Title className="dialog-title">{name}</RadixDialog.Title>
              <span>
                {category.name} · {plural(total, "item")}
              </span>
            </div>
            <button type="button" className="btn btn-sm" onClick={() => setDialog("rename")} disabled={!info}>
              <Pencil size={15} /> Rename
            </button>
            <button type="button" className="btn btn-sm btn-danger" onClick={() => setDialog("delete")} disabled={!info}>
              <Trash size={15} /> Delete
            </button>
            <RadixDialog.Close className="icon-btn" aria-label="Close">
              <X size={18} />
            </RadixDialog.Close>
          </header>
          <div className="collection-window-body">
            {items.data && items.data.items.length === 0 ? (
              <div className="empty">
                <p>This collection is empty. Select items in {category.name} and choose “Move”, or open an item and choose Organize › Move, to put them here.</p>
              </div>
            ) : (
              <div className="collection-window-grid" style={{ ["--card" as string]: `${size}px` }}>
                {items.data?.items.map((item) => (
                  <MediaCard key={item.id} item={item} width={size} transitionId={item.id} />
                ))}
              </div>
            )}
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
      {info && (
        <>
          <NameDialog
            open={dialog === "rename"}
            onOpenChange={(open) => !open && setDialog(null)}
            title="Rename collection"
            label="Name"
            initial={info.name}
            confirm="Save"
            onSubmit={async (next) => {
              await api.collectionRename(info.id, next);
              libraryChanged(queryClient);
            }}
          />
          <ConfirmDialog
            open={dialog === "delete"}
            onOpenChange={(open) => !open && setDialog(null)}
            title={`Delete the collection “${info.name}”?`}
            description={`Only the collection goes: its items stay in ${category.name}.`}
            confirm="Delete collection"
            danger
            onConfirm={async () => {
              await api.collectionDelete(info.id);
              libraryChanged(queryClient);
              onClose();
            }}
          />
        </>
      )}
    </RadixDialog.Root>
  );
}

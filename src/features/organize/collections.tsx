import { Fragment, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { DropdownMenu } from "radix-ui";
import { ChevronDown, ChevronRight, Folder, FolderInput, FolderPlus, Pencil, Trash } from "lucide-react";
import { api, type Category, type NamedRef } from "../../lib/api";
import { libraryChanged, useCollections } from "../../lib/queries";
import { Collage } from "../../components/Collage";
import { ConfirmDialog, MoveCollectionDialog, NameDialog } from "./dialogs";

/** The collections directly inside a category or collection, as tiles. */
export function CollectionRow({ category, parent }: { category: string; parent: number | null }) {
  const level = useCollections(category, parent);
  const children = level.data?.children ?? [];
  if (children.length === 0) return null;
  return (
    <section className="collection-row" aria-label="Collections">
      {children.map((collection) => (
        <Link key={collection.id} to="/library/$scope" params={{ scope: category }} search={{ collection: collection.id }} className="tile collection-tile" data-blip>
          <div className={`tile-screen screen-${collection.id % 5}`}>
            {collection.covers.length > 0 ? (
              <Collage covers={collection.covers} />
            ) : (
              <div className="tile-icon">
                <Folder size={34} strokeWidth={2.2} aria-hidden />
              </div>
            )}
          </div>
          <div className="tile-label">
            <strong>{collection.name}</strong>
            <span className="count">{collection.itemCount.toLocaleString()}</span>
          </div>
        </Link>
      ))}
    </section>
  );
}

/** "Books › One Piece ›" above a collection's title. */
export function CollectionCrumbs({ category, path }: { category: Category; path: NamedRef[] }) {
  return (
    <span className="crumbs">
      <Link to="/library/$scope" params={{ scope: category.key }}>
        {category.name}
      </Link>
      {path.slice(0, -1).map((collection) => (
        <Fragment key={collection.id}>
          <ChevronRight size={14} strokeWidth={2.6} aria-hidden />
          <Link to="/library/$scope" params={{ scope: category.key }} search={{ collection: collection.id }}>
            {collection.name}
          </Link>
        </Fragment>
      ))}
    </span>
  );
}

/** "New collection" on a category page; inside a collection, a menu that also renames, moves and deletes it. */
export function CollectionActions({ category, path }: { category: Category; path: NamedRef[] }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [dialog, setDialog] = useState<"new" | "rename" | "move" | "delete" | null>(null);
  const current = path.at(-1) ?? null;
  const parentId = path.length > 1 ? path[path.length - 2].id : null;
  const close = (open: boolean) => !open && setDialog(null);
  const openCollection = (collection: number | null) =>
    navigate({ to: "/library/$scope", params: { scope: category.key }, search: collection == null ? {} : { collection } });

  return (
    <>
      {current ? (
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button type="button" className="btn">
              Collection <ChevronDown size={15} />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className="menu" align="end" sideOffset={8}>
              <DropdownMenu.Item className="menu-item" onSelect={() => setDialog("new")}>
                <FolderPlus size={16} /> New collection inside…
              </DropdownMenu.Item>
              <DropdownMenu.Item className="menu-item" onSelect={() => setDialog("rename")}>
                <Pencil size={16} /> Rename…
              </DropdownMenu.Item>
              <DropdownMenu.Item className="menu-item" onSelect={() => setDialog("move")}>
                <FolderInput size={16} /> Move…
              </DropdownMenu.Item>
              <DropdownMenu.Separator className="menu-separator" />
              <DropdownMenu.Item className="menu-item danger" onSelect={() => setDialog("delete")}>
                <Trash size={16} /> Delete collection…
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      ) : (
        <button type="button" className="btn" onClick={() => setDialog("new")}>
          <FolderPlus size={16} /> New collection
        </button>
      )}
      <NameDialog
        open={dialog === "new"}
        onOpenChange={close}
        title={current ? `New collection in “${current.name}”` : `New collection in ${category.name}`}
        description="Collections group items inside a category, like a series, a franchise or a box set. They can hold other collections."
        label="Name"
        confirm="Create"
        onSubmit={async (name) => {
          const id = await api.collectionCreate(category.key, current?.id ?? null, name);
          libraryChanged(queryClient);
          await openCollection(id);
        }}
      />
      {current && (
        <>
          <NameDialog
            open={dialog === "rename"}
            onOpenChange={close}
            title="Rename collection"
            label="Name"
            initial={current.name}
            confirm="Save"
            onSubmit={async (name) => {
              await api.collectionRename(current.id, name);
              libraryChanged(queryClient);
            }}
          />
          <MoveCollectionDialog open={dialog === "move"} onOpenChange={close} category={category.key} collection={{ ...current, parentId }} />
          <ConfirmDialog
            open={dialog === "delete"}
            onOpenChange={close}
            title={`Delete the collection “${current.name}”?`}
            description="Only the collection goes. Everything inside it, items and collections alike, moves up one level."
            confirm="Delete collection"
            danger
            onConfirm={async () => {
              await api.collectionDelete(current.id);
              libraryChanged(queryClient);
              await openCollection(parentId);
            }}
          />
        </>
      )}
    </>
  );
}

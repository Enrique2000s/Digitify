import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { DropdownMenu } from "radix-ui";
import { ChevronDown, ChevronRight, Library, Pencil, Plus, Tag as TagIcon, Trash } from "lucide-react";
import { api, type Shelf, type Tag } from "../../lib/api";
import { plural } from "../../lib/format";
import { libraryChanged, useShelves, useTags } from "../../lib/queries";
import { CategoryStrip } from "../../components/CategoryStrip";
import { Collage } from "../../components/Collage";
import { LibraryView } from "../library/LibraryView";
import { ConfirmDialog, NameDialog, ShelfDialog } from "./dialogs";

/** A shelf as a tile with the first covers on it (Shelves page and Home). */
export function ShelfCard({ shelf }: { shelf: Shelf }) {
  return (
    <Link to="/shelf/$id" params={{ id: String(shelf.id) }} className="tile" data-blip>
      <div className={`tile-screen screen-${shelf.id % 8}`}>
        {shelf.covers.length > 0 ? (
          <Collage covers={shelf.covers} />
        ) : (
          <div className="tile-icon">
            <Library size={40} strokeWidth={2.2} aria-hidden />
          </div>
        )}
      </div>
      <div className="tile-label">
        <strong>{shelf.name}</strong>
        <span className="count">{shelf.itemCount.toLocaleString()}</span>
        <ChevronRight size={18} strokeWidth={2.8} aria-hidden />
      </div>
    </Link>
  );
}

function PageTitle({ icon, title, count, children }: { icon: React.ReactNode; title: string; count: string; children?: React.ReactNode }) {
  return (
    <div className="page-header">
      <div className="title-row">
        <span className="title-badge">{icon}</span>
        <div>
          <h1 className="display">{title}</h1>
          <div className="count">{count}</div>
        </div>
      </div>
      <div className="header-actions">{children}</div>
    </div>
  );
}

export function ShelvesPage() {
  const shelves = useShelves();
  const [creating, setCreating] = useState(false);
  const list = shelves.data ?? [];
  return (
    <div className="page">
      <CategoryStrip />
      <PageTitle icon={<Library size={26} strokeWidth={2.2} aria-hidden />} title="Shelves" count={shelves.data ? plural(list.length, "shelf", "shelves") : " "}>
        <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
          <Plus size={17} strokeWidth={2.6} /> New shelf
        </button>
      </PageTitle>
      {shelves.data && list.length === 0 ? (
        <div className="empty">
          <h2 className="display">No shelves yet</h2>
          <p>
            Shelves are your own lists across categories: “Read this summer”, “Signed editions”, “Movie night”. An item can
            sit on as many shelves as you like, and removing it from a shelf never removes it from your library.
          </p>
          <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
            <Plus size={16} /> New shelf
          </button>
        </div>
      ) : (
        <div className="card-grid">
          {list.map((shelf) => (
            <ShelfCard key={shelf.id} shelf={shelf} />
          ))}
        </div>
      )}
      <ShelfDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}

/** A menu of actions for the thing a page shows (a shelf or a tag). */
function ThingMenu({ label, onRename, onDelete, deleteLabel }: { label: string; onRename: () => void; onDelete: () => void; deleteLabel: string }) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button type="button" className="btn">
          {label} <ChevronDown size={15} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="menu" align="end" sideOffset={8}>
          <DropdownMenu.Item className="menu-item" onSelect={onRename}>
            <Pencil size={16} /> Rename…
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="menu-separator" />
          <DropdownMenu.Item className="menu-item danger" onSelect={onDelete}>
            <Trash size={16} /> {deleteLabel}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function ShelfPage() {
  const { id } = useParams({ from: "/shelf/$id" });
  const shelves = useShelves();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [dialog, setDialog] = useState<"rename" | "delete" | null>(null);
  const shelf = shelves.data?.find((s) => s.id === Number(id));
  if (!shelf) {
    return shelves.isPending ? null : (
      <div className="page">
        <div className="empty">
          <h2 className="display">This shelf is gone</h2>
          <Link to="/shelves" className="btn">
            All shelves
          </Link>
        </div>
      </div>
    );
  }
  const close = (open: boolean) => !open && setDialog(null);
  return (
    <>
      <LibraryView
        key={`shelf:${shelf.id}`}
        viewKey="shelf"
        base={{ shelf: shelf.id }}
        title={shelf.name}
        eyebrow={
          <Link to="/shelves" className="crumbs">
            Shelves
          </Link>
        }
        icon={<Library size={26} strokeWidth={2.2} aria-hidden />}
        description={shelf.description}
        actions={<ThingMenu label="Shelf" onRename={() => setDialog("rename")} onDelete={() => setDialog("delete")} deleteLabel="Delete shelf…" />}
        empty={
          <div className="empty">
            <p>
              Nothing on this shelf yet. Add items from their page (Organize › Add to shelf), or select several items in
              any view and choose “Add to shelf”.
            </p>
          </div>
        }
      />
      <ShelfDialog open={dialog === "rename"} onOpenChange={close} shelf={shelf} />
      <ConfirmDialog
        open={dialog === "delete"}
        onOpenChange={close}
        title={`Delete the shelf “${shelf.name}”?`}
        description="Only the shelf goes; everything on it stays in your library."
        confirm="Delete shelf"
        danger
        onConfirm={async () => {
          await api.shelfDelete(shelf.id);
          libraryChanged(queryClient);
          await navigate({ to: "/shelves" });
        }}
      />
    </>
  );
}

function TagDialogs({ tag, dialog, onClose, onDeleted }: { tag: Tag; dialog: "rename" | "delete" | null; onClose: () => void; onDeleted?: () => void }) {
  const queryClient = useQueryClient();
  return (
    <>
      <NameDialog
        open={dialog === "rename"}
        onOpenChange={(open) => !open && onClose()}
        title="Rename tag"
        description="Renaming it to another tag's name merges the two."
        label="Name"
        initial={tag.name}
        confirm="Save"
        onSubmit={async (name) => {
          await api.tagRename(tag.id, name);
          libraryChanged(queryClient);
        }}
      />
      <ConfirmDialog
        open={dialog === "delete"}
        onOpenChange={(open) => !open && onClose()}
        title={`Delete the tag “${tag.name}”?`}
        description={`It comes off ${plural(tag.itemCount, "item")}. The items stay in your library.`}
        confirm="Delete tag"
        danger
        onConfirm={async () => {
          await api.tagDelete(tag.id);
          libraryChanged(queryClient);
          onDeleted?.();
        }}
      />
    </>
  );
}

export function TagsPage() {
  const tags = useTags();
  const [selected, setSelected] = useState<{ tag: Tag; dialog: "rename" | "delete" } | null>(null);
  const list = tags.data ?? [];
  return (
    <div className="page">
      <CategoryStrip />
      <PageTitle icon={<TagIcon size={26} strokeWidth={2.2} aria-hidden />} title="Tags" count={tags.data ? plural(list.length, "tag") : " "} />
      {tags.data && list.length === 0 ? (
        <div className="empty">
          <h2 className="display">No tags yet</h2>
          <p>
            Tags are quick labels like “signed”, “to read” or “gift”. Add them on an item's page under Organize, or to many
            items at once with Select › Tags.
          </p>
        </div>
      ) : (
        <ul className="tag-list">
          {list.map((tag) => (
            <li key={tag.id}>
              <Link to="/tag/$id" params={{ id: String(tag.id) }} className="tag-chip big" data-blip>
                <TagIcon size={14} strokeWidth={2.4} aria-hidden />
                {tag.name}
              </Link>
              <span className="muted">{plural(tag.itemCount, "item")}</span>
              <button type="button" className="icon-btn" aria-label={`Rename ${tag.name}`} title="Rename" onClick={() => setSelected({ tag, dialog: "rename" })}>
                <Pencil size={15} />
              </button>
              <button type="button" className="icon-btn" aria-label={`Delete ${tag.name}`} title="Delete" onClick={() => setSelected({ tag, dialog: "delete" })}>
                <Trash size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {selected && <TagDialogs tag={selected.tag} dialog={selected.dialog} onClose={() => setSelected(null)} />}
    </div>
  );
}

export function TagPage() {
  const { id } = useParams({ from: "/tag/$id" });
  const tags = useTags();
  const navigate = useNavigate();
  const [dialog, setDialog] = useState<"rename" | "delete" | null>(null);
  const tag = tags.data?.find((t) => t.id === Number(id));
  if (!tag) {
    return tags.isPending ? null : (
      <div className="page">
        <div className="empty">
          <h2 className="display">This tag is gone</h2>
          <Link to="/tags" className="btn">
            All tags
          </Link>
        </div>
      </div>
    );
  }
  return (
    <>
      <LibraryView
        key={`tag:${tag.id}`}
        viewKey="tag"
        base={{ tag: tag.id }}
        title={tag.name}
        eyebrow={
          <Link to="/tags" className="crumbs">
            Tags
          </Link>
        }
        icon={<TagIcon size={26} strokeWidth={2.2} aria-hidden />}
        actions={<ThingMenu label="Tag" onRename={() => setDialog("rename")} onDelete={() => setDialog("delete")} deleteLabel="Delete tag…" />}
        empty={<div className="empty"><p>No items carry this tag anymore.</p></div>}
      />
      <TagDialogs tag={tag} dialog={dialog} onClose={() => setDialog(null)} onDeleted={() => void navigate({ to: "/tags" })} />
    </>
  );
}

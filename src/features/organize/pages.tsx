import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { DropdownMenu } from "radix-ui";
import { ChevronDown, Pencil, Tag as TagIcon, Trash } from "lucide-react";
import { api, type Tag } from "../../lib/api";
import { plural } from "../../lib/format";
import { libraryChanged, useTags } from "../../lib/queries";
import { CategoryStrip } from "../../components/CategoryStrip";
import { useArrival } from "../../lib/arrival";
import { LibraryView } from "../library/LibraryView";
import { ConfirmDialog, NameDialog } from "./dialogs";

function PageTitle({ icon, title, count, children }: { icon: React.ReactNode; title: string; count: string; children?: React.ReactNode }) {
  const arriving = useArrival(`title:${title}`);
  return (
    <div className="page-header">
      <div className={`title-row${arriving ? " arriving" : ""}`}>
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

function ThingMenu({
  label,
  onRename,
  onDelete,
  deleteLabel,
  renameLabel = "Rename…",
}: {
  label: string;
  onRename: () => void;
  onDelete: () => void;
  deleteLabel: string;
  renameLabel?: string;
}) {
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
            <Pencil size={16} /> {renameLabel}
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
  // Laid out like the other Library views (D-046): the header and buttons hold their place, and
  // only the list arrives.
  return (
    <div className="library-view">
      <div className="tags-view">
      <CategoryStrip />
      <PageTitle icon={<TagIcon size={26} strokeWidth={2.2} aria-hidden />} title="Tags" count={tags.data ? plural(list.length, "tag") : " "} />
      <div className="tags-stage">
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
      </div>
      {selected && <TagDialogs tag={selected.tag} dialog={selected.dialog} onClose={() => setSelected(null)} />}
      </div>
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

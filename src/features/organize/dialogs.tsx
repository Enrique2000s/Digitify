import { useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FolderPlus } from "lucide-react";
import { api, errorText, type CollectionNode, type SmartRules } from "../../lib/api";
import { libraryChanged, useCategories, useCollectionTree } from "../../lib/queries";
import { Dialog, Field } from "../../components/common";

/** Runs an action for a dialog, keeping it open with the error if the action fails. */
function useAction(onOpenChange: (open: boolean) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      onOpenChange(false);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, run };
}

/** One text field: a new collection's name, renaming a tag, and so on. */
export function NameDialog({
  open,
  onOpenChange,
  title,
  description,
  label,
  initial = "",
  confirm,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  label: string;
  initial?: string;
  confirm: string;
  onSubmit: (name: string) => Promise<unknown>;
}) {
  const [name, setName] = useState(initial);
  const { busy, error, setError, run } = useAction(onOpenChange);
  useEffect(() => {
    if (open) {
      setName(initial);
      setError(null);
    }
  }, [open, initial, setError]);
  const submit = () => name.trim() && void run(() => onSubmit(name.trim()));
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      footer={
        <>
          <button type="button" className="btn" onClick={() => onOpenChange(false)}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={busy || !name.trim()} onClick={submit}>
            {confirm}
          </button>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Field label={label}>
          <input className="input" value={name} onChange={(event) => setName(event.target.value)} autoFocus />
        </Field>
      </form>
      {error && <div className="dialog-error">{error}</div>}
    </Dialog>
  );
}

/** A yes/no question before something that can't be undone. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirm,
  danger,
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  confirm: string;
  danger?: boolean;
  onConfirm: () => Promise<unknown>;
  children?: ReactNode;
}) {
  const { busy, error, setError, run } = useAction(onOpenChange);
  useEffect(() => {
    if (open) setError(null);
  }, [open, setError]);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      footer={
        <>
          <button type="button" className="btn" onClick={() => onOpenChange(false)}>
            Cancel
          </button>
          <button type="button" className={danger ? "btn btn-danger solid" : "btn btn-primary"} disabled={busy} onClick={() => void run(onConfirm)}>
            {confirm}
          </button>
        </>
      }
    >
      {children}
      {error && <div className="dialog-error">{error}</div>}
    </Dialog>
  );
}

/** Creates a shelf, or renames one. Resolves with the shelf's id. */
export function ShelfDialog({
  open,
  onOpenChange,
  shelf,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shelf?: { id: number; name: string; description: string | null; rules?: SmartRules | null };
  onSaved?: (id: number) => Promise<unknown> | void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const { busy, error, setError, run } = useAction(onOpenChange);
  useEffect(() => {
    if (open) {
      setName(shelf?.name ?? "");
      setDescription(shelf?.description ?? "");
      setError(null);
    }
  }, [open, shelf, setError]);
  const save = () =>
    void run(async () => {
      const input = { name: name.trim(), description: description.trim() || null, rules: shelf?.rules ?? null };
      let id = shelf?.id;
      if (id == null) id = await api.shelfCreate(input);
      else await api.shelfUpdate(id, input);
      await onSaved?.(id);
      libraryChanged(queryClient);
    });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={shelf ? "Rename shelf" : "New shelf"}
      description={shelf ? undefined : "Your own list across categories, like “Read this summer” or “Movie night”."}
      footer={
        <>
          <button type="button" className="btn" onClick={() => onOpenChange(false)}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={busy || !name.trim()} onClick={save}>
            {shelf ? "Save" : "Create shelf"}
          </button>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) save();
        }}
        style={{ display: "flex", flexDirection: "column", gap: 14 }}
      >
        <Field label="Name">
          <input className="input" value={name} onChange={(event) => setName(event.target.value)} autoFocus />
        </Field>
        <Field label="Description (optional)">
          <textarea className="textarea" style={{ minHeight: 70 }} value={description} onChange={(event) => setDescription(event.target.value)} />
        </Field>
      </form>
      {error && <div className="dialog-error">{error}</div>}
    </Dialog>
  );
}

/** Indented options for a category's collections. */
function CollectionOptions({ nodes, exclude }: { nodes: CollectionNode[]; exclude?: Set<number> }) {
  return nodes
    .filter((node) => !exclude?.has(node.id))
    .map((node) => (
      <option key={node.id} value={node.id}>
        {" ".repeat(node.depth)}
        {node.name}
      </option>
    ));
}

/** A new home for items: a category, optionally inside one of its collections (D-004). */
export function MoveDialog({
  open,
  onOpenChange,
  ids,
  title,
  initialCategory,
  initialCollection,
  onMoved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ids: number[];
  title: string;
  initialCategory: string;
  initialCollection: number | null;
  onMoved?: () => void;
}) {
  const queryClient = useQueryClient();
  const categories = useCategories();
  const [category, setCategory] = useState(initialCategory);
  const [collection, setCollection] = useState<number | null>(initialCollection);
  const [newName, setNewName] = useState("");
  const tree = useCollectionTree(open ? category : null);
  const { busy, error, setError, run } = useAction(onOpenChange);

  useEffect(() => {
    if (open) {
      setCategory(initialCategory);
      setCollection(initialCollection);
      setNewName("");
      setError(null);
    }
  }, [open, initialCategory, initialCollection, setError]);

  const createCollection = async () => {
    setError(null);
    try {
      const id = await api.collectionCreate(category, collection, newName.trim());
      setNewName("");
      await queryClient.invalidateQueries({ queryKey: ["collection-tree"] });
      setCollection(id);
      libraryChanged(queryClient);
    } catch (reason) {
      setError(errorText(reason));
    }
  };

  const categoryName = categories.data?.find((c) => c.key === category)?.name ?? "";
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description="Every item has one home: a category, and optionally a collection inside it. Shelves and tags don't change."
      footer={
        <>
          <button type="button" className="btn" onClick={() => onOpenChange(false)}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await api.itemsBulk(ids, [{ op: "move", category, collection }]);
                libraryChanged(queryClient);
                onMoved?.();
              })
            }
          >
            Move
          </button>
        </>
      }
    >
      <div className="field-row">
        <Field label="Category">
          <select
            className="select"
            value={category}
            onChange={(event) => {
              setCategory(event.target.value);
              setCollection(null);
            }}
          >
            {categories.data?.map((c) => (
              <option key={c.key} value={c.key}>
                {c.name}
                {c.isHidden ? " (hidden)" : ""}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Collection">
          <select className="select" value={collection ?? ""} onChange={(event) => setCollection(event.target.value ? Number(event.target.value) : null)}>
            <option value="">Not in a collection</option>
            <CollectionOptions nodes={tree.data ?? []} />
          </select>
        </Field>
      </div>
      <form
        className="inline-create"
        onSubmit={(event) => {
          event.preventDefault();
          if (newName.trim()) void createCollection();
        }}
      >
        <input
          className="input"
          placeholder={collection == null ? `New collection in ${categoryName}` : "New collection inside the selected one"}
          aria-label="New collection name"
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
        />
        <button type="submit" className="btn btn-sm" disabled={!newName.trim()}>
          <FolderPlus size={15} /> Create
        </button>
      </form>
      {error && <div className="dialog-error">{error}</div>}
    </Dialog>
  );
}

/** Moves a collection (and everything in it) within its category. */
export function MoveCollectionDialog({
  open,
  onOpenChange,
  category,
  collection,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  category: string;
  collection: { id: number; name: string; parentId: number | null };
}) {
  const queryClient = useQueryClient();
  const tree = useCollectionTree(open ? category : null);
  const [parent, setParent] = useState<number | null>(collection.parentId);
  const { busy, error, setError, run } = useAction(onOpenChange);
  useEffect(() => {
    if (open) {
      setParent(collection.parentId);
      setError(null);
    }
  }, [open, collection.parentId, setError]);

  // A collection can't move inside itself: leave out it and everything below it.
  const nodes = tree.data ?? [];
  const exclude = new Set<number>();
  const start = nodes.findIndex((node) => node.id === collection.id);
  if (start >= 0) {
    exclude.add(collection.id);
    for (let i = start + 1; i < nodes.length && nodes[i].depth > nodes[start].depth; i++) exclude.add(nodes[i].id);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Move “${collection.name}”`}
      description="The collection keeps everything inside it."
      footer={
        <>
          <button type="button" className="btn" onClick={() => onOpenChange(false)}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await api.collectionMove(collection.id, parent);
                libraryChanged(queryClient);
              })
            }
          >
            Move
          </button>
        </>
      }
    >
      <Field label="Put it inside">
        <select className="select" value={parent ?? ""} onChange={(event) => setParent(event.target.value ? Number(event.target.value) : null)}>
          <option value="">The top level of the category</option>
          <CollectionOptions nodes={nodes} exclude={exclude} />
        </select>
      </Field>
      {error && <div className="dialog-error">{error}</div>}
    </Dialog>
  );
}

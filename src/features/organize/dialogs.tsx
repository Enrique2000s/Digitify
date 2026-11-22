import { useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FolderPlus } from "lucide-react";
import { api, errorText, type CollectionNode } from "../../lib/api";
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
  collections = [],
  title,
  initialCategory,
  initialCollection,
  onMoved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ids: number[];
  /** Collections to move too (D-036): inside another collection of their category, or to its top. */
  collections?: number[];
  title: string;
  initialCategory: string;
  initialCollection: number | null;
  onMoved?: () => void;
}) {
  const queryClient = useQueryClient();
  const categories = useCategories();
  // Items and collections stay in their category (D-126); only the collection is chosen.
  const category = initialCategory;
  const [collection, setCollection] = useState<number | null>(initialCollection);
  const [newName, setNewName] = useState("");
  const tree = useCollectionTree(open ? category : null);
  const { busy, error, setError, run } = useAction(onOpenChange);

  useEffect(() => {
    if (open) {
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
      description="Into a collection of this category, or out of every collection. Items stay in their category: each category keeps its own kind of media."
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
                for (const id of collections) await api.collectionMove(id, collection);
                if (ids.length) await api.itemsBulk(ids, [{ op: "move", category, collection }]);
                libraryChanged(queryClient);
                void queryClient.invalidateQueries({ queryKey: ["collections"] });
                void queryClient.invalidateQueries({ queryKey: ["collection-tree"] });
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
          <p className="field-static">{categoryName}</p>
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

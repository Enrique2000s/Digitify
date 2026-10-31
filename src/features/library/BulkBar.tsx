import { useEffect, useId, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FolderInput, ListMinus, ListPlus, Pencil, Tags, Trash } from "lucide-react";
import { api, errorText, type BulkOp, type QueryParams } from "../../lib/api";
import { plural } from "../../lib/format";
import { libraryChanged, useCategories } from "../../lib/queries";
import { useSelection } from "../../lib/selection";
import { Dialog, Field } from "../../components/common";
import { MoveDialog } from "../organize/dialogs";
import { ShelfMenu } from "../organize/ShelfMenu";
import { tagNames, TagSuggestions } from "../organize/TagEditor";

type BulkDialog = "tags" | "move" | "edit" | "remove" | null;

function BulkDialogFrame({
  open,
  onOpenChange,
  title,
  description,
  confirm,
  danger,
  disabled,
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirm: string;
  danger?: boolean;
  disabled?: boolean;
  onConfirm: () => Promise<void>;
  children: React.ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) setError(null);
  }, [open]);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };
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
          <button type="button" className={danger ? "btn btn-danger solid" : "btn btn-primary"} disabled={busy || disabled} onClick={() => void run()}>
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

function TagsDialog({ ids, open, onOpenChange }: { ids: number[]; open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const listId = useId();
  const [add, setAdd] = useState("");
  const [remove, setRemove] = useState("");
  useEffect(() => {
    if (open) {
      setAdd("");
      setRemove("");
    }
  }, [open]);
  const ops: BulkOp[] = [];
  if (tagNames(add).length) ops.push({ op: "addTags", names: tagNames(add) });
  if (tagNames(remove).length) ops.push({ op: "removeTags", names: tagNames(remove) });
  return (
    <BulkDialogFrame
      open={open}
      onOpenChange={onOpenChange}
      title={`Tags for ${plural(ids.length, "item")}`}
      description="Separate several tags with commas."
      confirm="Apply"
      disabled={ops.length === 0}
      onConfirm={async () => {
        await api.itemsBulk(ids, ops);
        libraryChanged(queryClient);
      }}
    >
      <Field label="Add tags">
        <input className="input" list={listId} value={add} onChange={(event) => setAdd(event.target.value)} placeholder="e.g. signed, first edition" autoFocus />
      </Field>
      <Field label="Remove tags">
        <input className="input" list={listId} value={remove} onChange={(event) => setRemove(event.target.value)} />
      </Field>
      <TagSuggestions id={listId} />
    </BulkDialogFrame>
  );
}

/** A field that only changes when its box is ticked; an empty value clears it. */
function OptionalField({ label, enabled, onEnabled, children }: { label: string; enabled: boolean; onEnabled: (enabled: boolean) => void; children: React.ReactNode }) {
  return (
    <div className="optional-field">
      <label className="checkbox">
        <input type="checkbox" checked={enabled} onChange={(event) => onEnabled(event.target.checked)} />
        Change {label.toLowerCase()}
      </label>
      <fieldset disabled={!enabled}>{children}</fieldset>
    </div>
  );
}

function EditDialog({ ids, open, onOpenChange }: { ids: number[]; open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const [favorite, setFavorite] = useState<"" | "yes" | "no">("");
  const [yearOn, setYearOn] = useState(false);
  const [year, setYear] = useState("");
  const [seriesOn, setSeriesOn] = useState(false);
  const [series, setSeries] = useState("");
  useEffect(() => {
    if (open) {
      setFavorite("");
      setYearOn(false);
      setYear("");
      setSeriesOn(false);
      setSeries("");
    }
  }, [open]);

  const ops: BulkOp[] = [];
  if (favorite) ops.push({ op: "favorite", favorite: favorite === "yes" });
  if (yearOn) ops.push({ op: "setYear", year: year.trim() ? Number(year) : null });
  if (seriesOn) ops.push({ op: "setSeries", series: series.trim() || null });
  const badYear = yearOn && year.trim() !== "" && !/^\d{1,4}$/.test(year.trim());

  return (
    <BulkDialogFrame
      open={open}
      onOpenChange={onOpenChange}
      title={`Edit ${plural(ids.length, "item")}`}
      description="Only what you choose to change is changed. Your media files are never modified."
      confirm="Apply"
      disabled={ops.length === 0 || badYear}
      onConfirm={async () => {
        await api.itemsBulk(ids, ops);
        libraryChanged(queryClient);
      }}
    >
      <Field label="Favorites">
        <select className="select" value={favorite} onChange={(event) => setFavorite(event.target.value as typeof favorite)}>
          <option value="">Leave as they are</option>
          <option value="yes">Add to favorites</option>
          <option value="no">Remove from favorites</option>
        </select>
      </Field>
      <OptionalField label="Year" enabled={yearOn} onEnabled={setYearOn}>
        <input className="input" inputMode="numeric" aria-label="Year" placeholder="Leave empty to clear" value={year} onChange={(event) => setYear(event.target.value)} />
        {badYear && <span className="hint">Year should be a whole number, like 1927.</span>}
      </OptionalField>
      <OptionalField label="Series" enabled={seriesOn} onEnabled={setSeriesOn}>
        <input className="input" aria-label="Series" placeholder="Leave empty to clear" value={series} onChange={(event) => setSeries(event.target.value)} />
      </OptionalField>
    </BulkDialogFrame>
  );
}

function RemoveDialog({ ids, open, onOpenChange, onRemoved }: { ids: number[]; open: boolean; onOpenChange: (open: boolean) => void; onRemoved: () => void }) {
  const queryClient = useQueryClient();
  const [trash, setTrash] = useState(false);
  useEffect(() => {
    if (open) setTrash(false);
  }, [open]);
  return (
    <BulkDialogFrame
      open={open}
      onOpenChange={onOpenChange}
      title={`Remove ${plural(ids.length, "item")} from your library?`}
      description="Their details, copies and progress are removed from Digitify. Files on your computer are not deleted."
      confirm="Remove from library"
      danger
      onConfirm={async () => {
        const report = await api.itemRemove(ids, trash);
        libraryChanged(queryClient);
        onRemoved();
        if (report.errors.length) {
          throw new Error(`Removed from the library, but some copies couldn't be moved to the Recycle Bin: ${report.errors.join("; ")}`);
        }
      }}
    >
      <label className="checkbox">
        <input type="checkbox" checked={trash} onChange={(event) => setTrash(event.target.checked)} />
        Also move copies Digitify made in the library folder to the Recycle Bin
      </label>
    </BulkDialogFrame>
  );
}

/** The floating bar while selecting: what to do with the selected items. */
export function BulkBar({ base, total, shelf }: { base: Omit<QueryParams, "offset" | "limit">; total: number; shelf?: number }) {
  const selection = useSelection();
  const queryClient = useQueryClient();
  const categories = useCategories();
  const [dialog, setDialog] = useState<BulkDialog>(null);
  const [error, setError] = useState<string | null>(null);
  if (!selection?.active) return null;
  const ids = [...selection.selected];
  const none = ids.length === 0;
  const close = (open: boolean) => !open && setDialog(null);

  const selectAll = async () => {
    setError(null);
    try {
      selection.set(await api.queryIds(base));
    } catch (reason) {
      setError(errorText(reason));
    }
  };

  const removeFromShelf = async () => {
    if (shelf == null) return;
    setError(null);
    try {
      await api.itemsBulk(ids, [{ op: "removeFromShelf", shelf }]);
      selection.set([]);
      libraryChanged(queryClient);
    } catch (reason) {
      setError(errorText(reason));
    }
  };

  return (
    <>
      <div className="bulk-bar" role="toolbar" aria-label="Selected items">
        <strong aria-live="polite">{ids.length === 0 ? "Select items" : `${ids.length.toLocaleString()} selected`}</strong>
        {ids.length < total ? (
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => void selectAll()}>
            Select all {total.toLocaleString()}
          </button>
        ) : (
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => selection.set([])}>
            Select none
          </button>
        )}
        <span className="bulk-sep" aria-hidden />
        <ShelfMenu ids={ids} onError={setError}>
          <button type="button" className="btn btn-sm" disabled={none}>
            <ListPlus size={15} /> Add to shelf
          </button>
        </ShelfMenu>
        {shelf != null && (
          <button type="button" className="btn btn-sm" disabled={none} onClick={() => void removeFromShelf()}>
            <ListMinus size={15} /> Take off this shelf
          </button>
        )}
        <button type="button" className="btn btn-sm" disabled={none} onClick={() => setDialog("tags")}>
          <Tags size={15} /> Tags…
        </button>
        <button type="button" className="btn btn-sm" disabled={none} onClick={() => setDialog("move")}>
          <FolderInput size={15} /> Move…
        </button>
        <button type="button" className="btn btn-sm" disabled={none} onClick={() => setDialog("edit")}>
          <Pencil size={15} /> Edit…
        </button>
        <button type="button" className="btn btn-sm btn-danger" disabled={none} onClick={() => setDialog("remove")}>
          <Trash size={15} /> Remove…
        </button>
        <button type="button" className="btn btn-sm btn-primary" onClick={selection.stop}>
          Done
        </button>
        {error && <div className="dialog-error bulk-error">{error}</div>}
      </div>
      <TagsDialog ids={ids} open={dialog === "tags"} onOpenChange={close} />
      <EditDialog ids={ids} open={dialog === "edit"} onOpenChange={close} />
      <RemoveDialog ids={ids} open={dialog === "remove"} onOpenChange={close} onRemoved={() => selection.set([])} />
      <MoveDialog
        open={dialog === "move"}
        onOpenChange={close}
        ids={ids}
        title={`Move ${plural(ids.length, "item")}`}
        initialCategory={base.category ?? categories.data?.[0]?.key ?? "books"}
        initialCollection={base.collection ?? null}
      />
    </>
  );
}

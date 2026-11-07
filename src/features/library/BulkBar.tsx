import { useEffect, useId, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { open as openFile } from "@tauri-apps/plugin-dialog";
import { DropdownMenu } from "radix-ui";
import { FolderInput, ImagePlus, ListMusic, Pencil, Plus, Tags, Trash } from "lucide-react";
import { api, errorText, type BulkActions, type BulkOp, type CoverShape, type QueryParams } from "../../lib/api";
import { plural } from "../../lib/format";
import { libraryChanged, useCategories } from "../../lib/queries";
import { useSelection } from "../../lib/selection";
import { Dialog, Field } from "../../components/common";
import { MoveDialog } from "../organize/dialogs";
import { tagNames, TagSuggestions } from "../organize/TagEditor";
import { NewPlaylistDialog, usePlaylists } from "../music/Tracks";

type BulkDialog = "tags" | "move" | "edit" | "cover" | "remove" | null;

const SHAPE_LABELS: Record<CoverShape, string> = { square: "Square", disc: "CD", landscape: "Horizontal", poster: "Vertical" };

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

function EditDialog({ ids, actions, open, onOpenChange }: { ids: number[]; actions: BulkActions | undefined; open: boolean; onOpenChange: (open: boolean) => void }) {
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
  if (seriesOn && actions?.series) ops.push({ op: "setSeries", series: series.trim() || null });
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
      {actions?.series && (
        <OptionalField label="Series" enabled={seriesOn} onEnabled={setSeriesOn}>
          <input className="input" aria-label="Series" placeholder="Leave empty to clear" value={series} onChange={(event) => setSeries(event.target.value)} />
        </OptionalField>
      )}
    </BulkDialogFrame>
  );
}

/** One image as the artwork of every selected item, and the cover shape when they all take the same ones. */
function CoverDialog({ ids, actions, open, onOpenChange }: { ids: number[]; actions: BulkActions | undefined; open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const [image, setImage] = useState<string | null>(null);
  const [shape, setShape] = useState<CoverShape | "" | "default">("");
  useEffect(() => {
    if (open) {
      setImage(null);
      setShape("");
    }
  }, [open]);
  const shapes = actions?.coverShapes ?? [];
  const pick = async () => {
    const path = await openFile({ multiple: false, title: "Choose artwork", filters: [{ name: "Images", extensions: ["jpg", "jpeg", "png", "webp", "gif", "bmp"] }] });
    if (typeof path === "string") setImage(path);
  };
  return (
    <BulkDialogFrame
      open={open}
      onOpenChange={onOpenChange}
      title={`Cover for ${plural(ids.length, "item")}`}
      description="Artwork and shape are changed only if you choose them. Your media files are never modified."
      confirm="Apply"
      disabled={!image && !shape}
      onConfirm={async () => {
        if (image) await api.itemsSetCover(ids, image);
        if (shape) await api.itemsBulk(ids, [{ op: "setCoverShape", shape: shape === "default" ? null : shape }]);
        libraryChanged(queryClient);
      }}
    >
      <Field label="Artwork">
        <div style={{ display: "flex", gap: 8, alignItems: "center", minWidth: 0 }}>
          <button type="button" className="btn btn-sm" onClick={() => void pick()}>
            <ImagePlus size={15} /> {image ? "Another image…" : "Choose an image…"}
          </button>
          <span className="hint path" title={image ?? undefined}>
            {image ? image.split(/[\\/]/).pop() : "The same image for every selected item."}
          </span>
        </div>
      </Field>
      {shapes.length > 0 ? (
        <Field label="Shape">
          <div className="segmented" role="group" aria-label="Cover shape">
            <button type="button" aria-pressed={shape === ""} onClick={() => setShape("")}>
              Leave as is
            </button>
            {shapes.map((value) => (
              <button key={value} type="button" aria-pressed={shape === value} onClick={() => setShape(value)}>
                {SHAPE_LABELS[value]}
              </button>
            ))}
            <button type="button" aria-pressed={shape === "default"} onClick={() => setShape("default")}>
              Default
            </button>
          </div>
        </Field>
      ) : (
        <p className="hint">The shape can be changed when every selected item takes the same shapes: all music, or all Videos. Movies & Series covers are always vertical.</p>
      )}
    </BulkDialogFrame>
  );
}

/** Every selected track to a playlist, or to a new one. */
function PlaylistMenu({ ids, onError }: { ids: number[]; onError: (message: string) => void }) {
  const queryClient = useQueryClient();
  const playlists = usePlaylists();
  const [creating, setCreating] = useState<number[] | null>(null);
  const add = async (playlist: number) => {
    try {
      await api.itemsBulk(ids, [{ op: "addToPlaylist", playlist }]);
      void queryClient.invalidateQueries({ queryKey: ["playlists"] });
      void queryClient.invalidateQueries({ queryKey: ["track-playlists"] });
      void queryClient.invalidateQueries({ queryKey: ["tracks"] });
    } catch (reason) {
      onError(errorText(reason));
    }
  };
  const startNew = async () => {
    try {
      setCreating((await api.musicTracks({ items: ids })).map((track) => track.id));
    } catch (reason) {
      onError(errorText(reason));
    }
  };
  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button type="button" className="btn btn-sm" disabled={ids.length === 0}>
            <ListMusic size={15} /> Add to playlist
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="menu" align="start" sideOffset={8}>
            {playlists.data?.map((list) => (
              <DropdownMenu.Item key={list.id} className="menu-item" onSelect={() => void add(list.id)}>
                <ListMusic size={17} /> {list.name}
              </DropdownMenu.Item>
            ))}
            {playlists.data?.length ? <DropdownMenu.Separator className="menu-separator" /> : null}
            <DropdownMenu.Item className="menu-item" onSelect={() => void startNew()}>
              <Plus size={17} /> New playlist…
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <NewPlaylistDialog tracks={creating ?? []} open={creating != null} onOpenChange={(open) => !open && setCreating(null)} />
    </>
  );
}

function RemoveDialog({ ids, collections, open, onOpenChange, onRemoved }: { ids: number[]; collections: number[]; open: boolean; onOpenChange: (open: boolean) => void; onRemoved: () => void }) {
  const queryClient = useQueryClient();
  const [trash, setTrash] = useState(false);
  useEffect(() => {
    if (open) setTrash(false);
  }, [open]);
  const parts = [ids.length ? plural(ids.length, "item") : null, collections.length ? plural(collections.length, "collection") : null].filter(Boolean);
  return (
    <BulkDialogFrame
      open={open}
      onOpenChange={onOpenChange}
      title={`Remove ${parts.join(" and ")}?`}
      description={[
        ids.length > 0 ? "The items' details, copies and progress are removed from Digitify. Files on your computer are not deleted." : "",
        collections.length > 0 ? "Deleting a collection keeps what's inside it: its items and collections move up one level." : "",
      ]
        .filter(Boolean)
        .join(" ")}
      confirm={ids.length ? "Remove" : collections.length === 1 ? "Delete collection" : "Delete collections"}
      danger
      onConfirm={async () => {
        // Collections first, outermost last doesn't matter: what's inside always moves up a level.
        for (const id of collections) await api.collectionDelete(id);
        const report = ids.length ? await api.itemRemove(ids, trash) : { errors: [] as string[] };
        libraryChanged(queryClient);
        void queryClient.invalidateQueries({ queryKey: ["collections"] });
        void queryClient.invalidateQueries({ queryKey: ["collection-tree"] });
        onRemoved();
        if (report.errors.length) {
          throw new Error(`Removed from the library, but some copies couldn't be moved to the Recycle Bin: ${report.errors.join("; ")}`);
        }
      }}
    >
      {ids.length > 0 && (
        <label className="checkbox">
          <input type="checkbox" checked={trash} onChange={(event) => setTrash(event.target.checked)} />
          Also move copies Digitify made in the library folder to the Recycle Bin
        </label>
      )}
    </BulkDialogFrame>
  );
}

/** The floating bar while selecting: what to do with the selected items. */
export function BulkBar({
  base,
  total,
  collections = [],
  itemsShown = true,
}: {
  base: Omit<QueryParams, "offset" | "limit">;
  total: number;
  /** The view's collections (negative card ids), selectable too (D-036). */
  collections?: number[];
  itemsShown?: boolean;
}) {
  const selection = useSelection();
  const categories = useCategories();
  const [dialog, setDialog] = useState<BulkDialog>(null);
  const [error, setError] = useState<string | null>(null);
  const picked = selection?.active ? [...selection.selected] : [];
  // Items have positive ids; collections come as negative ones.
  const ids = picked.filter((id) => id > 0);
  const collectionIds = picked.filter((id) => id < 0).map((id) => -id);
  // What fits every selected item comes from the core, so the bar and the edits follow one set of rules.
  const actions = useQuery({
    queryKey: ["bulk-actions", [...ids].sort((a, b) => a - b).join(",")],
    queryFn: () => api.itemsBulkActions(ids),
    enabled: ids.length > 0,
    placeholderData: keepPreviousData,
  }).data;
  const fits = ids.length > 0 ? actions : undefined;
  if (!selection?.active) return null;
  const none = ids.length === 0;
  const nothing = picked.length === 0;
  const close = (open: boolean) => !open && setDialog(null);

  const selectAll = async () => {
    setError(null);
    try {
      selection.set([...collections, ...(itemsShown ? await api.queryIds(base) : [])]);
    } catch (reason) {
      setError(errorText(reason));
    }
  };

  return (
    <>
      <div className="bulk-bar" role="toolbar" aria-label="Selected items">
        <strong aria-live="polite">{nothing ? "Select items" : `${picked.length.toLocaleString()} selected`}</strong>
        {picked.length < total ? (
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => void selectAll()}>
            Select all {total.toLocaleString()}
          </button>
        ) : (
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => selection.set([])}>
            Select none
          </button>
        )}
        <span className="bulk-sep" aria-hidden />
        {fits?.playlist && <PlaylistMenu ids={ids} onError={setError} />}
        <button type="button" className="btn btn-sm" disabled={none} onClick={() => setDialog("tags")}>
          <Tags size={15} /> Tags…
        </button>
        <button type="button" className="btn btn-sm" disabled={nothing} onClick={() => setDialog("move")}>
          <FolderInput size={15} /> Move…
        </button>
        <button type="button" className="btn btn-sm" disabled={none} onClick={() => setDialog("edit")}>
          <Pencil size={15} /> Edit…
        </button>
        <button type="button" className="btn btn-sm" disabled={none} onClick={() => setDialog("cover")}>
          <ImagePlus size={15} /> Cover…
        </button>
        <button type="button" className="btn btn-sm btn-danger" disabled={nothing} onClick={() => setDialog("remove")}>
          <Trash size={15} /> Remove…
        </button>
        <button type="button" className="btn btn-sm btn-primary" onClick={selection.stop}>
          Done
        </button>
        {error && <div className="dialog-error bulk-error">{error}</div>}
      </div>
      <TagsDialog ids={ids} open={dialog === "tags"} onOpenChange={close} />
      <EditDialog ids={ids} actions={fits} open={dialog === "edit"} onOpenChange={close} />
      <CoverDialog ids={ids} actions={fits} open={dialog === "cover"} onOpenChange={close} />
      <RemoveDialog ids={ids} collections={collectionIds} open={dialog === "remove"} onOpenChange={close} onRemoved={() => selection.set([])} />
      <MoveDialog
        open={dialog === "move"}
        onOpenChange={close}
        ids={ids}
        collections={collectionIds}
        title={`Move ${[ids.length ? plural(ids.length, "item") : null, collectionIds.length ? plural(collectionIds.length, "collection") : null].filter(Boolean).join(" and ")}`}
        initialCategory={base.category ?? categories.data?.[0]?.key ?? "books"}
        initialCollection={base.collection ?? null}
      />
    </>
  );
}

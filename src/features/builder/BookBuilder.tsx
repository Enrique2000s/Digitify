import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { ArrowDownAZ, ImagePlus } from "lucide-react";
import { api, errorText, pageUrl, type ImportMode, type ItemDetail, type VersionInfo } from "../../lib/api";
import { usePreferences } from "../../lib/preferences";
import { libraryChanged, useCategories } from "../../lib/queries";
import { Dialog, Field } from "../../components/common";
import { byName, PageArranger, type ArrangedPage } from "./PageArranger";

const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "gif", "bmp", "tif", "tiff"];
const PREVIEW_BATCH = 12;

const fileName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;
const folderName = (path: string) => path.split(/[\\/]/).filter(Boolean).slice(-2, -1)[0] ?? "";

/** "Book from images…": photos or scans picked by hand, put in reading order, saved as one item. */
export function BookBuilderDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { preferences } = usePreferences();
  const categories = useCategories();
  const [pages, setPages] = useState<ArrangedPage[]>([]);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("books");
  const [mode, setMode] = useState<ImportMode>("reference");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPages([]);
    setTitle("");
    setCategory("books");
    setMode(preferences.importMode === "copy" ? "copy" : "reference");
    setBusy(false);
    setError(null);
  }, [open, preferences.importMode]);

  const choose = async () => {
    const selected = await openDialog({ multiple: true, title: "Choose the pages", filters: [{ name: "Images", extensions: IMAGE_EXTENSIONS }] });
    const paths = (Array.isArray(selected) ? selected : selected ? [selected] : []).filter((path) => !pages.some((page) => page.key === path));
    if (paths.length === 0) return;
    const added = byName(paths.map((path) => ({ key: path, name: fileName(path), src: null })));
    setPages((current) => [...current, ...added]);
    setTitle((current) => current || folderName(paths[0]));
    // Previews arrive a few at a time, so a long book shows its first pages at once.
    for (let start = 0; start < added.length; start += PREVIEW_BATCH) {
      const batch = added.slice(start, start + PREVIEW_BATCH).map((page) => page.key);
      const previews = await api.imagePreviews(batch).catch(() => batch.map(() => null));
      const found = new Map(batch.map((key, index) => [key, previews[index]]));
      setPages((current) => current.map((page) => (found.has(page.key) ? { ...page, src: found.get(page.key) ?? null } : page)));
    }
  };

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const id = await api.bookFromImages({ title, category, paths: pages.map((page) => page.key), mode });
      libraryChanged(queryClient);
      onOpenChange(false);
      void navigate({ to: "/item/$id", params: { id: String(id) } });
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };

  const bookCategories = categories.data?.filter((c) => c.handler === "book" || c.handler === "comic" || c.handler === "generic") ?? [];
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      wide
      title="Book from images"
      description="Choose photos or scans of a book's pages, put them in reading order, and they become one item."
      footer={
        <>
          <button type="button" className="btn" onClick={() => onOpenChange(false)}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={busy || pages.length === 0 || !title.trim()} onClick={() => void create()}>
            {busy ? "Creating…" : `Create book${pages.length ? ` · ${pages.length} pages` : ""}`}
          </button>
        </>
      }
    >
      <div className="field-row three">
        <Field label="Title">
          <input className="input" value={title} onChange={(event) => setTitle(event.target.value)} />
        </Field>
        <Field label="Category">
          <select className="select" value={category} onChange={(event) => setCategory(event.target.value)}>
            {bookCategories.map((c) => (
              <option key={c.key} value={c.key}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Files">
          <select className="select" value={mode} onChange={(event) => setMode(event.target.value as ImportMode)}>
            <option value="reference">Keep them where they are</option>
            <option value="copy">Copy into the library folder</option>
          </select>
        </Field>
      </div>
      <div className="arranger-toolbar">
        <button type="button" className="btn btn-sm" onClick={() => void choose()}>
          <ImagePlus size={15} /> {pages.length ? "Add more images…" : "Choose images…"}
        </button>
        <button type="button" className="btn btn-sm" disabled={pages.length < 2} onClick={() => setPages(byName(pages))}>
          <ArrowDownAZ size={15} /> Sort by file name
        </button>
        {pages.length > 1 && <span className="hint">Drag a page to its place, or use its arrows.</span>}
      </div>
      {pages.length > 0 ? <PageArranger pages={pages} onChange={setPages} /> : <p className="hint">No pages yet.</p>}
      {error && <div className="dialog-error">{error}</div>}
    </Dialog>
  );
}

/** Reorders the pages of a book made of images, or takes pages out of it. */
export function ArrangePagesDialog({ item, version, open, onOpenChange }: {
  item: ItemDetail;
  version: VersionInfo;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const initial = () => version.files.map((file, index) => ({ key: String(file.id), name: fileName(file.path), src: pageUrl(version.id, index, 240) }));
  const [pages, setPages] = useState<ArrangedPage[]>(initial);
  const [trash, setTrash] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPages(initial());
    setTrash(false);
    setBusy(false);
    setError(null);
  }, [open]);

  const removed = version.files.filter((file) => !pages.some((page) => page.key === String(file.id)));
  const managedRemoved = removed.filter((file) => file.storage === "managed").length;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.pagesArrange(version.id, pages.map((page) => Number(page.key)), trash);
      libraryChanged(queryClient);
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
      wide
      title="Arrange pages"
      description={`Put the pages of “${item.title}” in reading order. Pages you take out stay on your computer.`}
      footer={
        <>
          <button type="button" className="btn" onClick={() => onOpenChange(false)}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={busy || pages.length === 0} onClick={() => void save()}>
            {busy ? "Saving…" : "Save order"}
          </button>
        </>
      }
    >
      <div className="arranger-toolbar">
        <button type="button" className="btn btn-sm" disabled={pages.length < 2} onClick={() => setPages(byName(pages))}>
          <ArrowDownAZ size={15} /> Sort by file name
        </button>
        <span className="hint">
          {pages.length} pages{removed.length ? ` · ${removed.length} taken out` : ""}
        </span>
      </div>
      <PageArranger pages={pages} onChange={setPages} />
      {managedRemoved > 0 && (
        <label className="choice">
          <input type="checkbox" checked={trash} onChange={(event) => setTrash(event.target.checked)} />
          <span>
            <strong>Move the copies of taken-out pages to the Recycle Bin</strong>
            <span className="hint">
              {managedRemoved === 1 ? "One of them is a copy" : `${managedRemoved} of them are copies`} Digitify made in the library folder. Otherwise they stay there.
            </span>
          </span>
        </label>
      )}
      {error && <div className="dialog-error">{error}</div>}
    </Dialog>
  );
}

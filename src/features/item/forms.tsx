import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { FilePlus, FolderPlus, Plus, X } from "lucide-react";
import { api, errorText, type Handler, type ImportMode, type ItemDetail, type PersonInput, type VersionInfo, type VersionInput } from "../../lib/api";
import { usePreferences } from "../../lib/preferences";
import { CONDITIONS, CREATOR_ROLE, formatLabel, PHYSICAL_FORMATS } from "../../lib/format";
import { libraryChanged, useCategories } from "../../lib/queries";
import { Dialog, Field } from "../../components/common";
import { CustomFieldInputs, customValues, fromText, toText } from "./customFields";

const ROLES = ["author", "writer", "artist", "director", "translator", "editor", "narrator", "creator"];

/** Text fields stored in an item's metadata, per kind of category. */
const METADATA_FIELDS: Record<Handler, { key: string; label: string }[]> = {
  book: [
    { key: "publisher", label: "Publisher" },
    { key: "isbn", label: "ISBN" },
    { key: "language", label: "Language" },
  ],
  comic: [
    { key: "series", label: "Series" },
    { key: "volume", label: "Volume" },
    { key: "number", label: "Issue / chapter" },
    { key: "publisher", label: "Publisher" },
  ],
  video: [
    { key: "series", label: "Series" },
    { key: "season", label: "Season" },
    { key: "episode", label: "Episode" },
  ],
  audio: [{ key: "genre", label: "Genre" }],
  generic: [],
};

function str(value: unknown): string {
  return value == null ? "" : String(value);
}

function blankToNull(value: string): string | null {
  return value.trim() ? value.trim() : null;
}

function PeopleEditor({ people, onChange }: { people: PersonInput[]; onChange: (people: PersonInput[]) => void }) {
  return (
    <div className="field">
      <span>People</span>
      {people.map((person, index) => (
        <div key={index} style={{ display: "flex", gap: 8 }}>
          <input
            className="input"
            aria-label="Name"
            placeholder="Name"
            value={person.name}
            onChange={(event) => onChange(people.map((p, i) => (i === index ? { ...p, name: event.target.value } : p)))}
          />
          <select
            className="select"
            aria-label="Role"
            style={{ width: 150 }}
            value={person.role}
            onChange={(event) => onChange(people.map((p, i) => (i === index ? { ...p, role: event.target.value } : p)))}
          >
            {ROLES.map((role) => (
              <option key={role} value={role}>
                {role[0].toUpperCase() + role.slice(1)}
              </option>
            ))}
          </select>
          <button type="button" className="icon-btn" aria-label="Remove person" onClick={() => onChange(people.filter((_, i) => i !== index))}>
            <X size={16} />
          </button>
        </div>
      ))}
      <button type="button" className="btn btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => onChange([...people, { name: "", role: people[0]?.role ?? "author" }])}>
        <Plus size={14} /> Add person
      </button>
    </div>
  );
}

export function EditItemDialog({ item, open, onOpenChange }: { item: ItemDetail; open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const categories = useCategories();
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [year, setYear] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [people, setPeople] = useState<PersonInput[]>([]);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const categoryInfo = categories.data?.find((c) => c.key === category);
  const customFields = categoryInfo?.fields ?? [];

  useEffect(() => {
    if (!open) return;
    setTitle(item.title);
    setSubtitle(item.subtitle ?? "");
    setYear(item.year ? String(item.year) : "");
    setCategory(item.category);
    setDescription(item.description ?? "");
    setPeople(item.people.map(({ name, role }) => ({ name, role })));
    const metadata = item.metadata ?? {};
    setFields({
      ...Object.fromEntries(Object.values(METADATA_FIELDS).flat().map(({ key }) => [key, str(metadata[key])])),
      readingDirection: str(metadata.readingDirection),
    });
    const stored = customValues(item.metadata);
    const definitions = categories.data?.flatMap((c) => c.fields) ?? [];
    setCustom(Object.fromEntries(definitions.map((field) => [field.key, toText(field, stored[field.key])])));
    setError(null);
    // Only when the dialog opens: later category changes must not reset what's being typed.
  }, [open, item]);

  const handler = categoryInfo?.handler ?? item.handler;
  const defaultDirection = categoryInfo?.settings.readingDirection ?? (category === "manga" ? "rtl" : "ltr");

  const save = async () => {
    const metadata: Record<string, unknown> = { ...(item.metadata ?? {}) };
    for (const { key } of METADATA_FIELDS[handler]) {
      const value = blankToNull(fields[key] ?? "");
      if (value === null) delete metadata[key];
      else metadata[key] = value;
    }
    if (handler === "comic") metadata.readingDirection = fields.readingDirection || defaultDirection;
    const values = { ...customValues(item.metadata) };
    try {
      for (const field of customFields) {
        const value = fromText(field, custom[field.key] ?? "");
        if (value === undefined) delete values[field.key];
        else values[field.key] = value;
      }
    } catch (reason) {
      setError(errorText(reason));
      return;
    }
    if (Object.keys(values).length) metadata.custom = values;
    else delete metadata.custom;
    const parsedYear = year.trim() ? Number(year) : null;
    if (parsedYear !== null && (!Number.isInteger(parsedYear) || parsedYear < 0 || parsedYear > 3000)) {
      setError("Year should be a whole number, like 1927.");
      return;
    }
    try {
      await api.itemUpdate(item.id, {
        title,
        subtitle: blankToNull(subtitle),
        year: parsedYear,
        description: blankToNull(description),
        category,
        people: people.filter((p) => p.name.trim()),
        metadata,
      });
      libraryChanged(queryClient);
      onOpenChange(false);
    } catch (reason) {
      setError(errorText(reason));
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      wide
      title="Edit details"
      description="Changes are saved in your library only. Your media files are never modified."
      footer={
        <>
          <button type="button" className="btn" onClick={() => onOpenChange(false)}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void save()}>
            Save
          </button>
        </>
      }
    >
      <div className="field-row">
        <Field label="Title">
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="Subtitle">
          <input className="input" value={subtitle} onChange={(e) => setSubtitle(e.target.value)} />
        </Field>
      </div>
      <div className="field-row">
        <Field label="Category">
          <select className="select" value={category} onChange={(e) => setCategory(e.target.value)}>
            {categories.data?.map((c) => (
              <option key={c.key} value={c.key}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Year">
          <input className="input" inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value)} />
        </Field>
      </div>
      <PeopleEditor people={people} onChange={setPeople} />
      {METADATA_FIELDS[handler].length > 0 && (
        <div className="field-row">
          {METADATA_FIELDS[handler].map(({ key, label }) => (
            <Field key={key} label={label}>
              <input className="input" value={fields[key] ?? ""} onChange={(e) => setFields({ ...fields, [key]: e.target.value })} />
            </Field>
          ))}
        </div>
      )}
      {handler === "comic" && (
        <Field label="Reading direction">
          <select
            className="select"
            value={fields.readingDirection || defaultDirection}
            onChange={(e) => setFields({ ...fields, readingDirection: e.target.value })}
          >
            <option value="ltr">Left to right (Western)</option>
            <option value="rtl">Right to left (manga)</option>
          </select>
        </Field>
      )}
      <CustomFieldInputs fields={customFields} values={custom} onChange={setCustom} />
      <Field label="Description">
        <textarea className="textarea" value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      {error && <div className="dialog-error">{error}</div>}
    </Dialog>
  );
}

interface CopyFields {
  format: string;
  edition: string;
  condition: string;
  location: string;
  acquiredAt: string;
  notes: string;
}

const EMPTY_COPY: CopyFields = { format: "", edition: "", condition: "", location: "", acquiredAt: "", notes: "" };

function CopyEditor({ handler, value, onChange }: { handler: Handler; value: CopyFields; onChange: (value: CopyFields) => void }) {
  const set = (key: keyof CopyFields) => (event: { target: { value: string } }) => onChange({ ...value, [key]: event.target.value });
  return (
    <>
      <div className="field-row">
        <Field label="Format">
          <select className="select" value={value.format} onChange={set("format")}>
            {PHYSICAL_FORMATS[handler].map((format) => (
              <option key={format} value={format}>
                {formatLabel(format)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Edition">
          <input className="input" placeholder="e.g. First edition, Steelbook" value={value.edition} onChange={set("edition")} />
        </Field>
      </div>
      <div className="field-row">
        <Field label="Condition">
          <select className="select" value={value.condition} onChange={set("condition")}>
            <option value="">Not recorded</option>
            {CONDITIONS.map((condition) => (
              <option key={condition} value={condition}>
                {condition}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Acquired">
          <input className="input" type="date" value={value.acquiredAt} onChange={set("acquiredAt")} />
        </Field>
      </div>
      <Field label="Storage location">
        <input className="input" placeholder="e.g. Living room, shelf B2" value={value.location} onChange={set("location")} />
      </Field>
      <Field label="Notes">
        <textarea className="textarea" style={{ minHeight: 70 }} value={value.notes} onChange={set("notes")} />
      </Field>
    </>
  );
}

function toInput(fields: CopyFields): Omit<VersionInput, "kind" | "id" | "itemId"> {
  return {
    format: blankToNull(fields.format),
    edition: blankToNull(fields.edition),
    condition: blankToNull(fields.condition),
    location: blankToNull(fields.location),
    acquiredAt: blankToNull(fields.acquiredAt),
    notes: blankToNull(fields.notes),
  };
}

/** Add or edit a physical copy (format, edition, condition, location). */
export function PhysicalCopyDialog({
  item,
  version,
  onClose,
}: {
  item: ItemDetail;
  version: VersionInfo | "new" | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [fields, setFields] = useState<CopyFields>(EMPTY_COPY);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (version === null) return;
    setError(null);
    setFields(
      version === "new"
        ? { ...EMPTY_COPY, format: PHYSICAL_FORMATS[item.handler][0] }
        : {
            format: version.format ?? PHYSICAL_FORMATS[item.handler][0],
            edition: version.edition ?? "",
            condition: version.condition ?? "",
            location: version.location ?? "",
            acquiredAt: version.acquiredAt ?? "",
            notes: version.notes ?? "",
          },
    );
  }, [version, item.handler]);

  const save = async () => {
    try {
      await api.versionSave({
        id: version === "new" || version === null ? null : version.id,
        itemId: item.id,
        kind: "physical",
        ...toInput(fields),
      });
      libraryChanged(queryClient);
      onClose();
    } catch (reason) {
      setError(errorText(reason));
    }
  };

  return (
    <Dialog
      open={version !== null}
      onOpenChange={(open) => !open && onClose()}
      title={version === "new" ? "Add a physical copy" : "Edit physical copy"}
      description={`A copy of “${item.title}” that you own on the shelf.`}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void save()}>
            Save copy
          </button>
        </>
      }
    >
      <CopyEditor handler={item.handler} value={fields} onChange={setFields} />
      {error && <div className="dialog-error">{error}</div>}
    </Dialog>
  );
}

/** Catalog an item you own physically, before (or without) any digital copy. */
export function CatalogDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const categories = useCategories();
  const [category, setCategory] = useState("books");
  const [title, setTitle] = useState("");
  const [creator, setCreator] = useState("");
  const [year, setYear] = useState("");
  const [copy, setCopy] = useState<CopyFields>(EMPTY_COPY);
  const [error, setError] = useState<string | null>(null);
  const handler = categories.data?.find((c) => c.key === category)?.handler ?? "book";

  useEffect(() => {
    if (open) {
      setTitle("");
      setCreator("");
      setYear("");
      setError(null);
    }
  }, [open]);

  useEffect(() => setCopy((current) => ({ ...current, format: PHYSICAL_FORMATS[handler][0] })), [handler]);

  const save = async () => {
    const parsedYear = year.trim() ? Number(year) : null;
    if (parsedYear !== null && !Number.isInteger(parsedYear)) {
      setError("Year should be a whole number, like 1927.");
      return;
    }
    try {
      const id = await api.itemCreate(
        {
          title,
          subtitle: null,
          year: parsedYear,
          description: null,
          category,
          people: creator.trim() ? [{ name: creator, role: CREATOR_ROLE[handler].role }] : [],
          metadata: {},
        },
        { kind: "physical", ...toInput(copy) },
      );
      libraryChanged(queryClient);
      onOpenChange(false);
      void navigate({ to: "/item/$id", params: { id: String(id) } });
    } catch (reason) {
      setError(errorText(reason));
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      wide
      title="Catalog a physical item"
      description="Record something you own on the shelf. You can add its digital files later from the item's page."
      footer={
        <>
          <button type="button" className="btn" onClick={() => onOpenChange(false)}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={!title.trim()} onClick={() => void save()}>
            Add to library
          </button>
        </>
      }
    >
      <div className="field-row three">
        <Field label="Category">
          <select className="select" value={category} onChange={(e) => setCategory(e.target.value)}>
            {categories.data?.map((c) => (
              <option key={c.key} value={c.key}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={CREATOR_ROLE[handler].label}>
          <input className="input" value={creator} onChange={(e) => setCreator(e.target.value)} />
        </Field>
        <Field label="Year">
          <input className="input" inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value)} />
        </Field>
      </div>
      <Field label="Title">
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
      </Field>
      <div className="eyebrow" style={{ marginTop: 6 }}>
        Your copy
      </div>
      <CopyEditor handler={handler} value={copy} onChange={setCopy} />
      {error && <div className="dialog-error">{error}</div>}
    </Dialog>
  );
}

/** Adds files (a scan, an ebook, a rip) as a digital copy of this item. */
export function AttachFilesDialog({ item, open, onOpenChange }: { item: ItemDetail; open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const { preferences } = usePreferences();
  const [paths, setPaths] = useState<string[]>([]);
  const [mode, setMode] = useState<ImportMode>("reference");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setPaths([]);
      setMode(preferences.importMode === "copy" ? "copy" : "reference");
      setError(null);
      setBusy(false);
    }
  }, [open, preferences.importMode]);

  const pick = async (directory: boolean) => {
    const selected = await openDialog({ multiple: true, directory, title: directory ? "Choose a folder" : "Choose files" });
    const list = Array.isArray(selected) ? selected : selected ? [selected] : [];
    if (list.length) setPaths(list);
  };

  const attach = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.itemAttachFiles(item.id, paths, mode);
      libraryChanged(queryClient);
      onOpenChange(false);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };

  const names = paths.map((path) => path.split(/[\\/]/).filter(Boolean).pop() ?? path);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add digital files"
      description={`Files you choose become a digital copy of “${item.title}”, next to any physical copies.`}
      footer={
        <>
          <button type="button" className="btn" onClick={() => onOpenChange(false)}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={busy || paths.length === 0} onClick={() => void attach()}>
            {busy ? "Adding…" : "Add files"}
          </button>
        </>
      }
    >
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" className="btn" onClick={() => void pick(false)}>
          <FilePlus size={16} /> Choose files…
        </button>
        <button type="button" className="btn" onClick={() => void pick(true)}>
          <FolderPlus size={16} /> Choose a folder…
        </button>
      </div>
      {paths.length > 0 && (
        <p className="hint">
          {names.slice(0, 4).join(", ")}
          {names.length > 4 ? ` and ${names.length - 4} more` : ""}
        </p>
      )}
      <label className="choice">
        <input type="radio" name="attach-mode" checked={mode === "reference"} onChange={() => setMode("reference")} />
        <span>
          <strong>Keep files where they are</strong>
          <span className="hint">Nothing is copied or moved.</span>
        </span>
      </label>
      <label className="choice">
        <input type="radio" name="attach-mode" checked={mode === "copy"} onChange={() => setMode("copy")} />
        <span>
          <strong>Copy into the library folder</strong>
          <span className="hint">The originals stay untouched.</span>
        </span>
      </label>
      {error && <div className="dialog-error">{error}</div>}
    </Dialog>
  );
}

/** Removing never deletes files on its own; copies inside the library folder can optionally go to the Recycle Bin (D-009). */
export function RemoveItemDialog({ item, open, onOpenChange }: { item: ItemDetail; open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [trash, setTrash] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const managed = item.versions.flatMap((v) => v.files).filter((f) => f.storage === "managed").length;

  useEffect(() => {
    if (open) {
      setTrash(false);
      setError(null);
    }
  }, [open]);

  const remove = async () => {
    try {
      const report = await api.itemRemove([item.id], trash);
      if (report.errors.length) {
        setError(`Removed from the library, but some copies couldn't be moved to the Recycle Bin: ${report.errors.join("; ")}`);
        libraryChanged(queryClient);
        return;
      }
      onOpenChange(false);
      libraryChanged(queryClient);
      void navigate({ to: "/library/$scope", params: { scope: item.category } });
    } catch (reason) {
      setError(errorText(reason));
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Remove “${item.title}”?`}
      description="Its details, copies and progress are removed from Digitify. Files on your computer are not deleted."
      footer={
        <>
          <button type="button" className="btn" onClick={() => onOpenChange(false)}>
            Cancel
          </button>
          <button type="button" className="btn btn-danger solid" onClick={() => void remove()}>
            Remove from library
          </button>
        </>
      }
    >
      {managed > 0 && (
        <label className="checkbox">
          <input type="checkbox" checked={trash} onChange={(e) => setTrash(e.target.checked)} />
          Also move the {managed === 1 ? "copy" : `${managed} copies`} Digitify made in the library folder to the Recycle Bin
        </label>
      )}
      {error && <div className="dialog-error">{error}</div>}
    </Dialog>
  );
}

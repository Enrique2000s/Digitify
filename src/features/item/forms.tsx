import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Plus, X } from "lucide-react";
import { api, errorText, type Handler, type ItemDetail, type PersonInput } from "../../lib/api";
import { libraryChanged, useCategories } from "../../lib/queries";
import { Dialog, Field } from "../../components/common";

/** Disc formats a film or series in Movies & Series can come from (D-029). */
export const DISC_FORMATS: [string, string][] = [
  ["", "None"],
  ["dvd", "DVD"],
  ["bluray", "Blu-ray"],
  ["uhd-bluray", "4K UHD Blu-ray"],
  ["bluray-3d", "3D Blu-ray"],
];

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
  image: [],
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
  const [error, setError] = useState<string | null>(null);
  const categoryInfo = categories.data?.find((c) => c.key === category);

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
      discFormat: str(metadata.discFormat),
    });
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
    if (category === "video" && fields.discFormat) metadata.discFormat = fields.discFormat;
    else delete metadata.discFormat;
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
        {/* An item stays in its category (D-126). */}
        <Field label="Category">
          <p className="field-static">{categories.data?.find((c) => c.key === category)?.name ?? category}</p>
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
      {category === "video" && (
        <Field label="Disc format" hint="The disc this copy came from; shown as the case band on its cover.">
          <select className="select" value={fields.discFormat ?? ""} onChange={(e) => setFields({ ...fields, discFormat: e.target.value })}>
            {DISC_FORMATS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field label="Description">
        <textarea className="textarea" value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      {error && <div className="dialog-error">{error}</div>}
    </Dialog>
  );
}

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

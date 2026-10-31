import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Plus, Trash, X } from "lucide-react";
import { api, errorText, type Category, type FieldKind, type Handler } from "../../lib/api";
import { plural } from "../../lib/format";
import { libraryChanged, useCategories } from "../../lib/queries";
import { CATEGORY_ICONS, CategoryIcon, Dialog, Field, Switch } from "../../components/common";

const KINDS: { value: Handler; label: string }[] = [
  { value: "book", label: "Books and documents (ebooks, PDFs, scans)" },
  { value: "comic", label: "Comics and manga (page by page)" },
  { value: "video", label: "Movies and video" },
  { value: "audio", label: "Music and audio" },
  { value: "generic", label: "Anything else (catalog only)" },
];

const FIELD_KINDS: { value: FieldKind; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "longtext", label: "Long text" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "rating", label: "Rating (1–5 stars)" },
  { value: "boolean", label: "Yes / no" },
  { value: "choice", label: "Choice from a list" },
  { value: "url", label: "Web address" },
];

interface EditableField {
  uid: number;
  key: string | null;
  label: string;
  kind: FieldKind;
  choices: string;
}

function CategoryDialog({ category, onClose }: { category: Category | "new" | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const categories = useCategories();
  const editing = category && category !== "new" ? category : null;
  const open = category !== null;
  const nextUid = useRef(0);
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("folder");
  const [handler, setHandler] = useState<Handler>("generic");
  const [direction, setDirection] = useState<"ltr" | "rtl">("ltr");
  const [fields, setFields] = useState<EditableField[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [moveTo, setMoveTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(editing?.name ?? "");
    setIcon(editing?.icon ?? "folder");
    setHandler(editing?.handler ?? "generic");
    setDirection(editing?.settings.readingDirection === "rtl" ? "rtl" : "ltr");
    setFields(
      (editing?.fields ?? []).map((field) => ({ uid: nextUid.current++, key: field.key, label: field.label, kind: field.kind, choices: field.choices.join(", ") })),
    );
    setDeleting(false);
    setMoveTo("");
    setError(null);
    setBusy(false);
  }, [open, editing]);

  const update = (uid: number, change: Partial<EditableField>) => setFields((list) => list.map((field) => (field.uid === uid ? { ...field, ...change } : field)));
  const shift = (index: number, delta: number) =>
    setFields((list) => {
      const next = [...list];
      [next[index], next[index + delta]] = [next[index + delta], next[index]];
      return next;
    });

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      libraryChanged(queryClient);
      onClose();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    run(() => {
      const input = {
        name,
        icon,
        handler: editing ? null : handler,
        readingDirection: direction,
        fields: fields.map((field) => ({
          key: field.key,
          label: field.label,
          kind: field.kind,
          choices: field.kind === "choice" ? field.choices.split(",").map((c) => c.trim()).filter(Boolean) : [],
        })),
      };
      return editing ? api.categoryUpdate(editing.key, input) : api.categoryCreate(input);
    });

  const others = categories.data?.filter((c) => c.key !== editing?.key) ?? [];
  const kind = editing?.handler ?? handler;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && onClose()}
      wide
      title={editing ? `Edit “${editing.name}”` : "New category"}
      description={editing?.isBuiltin ? "A built-in category: you can rename it, change its icon and add your own fields." : undefined}
      footer={
        <>
          {editing && !editing.isBuiltin && (
            <button type="button" className="btn btn-danger" style={{ marginRight: "auto" }} onClick={() => setDeleting(true)}>
              <Trash size={15} /> Delete category…
            </button>
          )}
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={busy || !name.trim()} onClick={() => void save()}>
            {editing ? "Save" : "Create category"}
          </button>
        </>
      }
    >
      <div className="field-row">
        <Field label="Name">
          <input className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Board games, Vinyl, Magazines" autoFocus />
        </Field>
        <Field label="Kind of media" hint={editing ? "Fixed once a category exists." : "Decides which reader or player opens its items."}>
          <select className="select" value={kind} disabled={!!editing} onChange={(event) => setHandler(event.target.value as Handler)}>
            {KINDS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {kind === "comic" && (
        <Field label="Reading direction">
          <select className="select" value={direction} onChange={(event) => setDirection(event.target.value as "ltr" | "rtl")}>
            <option value="ltr">Left to right (Western)</option>
            <option value="rtl">Right to left (manga)</option>
          </select>
        </Field>
      )}
      <div className="field">
        <span>Icon</span>
        <div className="icon-picker" role="radiogroup" aria-label="Icon">
          {Object.keys(CATEGORY_ICONS).map((key) => (
            <button key={key} type="button" role="radio" aria-checked={icon === key} aria-label={key} title={key} onClick={() => setIcon(key)}>
              <CategoryIcon icon={key} size={20} />
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span>Custom fields</span>
        {fields.length === 0 && <p className="hint">Add your own details to fill in for each item, like “Players”, “Condition” or “Where I bought it”.</p>}
        {fields.map((field, index) => (
          <div key={field.uid} className="field-editor">
            <input className="input" aria-label="Field name" placeholder="Field name" value={field.label} onChange={(event) => update(field.uid, { label: event.target.value })} />
            <select className="select" aria-label="Field type" value={field.kind} onChange={(event) => update(field.uid, { kind: event.target.value as FieldKind })}>
              {FIELD_KINDS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <button type="button" className="icon-btn" aria-label={`Move ${field.label || "field"} up`} disabled={index === 0} onClick={() => shift(index, -1)}>
              <ArrowUp size={15} />
            </button>
            <button type="button" className="icon-btn" aria-label={`Move ${field.label || "field"} down`} disabled={index === fields.length - 1} onClick={() => shift(index, 1)}>
              <ArrowDown size={15} />
            </button>
            <button type="button" className="icon-btn" aria-label={`Remove ${field.label || "field"}`} onClick={() => setFields((list) => list.filter((f) => f.uid !== field.uid))}>
              <X size={15} />
            </button>
            {field.kind === "choice" && (
              <input
                className="input choices"
                aria-label="Choices"
                placeholder="Choices, separated by commas: Mint, Good, Worn"
                value={field.choices}
                onChange={(event) => update(field.uid, { choices: event.target.value })}
              />
            )}
          </div>
        ))}
        <button
          type="button"
          className="btn btn-sm"
          style={{ alignSelf: "flex-start" }}
          onClick={() => setFields((list) => [...list, { uid: nextUid.current++, key: null, label: "", kind: "text", choices: "" }])}
        >
          <Plus size={14} /> Add field
        </button>
        {editing && <small className="hint">Removing a field hides it; values already filled in are kept and come back if you add it again.</small>}
      </div>
      {deleting && editing && (
        <div className="notice danger" role="alert" style={{ flexDirection: "column" }}>
          <strong>Delete “{editing.name}”?</strong>
          {editing.itemCount > 0 ? (
            <>
              <span>
                It holds {plural(editing.itemCount, "item")}. They aren't deleted: choose the category they move to, with their
                collections.
              </span>
              <select className="select" aria-label="Move items to" value={moveTo} onChange={(event) => setMoveTo(event.target.value)}>
                <option value="">Choose a category…</option>
                {others.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.name}
                  </option>
                ))}
              </select>
            </>
          ) : (
            <span>It's empty, so nothing else changes.</span>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              className="btn btn-sm btn-danger solid"
              disabled={busy || (editing.itemCount > 0 && !moveTo)}
              onClick={() => void run(() => api.categoryDelete(editing.key, moveTo || null))}
            >
              Delete category
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setDeleting(false)}>
              Keep it
            </button>
          </div>
        </div>
      )}
      {error && <div className="dialog-error">{error}</div>}
    </Dialog>
  );
}

/** Settings › Categories: order and visibility (Home tiles and section pills), and the editor. */
export function CategoriesPanel() {
  const queryClient = useQueryClient();
  const categories = useCategories();
  const [editing, setEditing] = useState<Category | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const list = categories.data ?? [];

  const arrange = async (order: Category[]) => {
    setError(null);
    try {
      await api.categoriesArrange(
        order.map((c) => c.key),
        order.filter((c) => c.isHidden).map((c) => c.key),
      );
      libraryChanged(queryClient);
    } catch (reason) {
      setError(errorText(reason));
    }
  };
  const move = (index: number, delta: number) => {
    const order = [...list];
    [order[index], order[index + delta]] = [order[index + delta], order[index]];
    void arrange(order);
  };

  return (
    <section className="panel" id="categories">
      <div className="panel-head">
        <h2>Categories</h2>
        <button type="button" className="btn btn-sm" onClick={() => setEditing("new")}>
          <Plus size={15} /> New category
        </button>
      </div>
      <p className="hint" style={{ marginBottom: 10 }}>
        This order is the order of the tiles on Home and of the section buttons. Hidden categories keep their items, which still
        appear in Everything and in search.
      </p>
      <ul className="category-list">
        {list.map((category, index) => (
          <li key={category.key} className={category.isHidden ? "hidden" : undefined}>
            <span className="category-icon">
              <CategoryIcon icon={category.icon} size={20} />
            </span>
            <span className="label">
              <strong>{category.name}</strong>
              <span className="muted">
                {plural(category.itemCount, "item")}
                {category.fields.length > 0 && ` · ${plural(category.fields.length, "custom field")}`}
                {!category.isBuiltin && " · added by you"}
              </span>
            </span>
            <button type="button" className="icon-btn" aria-label={`Move ${category.name} up`} disabled={index === 0} onClick={() => move(index, -1)}>
              <ArrowUp size={16} />
            </button>
            <button type="button" className="icon-btn" aria-label={`Move ${category.name} down`} disabled={index === list.length - 1} onClick={() => move(index, 1)}>
              <ArrowDown size={16} />
            </button>
            <Switch
              checked={!category.isHidden}
              label={`Show ${category.name}`}
              onChange={(shown) => void arrange(list.map((c) => (c.key === category.key ? { ...c, isHidden: !shown } : c)))}
            />
            <button type="button" className="btn btn-sm" onClick={() => setEditing(category)}>
              Edit
            </button>
          </li>
        ))}
      </ul>
      {error && <div className="dialog-error">{error}</div>}
      <CategoryDialog category={editing} onClose={() => setEditing(null)} />
    </section>
  );
}

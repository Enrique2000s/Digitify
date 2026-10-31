import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Sparkles, X } from "lucide-react";
import { api, errorText, type SmartCondition, type SmartRules } from "../../lib/api";
import { FORMAT_LABELS, plural } from "../../lib/format";
import { libraryChanged, useCategories, useTags } from "../../lib/queries";
import { Dialog, Field } from "../../components/common";

type Input = "category" | "type" | "tag" | "year" | "text" | "format" | "yesno" | "progress" | "days" | "ownership" | "none";

/** What a rule can look at, the ways it can compare, and the value it takes. */
const FIELDS: Record<string, { label: string; ops: [string, string][]; input: Input; initial: string }> = {
  category: { label: "Category", ops: [["is", "is"], ["isNot", "is not"]], input: "category", initial: "" },
  type: { label: "Kind of media", ops: [["is", "is"], ["isNot", "is not"]], input: "type", initial: "book" },
  tag: { label: "Tags", ops: [["has", "include"], ["hasNot", "don't include"]], input: "tag", initial: "" },
  year: { label: "Year", ops: [["is", "is"], ["before", "is before"], ["after", "is after"], ["between", "is between"]], input: "year", initial: String(new Date().getFullYear()) },
  creator: { label: "Creator", ops: [["contains", "contains"], ["notContains", "doesn't contain"]], input: "text", initial: "" },
  title: { label: "Title", ops: [["contains", "contains"], ["startsWith", "starts with"], ["notContains", "doesn't contain"]], input: "text", initial: "" },
  format: { label: "Format", ops: [["is", "is"], ["isNot", "is not"]], input: "format", initial: "epub" },
  progress: { label: "Progress", ops: [["is", "is"]], input: "progress", initial: "notStarted" },
  favorite: { label: "Favorite", ops: [["is", "is"]], input: "yesno", initial: "yes" },
  ownership: { label: "Copies", ops: [["is", "are"]], input: "ownership", initial: "physical" },
  added: { label: "Added", ops: [["withinDays", "in the last"], ["olderThanDays", "more than"]], input: "days", initial: "30" },
  opened: { label: "Last opened", ops: [["withinDays", "in the last"], ["never", "never"]], input: "days", initial: "30" },
};

const SORTS: [string, string][] = [
  ["title", "Title"],
  ["added", "Recently added"],
  ["opened", "Recently opened"],
  ["year", "Year (newest first)"],
  ["creator", "Creator"],
];

export const EMPTY_RULES: SmartRules = { any: false, conditions: [], limit: null, sort: "title" };

function newCondition(field: string, categories: string[]): SmartCondition {
  const def = FIELDS[field];
  return { field, op: def.ops[0][0], value: def.input === "category" ? (categories[0] ?? "") : def.initial, value2: def.input === "year" ? def.initial : null };
}

function ValueInput({ condition, onChange }: { condition: SmartCondition; onChange: (change: Partial<SmartCondition>) => void }) {
  const categories = useCategories();
  const tags = useTags();
  const input = FIELDS[condition.field]?.input ?? "text";
  const set = (value: string) => onChange({ value });
  switch (input) {
    case "category":
      return (
        <select className="select" value={condition.value} onChange={(event) => set(event.target.value)} aria-label="Category">
          {categories.data?.map((category) => (
            <option key={category.key} value={category.key}>
              {category.name}
            </option>
          ))}
        </select>
      );
    case "type":
      return (
        <select className="select" value={condition.value} onChange={(event) => set(event.target.value)} aria-label="Kind of media">
          <option value="book">Books</option>
          <option value="comic">Comics and manga</option>
          <option value="video">Movies and series</option>
          <option value="audio">Music</option>
        </select>
      );
    case "tag":
      return (
        <>
          <input className="input" list="smart-tags" placeholder="Tag" value={condition.value} onChange={(event) => set(event.target.value)} aria-label="Tag" />
          <datalist id="smart-tags">
            {tags.data?.map((tag) => <option key={tag.id} value={tag.name} />)}
          </datalist>
        </>
      );
    case "year":
      return (
        <span className="smart-pair">
          <input className="input" type="number" min={0} max={9999} value={condition.value} onChange={(event) => set(event.target.value)} aria-label="Year" />
          {condition.op === "between" && (
            <>
              and
              <input className="input" type="number" min={0} max={9999} value={condition.value2 ?? ""} onChange={(event) => onChange({ value2: event.target.value })} aria-label="Last year" />
            </>
          )}
        </span>
      );
    case "format":
      return (
        <select className="select" value={condition.value} onChange={(event) => set(event.target.value)} aria-label="Format">
          {Object.entries(FORMAT_LABELS).map(([code, label]) => (
            <option key={code} value={code}>
              {label}
            </option>
          ))}
        </select>
      );
    case "yesno":
      return (
        <select className="select" value={condition.value} onChange={(event) => set(event.target.value)} aria-label="Favorite">
          <option value="yes">yes</option>
          <option value="no">no</option>
        </select>
      );
    case "progress":
      return (
        <select className="select" value={condition.value} onChange={(event) => set(event.target.value)} aria-label="Progress">
          <option value="notStarted">not started</option>
          <option value="inProgress">in progress</option>
          <option value="finished">finished</option>
        </select>
      );
    case "ownership":
      return (
        <select className="select" value={condition.value} onChange={(event) => set(event.target.value)} aria-label="Copies">
          <option value="physical">on the shelf</option>
          <option value="digital">digital</option>
          <option value="physicalOnly">on the shelf, not digitized</option>
          <option value="digitalOnly">digital only</option>
        </select>
      );
    case "days":
      return condition.op === "never" ? null : (
        <span className="smart-pair">
          <input className="input" type="number" min={1} max={36500} value={condition.value} onChange={(event) => set(event.target.value)} aria-label="Days" />
          days
        </span>
      );
    default:
      return <input className="input" placeholder="Text" value={condition.value} onChange={(event) => set(event.target.value)} aria-label={FIELDS[condition.field]?.label} />;
  }
}

/** Creates or edits a smart shelf: a shelf that fills itself from rules (D-023). */
export function SmartShelfDialog({
  open,
  onOpenChange,
  shelf,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shelf?: { id: number; name: string; description: string | null; rules: SmartRules | null };
}) {
  const queryClient = useQueryClient();
  const categories = useCategories();
  const keys = categories.data?.map((category) => category.key) ?? [];
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [rules, setRules] = useState<SmartRules>(EMPTY_RULES);
  const [count, setCount] = useState<{ value: number | null; error: string | null }>({ value: null, error: null });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(shelf?.name ?? "");
    setDescription(shelf?.description ?? "");
    setRules(shelf?.rules ?? { ...EMPTY_RULES, conditions: [newCondition("progress", keys)] });
    setError(null);
  }, [open, shelf]);

  // How many items match, a moment after each change.
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      api.smartCount(rules).then(
        (value) => setCount({ value, error: null }),
        (reason) => setCount({ value: null, error: errorText(reason) }),
      );
    }, 250);
    return () => window.clearTimeout(timer);
  }, [open, rules]);

  const change = (index: number, patch: Partial<SmartCondition>) =>
    setRules((current) => ({ ...current, conditions: current.conditions.map((c, i) => (i === index ? { ...c, ...patch } : c)) }));
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const input = { name: name.trim(), description: description.trim() || null, rules };
      if (shelf) await api.shelfUpdate(shelf.id, input);
      else await api.shelfCreate(input);
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
      title={shelf ? "Edit smart shelf" : "New smart shelf"}
      description="A shelf that fills itself: everything that matches its rules, kept up to date as your library changes."
      wide
      footer={
        <>
          <span className={`smart-count${count.error ? " error" : ""}`} role="status">
            <Sparkles size={15} aria-hidden /> {count.error ?? (count.value == null ? " " : `${plural(count.value, "item matches", "items match")}`)}
          </span>
          <button type="button" className="btn" onClick={() => onOpenChange(false)}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={busy || !name.trim() || !!count.error} onClick={() => void save()}>
            {shelf ? "Save" : "Create smart shelf"}
          </button>
        </>
      }
    >
      <div className="smart-form">
        <Field label="Name">
          <input className="input" value={name} placeholder="e.g. Manga I haven't started" onChange={(event) => setName(event.target.value)} autoFocus />
        </Field>
        <Field label="Description (optional)">
          <input className="input" value={description} onChange={(event) => setDescription(event.target.value)} />
        </Field>
        <div className="smart-match">
          Items that match
          <select className="select" value={rules.any ? "any" : "all"} onChange={(event) => setRules({ ...rules, any: event.target.value === "any" })} aria-label="Match">
            <option value="all">all</option>
            <option value="any">any</option>
          </select>
          of these rules:
        </div>
        <div className="smart-rules">
          {rules.conditions.length === 0 && <p className="smart-none">No rules: everything in the library.</p>}
          {rules.conditions.map((condition, index) => (
            <div key={index} className="smart-rule">
              <select
                className="select"
                value={condition.field}
                aria-label="What to look at"
                onChange={(event) => change(index, newCondition(event.target.value, keys))}
              >
                {Object.entries(FIELDS).map(([field, def]) => (
                  <option key={field} value={field}>
                    {def.label}
                  </option>
                ))}
              </select>
              <select className="select" value={condition.op} aria-label="How to compare" onChange={(event) => change(index, { op: event.target.value })}>
                {FIELDS[condition.field]?.ops.map(([op, label]) => (
                  <option key={op} value={op}>
                    {label}
                  </option>
                ))}
              </select>
              <ValueInput condition={condition} onChange={(patch) => change(index, patch)} />
              <button
                type="button"
                className="icon-btn"
                aria-label="Remove this rule"
                onClick={() => setRules({ ...rules, conditions: rules.conditions.filter((_, i) => i !== index) })}
              >
                <X size={16} />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="btn btn-sm smart-add"
            disabled={rules.conditions.length >= 20}
            onClick={() => setRules({ ...rules, conditions: [...rules.conditions, newCondition("category", keys)] })}
          >
            <Plus size={15} /> Add a rule
          </button>
        </div>
        <div className="smart-options">
          <label className="inline">
            Order
            <select className="select" value={rules.sort ?? "title"} onChange={(event) => setRules({ ...rules, sort: event.target.value })}>
              {SORTS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="inline">
            <input type="checkbox" checked={rules.limit != null} onChange={(event) => setRules({ ...rules, limit: event.target.checked ? 20 : null })} />
            Only the first
            <input
              className="input smart-limit"
              type="number"
              min={1}
              max={10000}
              disabled={rules.limit == null}
              value={rules.limit ?? 20}
              onChange={(event) => setRules({ ...rules, limit: Math.max(1, Math.min(10000, Number(event.target.value) || 1)) })}
            />
            items
          </label>
        </div>
      </div>
      {error && <div className="dialog-error">{error}</div>}
    </Dialog>
  );
}

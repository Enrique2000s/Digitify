import type { FieldDef } from "../../lib/api";
import { date } from "../../lib/format";
import { Field } from "../../components/common";

// Custom fields (defined per category in Settings › Categories) keep their values in each item's
// `metadata.custom`, keyed by the field's key.

export type CustomValues = Record<string, unknown>;

export function customValues(metadata: Record<string, unknown> | null): CustomValues {
  const custom = metadata?.custom;
  return custom && typeof custom === "object" && !Array.isArray(custom) ? (custom as CustomValues) : {};
}

/** A stored value as text for display, or null when there is nothing to show. */
export function formatCustom(field: FieldDef, value: unknown): string | null {
  if (value == null || value === "") return null;
  switch (field.kind) {
    case "boolean":
      return value === true ? "Yes" : value === false ? "No" : null;
    case "rating": {
      const stars = Math.max(0, Math.min(5, Math.round(Number(value))));
      return stars ? "★".repeat(stars) + "☆".repeat(5 - stars) : null;
    }
    case "date":
      return date(String(value));
    default:
      return String(value);
  }
}

/** The editable text form of a stored value. */
export function toText(field: FieldDef, value: unknown): string {
  if (value == null) return "";
  if (field.kind === "boolean") return value === true ? "yes" : value === false ? "no" : "";
  return String(value);
}

/** Converts the edited text back to a stored value; `undefined` removes it. Throws a readable message. */
export function fromText(field: FieldDef, text: string): unknown {
  const value = text.trim();
  if (!value) return undefined;
  switch (field.kind) {
    case "number": {
      const number = Number(value.replace(",", "."));
      if (!Number.isFinite(number)) throw new Error(`“${field.label}” should be a number.`);
      return number;
    }
    case "rating":
      return Number(value);
    case "boolean":
      return value === "yes";
    default:
      return value;
  }
}

function Input({ field, value, onChange }: { field: FieldDef; value: string; onChange: (value: string) => void }) {
  switch (field.kind) {
    case "longtext":
      return <textarea className="textarea" style={{ minHeight: 70 }} value={value} onChange={(event) => onChange(event.target.value)} />;
    case "number":
      return <input className="input" inputMode="decimal" value={value} onChange={(event) => onChange(event.target.value)} />;
    case "date":
      return <input className="input" type="date" value={value} onChange={(event) => onChange(event.target.value)} />;
    case "url":
      return <input className="input" type="url" placeholder="https://" value={value} onChange={(event) => onChange(event.target.value)} />;
    case "rating":
      return (
        <select className="select" value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="">Not rated</option>
          {[1, 2, 3, 4, 5].map((stars) => (
            <option key={stars} value={stars}>
              {"★".repeat(stars) + "☆".repeat(5 - stars)}
            </option>
          ))}
        </select>
      );
    case "boolean":
      return (
        <select className="select" value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="">Not set</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
      );
    case "choice":
      return (
        <select className="select" value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="">Not set</option>
          {field.choices.map((choice) => (
            <option key={choice} value={choice}>
              {choice}
            </option>
          ))}
          {value && !field.choices.includes(value) && <option value={value}>{value}</option>}
        </select>
      );
    default:
      return <input className="input" value={value} onChange={(event) => onChange(event.target.value)} />;
  }
}

/** Inputs for a category's custom fields; long text spans the whole row. */
export function CustomFieldInputs({ fields, values, onChange }: { fields: FieldDef[]; values: Record<string, string>; onChange: (values: Record<string, string>) => void }) {
  if (fields.length === 0) return null;
  return (
    <div className="field-row">
      {fields.map((field) => (
        <div key={field.key} style={field.kind === "longtext" ? { gridColumn: "1 / -1" } : undefined}>
          <Field label={field.label}>
            <Input field={field} value={values[field.key] ?? ""} onChange={(value) => onChange({ ...values, [field.key]: value })} />
          </Field>
        </div>
      ))}
    </div>
  );
}

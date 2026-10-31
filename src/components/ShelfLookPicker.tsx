import { usePreferences, type ShelfLook } from "../lib/preferences";

export const SHELF_LOOKS: { value: ShelfLook; name: string }[] = [
  { value: "breeze", name: "Breeze" },
  { value: "wood", name: "Wood" },
  { value: "glass", name: "Glass" },
  { value: "metal", name: "Dark metal" },
];

/** What the shelf view's shelves are made of (D-023), as cards with a small picture of each. */
export function ShelfLookPicker({ onPick }: { onPick?: () => void }) {
  const { preferences, update } = usePreferences();
  return (
    <div className="look-picker" role="group" aria-label="Shelf material">
      {SHELF_LOOKS.map((look) => (
        <button
          key={look.value}
          type="button"
          className="look-card"
          aria-pressed={preferences.shelfLook === look.value}
          onClick={() => {
            update({ shelfLook: look.value });
            onPick?.();
          }}
        >
          <span className={`shelf-swatch swatch-${look.value}`} aria-hidden>
            <i />
            <i />
            <i />
            <b />
          </span>
          {look.name}
        </button>
      ))}
    </div>
  );
}

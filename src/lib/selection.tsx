import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { useGridDragProps } from "./gridDrag";

/** Multi-select in the library views, for bulk edits. */
export interface Selection {
  active: boolean;
  selected: ReadonlySet<number>;
  /** Toggles one item; with `range`, selects everything between the last toggled item and this one. */
  toggle: (id: number, index: number, range: boolean) => void;
  set: (ids: Iterable<number>) => void;
  start: () => void;
  stop: () => void;
}

const Context = createContext<Selection | null>(null);

export const SelectionProvider = Context.Provider;

/** The current view's selection, or null outside a library view. */
export const useSelection = () => useContext(Context);

export function useSelectionState(cache: { get(index: number): { id: number } | undefined }): Selection {
  const [active, setActive] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set());
  const anchor = useRef<number | null>(null);

  const toggle = useCallback(
    (id: number, index: number, range: boolean) => {
      const from = anchor.current;
      setSelected((current) => {
        const next = new Set(current);
        if (range && from !== null) {
          const [first, last] = from < index ? [from, index] : [index, from];
          for (let i = first; i <= last; i++) {
            const item = cache.get(i);
            // Collections among the items (negative ids) aren't selectable.
            if (item && item.id > 0) next.add(item.id);
          }
        } else if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      if (!range) anchor.current = index;
    },
    [cache],
  );

  const stop = useCallback(() => {
    setActive(false);
    setSelected(new Set());
    anchor.current = null;
  }, []);

  return useMemo(
    () => ({ active, selected, toggle, set: (ids: Iterable<number>) => setSelected(new Set(ids)), start: () => setActive(true), stop }),
    [active, selected, toggle, stop],
  );
}

/** Click handling for a card or row: toggles selection instead of opening the item while selecting. */
export function useSelectable(id: number, index: number | undefined) {
  const selection = useSelection();
  // In a custom order, a card can also be dragged to a new place (when the view allows it).
  const drag = useGridDragProps(index != null ? id : 0);
  const selecting = !!selection?.active && index != null;
  const checked = selecting && selection.selected.has(id);
  const onClick = (event: React.MouseEvent) => {
    if (!selecting || !selection || index == null) return;
    event.preventDefault();
    selection.toggle(id, index, event.shiftKey);
  };
  return {
    selecting,
    checked,
    props: selecting ? { onClick, role: "checkbox", "aria-checked": checked, "data-selected": checked || undefined } : drag,
  };
}

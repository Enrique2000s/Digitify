import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, GripVertical } from "lucide-react";
import { api, errorText, type Category } from "../../lib/api";
import { plural } from "../../lib/format";
import { keys, libraryChanged, useCategories } from "../../lib/queries";
import { arrayMove, useReorder } from "../../lib/reorder";
import { CategoryIcon, Switch } from "../../components/common";

/** Settings › Categories: order and visibility (Home tiles and section pills). Categories are fixed (D-039). */
export function CategoriesPanel() {
  const queryClient = useQueryClient();
  const categories = useCategories();
  const [error, setError] = useState<string | null>(null);
  const list = categories.data ?? [];

  const arrange = async (order: Category[]) => {
    setError(null);
    // Shown at once; the library catches up behind it.
    queryClient.setQueryData(keys.categories, order);
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
  const move = (index: number, delta: number) => void arrange(arrayMove(list, index, index + delta));
  const order = useReorder((from, to) => void arrange(arrayMove(list, from, to)));

  return (
    <section className="panel" id="categories">
      <h2>Categories</h2>
      <p className="hint" style={{ marginBottom: 10 }}>
        Drag categories (or use the arrows) to set the order of the tiles on Home and of the section buttons. Hidden categories keep their items, which still
        appear in Everything and in search. The categories themselves are fixed, so the library keeps its structure.
      </p>
      <ul ref={order.listRef} className="category-list">
        {list.map((category, index) => (
          <li key={category.key} className={category.isHidden ? "hidden" : undefined} data-reorder style={order.style(index)}>
            <span {...order.handle(index)} aria-label={`Drag ${category.name}`}>
              <GripVertical size={18} />
            </span>
            <span className="category-icon">
              <CategoryIcon icon={category.icon} size={20} />
            </span>
            <span className="label">
              <strong>{category.name}</strong>
              <span className="muted">
                {plural(category.itemCount, "item")}
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
          </li>
        ))}
      </ul>
      {error && <div className="dialog-error">{error}</div>}
    </section>
  );
}

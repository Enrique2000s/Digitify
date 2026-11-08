import { ArrowDown, ArrowUp, GripVertical } from "lucide-react";
import { arrayMove, useReorder } from "../../lib/reorder";
import { usePreferences, type ArcadeFilter } from "../../lib/preferences";
import { Switch } from "../../components/common";
import { arcadeFilters, FILTER_LABELS } from "../arcade/shared";
import { Setting } from "./Setting";

/** Settings › Arcade (D-038): the views' order, which ones show, and one "All games" or two. */
export function ArcadeSettings() {
  const { preferences, update } = usePreferences();
  const arcade = preferences.arcade;
  // The rows in their order, hidden ones included; "all" stands for the two All views when combined.
  const rows = arcadeFilters(arcade, true);

  const arrange = (next: ArcadeFilter[]) =>
    update((c) => {
      // Back to the saved order: "all" expands into the two All views, and views this system
      // doesn't have keep their place after the one before them.
      const expanded = next.flatMap((f): ArcadeFilter[] => (f === "all" ? ["all-pc", "all-roms"] : [f]));
      const order = [...expanded];
      c.arcade.filterOrder.forEach((filter, index) => {
        if (order.includes(filter)) return;
        const before = c.arcade.filterOrder.slice(0, index).reverse().find((f) => order.includes(f));
        order.splice(before ? order.indexOf(before) + 1 : 0, 0, filter);
      });
      return { arcade: { ...c.arcade, filterOrder: order } };
    });
  const move = (index: number, delta: number) => arrange(arrayMove(rows, index, index + delta));
  const order = useReorder((from, to) => arrange(arrayMove(rows, from, to)));
  const show = (filter: ArcadeFilter, shown: boolean) =>
    update((c) => {
      const hidden = c.arcade.hiddenFilters.filter((f) => f !== filter);
      return { arcade: { ...c.arcade, hiddenFilters: shown ? hidden : [...hidden, filter] } };
    });

  return (
    <section className="panel" id="arcade">
      <h2>Arcade</h2>
      <Setting
        title="While a game runs"
        text={
          arcade.whilePlaying === "quit"
            ? "Digitify closes once the game starts and stays closed until you open it again. Time played isn't counted, since Digitify isn't running."
            : arcade.whilePlaying === "hide"
              ? "Digitify hides and goes silent, then comes back when the game ends."
              : "Digitify stays open and silences its music until the game ends; you can turn the music back on (or off again) meanwhile."
        }
      >
        <select
          className="select"
          style={{ width: 260 }}
          aria-label="While a game runs"
          value={arcade.whilePlaying}
          onChange={(event) => update((c) => ({ arcade: { ...c.arcade, whilePlaying: event.target.value as typeof arcade.whilePlaying } }))}
        >
          <option value="stay">Stay open and mute the music</option>
          <option value="hide">Hide, and come back after</option>
          <option value="quit">Close Digitify completely</option>
        </select>
      </Setting>
      <Setting title="One “All games” view" text="Show your PC games and your ROM games together in one view, instead of “All PC games” and “All ROM games”.">
        <Switch checked={arcade.combineAll} label="Combine All PC games and All ROM games" onChange={(combineAll) => update((c) => ({ arcade: { ...c.arcade, combineAll } }))} />
      </Setting>
      <p className="hint" style={{ margin: "14px 0 10px" }}>
        Drag the views (or use the arrows) to set the order of Arcade's buttons; switch off the ones you don't use.
      </p>
      <ul ref={order.listRef} className="category-list">
        {rows.map((filter, index) => {
          const hidden = arcade.hiddenFilters.includes(filter);
          const label = FILTER_LABELS[filter];
          return (
            <li key={filter} className={hidden ? "hidden" : undefined} data-reorder style={order.style(index)}>
              <span {...order.handle(index)} aria-label={`Drag ${label}`}>
                <GripVertical size={18} />
              </span>
              <span className="label">
                <strong>{label}</strong>
              </span>
              <button type="button" className="icon-btn" aria-label={`Move ${label} up`} disabled={index === 0} onClick={() => move(index, -1)}>
                <ArrowUp size={16} />
              </button>
              <button type="button" className="icon-btn" aria-label={`Move ${label} down`} disabled={index === rows.length - 1} onClick={() => move(index, 1)}>
                <ArrowDown size={16} />
              </button>
              <Switch checked={!hidden} label={`Show ${label}`} onChange={(shown) => show(filter, shown)} />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

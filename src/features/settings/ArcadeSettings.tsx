import { ArrowDown, ArrowUp, GripVertical } from "lucide-react";
import { arrayMove, useReorder } from "../../lib/reorder";
import { usePreferences, type ArcadeFilter } from "../../lib/preferences";
import { Switch } from "../../components/common";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errorText } from "../../lib/api";
import { addProgramGame, arcadeFilters, FILTER_LABELS, filledFilters } from "../arcade/shared";
import { Setup } from "../arcade/ArcadePage";
import { Setting } from "./Setting";

/** Settings › Arcade (D-038): the views' order, which ones show, and one "All games" or two. */
export function ArcadeSettings() {
  const { preferences, update } = usePreferences();
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: ["arcade-status"], queryFn: api.arcadeStatus });
  const [addError, setAddError] = useState<string | null>(null);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["arcade-games"] });
    void queryClient.invalidateQueries({ queryKey: ["arcade-status"] });
  };
  const addGame = async () => {
    setAddError(null);
    try {
      if ((await addProgramGame(preferences.arcade.downloadCovers)) != null) refresh();
    } catch (reason) {
      setAddError(errorText(reason));
    }
  };
  const arcade = preferences.arcade;
  // The rows in their order, hidden ones included; "all" stands for the two All views when combined.
  // A store or console without games has no view to arrange (D-101).
  const games = useQuery({ queryKey: ["arcade-games"], queryFn: api.arcadeGames });
  const rows = arcadeFilters(arcade, true, filledFilters(games.data));

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
      <Setting title="One “All games” view" text="Show your PC games and your ROM games together in one view, instead of “PC games” and “ROM games”.">
        <Switch checked={arcade.combineAll} label="Combine PC games and ROM games" onChange={(combineAll) => update((c) => ({ arcade: { ...c.arcade, combineAll } }))} />
      </Setting>
      <p className="hint" style={{ margin: "14px 0 10px" }}>
        Drag the views (or use the arrows) to set the order of Arcade's buttons; switch off the ones you don't use. A store or console shows here once Arcade has one of its games.
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
      <LaunchBoxSetting />
      <SteamGridDbSetting />
      {/* Emulators & folders here too (D-124): the same panel as in Arcade. */}
      <h3 className="settings-subtitle">Emulators &amp; folders</h3>
      {status.data && <Setup status={status.data} onChanged={refresh} onAddProgram={() => void addGame()} />}
      {addError && <p className="notice danger">{addError}</p>}
    </section>
  );
}

/**
 * SteamGridDB (D-128): its community's box art for any game by its name, with the user's own key.
 * The key is checked with SteamGridDB, then kept on this computer; it can be removed.
 */
function SteamGridDbSetting() {
  const status = useQuery({ queryKey: ["steamgriddb"], queryFn: api.arcadeSteamGridDbStatus });
  const queryClient = useQueryClient();
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (value: string | null) => {
    setBusy(true);
    setError(null);
    try {
      await api.arcadeSteamGridDbSet(value);
      setKey("");
      void queryClient.invalidateQueries({ queryKey: ["steamgriddb"] });
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Setting
      title="Covers from SteamGridDB"
      text={
        <>
          Box art from SteamGridDB's community for any game, found by its name (emulated games too), in Find covers and for games without a cover. It needs your own free key: sign in at
          SteamGridDB, then Preferences › API. The key stays on this computer and goes only to SteamGridDB. A launcher's own cover still comes first.
          {error && <span className="setting-error"> {error}</span>}
        </>
      }
    >
      {status.data ? (
        <div className="steamgriddb-row">
          <span className="steamgriddb-ok">Key saved</span>
          <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void save(null)}>
            Remove
          </button>
        </div>
      ) : (
        <form
          className="steamgriddb-row"
          onSubmit={(event) => {
            event.preventDefault();
            if (key.trim()) void save(key);
          }}
        >
          <input className="input" type="password" autoComplete="off" placeholder="Your API key" value={key} onChange={(event) => setKey(event.target.value)} aria-label="SteamGridDB API key" />
          <button type="submit" className="btn btn-sm btn-primary" disabled={busy || !key.trim()}>
            {busy ? "Checking…" : "Save"}
          </button>
          <button type="button" className="btn btn-sm" onClick={() => void api.arcadeSteamGridDbOpen().catch((reason) => setError(errorText(reason)))}>
            Get a key
          </button>
        </form>
      )}
    </Setting>
  );
}

/**
 * LaunchBox Games Database (D-131): its front boxes for nearly every console and PC game, by name.
 * Its database is downloaded once (about 110 MB) and searched on this computer; no account.
 */
function LaunchBoxSetting() {
  const status = useQuery({ queryKey: ["launchbox"], queryFn: api.arcadeLaunchBoxStatus });
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      void queryClient.invalidateQueries({ queryKey: ["launchbox"] });
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };
  const here = status.data;
  return (
    <Setting
      title="Covers from LaunchBox Games Database"
      text={
        <>
          Front boxes for nearly every console's games and PC games, found by name, in Find covers and for games without a cover. Its database is downloaded once (about 110 MB) and searched on
          this computer; no account. Only the cover chosen is downloaded.
          {here && ` ${here.games.toLocaleString()} games, downloaded ${new Date(here.updated).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}.`}
          {busy && " Downloading and preparing it: a minute or two."}
          {error && <span className="setting-error"> {error}</span>}
        </>
      }
    >
      <div className="steamgriddb-row">
        {here ? (
          <>
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void run(api.arcadeLaunchBoxDownload)}>
              {busy ? "Downloading…" : "Refresh"}
            </button>
            <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void run(api.arcadeLaunchBoxRemove)}>
              Remove
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => void run(api.arcadeLaunchBoxDownload)}>
            {busy ? "Downloading…" : "Download (110 MB)"}
          </button>
        )}
      </div>
    </Setting>
  );
}

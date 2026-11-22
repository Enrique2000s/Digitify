import { useState } from "react";
import { Marquee } from "../../components/Marquee";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { AppWindow, CheckCircle2, ChevronDown, CircleSlash, CircleAlert, Clock, FolderPlus, ImageDown, LoaderCircle, Pencil, RefreshCw, RotateCcw, X } from "lucide-react";
import { api, errorText, onLinux, type ArcadeEmulator, type ArcadeEmulatorStatus, type ArcadeFolder, type ArcadeGame, type ArcadeStatus } from "../../lib/api";
import { usePreferences } from "../../lib/preferences";
import { Dialog, Switch } from "../../components/common";
import { EmulatorMark, LogoMark } from "./logos";
import { PLATFORM_NAMES, playTime, listOf, scanSummary } from "./shared";

/** Emulators & folders (D-113): launchers, emulators, consoles, and folders and covers, in tabs. */

type SetupTab = "launchers" | "emulators" | "consoles" | "folders";

/** Emulators & folders' groups of emulators, by the maker of the consoles they play (D-113). */
const EMULATOR_GROUPS: { name: string; keys: ArcadeEmulator[] }[] = [
  { name: "Nintendo", keys: ["dolphin", "cemu", "ryujinx", "project64", "rmg", "melonds", "desmume", "azahar", "mgba", "nestopia", "fceux", "snes9x", "zsnes"] },
  { name: "Sony", keys: ["duckstation", "pcsx2", "rpcs3", "ppsspp"] },
  { name: "Sega", keys: ["fusion", "flycast", "nulldc"] },
  { name: "Microsoft", keys: ["xemu", "xenia"] },
  { name: "Many consoles", keys: ["mesen", "ares", "retroarch"] },
];

/**
 * Emulators & folders (D-113): everything Arcade finds games with, in four tabs. Launchers (the
 * stores and programs added by hand), Emulators (grouped by maker, one row each, its folders
 * opening beneath it), Consoles (which emulator plays each console) and Folders & covers.
 */
export function Setup({ status, onChanged, onAddProgram }: { status: ArcadeStatus; onChanged: () => void; onAddProgram: () => void }) {
  const [tab, setTab] = useState<SetupTab>("launchers");
  const [error, setError] = useState<string | null>(null);
  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
      onChanged();
    } catch (reason) {
      setError(errorText(reason));
    }
  };
  const games = useQuery({ queryKey: ["arcade-games"], queryFn: api.arcadeGames });
  const storesFound = status.stores.filter((s) => s.found).length;
  const available = status.emulators.filter((e) => e.available);
  const emulatorsFound = available.filter((e) => e.found).length;
  const tabs: [SetupTab, string, string | null][] = [
    ["launchers", "Launchers", `${storesFound}`],
    ["emulators", "Emulators", `${emulatorsFound} of ${available.length}`],
    ["consoles", "Consoles", null],
    ["folders", "Folders & covers", null],
  ];
  return (
    <section className="arcade-setup" aria-label="Emulators and folders">
      <div className="segmented arcade-setup-tabs" role="tablist" aria-label="Emulators and folders">
        {tabs.map(([key, label, count]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} aria-pressed={tab === key} onClick={() => setTab(key)}>
            {label}
            {count != null && <span className="count">{count}</span>}
          </button>
        ))}
      </div>
      {tab === "launchers" && <LaunchersTab status={status} games={games.data} onRun={run} onAddProgram={onAddProgram} />}
      {tab === "emulators" && <EmulatorsTab status={status} onRun={run} />}
      {tab === "consoles" && <ConsolesTab status={status} games={games.data} />}
      {tab === "folders" && <FoldersTab status={status} games={games.data} onRun={run} />}
      {error && <p className="notice danger">{error}</p>}
    </section>
  );
}

function LaunchersTab({ status, games, onRun, onAddProgram }: { status: ArcadeStatus; games: ArcadeGame[] | undefined; onRun: Run; onAddProgram: () => void }) {
  const byHand = (games ?? []).filter((g) => g.platform === "pc" && !g.store && !g.missing).length;
  return (
    <div className="arcade-setup-pane">
      <p className="muted">Each store's installed games, following what you install or remove; each starts through its store.</p>
      <ul className="arcade-rows">
        {status.stores.map((store) => (
          <li key={store.key} className={store.found ? "found" : "absent"}>
            {store.found ? <CheckCircle2 size={16} className="ok" /> : <CircleAlert size={16} className="warn" />}
            <LogoMark name={store.key} className="setup-logo" />
            <strong>{store.name}</strong>
            <span className="muted">{store.found ? `${store.games} installed ${store.games === 1 ? "game" : "games"}` : "not found on this computer"}</span>
            {store.key === "steam" && store.found && <SteamHoursButton onRun={onRun} />}
          </li>
        ))}
        <li className="found">
          <AppWindow size={16} className="ok" />
          <strong>Added by you</strong>
          <span className="muted">{byHand === 1 ? "1 program" : `${byHand} programs`}</span>
          <button type="button" className="btn btn-sm" onClick={onAddProgram}>
            Add a game…
          </button>
        </li>
      </ul>
      {status.hidden > 0 && (
        <p className="arcade-hidden">
          {status.hidden} store {status.hidden === 1 ? "game is" : "games are"} off the list.
          <button type="button" className="btn btn-sm" onClick={() => void onRun(() => api.arcadeUnhide())}>
            Show {status.hidden === 1 ? "it" : "them"} again
          </button>
        </p>
      )}
    </div>
  );
}

/**
 * Steam's hours (D-167): the time Steam has recorded for each of your Steam games, read from Steam's
 * own records, shown first and brought in only when you say so, as time played elsewhere, so each
 * game's total matches Steam's (a game where Digitify counts more keeps its time).
 */
function SteamHoursButton({ onRun }: { onRun: Run }) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const hours = useQuery({ queryKey: ["arcade-steam-hours"], queryFn: api.arcadeSteamHours, enabled: open });
  const queryClient = useQueryClient();
  const list = hours.data ?? [];
  const extra = list.reduce((n, g) => n + g.steamSeconds - g.digitifySeconds, 0);
  const apply = () =>
    onRun(async () => {
      const changed = await api.arcadeSteamHoursApply();
      await queryClient.invalidateQueries({ queryKey: ["arcade-steam-hours"] });
      void queryClient.invalidateQueries({ queryKey: ["stats"] });
      setDone(`${changed} ${changed === 1 ? "game" : "games"} now count Steam's hours.`);
    });
  return (
    <>
      <button
        type="button"
        className="btn btn-sm"
        onClick={() => {
          setDone(null);
          setOpen(true);
        }}
      >
        <Clock size={14} /> Steam's hours…
      </button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Use Steam's hours"
        description="Steam keeps how long you've played each game. Bring that time in as time played elsewhere, so each game's total matches Steam's. Games where Digitify already counts more keep theirs; you can do this again later to add what Steam counts since."
        footer={
          <>
            <button type="button" className="btn" onClick={() => setOpen(false)}>
              {done ? "Close" : "Cancel"}
            </button>
            {!done && (
              <button type="button" className="btn btn-primary" disabled={!list.length} onClick={() => void apply()}>
                Use Steam's hours
              </button>
            )}
          </>
        }
      >
        {done ? (
          <p>{done}</p>
        ) : hours.isLoading ? (
          <p className="muted">Reading Steam's records…</p>
        ) : list.length === 0 ? (
          <p className="muted">Nothing to bring in: every Steam game here already counts at least Steam's time (or Steam hasn't recorded any).</p>
        ) : (
          <>
            <p>
              <b>{playTime(extra)}</b> more over <b>{list.length}</b> {list.length === 1 ? "game" : "games"}.
            </p>
            <ul className="steam-hours">
              {list.slice(0, 40).map((g) => (
                <li key={g.id}>
                  <span>{g.title}</span>
                  <span className="muted">{playTime(g.digitifySeconds)} →</span>
                  <b>{playTime(g.steamSeconds)}</b>
                </li>
              ))}
              {list.length > 40 && <li className="muted">and {list.length - 40} more</li>}
            </ul>
          </>
        )}
      </Dialog>
    </>
  );
}

function EmulatorsTab({ status, onRun }: { status: ArcadeStatus; onRun: Run }) {
  const [open, setOpen] = useState<ArcadeEmulator | null>(null);
  return (
    <div className="arcade-setup-pane">
      <p className="muted">Found where they're usually installed, or pointed to by hand (a portable copy). Their game folders come from their own settings unless you set them here.</p>
      {EMULATOR_GROUPS.map((group) => {
        const rank = (e: ArcadeEmulatorStatus) => (e.found ? 0 : e.ignored ? 2 : 1);
        const emulators = status.emulators.filter((e) => group.keys.includes(e.key)).sort((a, b) => rank(a) - rank(b));
        if (!emulators.length) return null;
        return (
          <div key={group.name} className="arcade-emulator-group">
            <h3>{group.name}</h3>
            <ul className="arcade-rows emulator-rows">
              {emulators.map((emulator) => (
                <EmulatorRow key={emulator.key} emulator={emulator} open={open === emulator.key} onToggle={() => setOpen(open === emulator.key ? null : emulator.key)} onRun={onRun} />
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function ConsolesTab({ status, games }: { status: ArcadeStatus; games: ArcadeGame[] | undefined }) {
  const { preferences, update } = usePreferences();
  const count = (key: string) => (games ?? []).filter((g) => !g.missing && g.platform === key && !g.retroarch).length;
  const name = (key: ArcadeEmulator) => status.emulators.find((e) => e.key === key)?.name ?? key;
  const isFound = (key: ArcadeEmulator) => !!status.emulators.find((e) => e.key === key)?.found;
  // Consoles with games first, then those with an emulator found, then the rest.
  const rows = status.consoles
    .filter((c) => c.players.length > 0)
    .map((c) => ({ ...c, games: count(c.key), found: c.players.filter(isFound) }))
    .sort((a, b) => Number(b.games > 0) - Number(a.games > 0) || Number(b.found.length > 0) - Number(a.found.length > 0));
  return (
    <div className="arcade-setup-pane">
      <p className="muted">Which emulator each console's games open in. Games from RetroArch's playlists always open in RetroArch, with their core.</p>
      <table className="arcade-consoles">
        <thead>
          <tr>
            <th>Console</th>
            <th>Games</th>
            <th>Plays in</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const chosen = preferences.arcade.playsIn[row.key];
            const current = chosen && row.found.includes(chosen) ? chosen : row.found[0];
            return (
              <tr key={row.key} className={row.games > 0 ? "" : "quiet"}>
                <td>
                  <span className="arcade-console-name">
                    <LogoMark name={row.key} className="setup-logo" />
                    {PLATFORM_NAMES[row.key]}
                  </span>
                </td>
                <td>{row.games.toLocaleString()}</td>
                <td>
                  {row.found.length > 1 ? (
                    <select
                      value={current}
                      aria-label={`${PLATFORM_NAMES[row.key]} games play in`}
                      onChange={(event) => update((c) => ({ arcade: { ...c.arcade, playsIn: { ...c.arcade.playsIn, [row.key]: event.target.value as ArcadeEmulator } } }))}
                    >
                      {row.found.map((key) => (
                        <option key={key} value={key}>
                          {name(key)}
                        </option>
                      ))}
                    </select>
                  ) : row.found.length === 1 ? (
                    <strong>{name(row.found[0])}</strong>
                  ) : (
                    <span className="muted">Needs {listOf(row.players.map(name), "or")}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function FoldersTab({ status, games, onRun }: { status: ArcadeStatus; games: ArcadeGame[] | undefined; onRun: Run }) {
  const { preferences, update } = usePreferences();
  // Look for games (D-146): here rather than on Arcade's page, beside the folders it looks in.
  const [scanning, setScanning] = useState(false);
  const [scanNote, setScanNote] = useState<string | null>(null);
  const canScan = status.emulators.some((e) => e.found) || status.stores.some((s) => s.found) || status.folders.length > 0;
  const scan = () =>
    onRun(async () => {
      setScanning(true);
      setScanNote(null);
      try {
        setScanNote(scanSummary(await api.arcadeScan(preferences.arcade.downloadCovers)));
      } finally {
        setScanning(false);
      }
    });
  const addFolder = async () => {
    const path = await openDialog({ directory: true, multiple: false, title: "Choose a game folder" });
    if (typeof path === "string") await onRun(() => api.arcadeFolderAdd(path));
  };
  // Covers for every game that has none (D-108): from the emulators and launchers here, and online.
  const bare = (games ?? []).filter((g) => !g.missing && !g.coverKey);
  const [coverNote, setCoverNote] = useState<string | null>(null);
  const findMissing = () =>
    onRun(async () => {
      const queued = await api.arcadeFindCovers(bare.map((g) => g.id), true);
      setCoverNote(queued > 0 ? `Looking for ${queued} ${queued === 1 ? "cover" : "covers"}; they appear as they're found.` : "No cover found for them anywhere Arcade looks.");
    });
  return (
    <div className="arcade-setup-row">
      <div className="arcade-setup-block">
        <h3>More game folders</h3>
        <p className="muted">Searched for every kind of game, besides each emulator's folders.</p>
        {status.folders.length > 0 && (
          <ul className="arcade-folders">
            {status.folders.map((folder) => (
              <li key={folder.id ?? folder.path} className={folder.exists ? "" : "missing"}>
                <span title={folder.path}>{folder.path}</span>
                {!folder.exists && <em>not found</em>}
                <button type="button" className="icon-btn" aria-label={`Remove ${folder.path}`} onClick={() => void onRun(() => api.arcadeFolderRemove(folder.id!))}>
                  <X size={15} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="arcade-scan-row">
          <button type="button" className="btn btn-sm" onClick={() => void addFolder()}>
            <FolderPlus size={15} /> Add a folder…
          </button>
          <button type="button" className="btn btn-sm" disabled={scanning || !canScan} onClick={() => void scan()}>
            {scanning ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />} Look for games
          </button>
        </div>
        <p className="muted arcade-scan-note">{scanNote ?? "Looks again in every emulator's and launcher's folders and these, for games added or gone."}</p>
      </div>
      <div className="arcade-setup-block">
        <h3>Covers</h3>
        <label className="arcade-switch-row">
          <Switch checked={preferences.arcade.downloadCovers} onChange={(on) => update((c) => ({ arcade: { ...c.arcade, downloadCovers: on } }))} label="Download covers" />
          <span>
            Download covers
            <small>
              For each game found: GameCube, Wii, 3DS and Wii U from GameTDB by the game's ID; every console from libretro-thumbnails by the game's name; Steam and GOG games from their stores; other PC games from Steam's store and the Microsoft Store by their name. With LaunchBox's database or a SteamGridDB key (Settings › Arcade), from them too. A launcher's own cover, and the ones on this computer (Dolphin's, RetroArch's), come first.
            </small>
          </span>
        </label>
        <div className="arcade-missing-covers">
          <button type="button" className="btn btn-sm" disabled={bare.length === 0} onClick={() => void findMissing()}>
            <ImageDown size={15} /> Find missing covers
          </button>
          <span className="muted">{coverNote ?? (bare.length === 0 ? "Every game has a cover." : `${bare.length} ${bare.length === 1 ? "game has" : "games have"} no cover yet. This looks online even when downloads are off.`)}</span>
        </div>
      </div>
    </div>
  );
}

export type Run = (action: () => Promise<unknown>) => Promise<void>;

/** "GameCube and Wii"; RetroArch plays its playlists' consoles. */
function consolesOf(emulator: ArcadeEmulatorStatus): string {
  if (emulator.key === "retroarch") return "Many consoles";
  return listOf(emulator.platforms.map((p) => PLATFORM_NAMES[p]), "and");
}

async function locateEmulator(emulator: ArcadeEmulatorStatus, onRun: Run) {
  const path = await openDialog({
    multiple: false,
    title: `Where is ${emulator.name}?`,
    filters: onLinux ? undefined : [{ name: emulator.name, extensions: ["exe"] }],
  });
  if (typeof path === "string") await onRun(() => api.arcadeSetEmulator(emulator.key, path));
}

function LocateButton({ emulator, onRun }: { emulator: ArcadeEmulatorStatus; onRun: Run }) {
  return (
    <button type="button" className="btn btn-sm" onClick={() => void locateEmulator(emulator, onRun)}>
      Locate…
    </button>
  );
}

/** One emulator in the Emulators tab (D-113): found, with its program and folders opening beneath
 *  it; or not found, with Locate… (or "Windows only"). */
function EmulatorRow({ emulator, open, onToggle, onRun }: { emulator: ArcadeEmulatorStatus; open: boolean; onToggle: () => void; onRun: Run }) {
  const locate = () => locateEmulator(emulator, onRun);
  // RetroArch's games come from its playlists, not from folders (D-101).
  const playlists = emulator.key === "retroarch";
  // Folders set in Arcade replace the emulator's own (D-035): any change keeps the whole list here.
  const saveFolders = (folders: ArcadeFolder[]) => onRun(() => api.arcadeEmulatorFolders(emulator.key, folders.map((f) => ({ path: f.path, recursive: f.recursive }))));
  const pickFolder = async (title: string) => {
    const path = await openDialog({ directory: true, multiple: false, title });
    return typeof path === "string" ? path : null;
  };
  const changeFolder = async (index: number) => {
    const path = await pickFolder(`Where are ${emulator.name}'s games?`);
    if (path) await saveFolders(emulator.folders.map((f, i) => (i === index ? { ...f, path, exists: true } : f)));
  };
  const addFolder = async () => {
    const path = await pickFolder(`Add a folder of ${emulator.name} games`);
    if (path) await saveFolders([...emulator.folders, { id: null, path, recursive: true, exists: true }]);
  };
  const folders = emulator.folders.length;
  const summary = playlists ? (folders ? "its playlists" : "no playlists") : folders === 1 ? "1 folder" : `${folders} folders`;
  return (
    <li className={`arcade-emulator-row${emulator.found ? " found" : " absent"}${open && emulator.found ? " open" : ""}${emulator.available ? "" : " unavailable"}${emulator.ignored ? " ignored" : ""}`}>
      <div className="arcade-emulator-line">
        {emulator.found ? <CheckCircle2 size={16} className="ok" /> : emulator.ignored ? <CircleSlash size={16} className="muted" /> : <CircleAlert size={16} className="warn" />}
        <EmulatorMark emulator={emulator.key} name={emulator.name} icon={emulator.icon} />
        <strong>{emulator.name}</strong>
        {/* Every console it plays, its names sliding when they don't fit (D-169). */}
        <Marquee className="muted arcade-emulator-consoles" text={emulator.ignored ? "Not used" : consolesOf(emulator)} />
        {emulator.found ? (
          <button type="button" className="btn btn-sm" aria-expanded={open} onClick={onToggle}>
            {summary} <ChevronDown size={14} className="arcade-chevron" />
          </button>
        ) : emulator.ignored ? (
          // Set aside (D-117): Arcade looks for it again.
          <button type="button" className="btn btn-sm" onClick={() => void onRun(() => api.arcadeIgnoreEmulator(emulator.key, false))}>
            Use again
          </button>
        ) : emulator.available ? (
          <LocateButton emulator={emulator} onRun={onRun} />
        ) : (
          <span className="muted">Windows only</span>
        )}
      </div>
      {emulator.found && open && (
        <div className="arcade-emulator-details">
          <div className="arcade-emulator-program">
            <span className="arcade-emulator-path" title={emulator.found}>{emulator.found}</span>
            <button type="button" className="btn btn-sm" onClick={() => void locate()}>Change…</button>
            {emulator.picked && (
              <button type="button" className="icon-btn" aria-label="Find it automatically" title="Find it automatically" onClick={() => void onRun(() => api.arcadeSetEmulator(emulator.key, null))}>
                <RotateCcw size={15} />
              </button>
            )}
            {/* D-117: one found that isn't wanted is set aside; its games stay, opening in another emulator if there is one. */}
            <button
              type="button"
              className="btn btn-sm"
              title={`Arcade stops using ${emulator.name}: it isn't looked for, its folders aren't searched, and no game opens in it. "Use again" brings it back.`}
              onClick={() => void onRun(() => api.arcadeIgnoreEmulator(emulator.key, true))}
            >
              <CircleSlash size={14} /> Don't use
            </button>
          </div>
          {playlists ? (
            <>
              <p className="arcade-emulator-label">
                Playlists
                <span className="muted"> · each game starts with the core its playlist names</span>
              </p>
              <ul className="arcade-folders small">
                {emulator.folders.map((folder) => (
                  <li key={folder.path} className={folder.exists ? "" : "missing"}>
                    <span title={folder.path}>{folder.path}</span>
                    {!folder.exists && <em>not found</em>}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <>
              <p className="arcade-emulator-label">
                Game folders
                <span className="muted">{emulator.customFolders ? " · set here" : ` · from ${emulator.name}'s settings`}</span>
              </p>
              {emulator.folders.length > 0 ? (
                <ul className="arcade-folders small">
                  {emulator.folders.map((folder, index) => (
                    <li key={folder.path} className={folder.exists ? "" : "missing"}>
                      <span title={folder.path}>{folder.path}</span>
                      {!folder.exists && <em>not found</em>}
                      <button type="button" className="icon-btn" aria-label={`Change ${folder.path}`} title="Change…" onClick={() => void changeFolder(index)}>
                        <Pencil size={14} />
                      </button>
                      <button type="button" className="icon-btn" aria-label={`Remove ${folder.path}`} title="Remove" onClick={() => void saveFolders(emulator.folders.filter((_, i) => i !== index))}>
                        <X size={14} />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">No game folder yet.</p>
              )}
              <div className="arcade-emulator-actions">
                <button type="button" className="btn btn-sm" onClick={() => void addFolder()}>
                  <FolderPlus size={14} /> Add folder…
                </button>
                {emulator.customFolders && (
                  <button type="button" className="btn btn-sm" onClick={() => void onRun(() => api.arcadeEmulatorFolders(emulator.key, null))}>
                    Use {emulator.name}'s folders
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </li>
  );
}

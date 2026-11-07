import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Check, CheckCircle2, CircleAlert, Clock, FolderOpen, FolderPlus, Heart, ImageDown, ImagePlus, Joystick, ListChecks, LoaderCircle, Pencil, Play, RefreshCw, RotateCcw, Search, Settings2, Trash, X } from "lucide-react";
import { api, errorText, onLinux, type ArcadeEmulatorStatus, type ArcadeFolder, type ArcadeGame, type ArcadeStatus } from "../../lib/api";
import { usePreferences } from "../../lib/preferences";
import { GridDragProvider, useGridDragProps } from "../../lib/gridDrag";
import { CardSizeSlider, Dialog, Switch } from "../../components/common";
import { badgeOf, consoleOf, FILTER_LABELS, GameCover, lastPlayed, PLATFORM_ASPECT, PLATFORM_NAMES, playTime, reorderWithin, SORTS, useArcade, useArcadeFilters, useLaunch, useShownGames } from "./shared";

/** `/arcade` (D-034, D-035, D-037): the games of the emulators and stores on this computer, started the way they start. */
export function ArcadePage() {
  const { status, games, starting, notSeen, clearNotSeen } = useArcade();
  const { preferences, update } = usePreferences();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const [setup, setSetup] = useState<boolean | null>(null);
  const [scanning, setScanning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<number>>(new Set());
  const { launch, error, clearError } = useLaunch();
  const shown = useShownGames(games.data, search);
  const view = useArcadeFilters();
  const arcade = preferences.arcade;
  const setArcade = (change: Partial<typeof arcade>) => update((current) => ({ arcade: { ...current.arcade, ...change } }));
  const anyEmulator = (status.data?.emulators.some((e) => e.found) || status.data?.stores.some((s) => s.found)) ?? false;
  // The setup shows by itself until there's an emulator and a game.
  const showSetup = setup ?? (status.data ? !anyEmulator || status.data.games === 0 : false);
  const running = status.data?.running != null ? games.data?.find((g) => g.id === status.data!.running) : undefined;
  const game = selected != null ? games.data?.find((g) => g.id === selected) : undefined;
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["arcade-games"] });
    void queryClient.invalidateQueries({ queryKey: ["arcade-status"] });
  };

  const scan = async () => {
    setScanning(true);
    setNotice(null);
    try {
      const report = await api.arcadeScan(arcade.downloadCovers);
      const parts = [`${report.found} ${report.found === 1 ? "game" : "games"} found`];
      if (report.added) parts.push(`${report.added} new`);
      if (report.missing) parts.push(`${report.missing} missing`);
      if (report.coversQueued) parts.push(`looking for ${report.coversQueued} ${report.coversQueued === 1 ? "cover" : "covers"}`);
      setNotice(parts.join(" · "));
      refresh();
    } catch (reason) {
      setNotice(errorText(reason));
    } finally {
      setScanning(false);
    }
  };

  // The first visit with emulators but no games looks for them once by itself.
  const [autoScanned, setAutoScanned] = useState(false);
  useEffect(() => {
    if (autoScanned || !status.data || !anyEmulator || status.data.games > 0) return;
    setAutoScanned(true);
    void scan();
  });

  // Selecting: Escape leaves it.
  const stopSelecting = () => {
    setSelecting(false);
    setPicked(new Set());
  };
  useEffect(() => {
    if (!selecting) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && stopSelecting();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selecting]);
  const toggle = (id: number) =>
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Custom order: games are dragged into place in any console's view too; the games shown trade
  // places among themselves and the rest keep theirs (D-035, D-037).
  const customOrder = arcade.sort === "custom";
  const canArrange = customOrder && !selecting;
  const drag = canArrange
    ? {
        onDrop: (dragged: number, target: number, after: boolean) => {
          void api
            .arcadeReorder(reorderWithin((games.data ?? []).filter((g) => !g.missing), shown, dragged, target, after))
            .then(refresh)
            .catch((reason) => setNotice(errorText(reason)));
        },
      }
    : null;
  const startingGame = starting ? games.data?.find((g) => g.id === starting.id) : undefined;
  const unseenGame = notSeen != null ? games.data?.find((g) => g.id === notSeen) : undefined;

  return (
    <div className="page arcade-page">
      <header className="arcade-head">
        <div className="arcade-head-title">
          <span className="arcade-logo" aria-hidden>
            <Joystick size={26} strokeWidth={2.3} />
          </span>
          <div>
            <h1 className="display">Arcade</h1>
            <p>Your emulators' and stores' games, each started the way it always starts, with its own settings.</p>
          </div>
        </div>
        <div className="arcade-head-actions">
          <button type="button" className="btn" disabled={scanning || (!anyEmulator && !status.data?.folders.length)} onClick={() => void scan()}>
            {scanning ? <LoaderCircle size={16} className="spin" /> : <RefreshCw size={16} />} Look for games
          </button>
          <button type="button" className="btn glow-when-on" aria-pressed={showSetup} onClick={() => setSetup(!showSetup)}>
            <Settings2 size={16} /> Emulators & folders
          </button>
        </div>
      </header>

      {running && (
        <div className="arcade-running" role="status">
          <span className="arcade-running-dot" aria-hidden />
          <span>
            Playing <strong>{running.title}</strong>. Digitify waits, hidden and quiet, until the game closes.
          </span>
        </div>
      )}
      {startingGame && !running && (
        <div className="arcade-running starting" role="status">
          <LoaderCircle size={16} className="spin" />
          <span>
            Starting <strong>{startingGame.title}</strong> through {starting!.store}. Digitify hides once the game is up.
          </span>
        </div>
      )}
      {unseenGame && (
        <div className="arcade-notice" role="status">
          <span>
            {unseenGame.title} didn't show up, so Digitify stayed open. If it's running, it plays as usual; play time isn't counted this time.
          </span>
          <button type="button" className="icon-btn" aria-label="Dismiss" onClick={clearNotSeen}>
            <X size={15} />
          </button>
        </div>
      )}
      {notice && (
        <div className="arcade-notice" role="status">
          <span>{notice}</span>
          <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => setNotice(null)}>
            <X size={15} />
          </button>
        </div>
      )}
      {error && (
        <div className="arcade-notice error" role="alert">
          <CircleAlert size={16} /> <span>{error}</span>
          <button type="button" className="icon-btn" aria-label="Dismiss" onClick={clearError}>
            <X size={15} />
          </button>
        </div>
      )}

      {showSetup && status.data && <Setup status={status.data} onChanged={refresh} />}

      <div className="arcade-toolbar">
        <div className="segmented" role="group" aria-label="Console">
          {view.filters.map((filter) => (
            <button key={filter} type="button" aria-pressed={view.current === filter} onClick={() => view.choose(filter)}>
              {FILTER_LABELS[filter]}
            </button>
          ))}
        </div>
        <label className="arcade-search">
          <Search size={15} aria-hidden />
          <input type="search" placeholder="Find a game" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Find a game" />
        </label>
        <button type="button" className="btn btn-sm glow-when-on" aria-pressed={selecting} onClick={() => (selecting ? stopSelecting() : setSelecting(true))}>
          <ListChecks size={15} /> Select
        </button>
        <label className="arcade-size">
          <span>Size</span>
          <CardSizeSlider value={arcade.cardSize} onChange={(size) => setArcade({ cardSize: size })} />
        </label>
        <label className="arcade-sort">
          <span>Sort</span>
          <select value={arcade.sort} onChange={(event) => setArcade({ sort: event.target.value as typeof arcade.sort })}>
            {SORTS.map((sort) => (
              <option key={sort.key} value={sort.key}>{sort.label}</option>
            ))}
          </select>
        </label>
      </div>
      {canArrange && shown.length > 1 && <p className="arcade-hint">Drag the games into the order you like{view.current === "all" && !search.trim() ? "" : "; the others keep their places"}.</p>}

      {games.data && shown.length === 0 ? (
        <div className="empty arcade-empty">
          <Joystick size={40} strokeWidth={1.8} />
          <h2>{games.data.length === 0 ? "No games yet" : "No games here"}</h2>
          <p>
            {games.data.length === 0
              ? anyEmulator
                ? "Arcade looks in the game folders set up in your emulators, and in folders you add here. Check them in Emulators & folders, then look for games."
                : `Install Dolphin (GameCube and Wii), Project64 or RMG (Nintendo 64), or games from a store (Steam${onLinux ? " or Heroic" : ", Epic Games or Xbox"}), or point Arcade to your emulators in Emulators & folders.`
              : "Nothing matches this console or search."}
          </p>
        </div>
      ) : (
        <GridDragProvider value={drag}>
          <div className={`arcade-grid${selecting ? " selecting" : ""}${canArrange ? " arranging-in-place" : ""}`} style={{ ["--card" as string]: `${arcade.cardSize}px` }}>
            {shown.map((g) => (
              <GameTile
                key={g.id}
                game={g}
                running={status.data?.running === g.id}
                selecting={selecting}
                checked={picked.has(g.id)}
                onOpen={() => (selecting ? toggle(g.id) : setSelected(g.id))}
                onPlay={() => void launch(g)}
              />
            ))}
          </div>
        </GridDragProvider>
      )}

      {selecting && (
        <BulkBar
          ids={[...picked]}
          total={shown.length}
          onSelectAll={() => setPicked(new Set(shown.map((g) => g.id)))}
          onClear={() => setPicked(new Set())}
          onDone={stopSelecting}
          onNotice={setNotice}
          onChanged={refresh}
        />
      )}
      {game && !selecting && <GamePanel game={game} running={status.data?.running ?? null} onClose={() => setSelected(null)} onPlay={() => void launch(game)} />}
    </div>
  );
}

function GameTile({ game, running, selecting, checked, onOpen, onPlay }: { game: ArcadeGame; running: boolean; selecting: boolean; checked: boolean; onOpen: () => void; onPlay: () => void }) {
  const drag = useGridDragProps(game.id);
  return (
    <div className={`arcade-tile${running ? " running" : ""}${checked ? " checked" : ""}`} data-platform={game.platform} {...drag}>
      <button
        type="button"
        className="arcade-tile-art"
        style={{ aspectRatio: PLATFORM_ASPECT[game.platform] }}
        onClick={onOpen}
        aria-label={`${game.title}, ${consoleOf(game)}`}
        aria-pressed={selecting ? checked : undefined}
        data-blip
      >
        <GameCover game={game} />
        <span className="arcade-badge" data-platform={game.platform} data-store={game.store ?? undefined}>{badgeOf(game)}</span>
        {game.isFavorite && <Heart className="arcade-fav" size={16} fill="currentColor" aria-label="Favorite" />}
        {selecting && <span className={`card-check${checked ? " on" : ""}`} aria-hidden>{checked && <Check size={15} strokeWidth={3.2} />}</span>}
      </button>
      {!selecting && (
        <button type="button" className="arcade-play" aria-label={`Play ${game.title}`} title="Play" onClick={onPlay} data-no-drag>
          <Play size={18} fill="currentColor" />
        </button>
      )}
      <div className="arcade-tile-text">
        <strong title={game.title}>{game.title}</strong>
        <span>{game.playSeconds > 0 ? playTime(game.playSeconds) : consoleOf(game)}</span>
      </div>
    </div>
  );
}

/** What can be done to several selected games at once. */
function BulkBar({
  ids,
  total,
  onSelectAll,
  onClear,
  onDone,
  onNotice,
  onChanged,
}: {
  ids: number[];
  total: number;
  onSelectAll: () => void;
  onClear: () => void;
  onDone: () => void;
  onNotice: (text: string) => void;
  onChanged: () => void;
}) {
  const { preferences } = usePreferences();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try {
      await action();
      onChanged();
      if (done) onNotice(done);
    } catch (reason) {
      onNotice(errorText(reason));
    } finally {
      setBusy(false);
    }
  };
  const none = ids.length === 0;
  return createPortal(
    <>
      <div className="bulk-bar arcade-bulk" role="toolbar" aria-label="Selected games">
        <strong aria-live="polite">{none ? "Select games" : `${ids.length} selected`}</strong>
        {ids.length < total ? (
          <button type="button" className="btn btn-sm btn-ghost" onClick={onSelectAll}>
            Select all {total}
          </button>
        ) : (
          <button type="button" className="btn btn-sm btn-ghost" onClick={onClear}>
            Clear
          </button>
        )}
        <span className="bulk-sep" />
        <button type="button" className="btn btn-sm" disabled={none || busy} onClick={() => void run(() => api.arcadeSetFavoriteMany(ids, true))}>
          <Heart size={15} fill="currentColor" /> Favorite
        </button>
        <button type="button" className="btn btn-sm" disabled={none || busy} onClick={() => void run(() => api.arcadeSetFavoriteMany(ids, false))}>
          <Heart size={15} /> Not favorite
        </button>
        <button
          type="button"
          className="btn btn-sm"
          disabled={none || busy}
          title="Looks for their covers again (pictures you chose stay)"
          onClick={() =>
            void run(
              () => api.arcadeFindCovers(ids, preferences.arcade.downloadCovers),
              preferences.arcade.downloadCovers ? "Looking for covers…" : "Covers updated from Dolphin's cache",
            )
          }
        >
          <ImageDown size={15} /> Find covers
        </button>
        <button type="button" className="btn btn-sm btn-danger" disabled={none || busy} onClick={() => setConfirming(true)}>
          <Trash size={15} /> Remove from Digitify
        </button>
        <span className="bulk-sep" />
        <button type="button" className="btn btn-sm btn-primary" onClick={onDone}>
          Done
        </button>
      </div>
      <Dialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Remove ${ids.length} ${ids.length === 1 ? "game" : "games"} from Digitify?`}
        description="They leave Arcade's list. Files stay where they are and store games stay installed: emulator games come back with a later search if they're still in a game folder; store games stay off until you show them again in Emulators & folders."
        footer={
          <>
            <button type="button" className="btn" onClick={() => setConfirming(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-danger solid"
              onClick={() => {
                setConfirming(false);
                void run(async () => {
                  const removed = await api.arcadeForgetMany(ids);
                  onClear();
                  onNotice(`${removed} ${removed === 1 ? "game" : "games"} removed from Digitify`);
                });
              }}
            >
              Remove
            </button>
          </>
        }
      >
        <span />
      </Dialog>
    </>,
    document.body,
  );
}

function GamePanel({ game, running, onClose, onPlay }: { game: ArcadeGame; running: number | null; onClose: () => void; onPlay: () => void }) {
  const queryClient = useQueryClient();
  const { preferences } = usePreferences();
  const [error, setError] = useState<string | null>(null);
  const [naming, setNaming] = useState<string | null>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["arcade-games"] });
  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
      refresh();
    } catch (reason) {
      setError(errorText(reason));
    }
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && naming == null && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, naming]);
  const changeCover = async () => {
    const path = await openDialog({ multiple: false, title: "Choose a cover", filters: [{ name: "Images", extensions: ["jpg", "jpeg", "png", "webp", "bmp"] }] });
    if (typeof path === "string") await run(() => api.arcadeSetCover(game.id, path));
  };
  const rename = async () => {
    if (naming == null) return;
    await run(() => api.arcadeRename(game.id, naming));
    setNaming(null);
  };
  const pc = game.platform === "pc";
  const emulator = pc ? consoleOf(game) : game.platform === "n64" ? (onLinux ? "RMG" : preferences.arcade.n64 === "rmg" ? "RMG" : "Project64") : "Dolphin";
  const played = lastPlayed(game.lastPlayedAt);
  // On the page's own layer, so it stays put however the page scrolls.
  return createPortal(
    <div className="arcade-panel-scrim" onClick={onClose}>
      <aside className="arcade-panel" aria-label={game.title} onClick={(event) => event.stopPropagation()}>
        <button type="button" className="round-btn arcade-panel-close" aria-label="Close" onClick={onClose}>
          <X size={17} />
        </button>
        <div className="arcade-panel-art" style={{ aspectRatio: PLATFORM_ASPECT[game.platform] }}>
          <GameCover game={game} size="cover" />
        </div>
        {naming == null ? (
          <h2 className="arcade-panel-title">
            {game.title}
            <button type="button" className="icon-btn" aria-label="Rename" title="Rename" onClick={() => setNaming(game.title)}>
              <Pencil size={15} />
            </button>
          </h2>
        ) : (
          <form
            className="arcade-rename"
            onSubmit={(event) => {
              event.preventDefault();
              void rename();
            }}
          >
            <input className="input" autoFocus value={naming} onChange={(event) => setNaming(event.target.value)} onKeyDown={(event) => event.key === "Escape" && setNaming(null)} aria-label="Name" />
            <button type="submit" className="btn btn-sm btn-primary">Save</button>
            <button type="button" className="btn btn-sm" onClick={() => setNaming(null)}>Cancel</button>
          </form>
        )}
        <p className="arcade-panel-sub">{pc ? `PC · starts through ${emulator}` : `${PLATFORM_NAMES[game.platform]}${game.gameId ? ` · ${game.gameId}` : ""} · plays in ${emulator}`}</p>
        <button type="button" className="btn btn-primary arcade-panel-play" disabled={running != null} onClick={onPlay}>
          <Play size={17} fill="currentColor" /> {running === game.id ? "Playing…" : "Play"}
        </button>
        <dl className="arcade-panel-facts">
          <div>
            <dt>
              <Clock size={14} /> Played
            </dt>
            <dd>
              {playTime(game.playSeconds)}
              {game.playCount > 0 ? ` · ${game.playCount} ${game.playCount === 1 ? "session" : "sessions"}` : ""}
            </dd>
          </div>
          {played && (
            <div>
              <dt>Last played</dt>
              <dd>{played}</dd>
            </div>
          )}
          {!pc && (
            <div>
              <dt>File</dt>
              <dd title={game.path}>
                {game.path.split(/[\\/]/).pop()}
                {game.size ? ` · ${fileSize(game.size)}` : ""}
              </dd>
            </div>
          )}
        </dl>
        <div className="arcade-panel-actions">
          <button type="button" className="btn" aria-pressed={game.isFavorite} onClick={() => void run(() => api.arcadeSetFavorite(game.id, !game.isFavorite))}>
            <Heart size={16} fill={game.isFavorite ? "currentColor" : "none"} /> {game.isFavorite ? "Favorite" : "Add to favorites"}
          </button>
          <button type="button" className="btn" onClick={() => void changeCover()}>
            <ImagePlus size={16} /> Change cover
          </button>
          <button type="button" className="btn" onClick={() => void run(() => api.arcadeFindCovers([game.id], preferences.arcade.downloadCovers))}>
            <ImageDown size={16} /> Find cover
          </button>
          <button type="button" className="btn" onClick={() => void run(() => api.arcadeReveal(game.id))}>
            <FolderOpen size={16} /> {pc ? "Show folder" : "Show file"}
          </button>
          <button
            type="button"
            className="btn btn-danger"
            title={pc ? "Takes it off Arcade's list; it stays installed (Emulators & folders can show it again)" : "Takes it off Arcade's list; the file stays where it is"}
            onClick={() =>
              void run(async () => {
                await api.arcadeForget(game.id);
                onClose();
              })
            }
          >
            <Trash size={16} /> Remove from Digitify
          </button>
        </div>
        {error && <p className="notice danger">{error}</p>}
      </aside>
    </div>,
    document.body,
  );
}

function Setup({ status, onChanged }: { status: ArcadeStatus; onChanged: () => void }) {
  const { preferences, update } = usePreferences();
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
  const addFolder = async () => {
    const path = await openDialog({ directory: true, multiple: false, title: "Choose a game folder" });
    if (typeof path === "string") await run(() => api.arcadeFolderAdd(path));
  };
  const n64Choices = status.emulators.filter((e) => e.platforms.includes("n64") && e.found);
  return (
    <section className="arcade-setup" aria-label="Emulators and folders">
      <div className="arcade-emulators">
        {status.emulators.map((emulator) => (
          <EmulatorCard key={emulator.key} emulator={emulator} onRun={run} />
        ))}
      </div>
      <div className="arcade-stores">
        <h3>PC games from your stores</h3>
        <p className="muted">Only installed games are listed, and the list follows what you install or remove. Each starts through its store.</p>
        <ul>
          {status.stores.map((store) => (
            <li key={store.key} className={store.found ? "found" : ""}>
              {store.found ? <CheckCircle2 size={16} className="ok" /> : <CircleAlert size={16} className="warn" />}
              <strong>{store.name}</strong>
              <span className="muted">{store.found ? `${store.games} installed ${store.games === 1 ? "game" : "games"}` : "not found on this computer"}</span>
            </li>
          ))}
        </ul>
        {status.hidden > 0 && (
          <p className="arcade-hidden">
            {status.hidden} store {status.hidden === 1 ? "game is" : "games are"} off the list.
            <button type="button" className="btn btn-sm" onClick={() => void run(() => api.arcadeUnhide())}>
              Show {status.hidden === 1 ? "it" : "them"} again
            </button>
          </p>
        )}
      </div>
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
                  <button type="button" className="icon-btn" aria-label={`Remove ${folder.path}`} onClick={() => void run(() => api.arcadeFolderRemove(folder.id!))}>
                    <X size={15} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="btn btn-sm" onClick={() => void addFolder()}>
            <FolderPlus size={15} /> Add a folder…
          </button>
        </div>
        <div className="arcade-setup-block">
          <h3>Covers</h3>
          <label className="arcade-switch-row">
            <Switch checked={preferences.arcade.downloadCovers} onChange={(on) => update((c) => ({ arcade: { ...c.arcade, downloadCovers: on } }))} label="Download covers" />
            <span>
              Download covers
              <small>GameCube and Wii from GameTDB by each disc's ID; consoles from libretro-thumbnails by the game's name; Steam games from Steam by their ID. Covers already on this computer (Dolphin's, Steam's, the Xbox app's) are used first.</small>
            </span>
          </label>
          {n64Choices.length > 1 && (
            <>
              <h3>Nintendo 64 games play in</h3>
              <div className="segmented" role="group" aria-label="Nintendo 64 emulator">
                {n64Choices.map((e) => (
                  <button key={e.key} type="button" aria-pressed={preferences.arcade.n64 === e.key} onClick={() => update((c) => ({ arcade: { ...c.arcade, n64: e.key as "project64" | "rmg" } }))}>
                    {e.name}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      {error && <p className="notice danger">{error}</p>}
    </section>
  );
}

function EmulatorCard({ emulator, onRun }: { emulator: ArcadeEmulatorStatus; onRun: (action: () => Promise<unknown>) => Promise<void> }) {
  const locate = async () => {
    const path = await openDialog({
      multiple: false,
      title: `Where is ${emulator.name}?`,
      filters: onLinux ? undefined : [{ name: emulator.name, extensions: ["exe"] }],
    });
    if (typeof path === "string") await onRun(() => api.arcadeSetEmulator(emulator.key, path));
  };
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
  const consoles = emulator.platforms.map((p) => PLATFORM_NAMES[p]).join(" and ");
  return (
    <div className={`arcade-emulator${emulator.found ? " found" : ""}${emulator.available ? "" : " unavailable"}`}>
      <div className="arcade-emulator-head">
        {emulator.found ? <CheckCircle2 size={18} className="ok" /> : <CircleAlert size={18} className="warn" />}
        <strong>{emulator.name}</strong>
        <span className="muted">{consoles}</span>
      </div>
      {!emulator.available ? (
        <p className="muted">Windows only. On Linux, Nintendo 64 games play in RMG.</p>
      ) : emulator.found ? (
        <>
          <div className="arcade-emulator-program">
            <span className="arcade-emulator-path" title={emulator.found}>{emulator.found}</span>
            <button type="button" className="btn btn-sm" onClick={() => void locate()}>Change…</button>
            {emulator.picked && (
              <button type="button" className="icon-btn" aria-label="Find it automatically" title="Find it automatically" onClick={() => void onRun(() => api.arcadeSetEmulator(emulator.key, null))}>
                <RotateCcw size={15} />
              </button>
            )}
          </div>
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
      ) : (
        <>
          <p className="muted">Not found on this computer.</p>
          <div className="arcade-emulator-actions">
            <button type="button" className="btn btn-sm" onClick={() => void locate()}>Locate…</button>
          </div>
        </>
      )}
    </div>
  );
}

function fileSize(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}

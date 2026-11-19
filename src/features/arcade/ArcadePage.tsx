import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useSearch } from "@tanstack/react-router";
import { ReviewPanel } from "../../components/Review";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { AppWindow, Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, CircleAlert, Clock, FolderOpen, FolderPlus, Heart, ImageDown, ImagePlus, Joystick, ListChecks, LoaderCircle, Pencil, Play, RefreshCw, RotateCcw, Search, Settings2, Trash, X } from "lucide-react";
import { api, errorText, onLinux, type ArcadeConsole, type ArcadeEmulator, type ArcadeEmulatorStatus, type ArcadeFolder, type ArcadeGame, type ArcadeStatus } from "../../lib/api";
import type { ArcadeFilter } from "../../lib/preferences";
import { usePreferences, type ArcadePreferences } from "../../lib/preferences";
import { GridDragProvider, useGridDragProps } from "../../lib/gridDrag";
import { CardSizeSlider, Dialog, Switch } from "../../components/common";
import { badgeOf, consoleOf, FILTER_LABELS, inFilter, GameCover, lastPlayed, PLATFORM_ASPECT, PLATFORM_NAMES, playTime, reorderWithin, SORTS, useArcade, useArcadeFilters, useLaunch, useShownGames } from "./shared";
import { PlatformLogo } from "./logos";

/** `/arcade` (D-034, D-035, D-037): the games of the emulators and stores on this computer, started the way they start. */
export function ArcadePage() {
  const { status, games, starting, notSeen, clearNotSeen } = useArcade();
  const { preferences, update } = usePreferences();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const opened = useSearch({ strict: false }) as { game?: number };
  const [selected, setSelected] = useState<number | null>(opened.game ?? null);
  useEffect(() => {
    if (opened.game != null) setSelected(opened.game);
  }, [opened.game]);
  const [setup, setSetup] = useState<boolean | null>(null);
  const [scanning, setScanning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<number>>(new Set());
  const { launch, error, clearError } = useLaunch();
  const shown = useShownGames(games.data, search);
  const view = useArcadeFilters();
  // Games pop in when the view, sort or search changes, like the library's items (D-041).
  const stageKey = `${view.current}:${preferences.arcade.sort}:${search.trim()}`;
  const [entering, setEntering] = useState(true);
  useEffect(() => {
    setEntering(true);
    const timer = window.setTimeout(() => setEntering(false), 1100);
    return () => window.clearTimeout(timer);
  }, [stageKey]);
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

  // A PC game no store Arcade reads installed, by its program (D-107): added, then its panel opens.
  const addProgram = async () => {
    const path = await openDialog({ multiple: false, title: "Choose the game's program", filters: onLinux ? undefined : [{ name: "Programs", extensions: ["exe"] }] });
    if (typeof path !== "string") return;
    try {
      const id = await api.arcadeAddProgram(path, arcade.downloadCovers);
      refresh();
      setSelected(id);
    } catch (reason) {
      setNotice(errorText(reason));
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
          <button type="button" className="btn" title="Adds a PC game by its program, for games no store here installed" onClick={() => void addProgram()}>
            <AppWindow size={16} /> Add a game…
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
            Playing <strong>{running.title}</strong>.{" "}
            {arcade.whilePlaying === "hide" ? "Digitify waits, hidden and quiet, until the game closes." : "Digitify's music is silent until the game closes (the music button on Home or in the title bar brings it back)."}
          </span>
        </div>
      )}
      {startingGame && !running && (
        <div className="arcade-running starting" role="status">
          <LoaderCircle size={16} className="spin" />
          <span>
            Starting <strong>{startingGame.title}</strong> through {starting!.store}.{" "}
            {arcade.whilePlaying === "hide" ? "Digitify hides once the game is up." : "Digitify goes quiet once the game is up."}
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

      {showSetup && status.data && <Setup status={status.data} onChanged={refresh} onAddProgram={() => void addProgram()} />}

      <div className="arcade-toolbar">
        <ViewStrip filters={view.filters} current={view.current} onChoose={view.choose} games={games.data} />
        {/* Find, Size, Select and Sort: the same tools, in the same order, as the Library's (D-044). */}
        <div className="view-tools">
        <label className="arcade-search">
          <Search size={15} aria-hidden />
          <input type="search" placeholder="Find a game" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Find a game" />
        </label>
        <label className="arcade-size">
          <span>Size</span>
          <CardSizeSlider value={preferences.cardSize} onChange={(cardSize) => update({ cardSize })} />
        </label>
        <button type="button" className="btn btn-sm glow-when-on" aria-pressed={selecting} onClick={() => (selecting ? stopSelecting() : setSelecting(true))}>
          <ListChecks size={15} /> Select
        </button>
        <label className="arcade-sort">
          <span>Sort</span>
          <select value={arcade.sort} onChange={(event) => setArcade({ sort: event.target.value as typeof arcade.sort })}>
            {SORTS.map((sort) => (
              <option key={sort.key} value={sort.key}>{sort.label}</option>
            ))}
          </select>
        </label>
        </div>
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
                : `Install an emulator Arcade knows (Emulators & folders lists them) or games from a store (Steam, itch.io${onLinux ? ", Heroic or Lutris" : ", Epic Games, Xbox, GOG, Ubisoft Connect, the EA app, Battle.net or Amazon Games"}), point Arcade to your emulators in Emulators & folders, or add a game by its program.`
              : "Nothing matches this console or search."}
          </p>
        </div>
      ) : (
        <GridDragProvider value={drag}>
          <div key={stageKey} className={`arcade-grid${selecting ? " selecting" : ""}${canArrange ? " arranging-in-place" : ""}${entering ? " entering" : ""}`} style={{ ["--card" as string]: `${preferences.cardSize}px` }}>
            {shown.map((g, index) => (
              <GameTile
                key={g.id}
                index={index}
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

/**
 * Arcade's views in one row (D-109): with many consoles it scrolls sideways (the wheel, a drag of
 * the trackpad, or the arrows at its ends) instead of growing, so it never pushes the tools beside
 * it off the page; the view chosen is always scrolled into sight.
 */
function ViewStrip({ filters, current, onChoose, games }: { filters: ArcadeFilter[]; current: ArcadeFilter; onChoose: (filter: ArcadeFilter) => void; games: ArcadeGame[] | undefined }) {
  const strip = useRef<HTMLDivElement>(null);
  const [ends, setEnds] = useState({ left: false, right: false });
  const target = useRef<number | null>(null);
  const measure = () => {
    const el = strip.current;
    if (!el) return;
    setEnds({ left: el.scrollLeft > 2, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
  };
  useLayoutEffect(() => {
    const el = strip.current;
    if (!el) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    // The wheel scrolls the row sideways.
    const onWheel = (event: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      event.preventDefault();
      el.scrollBy({ left: event.deltaY });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      observer.disconnect();
      el.removeEventListener("wheel", onWheel);
    };
  }, [filters.length]);
  useEffect(() => {
    target.current = null;
    strip.current?.querySelector<HTMLElement>('[aria-pressed="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [current]);
  // Each click moves on from where the row is heading, so quick clicks during the glide all count.
  const page = (direction: 1 | -1) => {
    const el = strip.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const from = target.current ?? el.scrollLeft;
    const to = Math.max(0, Math.min(max, from + direction * el.clientWidth * 0.7));
    target.current = to;
    el.scrollTo({ left: to, behavior: "smooth" });
  };
  const settle = () => {
    // The glide is over once the row stops where it was heading.
    if (target.current != null && Math.abs((strip.current?.scrollLeft ?? 0) - target.current) < 2) target.current = null;
    measure();
  };
  return (
    <div className={`arcade-views${ends.left ? " more-left" : ""}${ends.right ? " more-right" : ""}`}>
      <button type="button" className={`round-btn arcade-views-arrow left${ends.left ? "" : " hidden"}`} aria-label="Earlier views" tabIndex={ends.left ? 0 : -1} aria-hidden={!ends.left} onClick={() => page(-1)}>
        <ChevronLeft size={16} strokeWidth={2.6} />
      </button>
      <div ref={strip} className="segmented" role="group" aria-label="Console" onScroll={settle} onWheel={() => (target.current = null)}>
        {filters.map((filter) => (
          <button key={filter} type="button" aria-pressed={current === filter} onClick={() => onChoose(filter)}>
            {FILTER_LABELS[filter]}
            {/* How many games each view holds, as Library's sections show (D-099). */}
            {games && <span className="count">{games.filter((g) => !g.missing && inFilter(g, filter)).length.toLocaleString()}</span>}
          </button>
        ))}
      </div>
      <button type="button" className={`round-btn arcade-views-arrow right${ends.right ? "" : " hidden"}`} aria-label="More views" tabIndex={ends.right ? 0 : -1} aria-hidden={!ends.right} onClick={() => page(1)}>
        <ChevronRight size={16} strokeWidth={2.6} />
      </button>
    </div>
  );
}

export function GameTile({ game, index, running, selecting, checked, onOpen, onPlay }: { game: ArcadeGame; index: number; running: boolean; selecting: boolean; checked: boolean; onOpen: () => void; onPlay: () => void }) {
  const drag = useGridDragProps(game.id);
  return (
    <div className={`arcade-tile${running ? " running" : ""}${checked ? " checked" : ""}`} data-platform={game.platform} style={{ ["--i" as string]: index, ["--aspect" as string]: PLATFORM_ASPECT[game.platform] }} {...drag}>
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
        <span className="arcade-badge" data-platform={game.platform} data-store={game.store ?? undefined}>
          <PlatformLogo game={game} />
          {badgeOf(game)}
        </span>
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
        <span>{game.playSeconds > 0 ? `${consoleOf(game)} · ${playTime(game.playSeconds)}` : consoleOf(game)}</span>
      </div>
    </div>
  );
}

/** Time played outside Digitify (D-043): hours and minutes added to what Digitify counts. */
function ExtraTime({ game, onSave }: { game: ArcadeGame; onSave: (seconds: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [hours, setHours] = useState("");
  const [minutes, setMinutes] = useState("");
  if (!editing) {
    return (
      <button
        type="button"
        className="btn btn-sm btn-ghost arcade-extra-edit"
        onClick={() => {
          setHours(String(Math.floor(game.extraSeconds / 3600)));
          setMinutes(String(Math.floor((game.extraSeconds % 3600) / 60)));
          setEditing(true);
        }}
      >
        <Pencil size={13} /> {game.extraSeconds > 0 ? "Change time added" : "Add time played elsewhere"}
      </button>
    );
  }
  const seconds = (Math.max(0, Number(hours) || 0) * 60 + Math.max(0, Number(minutes) || 0)) * 60;
  return (
    <form
      className="arcade-extra-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(seconds);
        setEditing(false);
      }}
    >
      <span>Played outside Digitify</span>
      <label>
        <input className="input" type="number" min={0} inputMode="numeric" value={hours} onChange={(event) => setHours(event.target.value)} aria-label="Hours" autoFocus /> h
      </label>
      <label>
        <input className="input" type="number" min={0} max={59} inputMode="numeric" value={minutes} onChange={(event) => setMinutes(event.target.value)} aria-label="Minutes" /> min
      </label>
      <button type="submit" className="btn btn-sm btn-primary">
        Save
      </button>
      <button type="button" className="btn btn-sm" onClick={() => setEditing(false)}>
        Cancel
      </button>
    </form>
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
        <button
          type="button"
          className="btn btn-sm"
          disabled={none || busy}
          title="Puts back each game's own cover: its launcher's for PC games, the emulator's or the download's for the others (pictures you chose give way)"
          onClick={() => void run(() => api.arcadeFindCovers(ids, preferences.arcade.downloadCovers, true), "Default covers back")}
        >
          <RotateCcw size={15} /> Default covers
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
  const status = useQuery({ queryKey: ["arcade-status"], queryFn: api.arcadeStatus });
  const emulator = pc ? consoleOf(game) : playsIn(game, preferences.arcade, status.data);
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
        <p className="arcade-panel-sub">{pc ? (game.store ? `PC · starts through ${emulator}` : "PC · added by you · starts by itself") : `${PLATFORM_NAMES[game.platform]}${game.gameId ? ` · ${game.gameId}` : ""} · plays in ${emulator}`}</p>
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
              {game.extraSeconds > 0 && <span className="arcade-extra"> · {playTime(game.extraSeconds)} added by you</span>}
              <ExtraTime game={game} onSave={(seconds) => void run(() => api.arcadeSetExtraTime(game.id, seconds))} />
            </dd>
          </div>
          <div>
            <dt>Your review</dt>
            <dd>
              <ReviewPanel compact rating={game.rating} note={game.note} onSave={(rating, note) => void run(() => api.arcadeSetReview(game.id, rating, note))} />
            </dd>
          </div>
          {played && (
            <div>
              <dt>Last played</dt>
              <dd>{played}</dd>
            </div>
          )}
          {(!pc || !game.store) && (
            <div>
              <dt>{pc ? "Program" : "File"}</dt>
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
          <button
            type="button"
            className="btn"
            title={pc ? "Puts back the cover its launcher shows" : "Puts back the cover from the emulator or the download"}
            onClick={() => void run(() => api.arcadeFindCovers([game.id], preferences.arcade.downloadCovers, true))}
          >
            <RotateCcw size={16} /> Default cover
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

type SetupTab = "launchers" | "emulators" | "consoles" | "folders";

/** Emulators & folders' groups of emulators, by the maker of the consoles they play (D-113). */
const EMULATOR_GROUPS: { name: string; keys: ArcadeEmulator[] }[] = [
  { name: "Nintendo", keys: ["dolphin", "project64", "rmg", "melonds", "desmume", "mgba", "nestopia", "fceux", "snes9x", "zsnes"] },
  { name: "Sony", keys: ["duckstation", "pcsx2", "rpcs3"] },
  { name: "Sega", keys: ["fusion", "nulldc"] },
  { name: "Many consoles", keys: ["mesen", "ares", "retroarch"] },
];

/**
 * Emulators & folders (D-113): everything Arcade finds games with, in four tabs. Launchers (the
 * stores and programs added by hand), Emulators (grouped by maker, one row each, its folders
 * opening beneath it), Consoles (which emulator plays each console) and Folders & covers.
 */
function Setup({ status, onChanged, onAddProgram }: { status: ArcadeStatus; onChanged: () => void; onAddProgram: () => void }) {
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
            <strong>{store.name}</strong>
            <span className="muted">{store.found ? `${store.games} installed ${store.games === 1 ? "game" : "games"}` : "not found on this computer"}</span>
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

function EmulatorsTab({ status, onRun }: { status: ArcadeStatus; onRun: Run }) {
  const [open, setOpen] = useState<ArcadeEmulator | null>(null);
  return (
    <div className="arcade-setup-pane">
      <p className="muted">Found where they're usually installed, or pointed to by hand (a portable copy). Their game folders come from their own settings unless you set them here.</p>
      {EMULATOR_GROUPS.map((group) => {
        const emulators = status.emulators.filter((e) => group.keys.includes(e.key)).sort((a, b) => Number(!!b.found) - Number(!!a.found));
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
                <td>{PLATFORM_NAMES[row.key]}</td>
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
            <small>
              For each game found: GameCube and Wii from GameTDB by each disc's ID; other consoles (Nintendo 64, PlayStation, NES, Mega Drive, Dreamcast…) from libretro-thumbnails by the game's name; Steam and GOG games from their stores by their ID, other PC games from Steam's store by their name, itch.io's by its own. Covers already on this computer (Dolphin's, RetroArch's, the launchers') are used first.
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

type Run = (action: () => Promise<unknown>) => Promise<void>;

/** "A, B or C" / "A, B and C". */
function listOf(names: string[], joiner: "and" | "or"): string {
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} ${joiner} ${names.at(-1)}` : (names[0] ?? "");
}

/** The emulator a game starts in (D-111): RetroArch for its playlists' games, else the one chosen
 *  for its console if it's found, else the first found in Arcade's order. */
function playsIn(game: ArcadeGame, arcade: ArcadePreferences, status: ArcadeStatus | undefined): string {
  if (game.retroarch) return "RetroArch";
  const players = status?.consoles.find((c) => c.key === game.platform)?.players ?? [];
  const found = players.filter((key) => status?.emulators.find((e) => e.key === key)?.found);
  const chosen = arcade.playsIn[game.platform as ArcadeConsole];
  const key = chosen && found.includes(chosen) ? chosen : (found[0] ?? players[0]);
  return status?.emulators.find((e) => e.key === key)?.name ?? "its emulator";
}

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
    <li className={`arcade-emulator-row${emulator.found ? " found" : " absent"}${open ? " open" : ""}${emulator.available ? "" : " unavailable"}`}>
      <div className="arcade-emulator-line">
        {emulator.found ? <CheckCircle2 size={16} className="ok" /> : <CircleAlert size={16} className="warn" />}
        <strong>{emulator.name}</strong>
        <span className="muted arcade-emulator-consoles">{consolesOf(emulator)}</span>
        {emulator.found ? (
          <button type="button" className="btn btn-sm" aria-expanded={open} onClick={onToggle}>
            {summary} <ChevronDown size={14} className="arcade-chevron" />
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

function fileSize(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}

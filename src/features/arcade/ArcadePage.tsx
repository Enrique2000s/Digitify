import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Marquee } from "../../components/Marquee";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { DropdownMenu } from "radix-ui";
import { useQueryClient } from "@tanstack/react-query";
import { Dices, Check, ChevronDown, ChevronLeft, ChevronRight, CircleAlert, Joystick, Layers, ListChecks, LoaderCircle, Play, Search, Settings2, X } from "lucide-react";
import { api, errorText, onLinux, type ArcadeGame } from "../../lib/api";
import type { ArcadeFilter } from "../../lib/preferences";
import { usePreferences } from "../../lib/preferences";
import { GridDragProvider, useGridDragProps } from "../../lib/gridDrag";
import { CardSizeSlider } from "../../components/common";
import { LogoMark } from "./logos";
import { CoverPicker } from "./CoverPicker";
import { belongsTo, CollectionBar, CollectionsBoard, defaultCollection, useCollections } from "./Collections";
import { GamePanel } from "./GamePanel";
import { BulkBar } from "./BulkBar";
import { Setup } from "./Setup";
import { consoleKey, consoleOf, GameBadge, GameMarks, gameAspect, FILTER_LABELS, inFilter, GameCover, playTime, reorderWithin, SORTS, useArcade, useArcadeFilters, useLaunch, useShownGames, addProgramGame, scanSummary } from "./shared";

/** What Arcade shows (D-148, D-149): its games, the collections (their own screen, with a Back to
 *  the games), or one collection (Favorites is 0); in the address, so Back goes where it came from. */
type Board = "games" | "collections" | number;

/** `/arcade` (D-034, D-035, D-037): the games of the emulators and stores on this computer, started the way they start. */
export function ArcadePage() {
  const { status, games, starting, notSeen, clearNotSeen } = useArcade();
  const { preferences, update } = usePreferences();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const opened = useSearch({ strict: false }) as { game?: number; board?: string; collection?: number };
  const navigate = useNavigate();
  const [selected, setSelected] = useState<number | null>(opened.game ?? null);
  useEffect(() => {
    if (opened.game != null) setSelected(opened.game);
  }, [opened.game]);
  const [setup, setSetup] = useState<boolean | null>(null);
  const [scanning, setScanning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<number>>(new Set());
  const [covering, setCovering] = useState<ArcadeGame[] | null>(null);
  const { launch, error, clearError } = useLaunch();
  const collections = useCollections();
  const board: Board = opened.collection != null ? opened.collection : opened.board === "collections" ? "collections" : "games";
  const setBoard = (next: Board) => {
    setSearch("");
    setSelecting(false);
    setPicked(new Set());
    void navigate({ to: "/arcade", search: next === "games" ? {} : next === "collections" ? { board: "collections" } : { collection: next } });
  };
  const collection = typeof board === "number" ? (defaultCollection(board) ?? collections.data?.find((c) => c.id === board)) : undefined;
  // A collection that's gone (deleted) goes back to the collections.
  useEffect(() => {
    if (typeof board === "number" && collections.isSuccess && !collection) setBoard("collections");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board, collections.isSuccess, collection]);
  const scope = useMemo(() => (collection ? belongsTo(collection) : null), [collection]);
  const shown = useShownGames(games.data, search, scope);
  // Surprise me (D-163): a game from what's shown, at random, its panel opened and its box brought
  // into sight; one not completed first, and not the one just picked.
  const lastSurprise = useRef<number | null>(null);
  const surprise = () => {
    const open = shown.filter((g) => !g.completedAt);
    let pool = open.length > 0 ? open : shown;
    if (pool.length > 1) pool = pool.filter((g) => g.id !== lastSurprise.current);
    const game = pool[Math.floor(Math.random() * pool.length)];
    if (!game) return;
    lastSurprise.current = game.id;
    setSelected(game.id);
    requestAnimationFrame(() => {
      const tile = document.querySelector<HTMLElement>(`[data-game-id="${game.id}"]`);
      // Only the page scrolls to bring it into the middle, never the window around it (D-165).
      const page = tile?.closest<HTMLElement>(".page");
      if (tile && page) {
        const box = tile.getBoundingClientRect();
        const view = page.getBoundingClientRect();
        page.scrollBy({ top: box.top + box.height / 2 - (view.top + view.height / 2), behavior: "smooth" });
      }
      tile?.classList.remove("surprised");
      void tile?.offsetWidth;
      tile?.classList.add("surprised");
      window.setTimeout(() => tile?.classList.remove("surprised"), 1700);
    });
  };
  // The Console sort puts each console's and launcher's games under its name (D-149).
  const bySection = preferences.arcade.sort === "console";
  const sectionCounts = useMemo(() => {
    const counts = new Map<string, number>();
    if (bySection) for (const g of shown) counts.set(consoleKey(g), (counts.get(consoleKey(g)) ?? 0) + 1);
    return counts;
  }, [bySection, shown]);
  const view = useArcadeFilters();
  // Games pop in when the view, sort or search changes, like the library's items (D-041).
  const stageKey = `${collection ? `c${collection.id}` : view.current}:${preferences.arcade.sort}:${search.trim()}`;
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
  // Emulators & folders closes when anything else is used (D-157): a button, a dropdown and its
  // options, a field outside it, by mouse or keyboard. Not its own button (which toggles it), nor
  // what's inside it or the menus and dialogs it opened. What was pressed is seen as it's pressed
  // (a dropdown opens then and takes the click), and it closes when the pointer is let go: closing
  // sooner would move the page up under a dropdown just opened and put an option under the pointer.
  const setupToggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!showSetup) return;
    const CONTROL = "button, a[href], input, select, textarea, summary, [role='button'], [role='tab'], [role='option'], [role='menuitem'], [role='menuitemradio'], [role='menuitemcheckbox'], [role='combobox'], [role='switch'], [role='checkbox'], [role='radio']";
    const OVERLAY = "[role='dialog'], [role='alertdialog'], [role='menu'], [role='listbox'], [data-radix-popper-content-wrapper]";
    // Whether the last thing used was inside it: then a menu or dialog that opens is its own.
    let inside = false;
    // Whether something outside it was pressed and it closes when the pointer is let go.
    let pressed = false;
    const close = () => window.setTimeout(() => setSetup(false), 0);
    /** Whether using `target` closes it. */
    const closes = (target: Element | null): boolean => {
      const control = target?.closest(CONTROL);
      if (target?.closest(".arcade-setup")) {
        inside = true;
        return false;
      }
      if (target?.closest(OVERLAY)) return !inside && !!control;
      inside = false;
      return !!control && control !== setupToggle.current && !setupToggle.current?.contains(control);
    };
    const onPress = (event: PointerEvent) => {
      pressed = closes(event.target instanceof Element ? event.target : null);
    };
    const onRelease = () => {
      if (pressed) close();
      pressed = false;
    };
    const onKey = (event: KeyboardEvent) => {
      if ((event.key === "Enter" || event.key === " ") && closes(document.activeElement)) close();
    };
    document.addEventListener("pointerdown", onPress, true);
    document.addEventListener("pointerup", onRelease, true);
    document.addEventListener("pointercancel", onRelease, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPress, true);
      document.removeEventListener("pointerup", onRelease, true);
      document.removeEventListener("pointercancel", onRelease, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [showSetup]);
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
      setNotice(scanSummary(await api.arcadeScan(arcade.downloadCovers)));
      refresh();
    } catch (reason) {
      setNotice(errorText(reason));
    } finally {
      setScanning(false);
    }
  };

  // A PC game no store Arcade reads installed, by its program (D-107): added, then its panel opens.
  const addProgram = async () => {
    try {
      const id = await addProgramGame(arcade.downloadCovers);
      if (id == null) return;
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
          {scanning && (
            <span className="arcade-head-busy" role="status">
              <LoaderCircle size={16} className="spin" /> Looking for games…
            </span>
          )}
          {/* Goes to the collections' own screen (D-149), which has its Back to the games. */}
          <button type="button" className="btn arcade-collections-button" aria-current={board !== "games" ? "page" : undefined} onClick={() => board !== "collections" && setBoard("collections")}>
            <Layers size={16} /> Collections
          </button>
          <button ref={setupToggle} type="button" className="btn glow-when-on" aria-pressed={showSetup} onClick={() => setSetup(!showSetup)}>
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

      {board === "collections" && <CollectionsBoard games={games.data} onOpen={(id) => setBoard(id)} onBack={() => setBoard("games")} />}
      {board !== "collections" && (
      <>
      <div className="arcade-toolbar">
        {collection ? (
          <CollectionBar collection={collection} count={shown.length} games={games.data} onBack={() => setBoard("collections")} />
        ) : (
          <ViewStrip filters={view.filters} current={view.current} onChoose={view.choose} games={games.data} />
        )}
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
        {shown.length > 1 && !selecting && (
          <button type="button" className="btn btn-sm surprise-btn" title="Surprise me: a game from here you haven't completed, at random" onClick={surprise}>
            <Dices size={15} /> Surprise me
          </button>
        )}
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
      {canArrange && shown.length > 1 && <p className="arcade-hint">Drag the games into the order you like{view.current === "all" && !search.trim() && !collection ? "" : "; the others keep their places"}.</p>}

      {games.data && shown.length === 0 ? (
        <div className="empty arcade-empty">
          <Joystick size={40} strokeWidth={1.8} />
          <h2>{games.data.length === 0 ? "No games yet" : collection && !search.trim() ? "Nothing in this collection yet" : "No games here"}</h2>
          <p>
            {collection && games.data.length > 0 && !search.trim()
              ? collection.dynamic
                ? "No game passes its filters right now. Edit filters to change them; games that pass later show up by themselves."
                : "Put games in it from a game's panel (Collections), or select several in Arcade and use Add to collection."
              : games.data.length === 0
              ? anyEmulator
                ? "Arcade looks in the game folders set up in your emulators, and in folders you add here. Check them in Emulators & folders, then Look for games in its Folders & covers tab."
                : `Install an emulator Arcade knows (Emulators & folders lists them) or games from a store (Steam, itch.io, Minecraft${onLinux ? ", Heroic or Lutris" : ", Epic Games, Xbox, GOG, Ubisoft Connect, the EA app, Battle.net or Amazon Games"}), point Arcade to your emulators in Emulators & folders, or add a game by its program.`
              : "Nothing matches this console or search."}
          </p>
        </div>
      ) : (
        <GridDragProvider value={drag}>
          <div key={stageKey} className={`arcade-grid${selecting ? " selecting" : ""}${canArrange ? " arranging-in-place" : ""}${entering ? " entering" : ""}${bySection ? " by-section" : ""}`} style={{ ["--card" as string]: `${preferences.cardSize}px` }}>
            {shown.map((g, index) => (
              <Fragment key={g.id}>
                {bySection && (index === 0 || consoleKey(shown[index - 1]) !== consoleKey(g)) && <ConsoleHeading view={consoleKey(g)} count={sectionCounts.get(consoleKey(g)) ?? 0} />}
                <GameTile
                  index={index}
                  game={g}
                  running={status.data?.running === g.id}
                  selecting={selecting}
                  checked={picked.has(g.id)}
                  onOpen={() => (selecting ? toggle(g.id) : setSelected(g.id))}
                  onPlay={() => void launch(g)}
                />
              </Fragment>
            ))}
          </div>
        </GridDragProvider>
      )}
      </>
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
          onFindCovers={() => setCovering((games.data ?? []).filter((g) => picked.has(g.id)))}
          games={games.data}
          inCollection={collection && !collection.dynamic ? collection.id : null}
        />
      )}
      {covering && (
        <CoverPicker
          games={covering}
          onClose={(summary) => {
            setCovering(null);
            if (summary) setNotice(summary);
          }}
        />
      )}
      {game && !selecting && <GamePanel game={game} running={status.data?.running ?? null} onClose={() => setSelected(null)} onPlay={() => void launch(game)} />}
    </div>
  );
}

/** A console's or launcher's heading in the Console sort (D-149): its symbol, its name, how many games, and a line. */
function ConsoleHeading({ view, count }: { view: ArcadeFilter; count: number }) {
  return (
    <div className="arcade-section" role="heading" aria-level={2}>
      <LogoMark name={view === "others" ? "pc" : view} size={18} className="arcade-section-logo" />
      <span className="arcade-section-name">{FILTER_LABELS[view]}</span>
      <span className="count">{count.toLocaleString()}</span>
    </div>
  );
}

/** The makers whose consoles share one view menu (D-121). */
const CONSOLE_MAKERS: [string, readonly string[]][] = [
  ["Nintendo", ["wii", "wiiu", "gamecube", "n64", "switch", "ds", "3ds", "nes", "snes", "gb", "gbc", "gba"]],
  ["PlayStation", ["ps1", "ps2", "ps3", "psp"]],
  ["Sega", ["sms", "genesis", "segacd", "gamegear", "saturn", "dreamcast"]],
  ["Xbox consoles", ["ogxbox", "x360"]],
  ["More consoles", ["pce", "arcade", "atari2600", "other"]],
];

/** The views in their order, a maker's consoles together in one menu where it has two or more. */
function viewItems(filters: ArcadeFilter[]): (ArcadeFilter | { maker: string; filters: ArcadeFilter[] })[] {
  const out: (ArcadeFilter | { maker: string; filters: ArcadeFilter[] })[] = [];
  for (const filter of filters) {
    const maker = CONSOLE_MAKERS.find(([, keys]) => keys.includes(filter));
    const together = maker ? filters.filter((f) => maker[1].includes(f)) : [];
    if (!maker || together.length < 2) out.push(filter);
    else if (together[0] === filter) out.push({ maker: maker[0], filters: together });
  }
  return out;
}

/** A maker's consoles in one view button (D-121): it opens their list; the one chosen shows on it. */
function MakerMenu({ maker, filters, current, onChoose, count }: { maker: string; filters: ArcadeFilter[]; current: ArcadeFilter; onChoose: (filter: ArcadeFilter) => void; count: ((filter: ArcadeFilter) => number) | null }) {
  const chosen = filters.includes(current) ? current : null;
  const total = count ? filters.reduce((n, f) => n + count(f), 0) : null;
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button type="button" aria-pressed={!!chosen} className="maker-view">
          {chosen ? `${maker} · ${FILTER_LABELS[chosen]}` : maker}
          {count && <span className="count">{(chosen ? count(chosen) : total!).toLocaleString()}</span>}
          <ChevronDown size={13} aria-hidden />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="menu maker-menu" align="start" sideOffset={8}>
          {filters.map((filter) => (
            <DropdownMenu.Item key={filter} className="menu-item" onSelect={() => onChoose(filter)}>
              <LogoMark name={filter} className="setup-logo" />
              <span className="maker-menu-name">{FILTER_LABELS[filter]}</span>
              {count && <span className="muted">{count(filter).toLocaleString()}</span>}
              {filter === current && <Check size={15} aria-label="Shown" />}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
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
    const left = el.scrollLeft > 2;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
    setEnds((was) => (was.left === left && was.right === right ? was : { left, right }));
  };
  // Measured again after every change (D-159), and then every frame for a moment after it (D-161):
  // a view's name changing ("Nintendo · GameCube" back to "Nintendo"), the tools moving to or from
  // its line, the window changing, or anything settling a little later; so an arrow never shows
  // when everything fits, not even for a moment (a wrong frame stays under its fade-in).
  const watching = useRef({ until: 0, frame: 0 });
  const watch = () => {
    const w = watching.current;
    w.until = performance.now() + 1500;
    if (w.frame) return;
    const tick = () => {
      measure();
      w.frame = performance.now() < w.until ? requestAnimationFrame(tick) : 0;
    };
    w.frame = requestAnimationFrame(tick);
  };
  useEffect(() => () => cancelAnimationFrame(watching.current.frame), []);
  useLayoutEffect(() => {
    measure();
    watch();
  });
  useLayoutEffect(() => {
    const el = strip.current;
    if (!el) return;
    measure();
    const changed = () => {
      measure();
      watch();
    };
    const observer = new ResizeObserver(changed);
    observer.observe(el);
    if (el.parentElement) observer.observe(el.parentElement);
    for (const child of Array.from(el.children)) observer.observe(child);
    window.addEventListener("resize", changed);
    el.addEventListener("transitionend", changed);
    // The wheel scrolls the row sideways.
    const onWheel = (event: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      event.preventDefault();
      el.scrollBy({ left: event.deltaY });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", changed);
      el.removeEventListener("transitionend", changed);
      el.removeEventListener("wheel", onWheel);
    };
  }, [filters.join(",")]);
  useEffect(() => {
    target.current = null;
    // The chosen view into sight: only the row scrolls, sideways (D-165).
    const el = strip.current;
    const pressed = el?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (el && pressed) {
      const box = pressed.getBoundingClientRect();
      const row = el.getBoundingClientRect();
      const pad = 40;
      if (box.left < row.left + pad) el.scrollBy({ left: box.left - row.left - pad, behavior: "smooth" });
      else if (box.right > row.right - pad) el.scrollBy({ left: box.right - row.right + pad, behavior: "smooth" });
    }
  }, [current]);
  const count = (filter: ArcadeFilter) => (games ?? []).filter((g) => !g.missing && inFilter(g, filter)).length;
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
        {viewItems(filters).map((item) =>
          typeof item === "string" ? (
            <button key={item} type="button" aria-pressed={current === item} onClick={() => onChoose(item)}>
              {FILTER_LABELS[item]}
              {/* How many games each view holds, as Library's sections show (D-099). */}
              {games && <span className="count">{count(item).toLocaleString()}</span>}
            </button>
          ) : (
            <MakerMenu key={item.maker} maker={item.maker} filters={item.filters} current={current} onChoose={onChoose} count={games ? count : null} />
          ),
        )}
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
    <div className={`arcade-tile${running ? " running" : ""}${checked ? " checked" : ""}`} data-platform={game.platform} data-game-id={game.id} style={{ ["--i" as string]: index, ["--aspect" as string]: gameAspect(game) }} {...drag}>
      <button
        type="button"
        className="arcade-tile-art"
        style={{ aspectRatio: gameAspect(game) }}
        onClick={onOpen}
        aria-label={`${game.title}, ${consoleOf(game)}`}
        aria-pressed={selecting ? checked : undefined}
        data-blip
      >
        <GameCover game={game} />
        <GameBadge game={game} />
        <GameMarks game={game} />
        {selecting && <span className={`card-check${checked ? " on" : ""}`} aria-hidden>{checked && <Check size={15} strokeWidth={3.2} />}</span>}
      </button>
      {!selecting && (
        <button type="button" className="arcade-play" aria-label={`Play ${game.title}`} title="Play" onClick={onPlay} data-no-drag>
          <Play size={18} fill="currentColor" />
        </button>
      )}
      <div className="arcade-tile-text">
        <strong>
          <Marquee hover text={game.title} />
        </strong>
        <span>{game.playSeconds > 0 ? `${consoleOf(game)} · ${playTime(game.playSeconds)}` : consoleOf(game)}</span>
      </div>
    </div>
  );
}

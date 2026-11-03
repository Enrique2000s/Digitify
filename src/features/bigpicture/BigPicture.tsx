import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import {
  BookOpen,
  Delete,
  Gamepad2,
  Heart,
  House,
  LibraryBig,
  LogOut,
  MousePointer2,
  Pause,
  Play,
  Search,
  Settings2,
  SkipBack,
  SkipForward,
  Space,
  Star,
  X,
} from "lucide-react";
import { api, type ItemCard } from "../../lib/api";
import { exitBigPicture, focusFirst, moveFocus } from "../../lib/bigpicture";
import { controllerKind, onControllerChange, usePad, useSticks, type PadAction } from "../../lib/gamepad";
import { Cursor } from "./Cursor";
import { useMusic } from "../../lib/music/MusicProvider";
import { useCoverShape, usePreferences } from "../../lib/preferences";
import { libraryChanged, useCategories, useDashboard } from "../../lib/queries";
import { CategoryIcon, Cover } from "../../components/common";

export type BigPictureScreen = "home" | "library" | "item" | "search";
export interface BigPictureSearch {
  screen?: BigPictureScreen;
  scope?: string;
  id?: number;
}

/** Button names as printed on the controller in use. */
function useButtons() {
  const [kind, setKind] = useState(controllerKind);
  useEffect(() => onControllerChange(() => setKind(controllerKind())), []);
  const ps = kind === "playstation";
  return { kind, a: ps ? "✕" : "A", b: ps ? "○" : "B", x: ps ? "□" : "X", y: ps ? "△" : "Y", start: ps ? "Options" : "Menu" };
}

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(timer);
  }, []);
  return <span className="bp-clock">{now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</span>;
}

/**
 * A cover tile; selecting it opens the item. It's exactly as wide as its cover's shape at `height`,
 * so the art is never stretched or cropped differently from the rest of the app.
 */
function Tile({ item, autofocus, height = 300 }: { item: ItemCard; autofocus?: boolean; height?: number }) {
  const navigate = useNavigate();
  const { shape, aspect } = useCoverShape()(item);
  const width = Math.round(height * aspect);
  return (
    <button
      type="button"
      className="bp-tile"
      style={{ width }}
      data-bp-focus
      data-bp-autofocus={autofocus || undefined}
      onClick={() => void navigate({ to: "/bp", search: { screen: "item", id: item.id } })}
    >
      <span className="bp-tile-art" data-shape={shape} style={{ width, height }}>
        <Cover item={item} size="cover" />
        {item.progress != null && item.progress > 0 && item.progress < 1 && (
          <span className="bp-tile-progress">
            <span style={{ width: `${Math.round(item.progress * 100)}%` }} />
          </span>
        )}
      </span>
      <span className="bp-tile-title">{item.title}</span>
    </button>
  );
}

function Row({ title, items, first, height }: { title: string; items: ItemCard[]; first?: boolean; height?: number }) {
  if (!items.length) return null;
  return (
    <section className="bp-row">
      <h2>{title}</h2>
      <div className="bp-row-items">
        {items.map((item, index) => (
          <Tile key={item.id} item={item} height={height} autofocus={first && index === 0} />
        ))}
      </div>
    </section>
  );
}

function HomeScreen() {
  const dashboard = useDashboard();
  const categories = useCategories();
  const navigate = useNavigate();
  const data = dashboard.data;
  if (!data) return null;
  const going = [...data.continueWatching, ...data.continueItems];
  return (
    <>
      <section className="bp-row">
        <h2>Library</h2>
        <div className="bp-row-items">
          {/* The same order as everywhere: Everything, the categories, then Favorites. */}
          <button type="button" className="bp-category" data-bp-focus data-bp-autofocus onClick={() => void navigate({ to: "/bp", search: { screen: "library", scope: "all" } })}>
            <LibraryBig size={46} />
            <strong>Everything</strong>
          </button>
          {categories.data
            ?.filter((c) => !c.isHidden)
            .map((category) => (
              <button
                key={category.key}
                type="button"
                className="bp-category"
                data-bp-focus
                onClick={() => void navigate({ to: "/bp", search: { screen: "library", scope: category.key } })}
              >
                <CategoryIcon icon={category.icon} size={46} />
                <strong>{category.name}</strong>
                <span>{category.itemCount.toLocaleString()}</span>
              </button>
            ))}
          <button type="button" className="bp-category" data-bp-focus onClick={() => void navigate({ to: "/bp", search: { screen: "library", scope: "favorites" } })}>
            <Star size={46} />
            <strong>Favorites</strong>
          </button>
        </div>
      </section>
      {/* Under the categories, and smaller than the other rows. */}
      <Row title="Continue" items={going} height={190} />
      <Row title="Recently added" items={data.recent} />
      <Row title="Favorites" items={data.favorites} />
    </>
  );
}

function LibraryScreen({ scope }: { scope: string }) {
  const categories = useCategories();
  const navigate = useNavigate();
  const [limit, setLimit] = useState(120);
  const { preferences } = usePreferences();
  const base = scope === "favorites" ? { favorites: true } : scope === "all" ? {} : { category: scope };
  const sort = preferences.sorts[scope] ?? "title";
  const items = useQuery({
    queryKey: ["bp-items", scope, sort, limit],
    queryFn: () => api.query({ ...base, sort: sort === "shelf" ? "title" : sort, custom: sort === "custom" ? scope : null, offset: 0, limit }),
  });
  const tabs = [
    { key: "all", name: "Everything" },
    ...(categories.data?.filter((c) => !c.isHidden).map((c) => ({ key: c.key, name: c.name })) ?? []),
    { key: "favorites", name: "Favorites" },
  ];
  // LB and RB switch between the categories.
  usePad((action) => {
    if (action !== "lb" && action !== "rb") return;
    const at = tabs.findIndex((t) => t.key === scope);
    const next = tabs[(at + (action === "rb" ? 1 : -1) + tabs.length) % tabs.length];
    if (next) void navigate({ to: "/bp", search: { screen: "library", scope: next.key }, replace: true });
    return true;
  });
  return (
    <>
      <div className="bp-tabs" role="tablist">
        <span className="bp-hint-key">LB</span>
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={tab.key === scope}
            className="bp-tab"
            data-bp-focus
            onClick={() => void navigate({ to: "/bp", search: { screen: "library", scope: tab.key }, replace: true })}
          >
            {tab.name}
          </button>
        ))}
        <span className="bp-hint-key">RB</span>
      </div>
      <div className="bp-grid">
        {items.data?.items.map((item, index) => <Tile key={item.id} item={item} height={270} autofocus={index === 0} />)}
      </div>
      {items.data && items.data.total > items.data.items.length && (
        <button type="button" className="bp-button bp-more" data-bp-focus onClick={() => setLimit((n) => Math.min(500, n + 120))}>
          Show more ({(items.data.total - items.data.items.length).toLocaleString()} left)
        </button>
      )}
      {items.data?.total === 0 && <p className="bp-empty">Nothing here yet.</p>}
    </>
  );
}

function ItemScreen({ id }: { id: number }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const music = useMusic();
  const item = useQuery({ queryKey: ["item", id], queryFn: () => api.item(id) });
  const blurb = useQuery({ queryKey: ["blurb", id], queryFn: () => api.blurbs([id]).then((list) => list[0] ?? null) });
  const shapeOf = useCoverShape();
  const data = item.data;
  if (!data) return null;
  const { shape, aspect } = shapeOf({ handler: data.handler, category: data.category, coverShape: (data.metadata as Record<string, unknown>).coverShape as never });
  const digital = data.versions.some((v) => v.kind === "digital");
  const progress = data.progress ?? 0;
  // Videos always play from the start (D-027).
  const started = progress > 0.01 && progress < 0.999 && data.category !== "videos";
  // A track is its own item (D-027): its one part is what the music player plays.
  const ids = data.handler === "audio" ? data.parts.filter((p) => p.kind === "track").map((p) => p.id) : [];
  const favorite = async () => {
    await api.itemSetFavorite(id, !data.isFavorite);
    libraryChanged(queryClient);
  };
  return (
    <div className="bp-item">
      <div className="bp-item-art" data-shape={shape} style={{ ["--a" as string]: aspect }}>
        <Cover item={data} size="cover" />
      </div>
      <div className="bp-item-body">
        <h1>{data.title}</h1>
        <p className="bp-item-sub">{[data.subtitle, data.year, data.categoryName].filter(Boolean).join(" · ")}</p>
        {blurb.data?.facts.length ? <p className="bp-item-facts">{blurb.data.facts.join(" · ")}</p> : null}
        {data.description && <p className="bp-item-description">{data.description}</p>}
        <div className="bp-actions">
          {digital && (data.handler === "book" || data.handler === "comic") && (
            <button type="button" className="bp-button primary" data-bp-focus data-bp-autofocus onClick={() => void navigate({ to: "/read/$id", params: { id: String(id) } })}>
              <BookOpen size={26} /> {started ? `Continue · ${Math.round(progress * 100)}%` : "Read"}
            </button>
          )}
          {data.online && !data.online.downloaded && (
            <button type="button" className="bp-button primary" data-bp-focus data-bp-autofocus onClick={() => void navigate({ to: "/online/$id", params: { id: String(id) } })}>
              <Play size={26} /> Play online
            </button>
          )}
          {digital && data.handler === "video" && (
            <button type="button" className="bp-button primary" data-bp-focus data-bp-autofocus onClick={() => void navigate({ to: "/watch/$id", params: { id: String(id) } })}>
              <Play size={26} /> {started ? `Resume · ${Math.round(progress * 100)}%` : "Play"}
            </button>
          )}
          {data.handler === "audio" && ids.length > 0 && (
            <button type="button" className="bp-button primary" data-bp-focus data-bp-autofocus onClick={() => void music.play(ids, 0)}>
              <Play size={26} /> {music.current?.id === ids[0] && !music.paused ? "Playing" : "Play"}
            </button>
          )}
          <button type="button" className="bp-button" data-bp-focus aria-pressed={data.isFavorite} onClick={() => void favorite()}>
            <Heart size={24} fill={data.isFavorite ? "currentColor" : "none"} /> {data.isFavorite ? "Favorite" : "Add to favorites"}
          </button>
        </div>
      </div>
    </div>
  );
}

const KEY_ROWS = ["1234567890", "qwertyuiop", "asdfghjkl'", "zxcvbnm-.,"];

/** The on-screen keyboard: every key is selectable with the controller (X deletes, Y types a space). */
function OnScreenKeyboard({ onChange }: { onChange: (change: (value: string) => string) => void }) {
  const [shift, setShift] = useState(false);
  usePad((action) => {
    if (action === "x") {
      onChange((value) => value.slice(0, -1));
      return true;
    }
    if (action === "y") {
      onChange((value) => `${value} `);
      return true;
    }
  });
  return (
    <div className="bp-keyboard" role="group" aria-label="On-screen keyboard">
      {KEY_ROWS.map((row, r) => (
        <div key={row} className="bp-keyrow">
          {[...row].map((key, k) => (
            <button
              key={key}
              type="button"
              className="bp-key"
              data-bp-focus
              data-bp-autofocus={r === 1 && k === 0 ? true : undefined}
              onClick={() => onChange((value) => value + (shift ? key.toUpperCase() : key))}
            >
              {shift ? key.toUpperCase() : key}
            </button>
          ))}
        </div>
      ))}
      <div className="bp-keyrow">
        <button type="button" className="bp-key wide" data-bp-focus aria-pressed={shift} onClick={() => setShift(!shift)}>
          Shift
        </button>
        <button type="button" className="bp-key wider" data-bp-focus onClick={() => onChange((value) => `${value} `)}>
          <Space size={22} /> Space
        </button>
        <button type="button" className="bp-key wide" data-bp-focus onClick={() => onChange((value) => value.slice(0, -1))}>
          <Delete size={22} />
        </button>
        <button type="button" className="bp-key wide" data-bp-focus onClick={() => onChange(() => "")}>
          Clear
        </button>
      </div>
    </div>
  );
}

function SearchScreen() {
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(text.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [text]);
  const results = useQuery({ queryKey: ["bp-search", query], queryFn: () => api.query({ search: query, offset: 0, limit: 60 }), enabled: !!query });
  return (
    <div className="bp-search">
      <div className="bp-search-box">
        <Search size={30} />
        <input value={text} onChange={(event) => setText(event.target.value)} placeholder="Search your collection" aria-label="Search" />
      </div>
      <OnScreenKeyboard onChange={setText} />
      <div className="bp-grid">
        {results.data?.items.map((item) => <Tile key={item.id} item={item} height={270} />)}
      </div>
      {query && results.data?.total === 0 && <p className="bp-empty">No matches for “{query}”.</p>}
    </div>
  );
}

/** The menu on Start or the Xbox / PS button: navigation mode, cursor speed, leaving. */
function Menu({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const { preferences, update } = usePreferences();
  const ref = useRef<HTMLDivElement>(null);
  const bp = preferences.bigPicture;
  useEffect(() => {
    if (ref.current && bp.navigation !== "cursor") focusFirst(ref.current);
  }, []);
  const cursor = bp.navigation === "cursor";
  usePad((action) => {
    if (action === "back" || action === "start" || action === "guide") onClose();
    else if (action === "up" || action === "down" || action === "left" || action === "right") {
      if (!cursor && ref.current) moveFocus(ref.current, action);
    } else if (action === "accept") {
      // In cursor mode A goes on to the cursor, which clicks what it points at.
      if (cursor) return;
      (document.activeElement as HTMLElement | null)?.click();
    }
    return true;
  });
  return (
    <div className="bp-menu-backdrop" onClick={onClose}>
      <div ref={ref} className="bp-menu" role="dialog" aria-label="Big Picture menu" onClick={(event) => event.stopPropagation()}>
        <h2>Big Picture</h2>
        <button type="button" className="bp-button" data-bp-focus data-bp-autofocus onClick={onClose}>
          <Play size={22} /> Resume
        </button>
        <div className="bp-menu-setting">
          <span>Move around with</span>
          <div className="bp-choice">
            <button type="button" className="bp-button" data-bp-focus aria-pressed={bp.navigation === "focus"} onClick={() => update((c) => ({ bigPicture: { ...c.bigPicture, navigation: "focus" } }))}>
              <Gamepad2 size={22} /> Selection
            </button>
            <button type="button" className="bp-button" data-bp-focus aria-pressed={bp.navigation === "cursor"} onClick={() => update((c) => ({ bigPicture: { ...c.bigPicture, navigation: "cursor" } }))}>
              <MousePointer2 size={22} /> Cursor
            </button>
          </div>
        </div>
        {bp.navigation === "cursor" && (
          <div className="bp-menu-setting">
            <span>Cursor speed</span>
            <div className="bp-choice">
              {([["Slow", 600], ["Normal", 1000], ["Fast", 1500]] as const).map(([label, speed]) => (
                <button key={label} type="button" className="bp-button" data-bp-focus aria-pressed={bp.cursorSpeed === speed} onClick={() => update((c) => ({ bigPicture: { ...c.bigPicture, cursorSpeed: speed } }))}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}
        <button type="button" className="bp-button" data-bp-focus onClick={() => void exitBigPicture(() => void navigate({ to: "/" }))}>
          <LogOut size={22} /> Exit Big Picture
        </button>
      </div>
    </div>
  );
}

/** The music playing, in the top bar next to Search. */
function NowPlaying() {
  const music = useMusic();
  if (!music.active || !music.current) return null;
  return (
    <div className="bp-now" role="group" aria-label="Music">
      <div className="bp-now-art">
        <Cover item={{ title: music.current.title, coverKey: music.current.coverKey, handler: "audio" }} />
      </div>
      <div className="bp-now-text">
        <strong>{music.current.title}</strong>
        <span>{[music.current.artist, music.current.album].filter(Boolean).join(" · ")}</span>
      </div>
      <button type="button" className="bp-round" data-bp-focus aria-label="Previous track" onClick={music.previous}>
        <SkipBack size={22} />
      </button>
      <button type="button" className="bp-round" data-bp-focus aria-label={music.paused ? "Play" : "Pause"} onClick={music.toggle}>
        {music.paused ? <Play size={22} /> : <Pause size={22} />}
      </button>
      <button type="button" className="bp-round" data-bp-focus aria-label="Next track" onClick={music.next}>
        <SkipForward size={22} />
      </button>
    </div>
  );
}

/** `/bp`: Big Picture, a full-screen interface for the TV driven by a controller (D-025). */
export function BigPicturePage() {
  const search = useSearch({ from: "/bp" }) as BigPictureSearch;
  const screen = search.screen ?? "home";
  const navigate = useNavigate();
  const music = useMusic();
  const { preferences } = usePreferences();
  const buttons = useButtons();
  const main = useRef<HTMLDivElement>(null);
  const shell = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState(false);
  const cursor = preferences.bigPicture.navigation === "cursor";

  // A new screen selects its first (or marked) element once it has drawn.
  const key = `${screen}:${search.scope ?? ""}:${search.id ?? ""}`;
  useEffect(() => {
    if (cursor) return;
    const timer = window.setTimeout(() => {
      // Picking Home, Library or Search (or a category tab) keeps the selection where it is.
      const active = document.activeElement;
      if (active instanceof HTMLElement && active !== document.body && shell.current?.contains(active)) return;
      if (main.current) focusFirst(main.current);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [key, cursor]);

  // The selection never disappears: it's drawn with a class (not :focus, which goes when the window
  // loses focus), and if the selected element goes away, the selection comes back nearby.
  const selected = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const onIn = (event: FocusEvent) => {
      const target = event.target as HTMLElement;
      if (!shell.current?.contains(target) || !target.matches("[data-bp-focus]")) return;
      selected.current?.classList.remove("bp-selected");
      target.classList.add("bp-selected");
      selected.current = target;
    };
    const onOut = () =>
      window.setTimeout(() => {
        if (cursor || menu || !shell.current) return;
        const active = document.activeElement;
        if (active && active !== document.body && shell.current.contains(active)) return;
        const last = selected.current;
        if (last?.isConnected && last.getBoundingClientRect().width > 0) last.focus({ preventScroll: true });
        else if (main.current) focusFirst(main.current);
      }, 0);
    document.addEventListener("focusin", onIn);
    document.addEventListener("focusout", onOut);
    return () => {
      document.removeEventListener("focusin", onIn);
      document.removeEventListener("focusout", onOut);
    };
  }, [cursor, menu]);

  // The right stick scrolls, quickly: up and down the page, and sideways along the selected row.
  useSticks((sticks, dt) => {
    if (cursor || menu) return;
    if (sticks.ry && main.current) main.current.scrollBy({ top: sticks.ry * 1800 * dt, behavior: "instant" });
    if (sticks.rx) selected.current?.closest(".bp-row-items")?.scrollBy({ left: sticks.rx * 1800 * dt, behavior: "instant" });
  });

  const back = () => (screen === "home" ? setMenu(true) : window.history.back());
  usePad((action: PadAction) => {
    if (menu) return;
    switch (action) {
      case "up":
      case "down":
      case "left":
      case "right":
        // With the cursor on, only the cursor selects (the stick moves it; the D-pad does nothing).
        if (cursor) return true;
        // Everything on screen is reachable: the top bar, the content and the music.
        if (shell.current) moveFocus(shell.current, action);
        break;
      case "accept":
        // In cursor mode A clicks where the cursor is (the cursor handles it).
        if (cursor) return;
        (document.activeElement as HTMLElement | null)?.click();
        break;
      case "back":
        back();
        break;
      case "y":
        // On the search screen, X and Y belong to the keyboard.
        if (screen === "search") return;
        void navigate({ to: "/bp", search: { screen: "search" } });
        break;
      case "x":
        if (screen === "search" || !music.active) return;
        music.toggle();
        break;
      case "start":
      case "guide":
        setMenu(true);
        break;
      default:
        return;
    }
    return true;
  });
  // Esc works like B with a keyboard.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !menu) {
        event.preventDefault();
        back();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const nav = (to: BigPictureSearch, label: string, icon: ReactNode, current: boolean) => (
    <button type="button" className="bp-nav" data-bp-focus aria-current={current || undefined} onClick={() => void navigate({ to: "/bp", search: to })}>
      {icon} {label}
    </button>
  );
  const title = useMemo(() => ({ home: "Home", library: "Library", item: "", search: "Search" })[screen], [screen]);

  return (
    <div ref={shell} className={`bp${cursor ? " bp-cursor-mode" : ""}`}>
      <header className="bp-top">
        <span className="bp-brand">
          <Gamepad2 size={30} /> Digitify
        </span>
        <nav className="bp-navs">
          {nav({ screen: "home" }, "Home", <House size={24} />, screen === "home")}
          {nav({ screen: "library", scope: search.scope ?? "all" }, "Library", <LibraryBig size={24} />, screen === "library")}
          {nav({ screen: "search" }, "Search", <Search size={24} />, screen === "search")}
        </nav>
        <NowPlaying />
        <span className="bp-status">
          <Gamepad2 size={22} /> {buttons.kind === "playstation" ? "PlayStation controller" : buttons.kind ? "Xbox controller" : "No controller"}
        </span>
        <Clock />
        <button type="button" className="bp-round" data-bp-focus aria-label="Menu" onClick={() => setMenu(true)}>
          <Settings2 size={24} />
        </button>
        <button type="button" className="bp-round" data-bp-focus aria-label="Exit Big Picture" onClick={() => void exitBigPicture(() => void navigate({ to: "/" }))}>
          <X size={24} />
        </button>
      </header>
      <main ref={main} className="bp-main" key={key}>
        {title && <h1 className="bp-title">{title}</h1>}
        {screen === "home" && <HomeScreen />}
        {screen === "library" && <LibraryScreen scope={search.scope ?? "all"} />}
        {screen === "item" && search.id != null && <ItemScreen id={search.id} />}
        {screen === "search" && <SearchScreen />}
      </main>
      <footer className="bp-hints">
        <span>
          <b>{buttons.a}</b> Select
        </span>
        <span>
          <b>{buttons.b}</b> Back
        </span>
        <span>
          <b>{buttons.y}</b> Search
        </span>
        {music.active && (
          <span>
            <b>{buttons.x}</b> Play / pause music
          </span>
        )}
        {screen === "library" && (
          <span>
            <b>LB</b> <b>RB</b> Categories
          </span>
        )}
        <span>
          <b>{buttons.start}</b> Menu
        </span>
      </footer>
      {cursor && <Cursor speed={preferences.bigPicture.cursorSpeed} />}
      {menu && <Menu onClose={() => setMenu(false)} />}
    </div>
  );
}

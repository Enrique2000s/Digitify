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

/** A cover tile; selecting it opens the item. */
function Tile({ item, autofocus }: { item: ItemCard; autofocus?: boolean }) {
  const navigate = useNavigate();
  const { shape, aspect } = useCoverShape()(item);
  return (
    <button
      type="button"
      className="bp-tile"
      data-bp-focus
      data-bp-autofocus={autofocus || undefined}
      onClick={() => void navigate({ to: "/bp", search: { screen: "item", id: item.id } })}
    >
      <span className="bp-tile-art" data-shape={shape} style={{ aspectRatio: aspect }}>
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

function Row({ title, items, first }: { title: string; items: ItemCard[]; first?: boolean }) {
  if (!items.length) return null;
  return (
    <section className="bp-row">
      <h2>{title}</h2>
      <div className="bp-row-items">
        {items.map((item, index) => (
          <Tile key={item.id} item={item} autofocus={first && index === 0} />
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
      <Row title="Continue" items={going} first />
      <section className="bp-row">
        <h2>Library</h2>
        <div className="bp-row-items">
          {categories.data
            ?.filter((c) => !c.isHidden)
            .map((category, index) => (
              <button
                key={category.key}
                type="button"
                className="bp-category"
                data-bp-focus
                data-bp-autofocus={!going.length && index === 0 ? true : undefined}
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
  const tabs = [...(categories.data?.filter((c) => !c.isHidden).map((c) => ({ key: c.key, name: c.name })) ?? []), { key: "favorites", name: "Favorites" }];
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
        {items.data?.items.map((item, index) => <Tile key={item.id} item={item} autofocus={index === 0} />)}
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
  const tracks = useQuery({ queryKey: ["tracks", { album: id }], queryFn: () => api.musicTracks({ album: id }), enabled: item.data?.handler === "audio" });
  const shapeOf = useCoverShape();
  const data = item.data;
  if (!data) return null;
  const { shape, aspect } = shapeOf({ handler: data.handler, coverShape: (data.metadata as Record<string, unknown>).coverShape as never });
  const digital = data.versions.some((v) => v.kind === "digital");
  const progress = data.progress ?? 0;
  const started = progress > 0.01 && progress < 0.999;
  const ids = tracks.data?.map((t) => t.id) ?? [];
  const favorite = async () => {
    await api.itemSetFavorite(id, !data.isFavorite);
    libraryChanged(queryClient);
  };
  return (
    <div className="bp-item">
      <div className="bp-item-art" data-shape={shape} style={{ aspectRatio: aspect }}>
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
          {digital && data.handler === "video" && (
            <button type="button" className="bp-button primary" data-bp-focus data-bp-autofocus onClick={() => void navigate({ to: "/watch/$id", params: { id: String(id) } })}>
              <Play size={26} /> {started ? `Resume · ${Math.round(progress * 100)}%` : "Play"}
            </button>
          )}
          {data.handler === "audio" && ids.length > 0 && (
            <button type="button" className="bp-button primary" data-bp-focus data-bp-autofocus onClick={() => void music.play(ids, 0)}>
              <Play size={26} /> Play album
            </button>
          )}
          <button type="button" className="bp-button" data-bp-focus aria-pressed={data.isFavorite} onClick={() => void favorite()}>
            <Heart size={24} fill={data.isFavorite ? "currentColor" : "none"} /> {data.isFavorite ? "Favorite" : "Add to favorites"}
          </button>
        </div>
        {tracks.data && tracks.data.length > 0 && (
          <ol className="bp-tracks">
            {tracks.data.map((track, index) => (
              <li key={track.id}>
                <button type="button" className={`bp-track${music.current?.id === track.id ? " playing" : ""}`} data-bp-focus onClick={() => void music.play(ids, index)}>
                  <span className="bp-track-no">{track.number ?? index + 1}</span>
                  <span className="bp-track-title">{track.title}</span>
                  <span className="bp-track-artist">{track.artist ?? ""}</span>
                </button>
              </li>
            ))}
          </ol>
        )}
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
        {results.data?.items.map((item) => <Tile key={item.id} item={item} />)}
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
    if (ref.current) focusFirst(ref.current);
  }, []);
  usePad((action) => {
    if (action === "back" || action === "start" || action === "guide") onClose();
    else if (action === "up" || action === "down" || action === "left" || action === "right") ref.current && moveFocus(ref.current, action);
    else if (action === "accept") (document.activeElement as HTMLElement | null)?.click();
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

/** The pointer for cursor mode: the left stick moves it, the right stick scrolls, A clicks. */
function Cursor({ speed }: { speed: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const position = useRef({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
  useSticks((sticks, dt) => {
    const p = position.current;
    p.x = Math.max(0, Math.min(window.innerWidth - 2, p.x + sticks.lx * speed * dt));
    p.y = Math.max(0, Math.min(window.innerHeight - 2, p.y + sticks.ly * speed * dt));
    if (ref.current) ref.current.style.transform = `translate(${p.x}px, ${p.y}px)`;
    if (sticks.rx || sticks.ry) {
      let element = document.elementFromPoint(p.x, p.y) as HTMLElement | null;
      while (element && !(element.scrollHeight > element.clientHeight + 2 || element.scrollWidth > element.clientWidth + 2)) element = element.parentElement;
      element?.scrollBy(sticks.rx * 900 * dt, sticks.ry * 900 * dt);
    }
    const under = document.elementFromPoint(p.x, p.y)?.closest<HTMLElement>("[data-bp-focus]");
    if (under && document.activeElement !== under) under.focus({ preventScroll: true });
  });
  usePad((action) => {
    if (action !== "accept") return;
    const p = position.current;
    (document.elementFromPoint(p.x, p.y) as HTMLElement | null)?.click();
    return true;
  });
  return <div ref={ref} className="bp-cursor" aria-hidden style={{ transform: `translate(${position.current.x}px, ${position.current.y}px)` }} />;
}

function NowPlaying() {
  const music = useMusic();
  if (!music.active || !music.current) return null;
  return (
    <div className="bp-now">
      <div className="bp-now-art">
        <Cover item={{ title: music.current.album, coverKey: music.current.coverKey, handler: "audio" }} />
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
  const [menu, setMenu] = useState(false);
  const cursor = preferences.bigPicture.navigation === "cursor";

  // A new screen selects its first (or marked) element once it has drawn.
  const key = `${screen}:${search.scope ?? ""}:${search.id ?? ""}`;
  useEffect(() => {
    const timer = window.setTimeout(() => main.current && focusFirst(main.current), 250);
    return () => window.clearTimeout(timer);
  }, [key]);

  const back = () => (screen === "home" ? setMenu(true) : window.history.back());
  usePad((action: PadAction) => {
    if (menu) return;
    switch (action) {
      case "up":
      case "down":
      case "left":
      case "right":
        if (main.current && !moveFocus(main.current, action)) {
          // Past the content's edge: the top bar or the music.
          moveFocus(document.querySelector(".bp") as HTMLElement, action);
        }
        break;
      case "accept":
        if (!cursor) (document.activeElement as HTMLElement | null)?.click();
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
    <div className={`bp${cursor ? " bp-cursor-mode" : ""}`}>
      <header className="bp-top">
        <span className="bp-brand">
          <Gamepad2 size={30} /> Digitify
        </span>
        <nav className="bp-navs">
          {nav({ screen: "home" }, "Home", <House size={24} />, screen === "home")}
          {nav({ screen: "library", scope: search.scope ?? "all" }, "Library", <LibraryBig size={24} />, screen === "library")}
          {nav({ screen: "search" }, "Search", <Search size={24} />, screen === "search")}
        </nav>
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
      <NowPlaying />
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

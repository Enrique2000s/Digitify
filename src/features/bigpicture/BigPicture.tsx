import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Marquee } from "../../components/Marquee";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Award, BookOpen, CalendarHeart, ChartColumn, Star, ChevronLeft, ChevronRight, Delete, Gamepad2, Heart, House, LibraryBig, LogOut, MousePointer2, Pause, Play, Search, Settings2, SkipBack, SkipForward, Space, X, Eye, Joystick, Music, VolumeOff, Clapperboard } from "lucide-react";
import { photoContext, viewList } from "../../lib/routes";
import { api, type ArcadeGame, type ItemCard } from "../../lib/api";
import { exitBigPicture, focusFirst, moveFocus, takeIntro } from "../../lib/bigpicture";
import { ambientEngine } from "../../lib/ambient/engine";
import { BigPictureIntro } from "./Intro";
import { NowPlayingScreen } from "./NowPlayingScreen";
import { controllerKind, onControllerChange, usePad, useSticks, type PadAction } from "../../lib/gamepad";
import { Cursor } from "./Cursor";
import { OnlineScreen } from "./OnlineScreen";
import { ArcadeScreen, ArcadeTile } from "../arcade/ArcadeScreen";
import { consoleOf, GameCover, lastPlayed, matchingGames, gameAspect, playTime, useArcade, useLaunch } from "../arcade/shared";
import { PlatformLogo } from "../arcade/logos";
import { AchievementsList, YearReviewBody } from "../home/YearViews";
import { useHomeGames } from "../home/GameSections";
import { useAmbient } from "../../lib/ambient/AmbientProvider";
import { useMusic } from "../../lib/music/MusicProvider";
import { useCoverShape, usePreferences, type HomeSection } from "../../lib/preferences";
import { StatsPanel } from "../home/Stats";
import { SectionTitle } from "../home/HomePage";
import { SourceTag, sourceProps } from "../../components/SourceTag";
import { keys, libraryChanged, useCategories, useDashboard, useLibraryScope } from "../../lib/queries";
import { BpCollectionCard } from "./BpCollectionCard";
import { BpProfileScreen } from "../profile/BpProfile";
import { useProfile } from "../profile/data";
import { ProfileAvatar } from "../profile/Picture";
import { CategoryIcon, Cover } from "../../components/common";

/** Your picture in Big Picture's top bar (D-149). */
function BpAvatar() {
  const profile = useProfile();
  return <ProfileAvatar profile={profile.data} size={44} />;
}

export type BigPictureScreen = "home" | "library" | "item" | "search" | "online" | "arcade" | "music" | "game" | "achievements" | "year" | "profile";
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
  return { kind, a: ps ? "✕" : "A", b: ps ? "○" : "B", x: ps ? "□" : "X", y: ps ? "△" : "Y", start: ps ? "Options" : "Menu", view: ps ? "Create" : "View" };
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
      data-item={item.id}
      data-favorite={item.isFavorite || undefined}
      onClick={() => void navigate({ to: "/bp", search: { screen: "item", id: item.id } })}
    >
      <span className="bp-tile-art" data-shape={shape} style={{ width, height }} {...sourceProps(item.source)}>
        <Cover item={item} size="cover" />
        <SourceTag service={item.source} />
        {item.isFavorite && <Heart className="bp-tile-fav" size={22} fill="currentColor" aria-label="Favorite" />}
        {item.progress != null && item.progress > 0 && item.progress < 1 && (
          <span className="bp-tile-progress">
            <span style={{ width: `${Math.round(item.progress * 100)}%` }} />
          </span>
        )}
      </span>
      <span className="bp-tile-title">
        <Marquee hover text={item.title} />
      </span>
    </button>
  );
}

/**
 * A row that scrolls sideways, with arrows at its ends for the mouse and the cursor (the selection
 * scrolls it by itself). An arrow shows only while there's more that way.
 */
function Scroller({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [ends, setEnds] = useState({ left: false, right: false });
  useEffect(() => {
    const row = ref.current;
    if (!row) return;
    const update = () => setEnds({ left: row.scrollLeft > 4, right: row.scrollLeft + row.clientWidth < row.scrollWidth - 4 });
    update();
    row.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(row);
    return () => {
      row.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, []);
  const by = (direction: number) => ref.current?.scrollBy({ left: direction * ref.current.clientWidth * 0.8, behavior: "smooth" });
  return (
    <div className="bp-scroller">
      <div ref={ref} className="bp-row-items">
        {children}
      </div>
      {ends.left && (
        <button type="button" className="bp-round bp-arrow left" aria-label="Scroll left" onClick={() => by(-1)}>
          <ChevronLeft size={30} />
        </button>
      )}
      {ends.right && (
        <button type="button" className="bp-round bp-arrow right" aria-label="Scroll right" onClick={() => by(1)}>
          <ChevronRight size={30} />
        </button>
      )}
    </div>
  );
}

function Row({ title, items, first, height }: { title: ReactNode; items: ItemCard[]; first?: boolean; height?: number }) {
  if (!items.length) return null;
  return (
    <section className="bp-row">
      <h2>{title}</h2>
      <Scroller>
        {items.map((item, index) => (
          <Tile key={item.id} item={item} height={height} autofocus={first && index === 0} />
        ))}
      </Scroller>
    </section>
  );
}

/** "Featured today", as on Home: one item, big, with its description. */
function FeaturedCard({ item }: { item: ItemCard }) {
  const navigate = useNavigate();
  const blurb = useQuery({ queryKey: ["blurb", item.id], queryFn: () => api.blurbs([item.id]).then((list) => list[0] ?? null) });
  const { shape, aspect } = useCoverShape()(item);
  return (
    <section className="bp-row">
      <h2>
        <Award size={26} /> Featured today <span className="section-source">(Library)</span>
      </h2>
      <button type="button" className="bp-featured" data-bp-focus onClick={() => void navigate({ to: "/bp", search: { screen: "item", id: item.id } })}>
        {item.coverKey && (
          <span className="bp-featured-backdrop" aria-hidden>
            <Cover item={item} size="cover" />
          </span>
        )}
        <span className="bp-featured-art" data-shape={shape} style={{ ["--a" as string]: aspect }} {...sourceProps(item.source)}>
          <Cover item={item} size="cover" />
          <SourceTag service={item.source} />
        </span>
        <span className="bp-featured-body">
          <strong>{item.title}</strong>
          {(item.subtitle || item.year) && <span className="bp-featured-sub">{[item.subtitle, item.year].filter(Boolean).join(" · ")}</span>}
          {blurb.data && blurb.data.facts.length > 0 && <span className="bp-featured-facts">{blurb.data.facts.join(" · ")}</span>}
          {blurb.data?.description && <span className="bp-featured-description">{blurb.data.description}</span>}
        </span>
      </button>
    </section>
  );
}

/** Opens a game's own screen in Big Picture (D-120), where it's played from. */
function useOpenGame() {
  const navigate = useNavigate();
  return (game: ArcadeGame) => void navigate({ to: "/bp", search: { screen: "game", id: game.id } });
}

/** Home's game rows in Big Picture (D-041): A opens a game's screen, as in Arcade (D-120). */
function GameRowBP({ title, games }: { title: ReactNode; games: ArcadeGame[] }) {
  const open = useOpenGame();
  if (!games.length) return null;
  return (
    <section className="bp-row">
      <h2>{title}</h2>
      <Scroller>
        {games.map((game) => (
          <ArcadeTile key={game.id} game={game} autofocus={false} height={240} onPlay={() => open(game)} />
        ))}
      </Scroller>
    </section>
  );
}

/** "Up next" in Big Picture (D-050): what comes next, mixed; A opens an item or plays a game. */
function UpNextBP({ watching, reading, next, games }: { watching: ItemCard[]; reading: ItemCard[]; next: ItemCard[]; games: ArcadeGame[] }) {
  const open = useOpenGame();
  const lists = [watching.slice(0, 4), reading.slice(0, 4), next.slice(0, 4)];
  const items: ItemCard[] = [];
  const seen = new Set<number>();
  for (let n = 0; n < 4; n++) for (const list of lists) if (list[n] && !seen.has(list[n].id)) (seen.add(list[n].id), items.push(list[n]));
  if (!items.length && !games.length) return null;
  return (
    <section className="bp-row">
      <h2>
        <SectionTitle section="upNext" />
      </h2>
      <Scroller>
        {items.map((item) => (
          <Tile key={`i${item.id}`} item={item} height={240} />
        ))}
        {games.slice(0, 4).map((game) => (
          <ArcadeTile key={`g${game.id}`} game={game} autofocus={false} height={240} onPlay={() => open(game)} />
        ))}
      </Scroller>
    </section>
  );
}

/** "Game of the day" in Big Picture: A opens its screen (D-120). */
function FeaturedGameBP({ game }: { game: ArcadeGame }) {
  const open = useOpenGame();
  return (
    <section className="bp-row">
      <h2>
        <Gamepad2 size={26} /> Game of the day <span className="section-source">(Arcade)</span>
      </h2>
      <button type="button" className="bp-featured" data-bp-focus onClick={() => open(game)}>
        {game.coverKey && (
          <span className="bp-featured-backdrop" aria-hidden>
            <GameCover game={game} size="cover" fill />
          </span>
        )}
        <span className="bp-featured-art arcade-bp-art" style={{ ["--a" as string]: gameAspect(game) }}>
          <GameCover game={game} size="cover" />
        </span>
        <span className="bp-featured-body">
          <strong>{game.title}</strong>
          <span className="bp-featured-sub">{consoleOf(game)}</span>
          <span className="bp-featured-facts">{game.playSeconds > 0 ? `${playTime(game.playSeconds)} played` : "Not played yet"}</span>
        </span>
      </button>
    </section>
  );
}

/** Home in Big Picture: the same sections as Home, in the order (and with the ones hidden) set in "Customize Home". */
function HomeScreen() {
  // Items opened from Big Picture's Home step through no list (D-145).
  photoContext.params = null;
  const dashboard = useDashboard();
  const categories = useCategories();
  const navigate = useNavigate();
  const { preferences } = usePreferences();
  const games = useHomeGames();
  const data = dashboard.data;
  if (!data) return null;
  const sections: Partial<Record<HomeSection, ReactNode>> = {
    tiles: (
      <section className="bp-row">
        <h2>Library</h2>
        <Scroller>
          {/* The same order as everywhere: Everything (when turned on, D-074), the categories, then Favorites. */}
          {preferences.showEverything && (
            <button type="button" className="bp-category" data-bp-focus data-bp-autofocus onClick={() => void navigate({ to: "/bp", search: { screen: "library", scope: "all" } })}>
              <LibraryBig size={46} />
              <strong>Everything</strong>
              <span>{data.totals.items.toLocaleString()}</span>
            </button>
          )}
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
          <button type="button" className="bp-category" data-bp-focus onClick={() => void navigate({ to: "/bp", search: { screen: "arcade" } })}>
            <Joystick size={46} />
            <strong>Arcade</strong>
            <span>{games.count.toLocaleString()}</span>
          </button>
        </Scroller>
      </section>
    ),
    continuePlaying: <GameRowBP title={<SectionTitle section="continuePlaying" />} games={games.recent} />,
    because: data.because && (
      <Row
        title={
          <>
            Because you liked {data.because.seed.title} <span className="section-source">(Library)</span>
          </>
        }
        items={data.because.items}
      />
    ),
    upNext: <UpNextBP watching={data.continueWatching} reading={data.continueItems} next={data.nextVolumes} games={games.recent} />,
    favoriteGames: <GameRowBP title={<SectionTitle section="favoriteGames" />} games={games.favorites} />,
    featuredGame: games.featured && <FeaturedGameBP game={games.featured} />,
    featured: data.featured && <FeaturedCard item={data.featured} />,
    favorites: <Row title={<SectionTitle section="favorites" />} items={data.favorites} />,
    // Smaller than the other rows, as before.
    continueWatching: <Row title={<SectionTitle section="continueWatching" />} items={data.continueWatching} height={190} />,
    continueReading: <Row title={<SectionTitle section="continueReading" />} items={data.continueItems} height={190} />,
    recentlyOpened: <Row title={<SectionTitle section="recentlyOpened" />} items={data.recentlyOpened} />,
    recentlyAdded: <Row title={<SectionTitle section="recentlyAdded" />} items={data.recent} />,
    stats: (data.totals.items > 0 || games.count > 0) && (
      <section className="bp-row bp-stats">
        <h2>
          <ChartColumn size={26} /> <SectionTitle section="stats" />
        </h2>
        <StatsPanel bigPicture />
      </section>
    ),
  };
  return (
    <>
      {preferences.home.order
        .filter((section) => !preferences.home.hidden.includes(section))
        .map((section) => (sections[section] ? <div key={section}>{sections[section]}</div> : null))}
    </>
  );
}

function LibraryScreen({ scope }: { scope: string }) {
  const categories = useCategories();
  const navigate = useNavigate();
  const [limit, setLimit] = useState(120);
  const { preferences } = usePreferences();
  // Library's collections (D-149): their own tab; "collection:<id>" is one of them open.
  const inCollections = scope === "collections" || scope.startsWith("collection:");
  const base = scope === "favorites" ? { favorites: true } : scope === "all" ? {} : { category: scope };
  const sort = preferences.sorts[scope] ?? "title";
  const items = useQuery({
    queryKey: ["bp-items", scope, sort, limit],
    queryFn: () => api.query({ ...base, sort, custom: sort === "custom" ? scope : null, offset: 0, limit }),
    enabled: !inCollections,
  });
  // What's opened from here knows its list (D-091, D-145): a song played queues the ones after it.
  if (!inCollections) photoContext.params = { ...base, sort, custom: sort === "custom" ? scope : null };
  // Library remembers its section here too (D-075); the collections aren't a section.
  const { update } = usePreferences();
  useEffect(() => {
    if (!inCollections && scope !== preferences.libraryScope && (scope !== "all" || preferences.showEverything)) update({ libraryScope: scope });
  }, [scope, inCollections, preferences.libraryScope, preferences.showEverything, update]);
  const tabs = [
    ...(preferences.showEverything ? [{ key: "all", name: "Everything" }] : []),
    ...(categories.data?.filter((c) => !c.isHidden).map((c) => ({ key: c.key, name: c.name })) ?? []),
    { key: "collections", name: "Collections" },
  ];
  // LB and RB switch between the categories.
  usePad((action) => {
    if (action !== "lb" && action !== "rb") return;
    const at = tabs.findIndex((t) => t.key === (inCollections ? "collections" : scope));
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
            aria-selected={tab.key === scope || (inCollections && tab.key === "collections")}
            className="bp-tab"
            data-bp-focus
            onClick={() => void navigate({ to: "/bp", search: { screen: "library", scope: tab.key }, replace: true })}
          >
            {tab.name}
          </button>
        ))}
        <span className="bp-hint-key">RB</span>
      </div>
      {inCollections ? (
        <LibraryCollectionsBP open={scope.startsWith("collection:") ? Number(scope.slice("collection:".length)) : null} />
      ) : (
        <div className="bp-grid">
          {items.data?.items.map((item, index) => <Tile key={item.id} item={item} height={270} autofocus={index === 0} />)}
        </div>
      )}
      {!inCollections && items.data && items.data.total > items.data.items.length && (
        <button type="button" className="bp-button bp-more" data-bp-focus onClick={() => setLimit((n) => Math.min(500, n + 120))}>
          Show more ({(items.data.total - items.data.items.length).toLocaleString()} left)
        </button>
      )}
      {!inCollections && items.data?.total === 0 && <p className="bp-empty">Nothing here yet.</p>}
    </>
  );
}

/**
 * Library's collections in Big Picture (D-149): every category's (Music has playlists instead) as
 * big cards; one opens its items, Back returns to the cards.
 */
function LibraryCollectionsBP({ open }: { open: number | null }) {
  const navigate = useNavigate();
  const categories = useCategories();
  const { preferences } = usePreferences();
  const shown = (categories.data ?? []).filter((c) => !c.isHidden && c.handler !== "audio");
  const levels = useQueries({ queries: shown.map((c) => ({ queryKey: keys.collections(c.key, null), queryFn: () => api.collections(c.key, null) })) });
  const all = shown.flatMap((category, index) => (levels[index]?.data?.children ?? []).map((collection) => ({ collection, category })));
  const current = open != null ? all.find((c) => c.collection.id === open) : undefined;
  const sort = (current && preferences.sorts[current.category.key]) ?? "title";
  const items = useQuery({
    queryKey: ["bp-collection", open, sort],
    queryFn: () => api.query({ category: current!.category.key, collection: open, sort, offset: 0, limit: 500 }),
    enabled: open != null && !!current,
  });
  if (open != null) {
    if (current) photoContext.params = { category: current.category.key, collection: open, sort };
    return (
      <>
        <div className="bp-collection-head">
          <h2>{current?.collection.name ?? "Collection"}</h2>
          {current && <span>{`${current.category.name} · ${current.collection.itemCount.toLocaleString()} ${current.collection.itemCount === 1 ? "item" : "items"}`}</span>}
        </div>
        <div className="bp-grid">
          {items.data?.items.map((item, index) => <Tile key={item.id} item={item} height={270} autofocus={index === 0} />)}
        </div>
        {items.data?.total === 0 && <p className="bp-empty">This collection is empty.</p>}
      </>
    );
  }
  return all.length === 0 && levels.every((l) => l.isSuccess) ? (
    <p className="bp-empty">No collections yet. Make them in the regular app: in a category, Collections › New collection.</p>
  ) : (
    <div className="bp-grid bp-collections">
      {all.map(({ collection, category }, index) => (
        <BpCollectionCard
          key={collection.id}
          name={collection.name}
          detail={`${category.name} · ${collection.itemCount.toLocaleString()} ${collection.itemCount === 1 ? "item" : "items"}`}
          covers={collection.covers.map((c) => c.key)}
          icon={<CategoryIcon icon={category.icon} size={40} />}
          autofocus={index === 0}
          onOpen={() => void navigate({ to: "/bp", search: { screen: "library", scope: `collection:${collection.id}` } })}
        />
      ))}
    </div>
  );
}

/**
 * A game's screen in Big Picture (D-120), as Arcade's panel is in the regular mode: its cover, what
 * it is and how much it was played, Play, and favorite. A game opens here first, then plays.
 */
function GameScreen({ id }: { id: number }) {
  const queryClient = useQueryClient();
  const { games, status, starting } = useArcade();
  const { launch, error } = useLaunch();
  const game = games.data?.find((g) => g.id === id);
  if (!game) return games.data ? <p className="bp-empty">That game isn't in Arcade anymore.</p> : null;
  const running = status.data?.running ?? null;
  const when = lastPlayed(game.lastPlayedAt);
  const facts = [
    game.playSeconds > 0 ? `${playTime(game.playSeconds)} played` : "Not played yet",
    game.playCount > 0 ? `${game.playCount} ${game.playCount === 1 ? "session" : "sessions"}` : null,
    when ? `last played ${when}` : null,
  ].filter(Boolean);
  const favorite = async () => {
    await api.arcadeSetFavorite(game.id, !game.isFavorite);
    void queryClient.invalidateQueries({ queryKey: ["arcade-games"] });
  };
  return (
    <div className="bp-item bp-game">
      <div className="bp-item-art arcade-bp-art" style={{ ["--a" as string]: gameAspect(game) }}>
        <GameCover game={game} size="cover" />
      </div>
      <div className="bp-item-body">
        <h1>{game.title}</h1>
        <p className="bp-item-sub bp-game-console">
          <PlatformLogo game={game} />
          {[consoleOf(game), game.gameId].filter(Boolean).join(" · ")}
        </p>
        <p className="bp-item-facts">{facts.join(" · ")}</p>
        {/* Your review (D-049), as the regular panel shows it (D-121). */}
        {game.rating != null && (
          <p className="bp-game-rating" aria-label={`Your rating: ${game.rating} of 5`}>
            {[1, 2, 3, 4, 5].map((n) => (
              <Star key={n} size={26} fill={n <= game.rating! ? "currentColor" : "none"} aria-hidden />
            ))}
          </p>
        )}
        {game.note && <p className="bp-item-description">“{game.note}”</p>}
        {starting?.id === game.id && running !== game.id && <p className="bp-arcade-note">Starting through {starting.store}…</p>}
        {running === game.id && <p className="bp-arcade-note">Playing now. Digitify's music is silent until the game closes.</p>}
        {error && <p className="bp-arcade-note error">{error}</p>}
        <div className="bp-actions">
          <button type="button" className="bp-button primary" data-bp-focus data-bp-autofocus disabled={running != null} onClick={() => void launch(game)}>
            <Play size={26} fill="currentColor" /> {running === game.id ? "Playing…" : "Play"}
          </button>
          <button type="button" className="bp-button" data-bp-focus aria-pressed={game.isFavorite} onClick={() => void favorite()}>
            <Heart size={24} fill={game.isFavorite ? "currentColor" : "none"} /> {game.isFavorite ? "Favorite" : "Add to favorites"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Achievements in Big Picture (D-120): the same list, on Big Picture's screen. */
function AchievementsScreen() {
  return (
    <div className="bp-achievements">
      <AchievementsList />
    </div>
  );
}

/** "Your year" in Big Picture (D-120). */
function YearScreen({ year }: { year: number }) {
  return (
    <div className="bp-year year-review viz-root">
      <h2 className="year-title">
        <CalendarHeart size={26} aria-hidden /> Your {year} in Digitify
      </h2>
      <YearReviewBody year={year} />
    </div>
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
  // The songs after it in the list it was opened from play next (D-091), as in the regular app.
  const playSong = async () => {
    const items = await viewList(id, "audio").catch(() => null);
    const tracks = items ? await api.musicTracks({ items }).catch(() => []) : [];
    const at = tracks.findIndex((t) => t.id === ids[0]);
    await (at >= 0 ? music.play(tracks.map((t) => t.id), at) : music.play(ids, 0));
    void navigate({ to: "/bp", search: { screen: "music" } });
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
          {digital && data.handler === "image" && (
            <button type="button" className="bp-button primary" data-bp-focus data-bp-autofocus onClick={() => void navigate({ to: "/view/$id", params: { id: String(id) } })}>
              <Eye size={26} /> View
            </button>
          )}
          {digital && (data.handler === "book" || data.handler === "comic") && (
            <button type="button" className="bp-button primary" data-bp-focus data-bp-autofocus onClick={() => void navigate({ to: "/read/$id", params: { id: String(id) } })}>
              <BookOpen size={26} /> {started ? `Continue · ${Math.round(progress * 100)}%` : "Read"}
            </button>
          )}
          {data.online && !data.online.downloaded && (
            <button type="button" className="bp-button primary" data-bp-focus data-bp-autofocus onClick={() => void navigate({ to: "/bp", search: { screen: "online", id } })}>
              <Play size={26} /> Play online
            </button>
          )}
          {digital && data.handler === "video" && (
            <button type="button" className="bp-button primary" data-bp-focus data-bp-autofocus onClick={() => void navigate({ to: "/watch/$id", params: { id: String(id) } })}>
              <Play size={26} /> {started ? `Resume · ${Math.round(progress * 100)}%` : "Play"}
            </button>
          )}
          {data.handler === "audio" && ids.length > 0 && (
            <button type="button" className="bp-button primary" data-bp-focus data-bp-autofocus onClick={() => void playSong()}>
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
  photoContext.params = query ? { search: query } : null;
  // Arcade's games are found too (D-105), after the media.
  const games = useQuery({ queryKey: ["arcade-games"], queryFn: api.arcadeGames });
  const found = useMemo(() => matchingGames(games.data, query), [games.data, query]);
  const open = useOpenGame();
  return (
    <div className="bp-search">
      <div className="bp-search-box">
        <Search size={30} />
        <input value={text} onChange={(event) => setText(event.target.value)} placeholder="Search your collection" aria-label="Search" />
      </div>
      <OnScreenKeyboard onChange={setText} />
      <div className="bp-grid">
        {/* The library's media, then Arcade's games, as the search screen shows them (D-114). */}
        {results.data?.items.map((item) => <Tile key={item.id} item={item} height={270} />)}
        {found.map((game) => (
          <ArcadeTile key={`game:${game.id}`} game={game} autofocus={false} onPlay={() => open(game)} />
        ))}
      </div>
      {query && results.data?.total === 0 && found.length === 0 && <p className="bp-empty">No matches for “{query}”.</p>}
    </div>
  );
}

/** The menu on Start or the Xbox / PS button: navigation mode, cursor speed, leaving. */
function Menu({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const ambient = useAmbient();
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
        <div className="bp-menu-setting">
          <span>Startup animation</span>
          <div className="bp-choice">
            <button type="button" className="bp-button" data-bp-focus aria-pressed={bp.intro} onClick={() => update((c) => ({ bigPicture: { ...c.bigPicture, intro: true } }))}>
              <Clapperboard size={22} /> On
            </button>
            <button type="button" className="bp-button" data-bp-focus aria-pressed={!bp.intro} onClick={() => update((c) => ({ bigPicture: { ...c.bigPicture, intro: false } }))}>
              <X size={22} /> Off
            </button>
          </div>
        </div>
        <div className="bp-menu-setting">
          <span>{ambient.inGame ? "Music while you play" : "Menu music"}</span>
          <div className="bp-choice">
            <button type="button" className="bp-button" data-bp-focus aria-pressed={ambient.musicOn} onClick={() => !ambient.musicOn && ambient.toggleMusic()}>
              <Music size={22} /> On
            </button>
            <button type="button" className="bp-button" data-bp-focus aria-pressed={!ambient.musicOn} onClick={() => ambient.musicOn && ambient.toggleMusic()}>
              <VolumeOff size={22} /> Off
            </button>
          </div>
        </div>
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
  const navigate = useNavigate();
  if (!music.active || !music.current) return null;
  return (
    <div className="bp-now" role="group" aria-label="Music">
      {/* The cover and title open Now playing (D-072). */}
      <button type="button" className="bp-now-open" data-bp-focus aria-label="Open Now playing" onClick={() => void navigate({ to: "/bp", search: { screen: "music" } })}>
        <span className="bp-now-art">
          <Cover item={{ title: music.current.title, coverKey: music.current.coverKey, handler: "audio" }} iconOnly />
        </span>
        <span className="bp-now-text">
          <strong>{music.current.title}</strong>
          <span>{[music.current.artist, music.current.album].filter(Boolean).join(" · ")}</span>
        </span>
      </button>
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
  const queryClient = useQueryClient();
  const main = useRef<HTMLDivElement>(null);
  const shell = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState(false);
  const cursor = preferences.bigPicture.navigation === "cursor";
  const libraryScope = useLibraryScope();
  // The startup animation, when Big Picture was just entered (D-070), then Home arriving.
  const [intro, setIntro] = useState(() => takeIntro() && preferences.bigPicture.intro);
  const [arrived, setArrived] = useState(false);
  const introOn = useRef(intro);
  introOn.current = intro;
  // Moving and pressing make soft tones, like the rest of the app's interface sounds.
  const tone = (kind: "hover" | "press") => {
    if (preferences.interfaceSounds) ambientEngine.uiSound(kind);
  };

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
      // Moving the selection with the controller ticks softly (the mouse has its own blips).
      if (!cursor && !introOn.current && !target.matches(":hover") && preferences.interfaceSounds) ambientEngine.uiSound("hover");
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
    // During the startup animation any button skips it.
    if (intro) {
      setIntro(false);
      setArrived(true);
      return true;
    }
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
        tone("press");
        (document.activeElement as HTMLElement | null)?.click();
        break;
      case "back":
        tone("press");
        back();
        break;
      case "y":
        // On the search screen, X and Y belong to the keyboard.
        if (screen === "search") return;
        void navigate({ to: "/bp", search: { screen: "search" } });
        break;
      case "x":
        // The online player plays and pauses its own media with X.
        if (screen === "search" || screen === "online" || !music.active) return;
        music.toggle();
        break;
      case "select": {
        // View / Create: the selected item or game becomes a favorite, or stops being one (D-055).
        const focused = document.activeElement as HTMLElement | null;
        const tile = focused?.closest<HTMLElement>("[data-item], [data-game]");
        if (!tile) return;
        const favorite = !tile.hasAttribute("data-favorite");
        if (tile.dataset.item) {
          void api.itemSetFavorite(Number(tile.dataset.item), favorite).then(() => libraryChanged(queryClient));
        } else if (tile.dataset.game) {
          void api.arcadeSetFavorite(Number(tile.dataset.game), favorite).then(() => queryClient.invalidateQueries({ queryKey: ["arcade-games"] }));
        }
        break;
      }
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
  const title = useMemo(() => ({ home: "Home", library: "Library", item: "", search: "Search", online: "", arcade: "Arcade", music: "", game: "", achievements: "", year: "", profile: "" })[screen], [screen]);

  return (
    <div ref={shell} className={`bp${cursor ? " bp-cursor-mode" : ""}${arrived ? " after-intro" : ""}`}>
      {intro && (
        <BigPictureIntro
          onDone={() => {
            setIntro(false);
            setArrived(true);
          }}
        />
      )}
      <header className="bp-top">
        <span className="bp-brand">
          <Gamepad2 size={30} /> Digitify
        </span>
        <nav className="bp-navs">
          {nav({ screen: "home" }, "Home", <House size={24} />, screen === "home")}
          {nav({ screen: "library", scope: screen === "library" ? search.scope ?? libraryScope : libraryScope }, "Library", <LibraryBig size={24} />, screen === "library")}
          {nav({ screen: "arcade" }, "Arcade", <Joystick size={24} />, screen === "arcade")}
          {nav({ screen: "search" }, "Search", <Search size={24} />, screen === "search")}
        </nav>
        <NowPlaying />
        <span className="bp-status">
          <Gamepad2 size={22} /> {buttons.kind === "playstation" ? "PlayStation controller" : buttons.kind ? "Xbox controller" : "No controller"}
        </span>
        <Clock />
        {/* Your profile (D-149). */}
        <button type="button" className="bp-round bp-profile-button" data-bp-focus aria-label="Your profile" onClick={() => void navigate({ to: "/bp", search: { screen: "profile" } })}>
          <BpAvatar />
        </button>
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
        {screen === "library" && <LibraryScreen scope={search.scope ?? libraryScope} />}
        {screen === "item" && search.id != null && <ItemScreen id={search.id} />}
        {screen === "search" && <SearchScreen />}
        {screen === "online" && search.id != null && <OnlineScreen id={search.id} />}
        {screen === "arcade" && <ArcadeScreen scope={search.scope} />}
        {screen === "music" && <NowPlayingScreen />}
        {screen === "game" && search.id != null && <GameScreen id={search.id} />}
        {screen === "achievements" && <AchievementsScreen />}
        {screen === "year" && <YearScreen year={search.id ?? new Date().getFullYear()} />}
        {screen === "profile" && <BpProfileScreen />}
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
        {screen === "arcade" && (
          <span>
            <b>LB</b> <b>RB</b> Consoles
          </span>
        )}
        {screen === "music" && (
          <>
            <span>
              <b>LB</b> <b>RB</b> Tracks
            </span>
            <span>
              <b>LT</b> <b>RT</b> 10 s back / ahead
            </span>
          </>
        )}
        {screen === "online" && (
          <>
            <span>
              <b>{buttons.x}</b> Play / pause
            </span>
            <span>
              <b>LB</b> <b>RB</b> 10 s back / ahead
            </span>
          </>
        )}
        {(screen === "home" || screen === "library" || screen === "arcade" || screen === "search") && (
          <span>
            <b>{buttons.view}</b> Favorite
          </span>
        )}
        <span>
          <b>{buttons.start}</b> Menu
        </span>
      </footer>
      {/* In selection mode the mouse still gets Big Picture's round cursor (the selection stays the controller's). */}
      <Cursor key={cursor ? "cursor" : "mouse"} speed={preferences.bigPicture.cursorSpeed} mouseOnly={!cursor} />
      {menu && <Menu onClose={() => setMenu(false)} />}
    </div>
  );
}

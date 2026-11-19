import { useState, type ComponentPropsWithoutRef, type CSSProperties, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronRight,
  Eye,
  EyeOff,
  FilePlus,
  FolderPlus,
  FolderSearch,
  GripVertical,
  LayoutDashboard,
  LibraryBig,
  Moon,
  Music,
  Plus,
  RotateCcw,
  Sun,
  TriangleAlert,
  Volume2,
  VolumeOff,
  Joystick,
  Award,
} from "lucide-react";
import { type Category, type ArcadeGame, type ItemCard, type TileCover, pictureUrl } from "../../lib/api";
import { plural } from "../../lib/format";
import { useImporter } from "../../lib/importer";
import { arrayMove, useReorder } from "../../lib/reorder";
import { HOME_SECTIONS, useCoverShape, usePreferences, type HomeSection } from "../../lib/preferences";
import { useAmbient } from "../../lib/ambient/AmbientProvider";
import { useDashboard } from "../../lib/queries";
import { AddMenu } from "../../components/AddMenu";
import { Collage } from "../../components/Collage";
import { CategoryIcon, Cover } from "../../components/common";
import { MediaCard } from "../../components/MediaCard";
import { useLaunch } from "../arcade/shared";
import { useAutoBackupStatus, useRelink } from "../settings/LibraryTools";
import { Featured } from "./Featured";
import { DiscsBanner } from "./DiscsBanner";
import { StatsPanel } from "./Stats";
import { FeaturedGame, GameCard, GameRow, useHomeGames } from "./GameSections";

/** Each section's name and what it shows, Library or Arcade (D-042). */
export const SECTION_TITLES: Record<HomeSection, [string, string | null]> = {
  discs: ["Discs", null],
  tiles: ["Library sections", null],
  featured: ["Featured today", "Library"],
  featuredGame: ["Game of the day", "Arcade"],
  upNext: ["Up next", "Library & Arcade"],
  because: ["Because you liked…", "Library"],
  favorites: ["Favorites", "Library"],
  favoriteGames: ["Favorites", "Arcade"],
  continueWatching: ["Continue watching", "Library"],
  continuePlaying: ["Continue playing", "Arcade"],
  continueReading: ["Pick up where you left off", "Library"],
  recentlyAdded: ["Recently added", "Library"],
  recentlyOpened: ["Recently opened", "Library"],
  stats: ["Statistics", "Library & Arcade"],
};
const SECTION_NAMES = Object.fromEntries(Object.entries(SECTION_TITLES).map(([key, [name, from]]) => [key, from ? `${name} (${from})` : name])) as Record<HomeSection, string>;

/** A section's title with where it's from, "(Library)" or "(Arcade)", in a quieter tone. */
export function SectionTitle({ section }: { section: HomeSection }) {
  const [name, from] = SECTION_TITLES[section];
  return (
    <>
      {name}
      {from && <span className="section-source"> ({from})</span>}
    </>
  );
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return "Good evening!";
  if (hour < 12) return "Good morning!";
  if (hour < 18) return "Good afternoon!";
  return "Good evening!";
}

// Pastel "screens" for the built-in sections; other categories cycle through the first five.
const SCREENS: Record<string, number> = { books: 0, comics: 1, manga: 2, video: 3, music: 4, videos: 5, favorites: 6, all: 7, arcade: 2 };

interface TileProps extends ComponentPropsWithoutRef<"button"> {
  label: string;
  screen: number;
  covers: TileCover[];
  icon: ReactNode;
  count?: number;
  add?: boolean;
}

function TileBody({ label, screen, covers, icon, count, add }: Omit<TileProps, keyof ComponentPropsWithoutRef<"button">>) {
  return (
    <>
      <div className={`tile-screen screen-${screen}`}>
        {covers.length > 0 ? <Collage covers={covers} /> : <div className="tile-icon">{icon}</div>}
      </div>
      <div className="tile-label">
        <strong>{label}</strong>
        {count != null && !add && <span className="count">{count.toLocaleString()}</span>}
        <ChevronRight size={18} strokeWidth={2.8} aria-hidden style={count != null && !add ? undefined : { marginLeft: "auto" }} />
      </div>
    </>
  );
}

function SectionTile({ scope, label, screen, covers, icon, count }: { scope: string; label: string; screen: number; covers: TileCover[]; icon: ReactNode; count?: number }) {
  return (
    <Link to="/library/$scope" params={{ scope }} className="tile" data-blip>
      <TileBody label={label} screen={screen} covers={covers} icon={icon} count={count} />
    </Link>
  );
}

/** Columns for the compact tiles (D-041): one row up to six, else two balanced rows (at most six wide). */
function tileColumns(count: number): number {
  if (count <= 6) return Math.max(count, 1);
  return Math.min(6, Math.ceil(count / 2));
}

function Tiles({ categories, covers, total, games }: { categories: Category[]; covers: Record<string, TileCover[]>; total: number; games: { count: number; covers: TileCover[] } }) {
  const visible = categories.filter((category) => !category.isHidden);
  const { preferences } = usePreferences();
  const columns = tileColumns(visible.length + (preferences.showEverything ? 2 : 1));
  return (
    // Rows that come out shorter than the others stay centered under them (D-086).
    <section className="tiles" aria-label="Library sections" style={{ "--cols": columns } as React.CSSProperties}>
      {preferences.showEverything && <SectionTile scope="all" label="Everything" screen={SCREENS.all} covers={covers.all ?? []} icon={<LibraryBig size={36} strokeWidth={2.2} aria-hidden />} count={total} />}
      {visible.map((category, index) => (
        <SectionTile
          key={category.key}
          scope={category.key}
          label={category.name}
          screen={SCREENS[category.key] ?? index % 5}
          covers={covers[category.key] ?? []}
          icon={<CategoryIcon icon={category.icon} size={36} strokeWidth={2.2} />}
          count={category.itemCount}
        />
      ))}
      <Link to="/arcade" className="tile" data-blip>
        <TileBody label="Arcade" screen={SCREENS.arcade} covers={games.covers} icon={<Joystick size={36} strokeWidth={2.2} aria-hidden />} count={games.count} />
      </Link>
    </section>
  );
}

function ContinueCard({ item }: { item: ItemCard }) {
  const percent = Math.round((item.progress ?? 0) * 100);
  const { shape, aspect } = useCoverShape()(item);
  return (
    <Link to={item.handler === "video" ? "/watch/$id" : "/read/$id"} params={{ id: String(item.id) }} className="continue-card" data-blip>
      <div className="continue-thumb" data-shape={shape} style={{ aspectRatio: aspect }}>
        <Cover item={item} />
      </div>
      <div className="continue-body">
        <h3>{item.title}</h3>
        <p>{percent}% complete</p>
        <div className="meter" role="progressbar" aria-label="Progress" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
          <span style={{ width: `${percent}%` }} />
        </div>
      </div>
    </Link>
  );
}

/** Cover height in Home's rows (a vertical cover 152 px wide). */
const ROW_ART_HEIGHT = 228;

function Row({ title, items, more }: { title: ReactNode; items: ItemCard[]; more?: { scope: string } }) {
  const shapeOf = useCoverShape();
  return (
    <section className="section">
      <div className="section-head">
        <h2>{title}</h2>
        {more && (
          <Link to="/library/$scope" params={{ scope: more.scope }}>
            See all
          </Link>
        )}
      </div>
      <div className="row-scroller">
        {items.map((item) => (
          // Every cover in a row has the same height; horizontal ones are wider.
          <MediaCard key={item.id} item={item} width={Math.round(ROW_ART_HEIGHT * shapeOf(item).aspect)} />
        ))}
      </div>
    </section>
  );
}

/**
 * "Up next" (D-050): one row of what comes next, mixed — the film or series being watched, the
 * book being read, the next volume of a series just finished, the game played lately.
 */
function UpNext({ watching, reading, next, games, running }: { watching: ItemCard[]; reading: ItemCard[]; next: ItemCard[]; games: ArcadeGame[]; running: number | null }) {
  const shapeOf = useCoverShape();
  const { launch } = useLaunch();
  const lists: ({ kind: "item"; item: ItemCard } | { kind: "game"; game: ArcadeGame })[][] = [
    watching.slice(0, 4).map((item) => ({ kind: "item" as const, item })),
    reading.slice(0, 4).map((item) => ({ kind: "item" as const, item })),
    next.slice(0, 4).map((item) => ({ kind: "item" as const, item })),
    games.slice(0, 4).map((game) => ({ kind: "game" as const, game })),
  ];
  // Taken in turns, so each kind has its first entries near the front.
  const entries: (typeof lists)[number] = [];
  const seen = new Set<number>();
  for (let n = 0; n < 4; n++) {
    for (const list of lists) {
      const entry = list[n];
      if (!entry) continue;
      if (entry.kind === "item") {
        if (seen.has(entry.item.id)) continue;
        seen.add(entry.item.id);
      }
      entries.push(entry);
    }
  }
  if (!entries.length) return null;
  return (
    <section className="section">
      <div className="section-head">
        <h2>
          <SectionTitle section="upNext" />
        </h2>
      </div>
      <div className="row-scroller home-games">
        {entries.map((entry) =>
          entry.kind === "item" ? (
            <MediaCard key={`i${entry.item.id}`} item={entry.item} width={Math.round(ROW_ART_HEIGHT * shapeOf(entry.item).aspect * 0.88)} />
          ) : (
            <GameCard key={`g${entry.game.id}`} game={entry.game} running={running === entry.game.id} onPlay={() => void launch(entry.game)} />
          ),
        )}
      </div>
    </section>
  );
}

/** In "Customize Home", each section is a row to drag (or move with the arrows) and to hide or show. */
function EditBar({
  section,
  index,
  count,
  hidden,
  empty,
  handle,
  style,
}: {
  section: HomeSection;
  index: number;
  count: number;
  hidden: boolean;
  empty: boolean;
  handle: ReturnType<ReturnType<typeof useReorder>["handle"]>;
  style?: CSSProperties;
}) {
  const { preferences, update } = usePreferences();
  const move = (by: number) => update({ home: { ...preferences.home, order: arrayMove(preferences.home.order, index, index + by) } });
  const toggle = () =>
    update({
      home: { ...preferences.home, hidden: hidden ? preferences.home.hidden.filter((s) => s !== section) : [...preferences.home.hidden, section] },
    });
  return (
    <li className={`home-edit-bar${hidden ? " is-hidden" : ""}`} data-reorder style={style}>
      <span {...handle} aria-label={`Drag “${SECTION_NAMES[section]}”`}>
        <GripVertical size={18} />
      </span>
      <strong>{SECTION_NAMES[section]}</strong>
      {hidden ? <span className="home-edit-note">Hidden</span> : empty && <span className="home-edit-note">Nothing to show right now</span>}
      <span className="spacer" />
      <button type="button" className="icon-btn" aria-label={`Move “${SECTION_NAMES[section]}” up`} disabled={index === 0} onClick={() => move(-1)}>
        <ArrowUp size={16} />
      </button>
      <button type="button" className="icon-btn" aria-label={`Move “${SECTION_NAMES[section]}” down`} disabled={index === count - 1} onClick={() => move(1)}>
        <ArrowDown size={16} />
      </button>
      <button type="button" className="btn btn-sm" aria-pressed={!hidden} onClick={toggle}>
        {hidden ? <EyeOff size={15} /> : <Eye size={15} />} {hidden ? "Show" : "Shown"}
      </button>
    </li>
  );
}

export function HomePage() {
  const dashboard = useDashboard();
  const importer = useImporter();
  const relink = useRelink();
  const { preferences, resolvedTheme, update } = usePreferences();
  const ambient = useAmbient();
  const [editing, setEditing] = useState(false);
  const games = useHomeGames();
  const autoBackup = useAutoBackupStatus();
  const reorder = useReorder((from, to) => update((current) => ({ home: { ...current.home, order: arrayMove(current.home.order, from, to) } })));
  const data = dashboard.data;
  if (!data) return <div className="page" />;
  const dark = resolvedTheme === "dark";
  const hasItems = data.totals.items > 0 || games.count > 0;

  // Each section's content, or null when it has nothing to show.
  const content: Record<HomeSection, ReactNode> = {
    tiles: <Tiles categories={data.categories} covers={data.tileCovers} total={data.totals.items} games={games} />,
    continuePlaying: games.recent.length > 0 && <GameRow title={<SectionTitle section="continuePlaying" />} games={games.recent} running={games.running} starting={games.starting} />,
    favoriteGames: games.favorites.length > 0 && <GameRow title={<SectionTitle section="favoriteGames" />} games={games.favorites} running={games.running} starting={games.starting} />,
    featuredGame: games.featured && <FeaturedGame game={games.featured} running={games.running === games.featured.id} />,
    because: data.because && (
      <Row
        title={
          <>
            Because you liked <em className="because-seed">{data.because.seed.title}</em>
            <span className="section-source"> (Library)</span>
          </>
        }
        items={data.because.items}
      />
    ),
    upNext: <UpNext watching={data.continueWatching} reading={data.continueItems} next={data.nextVolumes} games={games.recent} running={games.running} />,
    featured: data.featured && (
      <section className="section" aria-label="Featured today">
        <Featured item={data.featured} />
      </section>
    ),
    continueWatching: data.continueWatching.length > 0 && (
      <section className="section">
        <div className="section-head">
          <h2>
            <SectionTitle section="continueWatching" />
          </h2>
        </div>
        <div className="continue-grid">
          {data.continueWatching.map((item) => (
            <ContinueCard key={item.id} item={item} />
          ))}
        </div>
      </section>
    ),
    continueReading: data.continueItems.length > 0 && (
      <section className="section">
        <div className="section-head">
          <h2>
            <SectionTitle section="continueReading" />
          </h2>
        </div>
        <div className="continue-grid">
          {data.continueItems.map((item) => (
            <ContinueCard key={item.id} item={item} />
          ))}
        </div>
      </section>
    ),
    recentlyOpened: data.recentlyOpened.length > 0 && <Row title={<SectionTitle section="recentlyOpened" />} items={data.recentlyOpened} />,
    recentlyAdded: data.recent.length > 0 && <Row title={<SectionTitle section="recentlyAdded" />} items={data.recent} more={{ scope: "all" }} />,
    favorites: data.favorites.length > 0 && <Row title={<SectionTitle section="favorites" />} items={data.favorites} more={{ scope: "favorites" }} />,
    discs: (
      <section className="section">
        <DiscsBanner />
      </section>
    ),
    stats: hasItems && (
      <section className="section">
        <div className="section-head">
          <h2>
            <SectionTitle section="stats" />
          </h2>
        </div>
        <StatsPanel />
      </section>
    ),
  };
  const order = preferences.home.order;

  // A photo picked in the image viewer shows behind Home (D-033), fading into the page.
  const wallpaper = preferences.homeWallpaper != null ? { backgroundImage: `var(--wallpaper-fade), url("${pictureUrl(preferences.homeWallpaper)}")` } : undefined;
  return (
    <div className={`page${wallpaper ? " with-wallpaper" : ""}`} style={wallpaper}>
      <div className="greeting">
        <div>
          <h1 className="display">{greeting()}</h1>
          <p>{data.totals.items === 0 ? "Let's bring your collection in." : "Where would you like to go today?"}</p>
        </div>
        <div className="greeting-actions">
          {editing && preferences.homeWallpaper != null && (
            <button type="button" className="btn" onClick={() => update({ homeWallpaper: null })}>
              Remove background
            </button>
          )}
          {/* Achievements first (D-100), then Customize Home. */}
          <Link to="/achievements" className="btn">
            <Award size={17} strokeWidth={2.4} aria-hidden /> Achievements
          </Link>
          {hasItems && (
            <button type="button" className="btn glow-when-on" aria-pressed={editing} onClick={() => setEditing(!editing)}>
              <LayoutDashboard size={17} strokeWidth={2.4} aria-hidden /> Customize Home
            </button>
          )}
          <AddMenu align="end">
            <button type="button" className="round-btn lg" aria-label="Add to library" title="Add to library">
              <Plus size={20} strokeWidth={2.6} />
            </button>
          </AddMenu>
          <button
            type="button"
            className="round-btn lg sound-toggle"
            aria-pressed={ambient.interfaceSounds}
            aria-label={ambient.interfaceSounds ? "Interface sounds: on" : "Interface sounds: off"}
            title={ambient.interfaceSounds ? "Interface sounds: on (click to turn off)" : "Interface sounds: off (click to turn on)"}
            onClick={() => ambient.setInterfaceSounds(!ambient.interfaceSounds)}
          >
            {ambient.interfaceSounds ? <Volume2 size={19} strokeWidth={2.4} aria-hidden /> : <VolumeOff size={19} strokeWidth={2.4} aria-hidden />}
          </button>
          <button
            type="button"
            className="round-btn lg sound-toggle menu-music-toggle"
            aria-pressed={ambient.musicOn}
            aria-label={ambient.musicOn ? "Menu music: on" : "Menu music: off"}
            title={
              ambient.inGame
                ? ambient.musicOn
                  ? "Menu music: on while you play (click to silence it)"
                  : "Menu music: silent while you play (click to turn it on)"
                : ambient.musicOn
                  ? "Menu music: on (click to turn off)"
                  : "Menu music: off (click to turn on)"
            }
            onClick={ambient.toggleMusic}
          >
            <Music size={19} strokeWidth={2.4} aria-hidden />
          </button>
          {/* Midnight is only dark: no light/night switch. */}
          {!(preferences.look === "breeze" && preferences.palette === "midnight") && (
            <button
              type="button"
              className="round-btn lg"
              aria-label={dark ? "Switch to light mode" : "Switch to night mode"}
              title={dark ? "Switch to light mode" : "Switch to night mode"}
              onClick={() => update({ theme: dark ? "light" : "dark" })}
            >
              {dark ? <Sun size={19} strokeWidth={2.4} /> : <Moon size={19} strokeWidth={2.4} />}
            </button>
          )}
        </div>
      </div>

      {data.totals.items === 0 && (
        <section className="welcome" aria-labelledby="welcome-title">
          <h2 id="welcome-title">Your library is ready</h2>
          <p>
            Import photos, ebooks, comics and manga (CBZ, PDF, EPUB), films, episodes and videos, and music. You can
            also drop files or folders anywhere on this window, or import from a link with “Add”.
          </p>
          <div className="actions">
            <button type="button" className="btn btn-primary btn-lg" onClick={() => void importer.pickFolder()}>
              <FolderPlus size={18} /> Import a folder
            </button>
            <button type="button" className="btn btn-lg" onClick={() => void importer.pickFiles()}>
              <FilePlus size={18} /> Import files
            </button>
          </div>
        </section>
      )}

      {autoBackup.data?.missingFolder && (
        <div className="notice warning" style={{ marginTop: 20 }}>
          <TriangleAlert size={18} aria-hidden style={{ flexShrink: 0, marginTop: 1 }} />
          <span>
            The automatic backup couldn't be copied to {autoBackup.data.missingFolder}: connect its drive. The backup itself was kept in the library's backups folder.
          </span>
          <Link to="/settings" className="btn btn-sm" style={{ marginLeft: "auto", flexShrink: 0 }}>
            Settings
          </Link>
        </div>
      )}

      {data.totals.missingFiles > 0 && (
        <div className="notice warning" style={{ marginTop: 20 }}>
          <TriangleAlert size={18} aria-hidden style={{ flexShrink: 0, marginTop: 1 }} />
          <span>
            {plural(data.totals.missingFiles, "file")} can't be found at {data.totals.missingFiles === 1 ? "its" : "their"} saved
            location. The drive may be disconnected, or the files were moved. Items with missing files are marked in
            your library.
            {relink.message && <strong style={{ display: "block", marginTop: 6 }}>{relink.message}</strong>}
          </span>
          <button type="button" className="btn btn-sm" style={{ marginLeft: "auto", flexShrink: 0 }} disabled={relink.busy} onClick={() => void relink.run()}>
            <FolderSearch size={14} /> Find moved files…
          </button>
        </div>
      )}

      {editing && (
        <div className="notice home-edit-notice">
          <LayoutDashboard size={18} aria-hidden style={{ flexShrink: 0, marginTop: 1 }} />
          <span>Arrange Home: drag sections into the order you like, and hide the ones you don't need. Changes are saved as you go.</span>
          <span className="spacer" />
          <button type="button" className="btn btn-sm" onClick={() => update({ home: { order: [...HOME_SECTIONS], hidden: [] } })}>
            <RotateCcw size={14} /> Reset
          </button>
          <button type="button" className="btn btn-sm btn-primary" onClick={() => setEditing(false)}>
            <Check size={14} /> Done
          </button>
        </div>
      )}

      {editing ? (
        <ol ref={reorder.listRef} className="home-arrange">
          {order.map((section, index) => (
            <EditBar
              key={section}
              section={section}
              index={index}
              count={order.length}
              hidden={preferences.home.hidden.includes(section)}
              empty={!content[section]}
              handle={reorder.handle(index)}
              style={reorder.style(index)}
            />
          ))}
        </ol>
      ) : (
        order
          .filter((section) => !preferences.home.hidden.includes(section) && content[section])
          .map((section, index) => (
            <div key={section} className="home-section" style={{ ["--i" as string]: index }}>
              {content[section]}
            </div>
          ))
      )}
      {data.totals.items > 0 && (
        <p className="home-totals">
          {plural(data.totals.items, "item")} · {data.totals.digital.toLocaleString()} with files in your library
        </p>
      )}
    </div>
  );
}

import { DropdownMenu } from "radix-ui";
import { open as openFile } from "@tauri-apps/plugin-dialog";
import { DEFAULT_VIEW, PictureAdjuster, viewStyle } from "../profile/Picture";
import { useState, type ComponentPropsWithoutRef, type CSSProperties, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
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
  ImagePlus,
  Move,
  Gamepad2,
  Disc3,
  LayoutGrid,
  ListVideo,
  Heart,
  Star,
  Clapperboard,
  BookOpen,
  CirclePlus,
  History,
  ChartColumn,
  ChevronDown,
  Trash2,
} from "lucide-react";
import { api, artworkUrl, errorText, type Category, type ArcadeGame, type ItemCard, type TileCover, pictureUrl } from "../../lib/api";
import { plural } from "../../lib/format";
import { useImporter } from "../../lib/importer";
import { arrayMove, useReorder } from "../../lib/reorder";
import { HOME_SECTIONS, homeSectionHidden, shortcutColor, useCoverShape, usePreferences, type HomeSection } from "../../lib/preferences";
import { useAmbient } from "../../lib/ambient/AmbientProvider";
import { useDashboard } from "../../lib/queries";
import { AddMenu } from "../../components/AddMenu";
import { photoContext } from "../../lib/routes";
import { addProgramGame } from "../arcade/shared";
import { Collage, RotatingCollage } from "../../components/Collage";
import { CategoryIcon, Cover, Dialog } from "../../components/common";
import { MediaCard } from "../../components/MediaCard";
import { RowScroller } from "../../components/RowScroller";
import { useLaunch } from "../arcade/shared";
import { useAutoBackupStatus, useRelink } from "../settings/LibraryTools";
import { Featured } from "./Featured";
import { DiscsBanner } from "./DiscsBanner";
import { StatsPanel } from "./Stats";
import { FeaturedGame, GameCard, GameRow, useHomeGames } from "./GameSections";

/** Each section's name and what it shows, Library or Arcade (D-042). */
export const SECTION_TITLES: Record<HomeSection, [string, string | null]> = {
  discs: ["Discs", null],
  tiles: ["Home Shortcuts", null],
  featured: ["Spotlight", null],
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
export const SCREENS: Record<string, number> = { books: 0, comics: 1, manga: 2, video: 3, music: 4, videos: 5, favorites: 6, all: 7, arcade: 2 };

interface TileProps extends ComponentPropsWithoutRef<"button"> {
  label: string;
  screen: number;
  covers: TileCover[];
  icon: ReactNode;
  count?: number;
  add?: boolean;
}

/**
 * A Home Shortcut's face (D-184): its covers fanned over its colour, or over a picture of one's own
 * (set in Customize Home), and under them its icon, name and count. Big Picture draws the same.
 */
export function TileBody({ label, screen, covers, icon, count, add, turn, tile }: Omit<TileProps, keyof ComponentPropsWithoutRef<"button">> & { turn?: number; tile?: string }) {
  const { preferences } = usePreferences();
  const background = tile ? preferences.tileBackgrounds[tile] : undefined;
  // Each shortcut on its section's color (D-184): Pictures light blue, Music green, Videos orange,
  // Movies & Series red, Books royal blue, Arcade violet, or the colors chosen per section.
  const color = tile ? shortcutColor(tile, preferences.sectionColors) : undefined;
  return (
    <>
      <div className={`tile-screen screen-${screen}${background ? " with-background" : ""}${color ? " tinted" : ""}`} style={color ? ({ "--tile-tint": color } as CSSProperties) : undefined}>
        {/* The picture of one's own behind (D-184), the covers moving on through the newest ones in
            front (D-177). */}
        {background && <img className="tile-background" src={artworkUrl(background.key, "cover")} alt="" style={viewStyle(background.view)} draggable={false} />}
        {covers.length > 0 ? <RotatingCollage covers={covers} turn={turn} /> : !background && <div className="tile-icon">{icon}</div>}
        <span className="tile-shine" aria-hidden />
      </div>
      <div className="tile-label">
        <span className="tile-badge" aria-hidden>
          {icon}
        </span>
        <strong>{label}</strong>
        {count != null && !add && <span className="count">{count.toLocaleString()}</span>}
        <ChevronRight size={18} strokeWidth={2.8} aria-hidden style={count != null && !add ? undefined : { marginLeft: "auto" }} />
      </div>
    </>
  );
}

/** One Home Shortcut: where it goes, and what its face shows. */
interface Shortcut {
  tile: string;
  label: string;
  screen: number;
  covers: TileCover[];
  icon: ReactNode;
  count: number;
  turn: number;
}

/** Home's shortcuts in their order (D-074, D-184): Everything when turned on, the categories, Arcade. */
function useShortcuts(categories: Category[], covers: Record<string, TileCover[]>, total: number, games: { count: number; covers: TileCover[] }): Shortcut[] {
  const { preferences } = usePreferences();
  const visible = categories.filter((category) => !category.isHidden);
  return [
    ...(preferences.showEverything ? [{ tile: "all", label: "Everything", screen: SCREENS.all, covers: covers.all ?? [], icon: <LibraryBig size={36} strokeWidth={2.2} aria-hidden />, count: total, turn: 0 }] : []),
    ...visible.map((category, index) => ({
      tile: category.key,
      label: category.name,
      screen: SCREENS[category.key] ?? index % 5,
      covers: covers[category.key] ?? [],
      icon: <CategoryIcon icon={category.icon} size={36} strokeWidth={2.2} />,
      count: category.itemCount,
      turn: index + 1,
    })),
    { tile: "arcade", label: "Arcade", screen: SCREENS.arcade, covers: games.covers, icon: <Joystick size={36} strokeWidth={2.2} aria-hidden />, count: games.count, turn: visible.length + 1 },
  ];
}

/**
 * The shortcuts' backgrounds in Customize Home (D-184): each shortcut as it looks, with a picture
 * of one's own to put behind its covers, adjusted in a frame of the card's own shape (the covers
 * drawn over it as they'll be), or taken away again.
 */
function ShortcutBackgrounds({ shortcuts }: { shortcuts: Shortcut[] }) {
  const { preferences, update } = usePreferences();
  const [adjusting, setAdjusting] = useState<Shortcut | null>(null);
  const [view, setView] = useState(DEFAULT_VIEW);
  const [error, setError] = useState<string | null>(null);
  const save = (tile: string, next: { key: string; view: typeof view } | null) =>
    update((c) => {
      const all = { ...c.tileBackgrounds };
      if (next) all[tile] = next;
      else delete all[tile];
      return { tileBackgrounds: all };
    });
  const choose = async (shortcut: Shortcut) => {
    setError(null);
    const path = await openFile({ multiple: false, title: `A picture behind ${shortcut.label}'s covers`, filters: [{ name: "Pictures", extensions: ["jpg", "jpeg", "png", "webp", "gif", "bmp"] }] });
    if (typeof path !== "string") return;
    try {
      const key = await api.artworkImport(path);
      save(shortcut.tile, { key, view: DEFAULT_VIEW });
      setView(DEFAULT_VIEW);
      setAdjusting(shortcut);
    } catch (reason) {
      setError(errorText(reason));
    }
  };
  const editing = adjusting ? preferences.tileBackgrounds[adjusting.tile] : undefined;
  return (
    <div className="home-edit-backgrounds">
      <p className="home-edit-hint">A picture of your own behind a shortcut's covers; the covers keep moving on in front of it.</p>
      {error && <p className="dialog-error">{error}</p>}
      <div className="home-edit-shortcuts">
        {shortcuts.map((shortcut) => {
          const background = preferences.tileBackgrounds[shortcut.tile];
          return (
            <div key={shortcut.tile} className="home-edit-shortcut">
              <div className="tile shortcut-preview">
                <TileBody label={shortcut.label} screen={shortcut.screen} covers={shortcut.covers} icon={shortcut.icon} count={shortcut.count} turn={shortcut.turn} tile={shortcut.tile} />
              </div>
              <div className="home-edit-shortcut-actions">
                <button type="button" className="btn btn-sm" onClick={() => void choose(shortcut)}>
                  <ImagePlus size={14} /> {background ? "Change" : "Background…"}
                </button>
                {background && (
                  <>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`Adjust ${shortcut.label}'s background`}
                      title="Adjust"
                      onClick={() => {
                        setView(background.view);
                        setAdjusting(shortcut);
                      }}
                    >
                      <Move size={15} />
                    </button>
                    <button type="button" className="icon-btn" aria-label={`Remove ${shortcut.label}'s background`} title="Remove" onClick={() => save(shortcut.tile, null)}>
                      <Trash2 size={15} />
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {adjusting && editing && (
        <Dialog
          open
          wide
          onOpenChange={(o) => !o && setAdjusting(null)}
          title={`${adjusting.label}'s background`}
          footer={
            <>
              <button type="button" className="btn btn-ghost" onClick={() => setView(DEFAULT_VIEW)}>
                <RotateCcw size={15} /> Reset
              </button>
              <button type="button" className="btn" onClick={() => setAdjusting(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  save(adjusting.tile, { key: editing.key, view });
                  setAdjusting(null);
                }}
              >
                Save
              </button>
            </>
          }
        >
          {/* The card's own shape, with its covers over the picture as on Home (D-184). */}
          <PictureAdjuster
            picture={artworkUrl(editing.key, "cover")}
            view={view}
            onChange={setView}
            kind="tile"
            overlay={
              <div className={`tile-screen-overlay screen-${adjusting.screen}`}>
                <Collage covers={adjusting.covers.slice(0, 3)} />
              </div>
            }
          />
        </Dialog>
      )}
    </div>
  );
}

/**
 * Home Shortcuts' columns (D-184): all in one row up to seven, so they take about the top half of
 * the screen and what's below shows too; more make two even rows.
 */
export function shortcutColumns(count: number): number {
  if (count <= 7) return Math.max(count, 1);
  return Math.ceil(count / 2);
}

function Tiles({ shortcuts }: { shortcuts: Shortcut[] }) {
  const columns = shortcutColumns(shortcuts.length);
  return (
    // Rows that come out shorter than the others stay centered under them (D-086).
    <section className="tiles shortcuts" aria-label="Home Shortcuts" style={{ "--cols": columns } as React.CSSProperties}>
      {shortcuts.map((shortcut) => (
        <Link
          key={shortcut.tile}
          to={shortcut.tile === "arcade" ? "/arcade" : "/library/$scope"}
          params={shortcut.tile === "arcade" ? undefined : { scope: shortcut.tile }}
          activeOptions={{ includeSearch: false }}
          className="tile"
          data-blip
        >
          <TileBody label={shortcut.label} screen={shortcut.screen} covers={shortcut.covers} icon={shortcut.icon} count={shortcut.count} turn={shortcut.turn} tile={shortcut.tile} />
        </Link>
      ))}
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
      <RowScroller>
        {items.map((item) => (
          // Every cover in a row has the same height; horizontal ones are wider.
          <MediaCard key={item.id} item={item} width={Math.round(ROW_ART_HEIGHT * shapeOf(item).aspect)} />
        ))}
      </RowScroller>
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
      <RowScroller className="home-games">
        {entries.map((entry) =>
          entry.kind === "item" ? (
            <MediaCard key={`i${entry.item.id}`} item={entry.item} width={Math.round(ROW_ART_HEIGHT * shapeOf(entry.item).aspect * 0.88)} />
          ) : (
            <GameCard key={`g${entry.game.id}`} game={entry.game} running={running === entry.game.id} onPlay={() => void launch(entry.game)} />
          ),
        )}
      </RowScroller>
    </section>
  );
}

/** Each section's symbol in Customize Home (D-184). */
const SECTION_ICONS: Record<HomeSection, typeof Award> = {
  discs: Disc3,
  tiles: LayoutGrid,
  featured: Award,
  featuredGame: Gamepad2,
  upNext: ListVideo,
  because: Heart,
  favorites: Star,
  favoriteGames: Star,
  continueWatching: Clapperboard,
  continuePlaying: Gamepad2,
  continueReading: BookOpen,
  recentlyAdded: CirclePlus,
  recentlyOpened: History,
  stats: ChartColumn,
};

/**
 * In "Customize Home" (D-184), each section is a card to drag (or move with the arrows) and to hide
 * or show, with its symbol and where it comes from; the Spotlight has a switch for each half, and
 * Home Shortcuts opens the shortcuts' backgrounds.
 */
function EditBar({
  section,
  index,
  count,
  hidden,
  empty,
  handle,
  style,
  shortcuts,
}: {
  section: HomeSection;
  index: number;
  count: number;
  hidden: boolean;
  empty: boolean;
  handle: ReturnType<ReturnType<typeof useReorder>["handle"]>;
  style?: CSSProperties;
  shortcuts: Shortcut[];
}) {
  const { preferences, update } = usePreferences();
  const [open, setOpen] = useState(false);
  const move = (by: number) => update({ home: { ...preferences.home, order: arrayMove(preferences.home.order, index, index + by) } });
  const toggleOne = (which: HomeSection) => {
    const off = preferences.home.hidden.includes(which);
    update({ home: { ...preferences.home, hidden: off ? preferences.home.hidden.filter((s) => s !== which) : [...preferences.home.hidden, which] } });
  };
  const [name, from] = SECTION_TITLES[section];
  const Icon = SECTION_ICONS[section];
  const backgrounds = Object.keys(preferences.tileBackgrounds).length;
  return (
    <li className={`home-edit-bar${hidden ? " is-hidden" : ""}${open ? " is-open" : ""}`} data-reorder style={style}>
      <div className="home-edit-row">
        <span {...handle} aria-label={`Drag “${SECTION_NAMES[section]}”`}>
          <GripVertical size={18} />
        </span>
        <span className="home-edit-icon" aria-hidden>
          <Icon size={18} strokeWidth={2.4} />
        </span>
        <span className="home-edit-name">
          <strong>{name}</strong>
          {from && <span className="home-edit-from">{from}</span>}
        </span>
        {hidden ? <span className="home-edit-note">Hidden</span> : empty && <span className="home-edit-note">Nothing to show right now</span>}
        <span className="spacer" />
        {section === "tiles" && (
          <button type="button" className="btn btn-sm" aria-expanded={open} onClick={() => setOpen(!open)}>
            <ImagePlus size={15} /> Backgrounds{backgrounds > 0 ? ` (${backgrounds})` : ""}
            <ChevronDown size={15} className="home-edit-chevron" />
          </button>
        )}
        <span className="home-edit-moves">
          <button type="button" className="icon-btn" aria-label={`Move “${SECTION_NAMES[section]}” up`} disabled={index === 0} onClick={() => move(-1)}>
            <ArrowUp size={16} />
          </button>
          <button type="button" className="icon-btn" aria-label={`Move “${SECTION_NAMES[section]}” down`} disabled={index === count - 1} onClick={() => move(1)}>
            <ArrowDown size={16} />
          </button>
        </span>
        {section === "featured" ? (
          // The Spotlight (D-184): Featured today and Game of the day, each on or off by itself.
          // One button the size of the others' Shown, its two halves in a menu, so the arrows keep their place.
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button type="button" className="btn btn-sm home-edit-show home-edit-halves" aria-pressed={!hidden} aria-label="What the Spotlight shows">
                {hidden ? <EyeOff size={15} /> : <Eye size={15} />}{" "}
                {hidden ? "Hidden" : preferences.home.hidden.includes("featured") || preferences.home.hidden.includes("featuredGame") ? "1 of 2" : "Shown"}
                <ChevronDown size={14} />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content className="menu" align="end" sideOffset={6}>
                {(
                  [
                    ["featured", "Featured today", Award],
                    ["featuredGame", "Game of the day", Gamepad2],
                  ] as const
                ).map(([which, label, HalfIcon]) => (
                  <DropdownMenu.CheckboxItem
                    key={which}
                    className="menu-item home-edit-half"
                    checked={!preferences.home.hidden.includes(which)}
                    onSelect={(event) => event.preventDefault()}
                    onCheckedChange={() => toggleOne(which)}
                  >
                    <HalfIcon size={16} /> {label}
                    <DropdownMenu.ItemIndicator className="home-edit-check">
                      <Check size={15} />
                    </DropdownMenu.ItemIndicator>
                  </DropdownMenu.CheckboxItem>
                ))}
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        ) : (
          <button type="button" className="btn btn-sm home-edit-show" aria-pressed={!hidden} onClick={() => toggleOne(section)}>
            {hidden ? <EyeOff size={15} /> : <Eye size={15} />} {hidden ? "Hidden" : "Shown"}
          </button>
        )}
      </div>
      {section === "tiles" && open && <ShortcutBackgrounds shortcuts={shortcuts} />}
    </li>
  );
}

export function HomePage() {
  const dashboard = useDashboard();
  const navigate = useNavigate();
  const importer = useImporter();
  const relink = useRelink();
  const { preferences, resolvedTheme, update } = usePreferences();
  const ambient = useAmbient();
  const [editing, setEditing] = useState(false);
  const games = useHomeGames();
  const autoBackup = useAutoBackupStatus();
  const reorder = useReorder((from, to) => update((current) => ({ home: { ...current.home, order: arrayMove(current.home.order, from, to) } })));
  const data = dashboard.data;
  const shortcuts = useShortcuts(data?.categories ?? [], data?.tileCovers ?? {}, data?.totals.items ?? 0, games);
  // Items opened from Home step through no list (D-138): only a library view sets one.
  photoContext.params = null;
  if (!data) return <div className="page" />;
  const dark = resolvedTheme === "dark";
  const hasItems = data.totals.items > 0 || games.count > 0;

  // Each section's content, or null when it has nothing to show.
  const content: Record<HomeSection, ReactNode> = {
    tiles: <Tiles shortcuts={shortcuts} />,
    continuePlaying: games.recent.length > 0 && <GameRow title={<SectionTitle section="continuePlaying" />} games={games.recent} running={games.running} starting={games.starting} />,
    favoriteGames: games.favorites.length > 0 && <GameRow title={<SectionTitle section="favoriteGames" />} games={games.favorites} running={games.running} starting={games.starting} />,
    // Game of the day lives in the Spotlight (D-184).
    featuredGame: null,
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
    // The Spotlight (D-184): Featured today and Game of the day, side by side when both are on.
    featured: (() => {
      const item = !preferences.home.hidden.includes("featured") ? data.featured : null;
      const game = !preferences.home.hidden.includes("featuredGame") ? games.featured : null;
      if (!item && !game) return null;
      return (
        <section className={`section home-spotlight${item && game ? " both" : ""}`} aria-label="Spotlight">
          {item && <Featured item={item} />}
          {game && <FeaturedGame game={game} running={games.running === game.id} />}
        </section>
      );
    })(),
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
          {/* Home holds everything (D-125): each category's ways in, and a game for Arcade. */}
          <AddMenu
            align="end"
            onAddGame={() =>
              void addProgramGame(preferences.arcade.downloadCovers).then(
                (id) => id != null && void navigate({ to: "/arcade", search: { game: id } }),
                () => void navigate({ to: "/arcade" }),
              )
            }
          >
            <button type="button" className="round-btn lg" aria-label="Add" title="Add">
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
          <Link to="/settings" search={{ tab: "library" }} className="btn btn-sm" style={{ marginLeft: "auto", flexShrink: 0 }}>
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
          <span className="home-edit-notice-icon" aria-hidden>
            <LayoutDashboard size={20} />
          </span>
          <span className="home-edit-notice-text">
            <strong>Customize Home</strong>
            <span>Drag sections into the order you like, hide the ones you don't need, and give the shortcuts pictures of your own. Changes are saved as you go.</span>
          </span>
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
              hidden={homeSectionHidden(preferences.home, section)}
              empty={!content[section]}
              handle={reorder.handle(index)}
              style={reorder.style(index)}
              shortcuts={shortcuts}
            />
          ))}
        </ol>
      ) : (
        order
          .filter((section) => !homeSectionHidden(preferences.home, section) && content[section])
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

import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronRight, FilePlus, FolderPlus, FolderSearch, LibraryBig, Moon, Package, Plus, Star, Sun, TriangleAlert, Volume2, VolumeOff } from "lucide-react";
import { type Category, type ItemCard, type TileCover } from "../../lib/api";
import { plural } from "../../lib/format";
import { useImporter } from "../../lib/importer";
import { usePreferences } from "../../lib/preferences";
import { useAmbient } from "../../lib/ambient/AmbientProvider";
import { useDashboard, useShelves } from "../../lib/queries";
import { AddMenu } from "../../components/AddMenu";
import { Collage } from "../../components/Collage";
import { aspectFor, CategoryIcon, Cover } from "../../components/common";
import { MediaCard } from "../../components/MediaCard";
import { ShelfCard } from "../organize/pages";
import { useRelink } from "../settings/LibraryTools";

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return "Good evening!";
  if (hour < 12) return "Good morning!";
  if (hour < 18) return "Good afternoon!";
  return "Good evening!";
}

// Pastel "screens" for the built-in sections; other categories cycle through the first five.
const SCREENS: Record<string, number> = { books: 0, comics: 1, manga: 2, video: 3, music: 4, add: 5, favorites: 6, all: 7 };

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

/** The "Add to library" tile is a menu button, so it forwards its ref and props to the trigger. */
const AddTile = forwardRef<HTMLButtonElement, ComponentPropsWithoutRef<"button">>(function AddTile(props, ref) {
  return (
    <button ref={ref} type="button" className="tile add" data-blip {...props}>
      <TileBody label="Add to library" screen={SCREENS.add} covers={[]} icon={<Plus size={46} strokeWidth={2.6} aria-hidden />} add />
    </button>
  );
});

function SectionTile({ scope, label, screen, covers, icon, count }: { scope: string; label: string; screen: number; covers: TileCover[]; icon: ReactNode; count?: number }) {
  return (
    <Link to="/library/$scope" params={{ scope }} className="tile" data-blip>
      <TileBody label={label} screen={screen} covers={covers} icon={icon} count={count} />
    </Link>
  );
}

/** Columns that keep the grid balanced: 3 × 2 for six tiles, 4 × 2 for eight, and so on. */
function tileColumns(count: number): number {
  if (count <= 4) return Math.max(count, 1);
  if (count <= 6 || count === 9) return 3;
  if (count <= 12) return 4;
  return 5;
}

function Tiles({ categories, covers, total }: { categories: Category[]; covers: Record<string, TileCover[]>; total: number }) {
  const visible = categories.filter((category) => !category.isHidden);
  const columns = tileColumns(visible.length + 3);
  return (
    <section className="tiles" aria-label="Library sections" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {visible.map((category, index) => (
        <SectionTile
          key={category.key}
          scope={category.key}
          label={category.name}
          screen={SCREENS[category.key] ?? index % 5}
          covers={covers[category.key] ?? []}
          icon={<CategoryIcon icon={category.icon} size={46} strokeWidth={2.2} />}
          count={category.itemCount}
        />
      ))}
      <SectionTile scope="favorites" label="Favorites" screen={SCREENS.favorites} covers={covers.favorites ?? []} icon={<Star size={46} strokeWidth={2.2} aria-hidden />} />
      <SectionTile scope="all" label="Everything" screen={SCREENS.all} covers={covers.all ?? []} icon={<LibraryBig size={46} strokeWidth={2.2} aria-hidden />} count={total} />
      <AddMenu>
        <AddTile />
      </AddMenu>
    </section>
  );
}

function ContinueCard({ item }: { item: ItemCard }) {
  const percent = Math.round((item.progress ?? 0) * 100);
  return (
    <Link to={item.handler === "video" ? "/watch/$id" : "/read/$id"} params={{ id: String(item.id) }} className="continue-card" data-blip>
      <div className="continue-thumb" style={{ aspectRatio: aspectFor(item.handler) }}>
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

function Row({ title, items, more }: { title: string; items: ItemCard[]; more?: { scope: string } }) {
  if (items.length === 0) return null;
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
          <MediaCard key={item.id} item={item} />
        ))}
      </div>
    </section>
  );
}

export function HomePage({ onCatalog }: { onCatalog: () => void }) {
  const dashboard = useDashboard();
  const importer = useImporter();
  const relink = useRelink();
  const { resolvedTheme, update } = usePreferences();
  const ambient = useAmbient();
  const shelves = useShelves();
  const data = dashboard.data;
  if (!data) return <div className="page" />;
  const dark = resolvedTheme === "dark";

  return (
    <div className="page">
      <div className="greeting">
        <div>
          <h1 className="display">{greeting()}</h1>
          <p>{data.totals.items === 0 ? "Let's bring your collection in." : "Where would you like to go today?"}</p>
        </div>
        <div className="greeting-actions">
          <button
            type="button"
            className="btn glow-when-on"
            aria-pressed={ambient.interfaceSounds}
            onClick={() => ambient.setInterfaceSounds(!ambient.interfaceSounds)}
          >
            {ambient.interfaceSounds ? <Volume2 size={17} strokeWidth={2.4} aria-hidden /> : <VolumeOff size={17} strokeWidth={2.4} aria-hidden />}
            Interface sounds: {ambient.interfaceSounds ? "on" : "off"}
          </button>
          <button
            type="button"
            className="round-btn lg"
            aria-label={dark ? "Switch to light mode" : "Switch to night mode"}
            title={dark ? "Switch to light mode" : "Switch to night mode"}
            onClick={() => update({ theme: dark ? "light" : "dark" })}
          >
            {dark ? <Sun size={19} strokeWidth={2.4} /> : <Moon size={19} strokeWidth={2.4} />}
          </button>
        </div>
      </div>

      {data.totals.items === 0 && (
        <section className="welcome" aria-labelledby="welcome-title">
          <h2 id="welcome-title">Your library is ready</h2>
          <p>
            Import ebooks, comics and manga (CBZ, PDF, EPUB, page images), films and episodes, and music albums. You can
            also drop files or folders anywhere on this window. For things you own only on the shelf so far, catalog the
            physical copy and add digital files later.
          </p>
          <div className="actions">
            <button type="button" className="btn btn-primary btn-lg" onClick={() => void importer.pickFolder()}>
              <FolderPlus size={18} /> Import a folder
            </button>
            <button type="button" className="btn btn-lg" onClick={() => void importer.pickFiles()}>
              <FilePlus size={18} /> Import files
            </button>
            <button type="button" className="btn btn-lg" onClick={onCatalog}>
              <Package size={18} /> Catalog a physical item
            </button>
          </div>
        </section>
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

      <Tiles categories={data.categories} covers={data.tileCovers} total={data.totals.items} />

      {data.continueWatching.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Continue watching</h2>
          </div>
          <div className="continue-grid">
            {data.continueWatching.map((item) => (
              <ContinueCard key={item.id} item={item} />
            ))}
          </div>
        </section>
      )}
      {data.continueItems.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Pick up where you left off</h2>
          </div>
          <div className="continue-grid">
            {data.continueItems.map((item) => (
              <ContinueCard key={item.id} item={item} />
            ))}
          </div>
        </section>
      )}
      {shelves.data && shelves.data.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2>Your shelves</h2>
            <Link to="/shelves">See all</Link>
          </div>
          <div className="shelf-row">
            {shelves.data.slice(0, 8).map((shelf) => (
              <ShelfCard key={shelf.id} shelf={shelf} />
            ))}
          </div>
        </section>
      )}
      <Row title="Recently opened" items={data.recentlyOpened} />
      <Row title="Recently added" items={data.recent} more={{ scope: "all" }} />
      <Row title="Favorites" items={data.favorites} more={{ scope: "favorites" }} />
      {data.totals.items > 0 && (
        <p className="home-totals">
          {plural(data.totals.items, "item")} · {data.totals.physical.toLocaleString()} with a physical copy ·{" "}
          {data.totals.digital.toLocaleString()} with digital files
        </p>
      )}
    </div>
  );
}

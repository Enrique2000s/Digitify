import { useEffect, type ReactNode } from "react";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { FilePlus, FolderPlus, LibraryBig, Star, LayoutGrid, Folder } from "lucide-react";
import type { Category } from "../../lib/api";
import { useImporter } from "../../lib/importer";
import { useCategories } from "../../lib/queries";
import { CATEGORY_TABS, usePreferences, type CategoryTab } from "../../lib/preferences";
import { CategoryIcon } from "../../components/common";
import { CollectionActions } from "../organize/collections";
import { CollectionDialog } from "../organize/CollectionDialog";
import { LibraryView } from "./LibraryView";
import { MUSIC_TABS, MusicPage, MusicTabs, type MusicTab } from "../music/MusicPage";

function EmptyLibrary({ text }: { text: string }) {
  const importer = useImporter();
  return (
    <div className="empty">
      <p>{text}</p>
      <div className="actions">
        <button type="button" className="btn btn-primary" onClick={() => void importer.pickFolder()}>
          <FolderPlus size={16} /> Import a folder
        </button>
        <button type="button" className="btn" onClick={() => void importer.pickFiles()}>
          <FilePlus size={16} /> Import files
        </button>
      </div>
    </div>
  );
}

const TAB_LABELS: Record<CategoryTab, [string, ReactNode]> = {
  media: ["Media", <LayoutGrid key="i" size={15} aria-hidden />],
  collections: ["Collections", <Folder key="i" size={15} aria-hidden />],
  favorites: ["Favorites", <Star key="i" size={15} aria-hidden />],
};

/** A category's tabs (D-094), beside the view's filter: its media, its collections, its favorites. */
function CategoryTabs({ category, tab }: { category: Category; tab: CategoryTab }) {
  const navigate = useNavigate();
  return (
    <div className="segmented music-tabs category-tabs" role="tablist" aria-label={category.name}>
      {CATEGORY_TABS.map((key) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={tab === key}
          aria-pressed={tab === key}
          onClick={() => {
            void navigate({ to: "/library/$scope", params: { scope: category.key }, search: { tab: key }, replace: true });
          }}
        >
          {TAB_LABELS[key][1]} {TAB_LABELS[key][0]}
        </button>
      ))}
    </div>
  );
}

/**
 * A category (D-094): its media, its collections or its favorites, each a tab beside the filter.
 * A collection opens over it as a folder (D-090). Music has its own tabs and no collections.
 */
function CategoryView({ category, collection, tab }: { category: Category; collection: number | null; tab: CategoryTab }) {
  const navigate = useNavigate();
  const music = category.handler === "audio";
  const shown: CategoryTab = music && tab === "collections" ? "media" : tab;
  const base = shown === "favorites" ? { category: category.key, favorites: true, collection: null } : { category: category.key, collection: null };
  return (
    <>
      <LibraryView
        key={shown}
        viewKey={shown === "media" ? category.key : `${category.key}:${shown}`}
        base={base}
        title={category.name}
        icon={<CategoryIcon icon={category.icon} size={26} />}
        square={music}
        handler={category.handler}
        mode={shown === "collections" ? "collections" : "items"}
        actions={music || shown === "favorites" ? undefined : <CollectionActions category={category} />}
        tabs={music ? <MusicTabs category={category} tab="tracks" /> : <CategoryTabs category={category} tab={shown} />}
        collections={music ? undefined : { category: category.key, parent: null }}
        empty={
          shown === "collections" ? (
            <div className="empty">
              <p>No collections in {category.name} yet. “New collection” makes one; then select items and choose “Move” to put them in it.</p>
            </div>
          ) : shown === "favorites" ? (
            <div className="empty">
              <p>Mark {category.name.toLowerCase()} as favorites from their page (the star), and they'll appear here.</p>
            </div>
          ) : (
            <EmptyLibrary text={`No ${category.name.toLowerCase()} in your library yet.`} />
          )
        }
      />
      {collection != null && !music && (
        <CollectionDialog category={category} id={collection} onClose={() => void navigate({ to: "/library/$scope", params: { scope: category.key }, search: { tab: shown }, replace: true })} />
      )}
    </>
  );
}

export function LibraryPage() {
  const { scope } = useParams({ from: "/library/$scope" });
  const { collection, tab } = useSearch({ from: "/library/$scope" });
  const categories = useCategories();
  const { preferences, update } = usePreferences();
  // The section opened last is where the Library button goes next time (D-075).
  useEffect(() => {
    const remembered = (scope === "all" && preferences.showEverything) || !!categories.data?.some((c) => c.key === scope);
    if (remembered && preferences.libraryScope !== scope) update({ libraryScope: scope });
  }, [scope, categories.data, preferences.showEverything, preferences.libraryScope, update]);

  if (scope === "all") {
    return (
      <LibraryView
        key="all"
        viewKey="all"
        base={{}}
        title="Everything"
        icon={<LibraryBig size={26} strokeWidth={2.2} aria-hidden />}
        empty={<EmptyLibrary text="Nothing here yet." />}
      />
    );
  }
  if (scope === "favorites") {
    return (
      <LibraryView
        key="favorites"
        viewKey="favorites"
        base={{ favorites: true }}
        title="Favorites"
        icon={<Star size={26} strokeWidth={2.2} aria-hidden />}
        empty={<div className="empty"><p>Mark items as favorites from their detail page, and they'll appear here.</p></div>}
      />
    );
  }
  const category = categories.data?.find((c) => c.key === scope);
  if (!category) return null;
  // A category opens on its media (Tracks for music) unless a tab is asked for (D-104).
  const musicTab = MUSIC_TABS.find((key) => key === tab) as MusicTab | undefined;
  if (category.handler === "audio" && musicTab && musicTab !== "tracks") return <MusicPage category={category} tab={musicTab} />;
  const categoryTab: CategoryTab = CATEGORY_TABS.find((key) => key === tab) ?? (collection != null ? "collections" : "media");
  return <CategoryView key={scope} category={category} collection={collection ?? null} tab={categoryTab} />;
}

import { useEffect } from "react";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { FilePlus, FolderPlus, LibraryBig, Search, Star } from "lucide-react";
import type { Category } from "../../lib/api";
import { useImporter } from "../../lib/importer";
import { useCategories } from "../../lib/queries";
import { usePreferences } from "../../lib/preferences";
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

/** A category; a collection opens over it as a folder (D-090). */
function CategoryView({ category, collection }: { category: Category; collection: number | null }) {
  const navigate = useNavigate();
  return (
    <>
      <LibraryView
        viewKey={category.key}
        base={{ category: category.key, collection: null }}
        title={category.name}
        icon={<CategoryIcon icon={category.icon} size={26} />}
        square={category.handler === "audio"}
        handler={category.handler}
        actions={<CollectionActions category={category} />}
        titleExtra={category.handler === "audio" ? <MusicTabs category={category} tab="tracks" /> : undefined}
        collections={{ category: category.key, parent: null }}
        empty={<EmptyLibrary text={`No ${category.name.toLowerCase()} in your library yet.`} />}
      />
      {collection != null && (
        <CollectionDialog category={category} id={collection} onClose={() => void navigate({ to: "/library/$scope", params: { scope: category.key }, search: {}, replace: true })} />
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
    const remembered = scope === "favorites" || (scope === "all" && preferences.showEverything) || !!categories.data?.some((c) => c.key === scope);
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
  // A music category opens on the tab used last time.
  const musicTab = MUSIC_TABS.find((key) => key === (tab ?? (collection == null ? preferences.musicTab : undefined))) as MusicTab | undefined;
  if (category.handler === "audio" && musicTab && musicTab !== "tracks") return <MusicPage category={category} tab={musicTab} />;
  return <CategoryView key={`${scope}:${collection ?? ""}`} category={category} collection={collection ?? null} />;
}

export function SearchPage() {
  const { q } = useSearch({ from: "/search" });
  return (
    <LibraryView
      key={`search:${q}`}
      viewKey="search"
      base={{ search: q }}
      eyebrow="Search"
      title={`“${q}”`}
      icon={<Search size={26} strokeWidth={2.4} aria-hidden />}
      empty={<div className="empty"><p>No matches for “{q}”. Search looks at titles, people, series, albums, genres and collections.</p></div>}
    />
  );
}

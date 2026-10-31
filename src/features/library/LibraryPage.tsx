import { useParams, useSearch } from "@tanstack/react-router";
import { FilePlus, FolderOpen, FolderPlus, LibraryBig, Search, Star } from "lucide-react";
import type { Category } from "../../lib/api";
import { useImporter } from "../../lib/importer";
import { useCategories, useCollections } from "../../lib/queries";
import { CategoryIcon } from "../../components/common";
import { CollectionActions, CollectionCrumbs, CollectionRow } from "../organize/collections";
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

/** A category, or one of its collections (with everything inside it). */
function CategoryView({ category, collection }: { category: Category; collection: number | null }) {
  const level = useCollections(category.key, collection);
  if (collection != null && !level.data) return null;
  const path = level.data?.path ?? [];
  const current = collection != null ? path.at(-1) : undefined;
  return (
    <LibraryView
      viewKey={category.key}
      base={{ category: category.key, collection }}
      title={current?.name ?? category.name}
      eyebrow={current ? <CollectionCrumbs category={category} path={path} /> : undefined}
      icon={current ? <FolderOpen size={26} strokeWidth={2.2} aria-hidden /> : <CategoryIcon icon={category.icon} size={26} />}
      square={category.handler === "audio"}
      actions={<CollectionActions category={category} path={current ? path : []} />}
      prelude={
        <>
          {category.handler === "audio" && collection == null && <MusicTabs category={category} tab="albums" />}
          <CollectionRow category={category.key} parent={collection} />
        </>
      }
      empty={
        current ? (
          <div className="empty">
            <p>
              Nothing in this collection yet. Open an item and choose Organize › Move, or select several items in any view
              and choose “Move”.
            </p>
          </div>
        ) : (
          <EmptyLibrary text={`No ${category.name.toLowerCase()} in your library yet.`} />
        )
      }
    />
  );
}

export function LibraryPage() {
  const { scope } = useParams({ from: "/library/$scope" });
  const { collection, tab } = useSearch({ from: "/library/$scope" });
  const categories = useCategories();

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
  const musicTab = MUSIC_TABS.find((key) => key === tab) as MusicTab | undefined;
  if (category.handler === "audio" && musicTab && musicTab !== "albums") return <MusicPage category={category} tab={musicTab} />;
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
      empty={<div className="empty"><p>No matches for “{q}”. Search looks at titles, people, series, albums, genres, tags, collections, custom fields and track names.</p></div>}
    />
  );
}

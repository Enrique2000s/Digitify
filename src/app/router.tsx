import { createHashHistory, createRootRoute, createRoute, createRouter, useNavigate } from "@tanstack/react-router";
import { HomePage } from "../features/home/HomePage";
import { ItemPage } from "../features/item/ItemPage";
import { LibraryPage, SearchPage } from "../features/library/LibraryPage";
import { ShelfPage, ShelvesPage, TagPage, TagsPage } from "../features/organize/pages";
import { ReaderPage } from "../features/reader/ReaderPage";
import { DiscPlayPage, WatchPage } from "../features/player/VideoPlayer";
import { DiscsPage } from "../features/discs/DiscsPage";
import { SettingsPage } from "../features/settings/SettingsPage";
import { BigPicturePage, type BigPictureSearch } from "../features/bigpicture/BigPicture";
import { VideoPoc } from "../poc/VideoPoc";
import { api } from "../lib/api";
import { useAmbientHold } from "../lib/ambient/AmbientProvider";
import { useQuery } from "@tanstack/react-query";
import { useOpenCatalog } from "./catalog";
import { Root } from "./Root";

const rootRoute = createRootRoute({ component: Root });

function Home() {
  return <HomePage onCatalog={useOpenCatalog()} />;
}

function Lab() {
  const navigate = useNavigate();
  useAmbientHold("video");
  const mode = useQuery({ queryKey: ["dev-mode"], queryFn: api.devMode, staleTime: Infinity });
  if (mode.isPending) return null;
  const path = mode.data?.startsWith("video:") ? mode.data.slice("video:".length) : null;
  return <VideoPoc initialPath={path} onExit={() => void navigate({ to: "/settings" })} />;
}

const routeTree = rootRoute.addChildren([
  createRoute({ getParentRoute: () => rootRoute, path: "/", component: Home }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/library/$scope",
    // `collection`: show one collection of the category, with everything inside it.
    // `tab`: a music category's other lists (artists, tracks, playlists…); albums are the default.
    validateSearch: (search: Record<string, unknown>): { collection?: number; tab?: string } => {
      const collection = Number(search.collection);
      const tab = typeof search.tab === "string" ? search.tab : undefined;
      return { ...(Number.isInteger(collection) && collection > 0 ? { collection } : {}), ...(tab ? { tab } : {}) };
    },
    component: LibraryPage,
  }),
  createRoute({ getParentRoute: () => rootRoute, path: "/shelves", component: ShelvesPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/shelf/$id", component: ShelfPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/tags", component: TagsPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/tag/$id", component: TagPage }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/search",
    validateSearch: (search: Record<string, unknown>) => ({ q: typeof search.q === "string" ? search.q : "" }),
    component: SearchPage,
  }),
  createRoute({ getParentRoute: () => rootRoute, path: "/item/$id", component: ItemPage }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/read/$id",
    // `page`: open a page-based book at this page (from 0), e.g. a chapter picked on the item page.
    validateSearch: (search: Record<string, unknown>): { page?: number } => {
      const page = Number(search.page);
      return Number.isInteger(page) && page >= 0 ? { page } : {};
    },
    component: ReaderPage,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/watch/$id",
    // `part`: an episode of a series; without it, the film or the next episode to watch.
    validateSearch: (search: Record<string, unknown>): { part?: number } => {
      const part = Number(search.part);
      return Number.isInteger(part) && part > 0 ? { part } : {};
    },
    component: WatchPage,
  }),
  createRoute({ getParentRoute: () => rootRoute, path: "/disc/$letter/$title", component: DiscPlayPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/discs", component: DiscsPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/settings", component: SettingsPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/lab", component: Lab }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/bp",
    // Big Picture's screens: home, a library category or Favorites, an item, search.
    validateSearch: (search: Record<string, unknown>): BigPictureSearch => {
      const screen = ["home", "library", "item", "search"].includes(String(search.screen)) ? (search.screen as BigPictureSearch["screen"]) : undefined;
      const id = Number(search.id);
      return {
        ...(screen ? { screen } : {}),
        ...(typeof search.scope === "string" ? { scope: search.scope } : {}),
        ...(Number.isInteger(id) && id > 0 ? { id } : {}),
      };
    },
    component: BigPicturePage,
  }),
]);

// Hash history: every route resolves to index.html without server-side fallbacks.
export const router = createRouter({ routeTree, history: createHashHistory(), defaultPreload: false });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

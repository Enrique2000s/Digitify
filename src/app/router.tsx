import { createHashHistory, createRootRoute, createRoute, createRouter, useNavigate } from "@tanstack/react-router";
import { HomePage } from "../features/home/HomePage";
import { ItemPage } from "../features/item/ItemPage";
import { LibraryPage, SearchPage } from "../features/library/LibraryPage";
import { ShelfPage, ShelvesPage, TagPage, TagsPage } from "../features/organize/pages";
import { SettingsPage } from "../features/settings/SettingsPage";
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
    validateSearch: (search: Record<string, unknown>): { collection?: number } => {
      const collection = Number(search.collection);
      return Number.isInteger(collection) && collection > 0 ? { collection } : {};
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
  createRoute({ getParentRoute: () => rootRoute, path: "/settings", component: SettingsPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/lab", component: Lab }),
]);

// Hash history: every route resolves to index.html without server-side fallbacks.
export const router = createRouter({ routeTree, history: createHashHistory(), defaultPreload: false });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

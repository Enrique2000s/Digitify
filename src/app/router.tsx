import { createHashHistory, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { HomePage } from "../features/home/HomePage";
import { ScreenError } from "./ScreenError";
import { ItemPage } from "../features/item/ItemPage";
import { OnlinePlayerPage } from "../features/online/OnlinePlayer";
import { PictureViewerPage } from "../features/pictures/PictureViewer";
import { ArcadePage } from "../features/arcade/ArcadePage";
import { LibraryPage } from "../features/library/LibraryPage";
import { SearchPage } from "../features/search/SearchPage";
import { NowPlayingPage } from "../features/music/NowPlayingPage";
import { AchievementsPage } from "../features/home/YearViews";
import { ProfilePage } from "../features/profile/ProfilePage";
import { LibraryCheckPage } from "../features/settings/LibraryCheck";
import { ReaderPage } from "../features/reader/ReaderPage";
import { DiscPlayPage, WatchPage } from "../features/player/VideoPlayer";
import { DiscsPage } from "../features/discs/DiscsPage";
import { SettingsPage } from "../features/settings/SettingsPage";
import { BigPicturePage, type BigPictureSearch } from "../features/bigpicture/BigPicture";
import { Root } from "./Root";

const rootRoute = createRootRoute({ component: Root });

function Home() {
  return <HomePage />;
}


const routeTree = rootRoute.addChildren([
  createRoute({ getParentRoute: () => rootRoute, path: "/", component: Home }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/library/$scope",
    // `collection`: show one collection of the category, with everything inside it.
    // `tab`: a music category's other lists (artists, playlists…); its tracks are the default.
    validateSearch: (search: Record<string, unknown>): { collection?: number; tab?: string } => {
      const collection = Number(search.collection);
      const tab = typeof search.tab === "string" ? search.tab : undefined;
      return { ...(Number.isInteger(collection) && collection > 0 ? { collection } : {}), ...(tab ? { tab } : {}) };
    },
    component: LibraryPage,
  }),
  createRoute({ getParentRoute: () => rootRoute, path: "/check", component: LibraryCheckPage }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/search",
    validateSearch: (search: Record<string, unknown>) => ({ q: typeof search.q === "string" ? search.q : "" }),
    component: SearchPage,
  }),
  createRoute({ getParentRoute: () => rootRoute, path: "/item/$id", component: ItemPage }),
  // An online item (D-028), in its service's own player.
  createRoute({ getParentRoute: () => rootRoute, path: "/online/$id", component: OnlinePlayerPage }),
  // Arcade (D-034): the games of the emulators on this computer.
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/arcade",
    // ?game=<id> opens that game's panel (from Home, D-041); ?board=collections shows the
    // collections and ?collection=<id> one of them (Favorites is 0, D-149; Completed is -1, D-169).
    validateSearch: (search: Record<string, unknown>): { game?: number; board?: "collections"; collection?: number } => {
      const game = Number(search.game);
      const collection = Number(search.collection);
      return {
        ...(Number.isInteger(game) && game > 0 ? { game } : {}),
        ...(search.board === "collections" ? { board: "collections" as const } : {}),
        ...(search.collection != null && search.collection !== "" && Number.isInteger(collection) && collection >= -1 ? { collection } : {}),
      };
    },
    component: ArcadePage,
  }),
  // A photo (D-033), in the image viewer, full window.
  createRoute({ getParentRoute: () => rootRoute, path: "/view/$id", component: PictureViewerPage }),
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
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/settings",
    // `tab`: one of Settings' tabs (D-121); General without it.
    validateSearch: (search: Record<string, unknown>): { tab?: string } => (typeof search.tab === "string" ? { tab: search.tab } : {}),
    component: SettingsPage,
  }),
  createRoute({ getParentRoute: () => rootRoute, path: "/now-playing", component: NowPlayingPage }),
  createRoute({ getParentRoute: () => rootRoute, path: "/achievements", component: AchievementsPage }),
  // Your profile (D-149).
  createRoute({ getParentRoute: () => rootRoute, path: "/profile", component: ProfilePage }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: "/bp",
    // Big Picture's screens: home, a library category or Favorites, an item, search.
    validateSearch: (search: Record<string, unknown>): BigPictureSearch => {
      const screen = ["home", "library", "item", "search", "online", "arcade", "music", "game", "achievements", "year", "profile"].includes(String(search.screen)) ? (search.screen as BigPictureSearch["screen"]) : undefined;
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
// A screen that fails offers Back and Home instead of a dead end (D-143).
export const router = createRouter({ routeTree, history: createHashHistory(), defaultPreload: false, defaultErrorComponent: ScreenError });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

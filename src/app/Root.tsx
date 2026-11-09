import { useEffect, useState } from "react";
import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { AmbientProvider } from "../lib/ambient/AmbientProvider";
import { MusicProvider } from "../lib/music/MusicProvider";
import { DiscsProvider } from "../lib/discs";
import { DiscNotice } from "../features/discs/DiscsPage";
import { ImporterProvider } from "../lib/importer";
import { PreferencesProvider, usePreferences } from "../lib/preferences";
import { useAppStatus, useLibraryEvents } from "../lib/queries";
import { TitleBar } from "../components/TitleBar";
import { DropOverlay, ImportPanel, ImportReviewDialog } from "../features/import/ImportUI";
import { BookBuilderDialog } from "../features/builder/BookBuilder";
import { ImportUrlDialog, OnlineQueuePanel } from "../features/online/ImportUrl";
import { Onboarding } from "../features/onboarding/Onboarding";
import { BuilderContext, ImportUrlContext } from "./catalog";
import { AppShortcuts } from "./AppShortcuts";
import { ArcadeSession } from "../features/arcade/ArcadeSession";
import { useSegmentedGlide } from "../lib/segmentedGlide";
import { CommandPalette } from "../features/palette/CommandPalette";
import { FloatingVideo } from "../features/player/FloatingVideo";
import { BigPictureCursor, BigPictureLauncher } from "../features/bigpicture/Launcher";

/** Colors per section (D-054): tells the preferences which section is on screen. */
function SectionColor() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { setSection } = usePreferences();
  useEffect(() => {
    const library = /^\/library\/([^/]+)/.exec(pathname);
    const section = pathname.startsWith("/arcade") ? "arcade" : library && !["all", "favorites"].includes(library[1]) ? decodeURIComponent(library[1]) : null;
    setSection(section);
  }, [pathname, setSection]);
  return null;
}

export function Root() {
  // Button groups' highlight slides to the chosen button (D-047).
  useSegmentedGlide();
  const status = useAppStatus();
  const devMode = useQuery({ queryKey: ["dev-mode"], queryFn: api.devMode, staleTime: Infinity });
  const navigate = useNavigate();
  // Decided from the route being rendered rather than the address: while a navigation is in
  // progress the address already changed, and deciding from it would mount the old page again.
  const fullWindow = useRouterState({ select: (state) => state.matches.some((match) => match.routeId === "/lab" || match.routeId === "/read/$id" || match.routeId === "/watch/$id" || match.routeId === "/disc/$letter/$title" || match.routeId === "/bp") });
  const bigPictureRoute = useRouterState({ select: (state) => state.matches.some((match) => match.routeId === "/bp") });
  const [builderOpen, setBuilderOpen] = useState(false);
  const [importUrlOpen, setImportUrlOpen] = useState(false);
  useLibraryEvents();

  // Automated video-lab runs (DIGITIFY_POC=video:<path>) open the lab directly.
  useEffect(() => {
    if (devMode.data?.startsWith("video:")) void navigate({ to: "/lab" });
  }, [devMode.data, navigate]);

  if (!status.data) return null;
  const libraryOpen = status.data.libraryOpen;

  // Preferences and ambient music wrap every screen, so the music carries on between them.
  return (
    <PreferencesProvider initial={status.data.preferences}>
      <AmbientProvider>
        <MusicProvider>
        <DiscsProvider>
        <AppShortcuts />
        <SectionColor />
        <ArcadeSession />
        <BigPictureLauncher />
        {fullWindow ? (
          // The video lab and the reader take the whole window.
          <>
            <Outlet />
            {/* From Big Picture, readers and the player are used with its cursor. */}
            {!bigPictureRoute && <BigPictureCursor />}
          </>
        ) : (
          <ImporterProvider enabled={libraryOpen}>
            <BuilderContext.Provider value={() => setBuilderOpen(true)}>
            <ImportUrlContext.Provider value={() => setImportUrlOpen(true)}>
              <div className="app">
                <TitleBar searchEnabled={libraryOpen} />
                {libraryOpen ? (
                  <main className="app-main">
                    <Outlet />
                  </main>
                ) : (
                  <Onboarding status={status.data} />
                )}
              </div>
              {libraryOpen && (
                <>
                  <ImportReviewDialog />
                  <ImportPanel />
                  <DropOverlay />
                  <BookBuilderDialog open={builderOpen} onOpenChange={setBuilderOpen} />
                  <ImportUrlDialog open={importUrlOpen} onOpenChange={setImportUrlOpen} />
                  <OnlineQueuePanel />
                  <DiscNotice />
                  <CommandPalette />
                  <FloatingVideo />
                </>
              )}
            </ImportUrlContext.Provider>
            </BuilderContext.Provider>
          </ImporterProvider>
        )}
        </DiscsProvider>
        </MusicProvider>
      </AmbientProvider>
    </PreferencesProvider>
  );
}

import { useEffect, useState } from "react";
import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { AmbientProvider } from "../lib/ambient/AmbientProvider";
import { MusicProvider } from "../lib/music/MusicProvider";
import { DiscsProvider } from "../lib/discs";
import { DiscNotice } from "../features/discs/DiscsPage";
import { ImporterProvider } from "../lib/importer";
import { PreferencesProvider } from "../lib/preferences";
import { useAppStatus, useLibraryEvents } from "../lib/queries";
import { TitleBar } from "../components/TitleBar";
import { DropOverlay, ImportPanel, ImportReviewDialog } from "../features/import/ImportUI";
import { BookBuilderDialog } from "../features/builder/BookBuilder";
import { ImportUrlDialog, OnlineQueuePanel } from "../features/online/ImportUrl";
import { Onboarding } from "../features/onboarding/Onboarding";
import { BuilderContext, ImportUrlContext } from "./catalog";
import { AppShortcuts } from "./AppShortcuts";
import { BigPictureCursor, BigPictureLauncher } from "../features/bigpicture/Launcher";

export function Root() {
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

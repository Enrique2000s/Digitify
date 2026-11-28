import { useEffect, useState } from "react";
import { Outlet, useRouterState } from "@tanstack/react-router";
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
import { MediaKeys } from "../lib/mediaKeys";
import { SleepTimerRunner } from "../lib/sleepTimer";
import { TrayHold } from "../lib/trayHold";
import { SteamHoursAuto } from "../features/arcade/shared";
import { ProgramPicker } from "../features/arcade/ProgramPicker";
import { ControllerSync } from "../features/settings/ControllerSettings";
import { CommandPalette } from "../features/palette/CommandPalette";
import { FloatingVideo } from "../features/player/FloatingVideo";
import { AchievementNotice } from "../features/home/YearViews";
import { ResumeNotice } from "../features/home/ResumeNotice";
import { PerfWatch } from "../lib/perfWatch";
import { CloseConfirm, WhatsNew, UpdateDialog } from "../features/app/AppDialogs";
import { BigPictureCursor, BigPictureLauncher } from "../features/bigpicture/Launcher";
import { blockHistoryKeys } from "../components/BackButton";
import { BusyIndicator } from "./BusyIndicator";

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
  // Decided from the route being rendered rather than the address: while a navigation is in
  // progress the address already changed, and deciding from it would mount the old page again.
  const fullWindow = useRouterState({ select: (state) => state.matches.some((match) => match.routeId === "/read/$id" || match.routeId === "/watch/$id" || match.routeId === "/disc/$letter/$title" || match.routeId === "/bp") });
  const bigPictureRoute = useRouterState({ select: (state) => state.matches.some((match) => match.routeId === "/bp") });
  const [builderCategory, setBuilderCategory] = useState<string | null>(null);
  const [importUrlCategory, setImportUrlCategory] = useState<string | null>(null);
  useLibraryEvents();
  // A page's Back is the one way back (D-138): no mouse side buttons or Alt+←/→.
  useEffect(() => blockHistoryKeys(), []);
  // No right-click menu (D-185) unless a part of the app gives one of its own, or in a text field
  // (copy and paste).
  useEffect(() => {
    const block = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("input, textarea, [contenteditable='true'], [data-context-menu]")) return;
      event.preventDefault();
    };
    window.addEventListener("contextmenu", block);
    return () => window.removeEventListener("contextmenu", block);
  }, []);
  // The manual that comes with Digitify (D-149), once a library is open: added the first time,
  // replaced by a newer one, or left gone if it was deleted.
  const libraryReady = status.data?.libraryOpen ?? false;
  useEffect(() => {
    if (libraryReady) void api.manualSync().catch(() => undefined);
  }, [libraryReady]);

  if (!status.data) return null;
  const libraryOpen = status.data.libraryOpen;

  // Preferences and ambient music wrap every screen, so the music carries on between them.
  return (
    <PreferencesProvider initial={status.data.preferences}>
      <AmbientProvider>
        <MusicProvider>
        <DiscsProvider>
        <AppShortcuts />
        <MediaKeys />
        <SleepTimerRunner />
        <TrayHold />
        <SteamHoursAuto />
        <ProgramPicker />
        <ControllerSync />
        <CloseConfirm />
        <SectionColor />
        <ArcadeSession />
        <BigPictureLauncher />
        <BusyIndicator />
        {fullWindow ? (
          // Readers, the players and Big Picture take the whole window.
          <>
            <Outlet />
            {/* From Big Picture, readers and the player are used with its cursor. */}
            {!bigPictureRoute && <BigPictureCursor />}
          </>
        ) : (
          <ImporterProvider enabled={libraryOpen}>
            <BuilderContext.Provider value={setBuilderCategory}>
            <ImportUrlContext.Provider value={setImportUrlCategory}>
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
                  <BookBuilderDialog category={builderCategory} onClose={() => setBuilderCategory(null)} />
                  <ImportUrlDialog category={importUrlCategory} onClose={() => setImportUrlCategory(null)} />
                  <OnlineQueuePanel />
                  <DiscNotice />
                  <CommandPalette />
                  <FloatingVideo />
                  <AchievementNotice />
                  <PerfWatch />
                  <ResumeNotice />
                  <WhatsNew />
                  <UpdateDialog />
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

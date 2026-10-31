import { useEffect, useState } from "react";
import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { AmbientProvider } from "../lib/ambient/AmbientProvider";
import { ImporterProvider } from "../lib/importer";
import { PreferencesProvider } from "../lib/preferences";
import { useAppStatus, useLibraryEvents } from "../lib/queries";
import { TitleBar } from "../components/TitleBar";
import { DropOverlay, ImportPanel, ImportReviewDialog } from "../features/import/ImportUI";
import { CatalogDialog } from "../features/item/forms";
import { Onboarding } from "../features/onboarding/Onboarding";
import { CatalogContext } from "./catalog";

export function Root() {
  const status = useAppStatus();
  const devMode = useQuery({ queryKey: ["dev-mode"], queryFn: api.devMode, staleTime: Infinity });
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [catalogOpen, setCatalogOpen] = useState(false);
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
        {pathname === "/lab" ? (
          <Outlet />
        ) : (
          <ImporterProvider enabled={libraryOpen}>
            <CatalogContext.Provider value={() => setCatalogOpen(true)}>
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
                  <CatalogDialog open={catalogOpen} onOpenChange={setCatalogOpen} />
                </>
              )}
            </CatalogContext.Provider>
          </ImporterProvider>
        )}
      </AmbientProvider>
    </PreferencesProvider>
  );
}

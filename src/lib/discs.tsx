import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { api, type DiscJob, type DriveInfo } from "./api";

interface DiscsContext {
  drives: DriveInfo[];
  /** Rips and disc imports, newest first, until dismissed. */
  jobs: DiscJob[];
  dismissJob: (id: number) => void;
  /** A disc just inserted, to offer in a notice. */
  inserted: DriveInfo | null;
  dismissInserted: () => void;
}

const Context = createContext<DiscsContext | null>(null);

const describe = (drive: DriveInfo) => (drive.media ? `${drive.media.kind}:${drive.media.label ?? ""}` : "");

/** The disc drives (Phase 4, D-022): kept current from the core's `drives-changed` events. */
export function DiscsProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const drives = useQuery({ queryKey: ["drives"], queryFn: api.drivesList, staleTime: Infinity });
  const [jobs, setJobs] = useState<Record<number, DiscJob>>({});
  const [inserted, setInserted] = useState<DriveInfo | null>(null);
  const seen = useRef<Map<string, string> | null>(null);

  useEffect(() => {
    const changes = listen("drives-changed", () => {
      void queryClient.invalidateQueries({ queryKey: ["drives"] });
      void queryClient.invalidateQueries({ queryKey: ["disc-contents"] });
    });
    const progress = listen<DiscJob>("disc-job", ({ payload }) => setJobs((current) => ({ ...current, [payload.id]: payload })));
    return () => {
      void changes.then((stop) => stop());
      void progress.then((stop) => stop());
    };
  }, [queryClient]);

  // A notice when a disc goes into a drive (not for discs already there when Digitify opened).
  useEffect(() => {
    if (!drives.data) return;
    const now = new Map(drives.data.map((drive) => [drive.letter, describe(drive)]));
    if (seen.current) {
      const fresh = drives.data.find((drive) => drive.media && seen.current?.get(drive.letter) !== describe(drive));
      if (fresh) setInserted(fresh);
    }
    seen.current = now;
  }, [drives.data]);

  // Stable, so the notice's own timer isn't restarted by every job update.
  const dismissInserted = useCallback(() => setInserted(null), []);
  const dismissJob = useCallback(
    (id: number) =>
      setJobs((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      }),
    [],
  );
  const value = useMemo<DiscsContext>(
    () => ({
      drives: drives.data ?? [],
      jobs: Object.values(jobs).sort((a, b) => b.id - a.id),
      dismissJob,
      inserted,
      dismissInserted,
    }),
    [drives.data, jobs, inserted, dismissJob, dismissInserted],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useDiscs(): DiscsContext {
  const context = useContext(Context);
  if (!context) throw new Error("useDiscs must be used inside DiscsProvider");
  return context;
}

export const DISC_KINDS: Record<string, string> = {
  audio: "Audio CD",
  dvd: "DVD",
  bluray: "Blu-ray",
  data: "Data disc",
  unknown: "Blank or unreadable disc",
};

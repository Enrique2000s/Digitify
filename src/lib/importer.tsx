import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { api, errorText, type ImportMode, type ImportProgress } from "./api";

interface ImporterContext {
  /** Paths waiting for confirmation in the import dialog. */
  pending: string[] | null;
  jobs: ImportProgress[];
  dragging: boolean;
  error: string | null;
  pickFiles: () => Promise<void>;
  pickFolder: () => Promise<void>;
  review: (paths: string[]) => void;
  closeReview: () => void;
  start: (mode: ImportMode, category: string | null) => Promise<void>;
  cancel: (jobId: number) => void;
  dismiss: (jobId: number) => void;
}

const Context = createContext<ImporterContext | null>(null);

const MEDIA_FILTER = {
  name: "Media",
  extensions: [
    "epub", "pdf", "mobi", "azw3", "azw", "fb2",
    "cbz", "cbr", "cb7", "cbt",
    "jpg", "jpeg", "png", "webp", "gif", "bmp", "tif", "tiff",
    "mp4", "m4v", "mkv", "mov", "avi", "webm", "wmv", "mpg", "mpeg", "ts", "m2ts",
    "mp3", "flac", "wav", "m4a", "aac", "ogg", "opus", "wma", "aiff", "ape", "wv",
  ],
};

export function ImporterProvider({ children, enabled }: { children: ReactNode; enabled: boolean }) {
  const [pending, setPending] = useState<string[] | null>(null);
  const [jobs, setJobs] = useState<ImportProgress[]>([]);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unlisten = listen<ImportProgress>("import-progress", ({ payload }) => {
      setJobs((current) => {
        const others = current.filter((job) => job.jobId !== payload.jobId);
        return [...others, payload].sort((a, b) => a.jobId - b.jobId);
      });
    });
    return () => {
      void unlisten.then((stop) => stop());
    };
  }, []);

  // Files and folders dropped anywhere on the window open the import review.
  useEffect(() => {
    if (!enabled) return;
    const unlisten = getCurrentWebview().onDragDropEvent((event) => {
      const { type } = event.payload;
      if (type === "enter" || type === "over") setDragging(true);
      else if (type === "leave") setDragging(false);
      else if (type === "drop") {
        setDragging(false);
        if (event.payload.paths.length > 0) setPending(event.payload.paths);
      }
    });
    return () => {
      void unlisten.then((stop) => stop());
    };
  }, [enabled]);

  const pickFiles = useCallback(async () => {
    const selected = await open({ multiple: true, directory: false, filters: [MEDIA_FILTER], title: "Import files" });
    const paths = Array.isArray(selected) ? selected : selected ? [selected] : [];
    if (paths.length) setPending(paths);
  }, []);

  const pickFolder = useCallback(async () => {
    const selected = await open({ multiple: true, directory: true, title: "Import folders" });
    const paths = Array.isArray(selected) ? selected : selected ? [selected] : [];
    if (paths.length) setPending(paths);
  }, []);

  const start = useCallback(
    async (mode: ImportMode, category: string | null) => {
      if (!pending) return;
      setError(null);
      try {
        await api.importStart(pending, mode, category);
        setPending(null);
      } catch (reason) {
        setError(errorText(reason));
      }
    },
    [pending],
  );

  const value = useMemo<ImporterContext>(
    () => ({
      pending,
      jobs,
      dragging,
      error,
      pickFiles,
      pickFolder,
      review: setPending,
      closeReview: () => {
        setPending(null);
        setError(null);
      },
      start,
      cancel: (jobId) => void api.importCancel(jobId),
      dismiss: (jobId) => setJobs((current) => current.filter((job) => job.jobId !== jobId)),
    }),
    [pending, jobs, dragging, error, pickFiles, pickFolder, start],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useImporter(): ImporterContext {
  const context = useContext(Context);
  if (!context) throw new Error("useImporter must be used inside ImporterProvider");
  return context;
}

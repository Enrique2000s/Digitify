import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import { api, errorText, type Category, type ImportMode, type ImportProgress } from "./api";

interface ImporterContext {
  /** Paths waiting for confirmation in the import dialog. */
  pending: string[] | null;
  /** The category they go into (D-125): the one they were added from, or none yet (dropped files). */
  pendingCategory: Category | null;
  jobs: ImportProgress[];
  dragging: boolean;
  error: string | null;
  pickFiles: (category?: Category | null) => Promise<void>;
  pickFolder: (category?: Category | null) => Promise<void>;
  review: (paths: string[], category?: Category | null) => void;
  closeReview: () => void;
  start: (mode: ImportMode, category: string | null) => Promise<void>;
  cancel: (jobId: number) => void;
  dismiss: (jobId: number) => void;
}

const Context = createContext<ImporterContext | null>(null);

/** The kinds of file each kind of category takes (D-125), for the file picker. */
const KINDS: Record<string, string[]> = {
  book: ["epub", "pdf", "mobi", "azw3", "azw", "fb2"],
  comic: ["cbz", "cbr", "cb7", "cbt", "pdf", "zip", "rar", "7z"],
  image: ["jpg", "jpeg", "png", "webp", "gif", "bmp", "tif", "tiff", "heic", "avif"],
  video: ["mp4", "m4v", "mkv", "mov", "avi", "webm", "wmv", "mpg", "mpeg", "ts", "m2ts"],
  audio: ["mp3", "flac", "wav", "m4a", "aac", "ogg", "opus", "wma", "aiff", "ape", "wv"],
};

function fileFilter(category: Category | null | undefined) {
  // Music takes videos too: their sound becomes an MP3 (D-132).
  const kinds = category?.handler === "audio" ? [...KINDS.audio, ...KINDS.video] : category ? KINDS[category.handler] : undefined;
  const extensions = kinds ?? [...new Set(Object.values(KINDS).flat())];
  return { name: category ? category.name : "Media", extensions };
}

export function ImporterProvider({ children, enabled }: { children: ReactNode; enabled: boolean }) {
  const [pending, setPendingPaths] = useState<string[] | null>(null);
  const [pendingCategory, setPendingCategory] = useState<Category | null>(null);
  const setPending = useCallback((paths: string[] | null, category: Category | null = null) => {
    setPendingPaths(paths);
    setPendingCategory(category);
  }, []);
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

  const pickFiles = useCallback(async (category?: Category | null) => {
    const selected = await open({ multiple: true, directory: false, filters: [fileFilter(category)], title: category ? `Add to ${category.name}` : "Import files" });
    const paths = Array.isArray(selected) ? selected : selected ? [selected] : [];
    if (paths.length) setPending(paths, category ?? null);
  }, [setPending]);

  const pickFolder = useCallback(async (category?: Category | null) => {
    const selected = await open({ multiple: true, directory: true, title: category ? `Add a folder to ${category.name}` : "Import folders" });
    const paths = Array.isArray(selected) ? selected : selected ? [selected] : [];
    if (paths.length) setPending(paths, category ?? null);
  }, [setPending]);

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
    [pending, setPending],
  );

  const value = useMemo<ImporterContext>(
    () => ({
      pending,
      pendingCategory,
      jobs,
      dragging,
      error,
      pickFiles,
      pickFolder,
      review: (paths: string[], category?: Category | null) => setPending(paths, category ?? null),
      closeReview: () => {
        setPending(null);
        setError(null);
      },
      start,
      cancel: (jobId) => void api.importCancel(jobId),
      dismiss: (jobId) => setJobs((current) => current.filter((job) => job.jobId !== jobId)),
    }),
    [pending, pendingCategory, jobs, dragging, error, pickFiles, pickFolder, start, setPending],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useImporter(): ImporterContext {
  const context = useContext(Context);
  if (!context) throw new Error("useImporter must be used inside ImporterProvider");
  return context;
}

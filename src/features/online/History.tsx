import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { Link as RouterLink } from "@tanstack/react-router";
import { Ban, Check, CircleCheck, Download, FolderInput, LoaderCircle, RotateCcw, TriangleAlert, X } from "lucide-react";
import { api, errorText, type HistoryEntry, type OnlineJob } from "../../lib/api";
import { plural } from "../../lib/format";
import { useImporter } from "../../lib/importer";
import { Dialog } from "../../components/common";
import { JobIcon, jobText } from "./ImportUrl";

const when = (iso: string) => {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? "" : at.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
};

/** What a row says under its title. */
function summary(entry: HistoryEntry): string {
  if (entry.kind === "files") {
    const c = entry.counts;
    const parts = [
      `${plural(c.imported ?? 0, "item")} added`,
      c.duplicates ? `${c.duplicates.toLocaleString()} already there` : null,
      c.skipped ? `${c.skipped.toLocaleString()} left out` : null,
      c.failed ? `${c.failed.toLocaleString()} failed` : null,
    ].filter(Boolean);
    const outcome = entry.state === "cancelled" ? "Cancelled" : entry.state === "failed" && !c.imported ? (entry.error ?? "Failed") : parts.join(", ");
    return [entry.detail ? `Into ${entry.detail}` : "Files and folders", outcome].join(" · ");
  }
  const outcome =
    entry.state === "done" ? (entry.action === "download" ? "Downloaded" : "Saved online") : entry.state === "skipped" ? "Already in your library" : entry.state === "cancelled" ? "Cancelled" : (entry.error ?? "Failed");
  return [entry.detail, outcome].filter(Boolean).join(" · ");
}

function StateIcon({ entry }: { entry: HistoryEntry }) {
  switch (entry.state) {
    case "done":
      return entry.kind === "files" ? <FolderInput size={16} color="var(--success)" aria-hidden /> : <CircleCheck size={16} color="var(--success)" aria-hidden />;
    case "skipped":
      return <Check size={16} aria-hidden />;
    case "cancelled":
      return <Ban size={16} aria-hidden />;
    default:
      return <TriangleAlert size={16} color="var(--warning)" aria-hidden />;
  }
}

/**
 * Downloads and imports (D-137): what's coming in now, from links and from files, and the history
 * of what came in, kept until cleared. Opened from Home.
 */
export function ImportsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const importer = useImporter();
  const history = useQuery({ queryKey: ["import-history"], queryFn: api.historyList, enabled: open });
  const queue = useQuery({ queryKey: ["online-queue"], queryFn: api.onlineQueue, enabled: open });
  const [jobs, setJobs] = useState<OnlineJob[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (queue.data) setJobs(queue.data);
  }, [queue.data]);
  useEffect(() => {
    const refresh = () => void queryClient.invalidateQueries({ queryKey: ["import-history"] });
    const stops = [
      listen<OnlineJob[]>("online-queue", ({ payload }) => {
        setJobs(payload);
        refresh();
      }),
      listen("import-progress", refresh),
      listen("import-history", refresh),
    ];
    return () => stops.forEach((stop) => void stop.then((unlisten) => unlisten()));
  }, [queryClient]);

  const running = jobs.filter((job) => job.state === "pending" || job.state === "working");
  const files = importer.jobs.filter((job) => job.phase === "scanning" || job.phase === "importing");
  const rows = history.data ?? [];
  const act = async (run: () => Promise<unknown>) => {
    setError(null);
    try {
      await run();
      await queryClient.invalidateQueries({ queryKey: ["import-history"] });
    } catch (reason) {
      setError(errorText(reason));
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      wide
      title="Downloads and imports"
      description="What's coming in from links and files, and what came in before. Clearing the history doesn't touch your library."
      footer={
        <>
          <button type="button" className="btn" disabled={rows.length === 0} onClick={() => void act(api.historyClear)}>
            Clear history
          </button>
          <button type="button" className="btn btn-primary" onClick={() => onOpenChange(false)}>
            Close
          </button>
        </>
      }
    >
      {(running.length > 0 || files.length > 0) && (
        <section className="imports-section" aria-label="Now">
          <h3>Now</h3>
          <ul className="online-jobs">
            {files.map((job) => (
              <li key={`files-${job.jobId}`} className="online-job working">
                <LoaderCircle size={16} className="spin" aria-hidden />
                <span className="online-job-text">
                  <span className="online-job-title">{job.current ?? "Files and folders"}</span>
                  <span className="online-job-status">
                    {job.phase === "scanning" ? "Looking through the files" : `Importing ${job.processed.toLocaleString()} of ${job.total.toLocaleString()}`}
                  </span>
                  {job.total > 0 && (
                    <span className="progress thin">
                      <span style={{ width: `${Math.round((job.processed / job.total) * 100)}%` }} />
                    </span>
                  )}
                </span>
                <button type="button" className="icon-btn" aria-label="Cancel this import" title="Cancel" onClick={() => importer.cancel(job.jobId)}>
                  <X size={15} />
                </button>
              </li>
            ))}
            {running.map((job) => (
              <li key={job.id} className={`online-job ${job.state}`}>
                <JobIcon job={job} />
                <span className="online-job-text">
                  <span className="online-job-title">{job.title}</span>
                  <span className="online-job-status">
                    {job.service} · {jobText(job)}
                  </span>
                  {job.state === "working" && job.action === "download" && (
                    <span className="progress thin">
                      <span style={{ width: `${Math.round((job.progress ?? 0) * 100)}%` }} />
                    </span>
                  )}
                </span>
                <button type="button" className="icon-btn" aria-label={`Cancel ${job.title}`} title="Cancel" onClick={() => void act(() => api.onlineCancel(job.id))}>
                  <X size={15} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="imports-section" aria-label="History">
        <h3>History</h3>
        {rows.length === 0 ? (
          <p className="muted">{history.isPending ? "Loading…" : "Nothing yet. What you add from links and files shows here."}</p>
        ) : (
          <ul className="online-jobs imports-history">
            {rows.map((entry) => (
              <li key={entry.id} className={`online-job ${entry.state}`}>
                <StateIcon entry={entry} />
                <span className="online-job-text">
                  {entry.itemId != null ? (
                    <RouterLink to="/item/$id" params={{ id: String(entry.itemId) }} className="online-job-title" onClick={() => onOpenChange(false)}>
                      {entry.title}
                    </RouterLink>
                  ) : (
                    <span className="online-job-title">{entry.title}</span>
                  )}
                  <span className="online-job-status">{summary(entry)}</span>
                </span>
                <span className="muted imports-when">{when(entry.finishedAt)}</span>
                {entry.retry && (
                  <button type="button" className="icon-btn" aria-label={`Retry ${entry.title}`} title="Retry" onClick={() => void act(() => api.historyRetry(entry.id))}>
                    <RotateCcw size={15} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      {error && <div className="dialog-error">{error}</div>}
    </Dialog>
  );
}

/** The title bar's button for Downloads and imports (D-145), with how many are running. */
export function ImportsButton() {
  const importer = useImporter();
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(0);
  useEffect(() => {
    void api.onlineQueue().then((jobs) => setRunning(jobs.filter((job) => job.state === "pending" || job.state === "working").length));
    const stop = listen<OnlineJob[]>("online-queue", ({ payload }) => setRunning(payload.filter((job) => job.state === "pending" || job.state === "working").length));
    return () => void stop.then((unlisten) => unlisten());
  }, []);
  const count = running + importer.jobs.filter((job) => job.phase === "scanning" || job.phase === "importing").length;
  return (
    <>
      <button
        type="button"
        className="round-btn imports-btn"
        aria-label={count ? `Downloads and imports: ${count} running` : "Downloads and imports"}
        title="Downloads and imports"
        onClick={() => setOpen(true)}
      >
        <Download size={18} strokeWidth={2.4} />
        {count > 0 && <span className="imports-badge">{count}</span>}
      </button>
      <ImportsDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

import { useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CircleCheck, Download, LoaderCircle, TriangleAlert, X } from "lucide-react";
import type { ImportMode, ImportProgress } from "../../lib/api";
import { useImporter } from "../../lib/importer";
import { usePreferences } from "../../lib/preferences";
import { useCategories } from "../../lib/queries";
import { Dialog, Field } from "../../components/common";

/** Confirms what to import and how: reference files in place, or copy them into the library. */
export function ImportReviewDialog() {
  const importer = useImporter();
  const { preferences, update } = usePreferences();
  const categories = useCategories();
  const [mode, setMode] = useState<ImportMode>("reference");
  const [category, setCategory] = useState("");
  // Files dropped while a category is open go into it (D-125).
  const location = useRouterState({ select: (state) => state.location.pathname });
  const openCategory = location.startsWith("/library/") ? decodeURIComponent(location.slice("/library/".length).split("/")[0]) : null;
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const paths = importer.pending ?? [];

  useEffect(() => {
    if (importer.pending) {
      setMode(preferences.importMode === "copy" ? "copy" : "reference");
      setRemember(preferences.importMode !== "ask");
      setCategory(importer.pendingCategory?.key ?? (categories.data?.some((c) => c.key === openCategory) ? openCategory! : ""));
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importer.pending, preferences.importMode]);

  const names = paths.map((path) => path.split(/[\\/]/).filter(Boolean).pop() ?? path);
  const submit = async () => {
    setBusy(true);
    update({ importMode: remember ? mode : "ask" });
    if (!category) return;
    await importer.start(mode, category);
    setBusy(false);
  };

  return (
    <Dialog
      open={importer.pending !== null}
      onOpenChange={(open) => !open && importer.closeReview()}
      title={importer.pendingCategory ? `Add to ${importer.pendingCategory.name}` : "Import into your library"}
      description={`${paths.length === 1 ? "1 item" : `${paths.length} items`} selected: ${names.slice(0, 3).join(", ")}${names.length > 3 ? ` and ${names.length - 3} more` : ""}. Only what the category holds is added; anything else is left out.${importer.pendingCategory?.handler === "audio" || categories.data?.find((c) => c.key === category)?.handler === "audio" ? " Videos keep their sound, as MP3s in the library folder; the videos stay as they are." : ""}`}
      footer={
        <>
          <button type="button" className="btn" onClick={importer.closeReview}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={busy || !category} onClick={() => void submit()}>
            <Download size={16} /> Import
          </button>
        </>
      }
    >
      <fieldset style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        <legend className="eyebrow" style={{ marginBottom: 10 }}>
          Where the files live
        </legend>
        <label className="choice">
          <input type="radio" name="mode" checked={mode === "reference"} onChange={() => setMode("reference")} />
          <span>
            <strong>Keep files where they are</strong>
            <span className="hint">Digitify remembers their location. Nothing is copied or moved.</span>
          </span>
        </label>
        <label className="choice">
          <input type="radio" name="mode" checked={mode === "copy"} onChange={() => setMode("copy")} />
          <span>
            <strong>Copy into the library folder</strong>
            <span className="hint">A copy goes into your library's media folder. The originals stay untouched.</span>
          </span>
        </label>
      </fieldset>
      {/* Each category takes its own kind of media (D-125): the one it was added from, or one picked here. */}
      {importer.pendingCategory ? (
        <p className="import-into">
          Into <strong>{importer.pendingCategory.name}</strong>
        </p>
      ) : (
        <Field label="Category" hint="What the files are added to. Only what it holds is added (pictures to Pictures, videos to Videos or Movies & Series…).">
          <select className="select" value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="" disabled>
              Choose a category
            </option>
            {categories.data
              ?.filter((c) => !c.isHidden)
              .map((c) => (
                <option key={c.key} value={c.key}>
                  {c.name}
                </option>
              ))}
          </select>
        </Field>
      )}
      <label className="checkbox">
        <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
        Use this choice by default next time
      </label>
      {importer.error && <div className="dialog-error">{importer.error}</div>}
    </Dialog>
  );
}

function summary(job: ImportProgress): string {
  switch (job.phase) {
    case "scanning":
      return "Looking for media…";
    case "importing":
      return `Importing ${job.processed.toLocaleString()} of ${job.total.toLocaleString()}`;
    case "done":
      return job.total === 0 ? "No supported media found" : "Import finished";
    case "cancelled":
      return "Import cancelled";
    default:
      return "Import failed";
  }
}

/** Progress for running and finished imports, in the bottom corner. */
export function ImportPanel() {
  const { jobs, cancel, dismiss } = useImporter();
  const job = jobs.length ? jobs[jobs.length - 1] : null;
  const clean = job?.phase === "done" && job.failed === 0 && job.errors.length === 0;

  // A clean finish dismisses itself; failures stay until the user has seen them.
  useEffect(() => {
    if (!job || !clean) return;
    const timer = window.setTimeout(() => dismiss(job.jobId), 6000);
    return () => window.clearTimeout(timer);
  }, [job, clean, dismiss]);

  if (!job) return null;
  const running = job.phase === "scanning" || job.phase === "importing";
  const fraction = job.total > 0 ? job.processed / job.total : 0;
  return (
    <section className="import-panel" aria-live="polite" aria-label="Import progress">
      <header>
        {running ? (
          <LoaderCircle size={18} className="spin" aria-hidden />
        ) : job.failed > 0 || job.phase === "failed" ? (
          <TriangleAlert size={18} color="var(--warning)" aria-hidden />
        ) : (
          <CircleCheck size={18} color="var(--success)" aria-hidden />
        )}
        <span>{summary(job)}</span>
        {running ? (
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => cancel(job.jobId)}>
            Cancel
          </button>
        ) : (
          <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => dismiss(job.jobId)}>
            <X size={16} />
          </button>
        )}
      </header>
      <div className={`progress${job.phase === "scanning" ? " indeterminate" : ""}`}>
        <span style={{ width: job.phase === "scanning" ? undefined : `${Math.round(fraction * 100)}%` }} />
      </div>
      {running && job.current && <div className="current">{job.current}</div>}
      <div className="stats">
        <span className="chip accent">{job.imported.toLocaleString()} added</span>
        {job.duplicates > 0 && <span className="chip">{job.duplicates.toLocaleString()} already in library</span>}
        {job.skipped > 0 && <span className="chip">{job.skipped.toLocaleString()} not for this category, left out</span>}
        {job.failed > 0 && <span className="chip warning">{job.failed.toLocaleString()} failed</span>}
      </div>
      {job.errors.length > 0 && (
        <details>
          <summary>Details</summary>
          <ul>
            {job.errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

export function DropOverlay() {
  const { dragging } = useImporter();
  if (!dragging) return null;
  return (
    <div className="drop-overlay">
      <div>
        <Download size={32} color="var(--accent)" aria-hidden />
        Drop to import into your library
      </div>
    </div>
  );
}

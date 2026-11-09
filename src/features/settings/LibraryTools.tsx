import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-dialog";
import { Archive, FolderOpen, FolderSearch, RotateCcw, ScanSearch, TriangleAlert } from "lucide-react";
import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { Link } from "@tanstack/react-router";
import { usePreferences } from "../../lib/preferences";
import { api, errorText, type AutoBackupStatus, type BackupInfo } from "../../lib/api";
import { bytes, dateTime } from "../../lib/format";
import { libraryChanged } from "../../lib/queries";
import { Dialog } from "../../components/common";

const KIND_LABELS: Record<string, string> = {
  manual: "Manual",
  auto: "Automatic",
  "before-upgrade": "Before an update",
  "before-restore": "Before a restore",
};

/** How automatic backups went last (D-056), kept fresh by the core's events. */
export function useAutoBackupStatus() {
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: ["backup-auto"], queryFn: api.backupAutoStatus });
  useEffect(() => {
    const off = listen<AutoBackupStatus>("backup-status", (event) => {
      queryClient.setQueryData(["backup-auto"], event.payload);
      void queryClient.invalidateQueries({ queryKey: ["backups"] });
    });
    return () => void off.then((stop) => stop());
  }, [queryClient]);
  return status;
}

/** Automatic backups (D-056): how often, where to copy them, how many to keep, and how it went. */
function AutoBackups() {
  const { preferences, update } = usePreferences();
  const auto = preferences.autoBackup;
  const status = useAutoBackupStatus();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const set = (change: Partial<typeof auto>) => update((c) => ({ autoBackup: { ...c.autoBackup, ...change } }));
  const choose = async () => {
    const folder = await open({ directory: true, multiple: false, title: "Where should automatic backups be copied? (another drive is best)" });
    if (typeof folder === "string") set({ folder });
  };
  const now = async () => {
    setBusy(true);
    setNote(null);
    try {
      const result = await api.backupAutoNow();
      setNote(result.missingFolder ? null : result.error ?? "Backed up.");
    } catch (reason) {
      setNote(errorText(reason));
    } finally {
      setBusy(false);
    }
  };
  const s = status.data;
  return (
    <>
      <div className="setting">
        <div className="setting-text">
          <strong>Automatic backups</strong>
          <p>
            Backs up the catalog by itself, kept in the library's backups folder{auto.folder ? " and copied to the folder below" : ""}. The last {auto.keep} are kept.
            {s?.last && ` Last one: ${dateTime(s.last)}.`}
          </p>
        </div>
        <select className="select" style={{ width: 160 }} value={auto.every} aria-label="Automatic backups" onChange={(e) => set({ every: e.target.value as typeof auto.every })}>
          <option value="off">Off</option>
          <option value="daily">Every day</option>
          <option value="weekly">Every week</option>
          <option value="monthly">Every month</option>
        </select>
      </div>
      {auto.every !== "off" && (
        <div className="setting">
          <div className="setting-text">
            <strong>Copy them to</strong>
            <p>{auto.folder ?? "Only the library's backups folder. Choose a folder on another drive to keep a copy safe if this one fails."}</p>
            {s?.missingFolder && (
              <p className="auto-backup-warning">
                <TriangleAlert size={14} /> The folder couldn't be reached: is its drive connected? The backup was kept in the library's backups folder.
              </p>
            )}
            {s?.error && <p className="auto-backup-warning">{s.error}</p>}
            {note && <p style={{ color: "var(--accent-text)" }}>{note}</p>}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <button type="button" className="btn" onClick={() => void choose()}>
              <FolderOpen size={16} /> {auto.folder ? "Change folder" : "Choose folder"}
            </button>
            {auto.folder && (
              <button type="button" className="btn btn-ghost" onClick={() => set({ folder: null })}>
                No copy
              </button>
            )}
            <select className="select" style={{ width: 120 }} value={auto.keep} aria-label="Backups to keep" onChange={(e) => set({ keep: Number(e.target.value) })}>
              {[3, 5, 8, 12, 20, 30].map((n) => (
                <option key={n} value={n}>
                  Keep {n}
                </option>
              ))}
            </select>
            <button type="button" className="btn" disabled={busy} onClick={() => void now()}>
              Back up now
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/** "Find moved files…": relinks missing files found under a folder the user picks. */
export function useRelink() {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    const folder = await open({ directory: true, multiple: false, title: "Where did the files go? Choose a folder to search" });
    if (typeof folder !== "string") return;
    setBusy(true);
    setMessage("Searching…");
    try {
      const report = await api.filesRelink(folder);
      libraryChanged(queryClient);
      setMessage(
        report.missing === 0
          ? "No files are missing."
          : `Found ${report.found} of ${report.missing} missing ${report.missing === 1 ? "file" : "files"}.` +
              (report.found < report.missing ? " Try another folder for the rest." : ""),
      );
    } catch (reason) {
      setMessage(errorText(reason));
    } finally {
      setBusy(false);
    }
  };
  return { run, message, busy };
}

export function BackupsPanel() {
  const queryClient = useQueryClient();
  const backups = useQuery({ queryKey: ["backups"], queryFn: api.backupList });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<BackupInfo | null>(null);
  const relink = useRelink();

  const backUp = async () => {
    setBusy(true);
    try {
      const backup = await api.backupCreate();
      setMessage(`Backed up (${bytes(backup.size)}).`);
      await backups.refetch();
    } catch (reason) {
      setMessage(errorText(reason));
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    if (!restoring) return;
    setBusy(true);
    try {
      await api.backupRestore(restoring.name);
      setMessage(`Restored the backup from ${dateTime(restoring.created)}. Your previous state was saved as a backup.`);
      setRestoring(null);
      libraryChanged(queryClient);
      await backups.refetch();
    } catch (reason) {
      setMessage(errorText(reason));
      setRestoring(null);
    } finally {
      setBusy(false);
    }
  };

  const list = backups.data ?? [];
  return (
    <section className="panel">
      <h2>Backups and maintenance</h2>
      <div className="setting">
        <div className="setting-text">
          <strong>Back up the library</strong>
          <p>
            Saves the whole catalog (items, copies, edits, progress) in the library's backups folder. Artwork and copied
            media stay in the library folder; back up that whole folder for a complete copy.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void backUp()}>
            <Archive size={16} /> Back up now
          </button>
          <button type="button" className="btn" onClick={() => api.backupReveal(null).catch((e) => setMessage(errorText(e)))}>
            Open folder
          </button>
        </div>
      </div>
      {list.length > 0 && (
        <ul className="copy-files" style={{ margin: "4px 0 12px" }} aria-label="Backups">
          {list.slice(0, 8).map((backup) => (
            <li key={backup.name} style={{ fontSize: 13, color: "var(--text)" }}>
              <span style={{ flex: 1 }}>
                {dateTime(backup.created)} <span className="muted">· {KIND_LABELS[backup.kind] ?? backup.kind} · {bytes(backup.size)}</span>
              </span>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setRestoring(backup)}>
                <RotateCcw size={14} /> Restore
              </button>
            </li>
          ))}
        </ul>
      )}
      {message && <p className="hint">{message}</p>}
      <AutoBackups />
      <div className="setting">
        <div className="setting-text">
          <strong>Library check</strong>
          <p>Files that can't be found where they were saved, and the same file in more than one item, in one list to review.</p>
        </div>
        <Link to="/check" className="btn">
          <ScanSearch size={16} /> Check the library
        </Link>
      </div>
      <div className="setting">
        <div className="setting-text">
          <strong>Find moved files</strong>
          <p>If files were moved or renamed, point Digitify at the folder they're in now. Files are matched by their content.</p>
          {relink.message && <p style={{ color: "var(--accent-text)" }}>{relink.message}</p>}
        </div>
        <button type="button" className="btn" disabled={relink.busy} onClick={() => void relink.run()}>
          <FolderSearch size={16} /> Find moved files…
        </button>
      </div>
      <Dialog
        open={restoring !== null}
        onOpenChange={(isOpen) => !isOpen && setRestoring(null)}
        title="Restore this backup?"
        description={
          restoring
            ? `Your library goes back to how it was on ${dateTime(restoring.created)}. Your current state is saved as a backup first, so you can undo this.`
            : undefined
        }
        footer={
          <>
            <button type="button" className="btn" onClick={() => setRestoring(null)}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void restore()}>
              Restore
            </button>
          </>
        }
      >
        <p className="hint">Media files are not touched; only the library's catalog is restored.</p>
      </Dialog>
    </section>
  );
}

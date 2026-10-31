import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-dialog";
import { Archive, FolderSearch, RotateCcw } from "lucide-react";
import { api, errorText, type BackupInfo } from "../../lib/api";
import { bytes, dateTime } from "../../lib/format";
import { libraryChanged } from "../../lib/queries";
import { Dialog } from "../../components/common";

const KIND_LABELS: Record<string, string> = {
  manual: "Manual",
  "before-upgrade": "Before an update",
  "before-restore": "Before a restore",
};

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

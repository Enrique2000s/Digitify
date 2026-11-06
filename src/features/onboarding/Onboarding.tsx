import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, TriangleAlert } from "lucide-react";
import { api, errorText, type AppStatus } from "../../lib/api";
import { keys } from "../../lib/queries";

/** First launch (or a library that can't be found): choose where the library lives (D-010). */
export function Onboarding({ status }: { status: AppStatus }) {
  const queryClient = useQueryClient();
  const [path, setPath] = useState(status.libraryPath ?? status.suggestedPath);
  const [cloud, setCloud] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    api.pathCloudSync(path).then((provider) => alive && setCloud(provider), () => alive && setCloud(null));
    return () => {
      alive = false;
    };
  }, [path]);

  const browse = async () => {
    const selected = await open({ directory: true, multiple: false, title: "Choose your library folder" });
    if (typeof selected === "string") setPath(selected);
  };

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await api.libraryChoose(path);
      queryClient.setQueryData(keys.status, next);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };

  const reopening = status.libraryError !== null;
  return (
    <div className="onboarding">
      <div>
        <div className="eyebrow" style={{ fontSize: 15 }}>Welcome to Digitify!</div>
        <h1 className="display onboarding-title" style={{ marginTop: 12 }}>
          Your collection, all in one place.
        </h1>
        <p className="onboarding-lede">
          Books, comics, manga, films, series, videos and music in one library that lives on your own computer. No
          accounts, no cloud, nothing leaves your PC.
        </p>
      </div>
      <form
        className="onboarding-card"
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <div className="dialog-title">{reopening ? "Find your library" : "Choose where your library lives"}</div>
        {reopening && (
          <div className="notice danger" role="alert">
            <TriangleAlert size={18} aria-hidden />
            <span>
              Digitify couldn't open the library at <strong>{status.libraryPath}</strong>: {status.libraryError}. If it's on
              a drive that isn't connected, connect it and try again, or choose another folder.
            </span>
          </div>
        )}
        <p className="hint">
          This folder holds the library database, cover artwork, and any media you choose to copy in. Back it up or move
          it as one folder. Your media files can stay wherever they are now.
        </p>
        <label className="field">
          <span>Library folder</span>
          <div style={{ display: "flex", gap: 8 }}>
            <input className="input" value={path} onChange={(event) => setPath(event.target.value)} spellCheck={false} />
            <button type="button" className="btn" onClick={() => void browse()}>
              <FolderOpen size={16} /> Browse
            </button>
          </div>
        </label>
        {cloud && (
          <div className="notice warning">
            <TriangleAlert size={18} aria-hidden />
            <span>
              This folder is synced by {cloud}. Syncing a live library database can corrupt it, and would upload your
              library to the cloud. A folder outside {cloud} is safer.
            </span>
          </div>
        )}
        {error && <div className="dialog-error">{error}</div>}
        <button type="submit" className="btn btn-primary btn-lg" disabled={busy || !path.trim()}>
          {reopening ? "Open this library" : "Create my library"}
        </button>
      </form>
    </div>
  );
}

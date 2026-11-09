import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Copy, FileWarning, FolderSearch, RefreshCw } from "lucide-react";
import { api, type CheckedFile } from "../../lib/api";
import { bytes } from "../../lib/format";
import { plural } from "../../lib/format";
import { useRelink } from "./LibraryTools";

function FileRow({ file }: { file: CheckedFile }) {
  return (
    <li className="check-file">
      <Link to="/item/$id" params={{ id: String(file.itemId) }} className="check-title" data-blip>
        {file.title}
      </Link>
      <span className="muted">
        {file.category}
        {file.size ? ` · ${bytes(file.size)}` : ""}
      </span>
      <span className="path" title={file.path}>
        {file.path}
      </span>
    </li>
  );
}

/** Settings › Library check (D-057): files that can't be found, and the same file in several items. */
export function LibraryCheckPage() {
  const check = useQuery({ queryKey: ["library-check"], queryFn: api.libraryCheck });
  const relink = useRelink();
  const data = check.data;
  return (
    <div className="page settings-page check-page">
      <div className="page-header">
        <div className="title-row">
          <Link to="/settings" className="round-btn" aria-label="Back to Settings" title="Back to Settings">
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 className="display">Library check</h1>
            <div className="count">Files that can't be found, and the same file in more than one item</div>
          </div>
        </div>
        <div className="header-actions">
          <button type="button" className="btn" disabled={check.isFetching} onClick={() => void check.refetch()}>
            <RefreshCw size={16} /> Check again
          </button>
        </div>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2>
            <FileWarning size={18} /> Missing files {data && <span className="muted">({data.missing.length})</span>}
          </h2>
          {data && data.missing.length > 0 && (
            <button type="button" className="btn btn-sm" disabled={relink.busy} onClick={() => void relink.run()}>
              <FolderSearch size={15} /> Find moved files…
            </button>
          )}
        </div>
        {relink.message && <p className="hint">{relink.message}</p>}
        {!data ? (
          <p className="hint">Checking…</p>
        ) : data.missing.length === 0 ? (
          <p className="hint">Every file is where it was saved.</p>
        ) : (
          <>
            <p className="hint">
              These files aren't at their saved place: a drive may be unplugged, or they were moved, renamed or deleted. If they were moved, “Find moved files” looks for them by their
              content in a folder you choose. To take an item off the library, open it and choose Remove.
            </p>
            <ul className="check-list">
              {data.missing.map((file) => (
                <FileRow key={`${file.itemId}:${file.path}`} file={file} />
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="panel">
        <h2>
          <Copy size={18} /> Duplicates {data && <span className="muted">({plural(data.duplicates.length, "group")})</span>}
        </h2>
        {!data ? (
          <p className="hint">Checking…</p>
        ) : data.duplicates.length === 0 ? (
          <p className="hint">No file is in more than one item.</p>
        ) : (
          <>
            <p className="hint">Each group is the same file content in different items. Open them to keep the one you want and remove the others.</p>
            {data.duplicates.map((group, index) => (
              <ul key={index} className="check-list check-group">
                {group.map((file) => (
                  <FileRow key={`${file.itemId}:${file.path}`} file={file} />
                ))}
              </ul>
            ))}
          </>
        )}
      </section>
    </div>
  );
}

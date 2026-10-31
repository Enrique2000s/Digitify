import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { open } from "@tauri-apps/plugin-dialog";
import { BookOpen, FilePlus, FolderOpen, HardDrive, ImagePlus, Package, Pencil, Plus, Star, Trash } from "lucide-react";
import { api, artworkUrl, errorText, type FieldDef, type ItemDetail, type VersionInfo } from "../../lib/api";
import { bytes, date, formatLabel, longDuration, ROLE_LABELS } from "../../lib/format";
import { libraryChanged, useCategories, useItem } from "../../lib/queries";
import { aspectFor, Cover } from "../../components/common";
import { HomePath, OrganizePanel } from "../organize/OrganizePanel";
import { canRead } from "../reader/ReaderPage";
import { ChaptersPanel, SeriesPanel } from "./SeriesPanels";
import { canWatch, EpisodesPanel, WatchButton, WatchedButton } from "./WatchPanels";
import { ArrangePagesDialog } from "../builder/BookBuilder";
import { TrackList } from "../music/Tracks";
import { customValues, formatCustom } from "./customFields";
import { AttachFilesDialog, EditItemDialog, PhysicalCopyDialog, RemoveItemDialog } from "./forms";

function meta(item: ItemDetail, key: string): string | null {
  const value = item.metadata?.[key];
  return value == null || value === "" ? null : String(value);
}

interface Track {
  language?: string | null;
  codec?: string | null;
  title?: string | null;
  channels?: number | null;
}

function trackLabel(track: Track): string {
  const channels = track.channels ? (track.channels === 6 ? "5.1" : track.channels === 8 ? "7.1" : `${track.channels} ch`) : null;
  return [track.title || track.language?.toUpperCase(), track.codec?.toUpperCase(), channels].filter(Boolean).join(" · ");
}

function facts(item: ItemDetail, fields: FieldDef[]): [string, ReactNode][] {
  const rows: [string, ReactNode][] = [["Category", item.categoryName]];
  if (item.year) rows.push(["Year", item.year]);
  const add = (label: string, value: ReactNode) => value && rows.push([label, value]);
  switch (item.handler) {
    case "book":
      add("Publisher", meta(item, "publisher"));
      add("ISBN", meta(item, "isbn"));
      add("Language", meta(item, "language"));
      add("Pages", meta(item, "pageCount"));
      break;
    case "comic":
      add("Series", meta(item, "series"));
      add("Volume", meta(item, "volume"));
      add("Issue / chapter", meta(item, "number"));
      add("Publisher", meta(item, "publisher"));
      add("Pages", meta(item, "pageCount"));
      add("Reading direction", meta(item, "readingDirection") === "rtl" ? "Right to left" : "Left to right");
      break;
    case "video": {
      add("Runtime", longDuration(Number(meta(item, "durationSec")) || 0));
      const w = meta(item, "width");
      const h = meta(item, "height");
      add("Resolution", w && h ? `${w} × ${h}` : null);
      add("Video", meta(item, "videoCodec")?.toUpperCase());
      const audio = (item.metadata?.audioTracks as Track[] | undefined) ?? [];
      add("Audio", audio.length ? audio.map(trackLabel).join(", ") : null);
      const subtitles = (item.metadata?.subtitleTracks as Track[] | undefined) ?? [];
      add("Subtitles", subtitles.length ? subtitles.map(trackLabel).join(", ") : null);
      add("Chapters", Number(meta(item, "chapters")) > 0 ? meta(item, "chapters") : null);
      add("Series", meta(item, "series"));
      add("Season", meta(item, "season"));
      add("Episode", meta(item, "episode"));
      break;
    }
    case "audio":
      add("Genre", meta(item, "genre"));
      add("Tracks", item.parts.length || null);
      add("Length", longDuration(Number(meta(item, "durationSec")) || 0));
      add("Discs", Number(meta(item, "discCount")) > 1 ? meta(item, "discCount") : null);
      break;
  }
  const custom = customValues(item.metadata);
  for (const field of fields) add(field.label, formatCustom(field, custom[field.key]));
  rows.push(["Added", date(item.addedAt)]);
  return rows;
}

function CopyCard({ item, version, onEdit }: { item: ItemDetail; version: VersionInfo; onEdit: () => void }) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [arranging, setArranging] = useState(false);
  const imageBook = version.kind === "digital" && version.format === "images" && version.files.length > 1;
  const [error, setError] = useState<string | null>(null);
  const physical = version.kind === "physical";
  const remove = async () => {
    try {
      await api.versionDelete(version.id);
      libraryChanged(queryClient);
    } catch (reason) {
      setError(errorText(reason));
    }
  };
  const missing = version.files.filter((f) => f.status !== "ok").length;
  const managed = version.files.some((f) => f.storage === "managed");
  const size = version.files.reduce((sum, f) => sum + (f.size ?? 0), 0);
  const details = physical
    ? [version.edition, version.condition && `Condition: ${version.condition}`, version.location, version.acquiredAt && `Acquired ${date(version.acquiredAt)}`]
    : [version.files.length > 1 ? `${version.files.length} files` : null, bytes(size)];

  return (
    <div className="copy">
      <div className="copy-icon">{physical ? <Package size={18} /> : <HardDrive size={18} />}</div>
      <div className="copy-body">
        <div className="copy-title">
          {formatLabel(version.format)}
          <span className="chip">{physical ? "Physical" : managed ? "In library folder" : "Referenced"}</span>
          {missing > 0 && <span className="chip warning">{missing === version.files.length ? "Missing" : `${missing} missing`}</span>}
        </div>
        <div className="hint">{details.filter(Boolean).join(" · ")}</div>
        {version.notes && <div className="hint">{version.notes}</div>}
        {!physical && version.files.length > 0 && (
          <ul className="copy-files">
            {version.files.slice(0, 4).map((file) => (
              <li key={file.id}>
                <span className="path" title={file.path}>
                  {file.path}
                </span>
                <button type="button" className="icon-btn" style={{ width: 28, height: 28 }} aria-label="Show in folder" onClick={() => api.fileReveal(file.id).catch((e) => setError(errorText(e)))}>
                  <FolderOpen size={14} />
                </button>
              </li>
            ))}
            {version.files.length > 4 && <li>and {version.files.length - 4} more files</li>}
          </ul>
        )}
        <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
          {physical && (
            <button type="button" className="btn btn-sm" onClick={onEdit}>
              Edit
            </button>
          )}
          {imageBook && (
            <button type="button" className="btn btn-sm" onClick={() => setArranging(true)}>
              Arrange pages
            </button>
          )}
          {confirming ? (
            <>
              <button type="button" className="btn btn-sm btn-danger" onClick={() => void remove()}>
                {physical ? "Remove copy" : "Forget these files"}
              </button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirming(false)}>
                Keep
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirming(true)}>
              Remove
            </button>
          )}
        </div>
        {confirming && !physical && <div className="hint">The files stay on your computer; Digitify just stops tracking them for “{item.title}”.</div>}
        {error && <div className="dialog-error">{error}</div>}
      </div>
      {imageBook && <ArrangePagesDialog item={item} version={version} open={arranging} onOpenChange={setArranging} />}
    </div>
  );
}

export function ItemPage() {
  const { id } = useParams({ from: "/item/$id" });
  const queryClient = useQueryClient();
  const query = useItem(Number(id));
  const categories = useCategories();
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [copy, setCopy] = useState<VersionInfo | "new" | null>(null);
  const [attaching, setAttaching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const item = query.data;

  if (query.isError) {
    return (
      <div className="page">
        <div className="empty">
          <h2 className="display">Not in your library</h2>
          <p>This item was removed or never existed.</p>
          <Link to="/" className="btn">
            Back to Home
          </Link>
        </div>
      </div>
    );
  }
  if (!item) return <div className="page" />;

  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
      libraryChanged(queryClient);
    } catch (reason) {
      setError(errorText(reason));
    }
  };

  const backdrop = (item.metadata as Record<string, unknown>).backdropKey as string | undefined;
  const changeBackdrop = async () => {
    const path = await open({ multiple: false, title: "Choose a background", filters: [{ name: "Images", extensions: ["jpg", "jpeg", "png", "webp", "bmp"] }] });
    if (typeof path === "string") await run(() => api.itemSetBackdrop(item.id, path));
  };
  const changeArtwork = async () => {
    const path = await open({ multiple: false, title: "Choose artwork", filters: [{ name: "Images", extensions: ["jpg", "jpeg", "png", "webp", "gif", "bmp"] }] });
    if (typeof path === "string") await run(() => api.itemSetCover(item.id, path));
  };

  const people = Object.entries(
    item.people.reduce<Record<string, string[]>>((groups, person) => {
      (groups[person.role] ??= []).push(person.name);
      return groups;
    }, {}),
  );
  const formats = [...new Set(item.versions.map((v) => v.format).filter(Boolean))] as string[];
  const readable = canRead(item);
  const watchable = canWatch(item);
  const physical = item.versions.filter((v) => v.kind === "physical");
  const digital = item.versions.filter((v) => v.kind === "digital");

  return (
    <div className="page">
      <section className="hero" aria-labelledby="item-title">
        {backdrop ? (
        <div className="hero-backdrop custom" style={{ backgroundImage: `url(${artworkUrl(backdrop, "cover")})` }} />
      ) : (
        item.coverKey && <div className="hero-backdrop" style={{ backgroundImage: `url(${artworkUrl(item.coverKey)})` }} />
      )}
        <div className="hero-cover" style={{ flexBasis: 220, aspectRatio: aspectFor(item.handler) }}>
          <Cover item={item} size="cover" />
        </div>
        <div className="hero-body">
          <span className="eyebrow">
            <HomePath item={item} />
            {item.year ? ` · ${item.year}` : ""}
          </span>
          <h1 id="item-title" className="display hero-title">
            {item.title}
          </h1>
          {item.subtitle && <p className="hero-meta" style={{ fontSize: 17, color: "var(--text)" }}>{item.subtitle}</p>}
          {people.length > 0 && (
            <p className="hero-meta">
              {people.map(([role, names]) => `${ROLE_LABELS[role] ?? role}: ${names.join(", ")}`).join(" · ")}
            </p>
          )}
          {formats.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {formats.map((format) => (
                <span key={format} className="chip">
                  {formatLabel(format)}
                </span>
              ))}
            </div>
          )}
          <div className="hero-actions">
            {watchable && <WatchButton item={item} />}
            {watchable && <WatchedButton item={item} />}
            {readable && (
              <Link to="/read/$id" params={{ id: String(item.id) }} className="btn btn-primary">
                <BookOpen size={16} />
                {item.progress != null && item.progress > 0 && item.progress < 1 ? `Continue reading · ${Math.round(item.progress * 100)}%` : "Read"}
              </Link>
            )}
            <button
              type="button"
              className={readable || watchable ? "btn" : "btn btn-primary"}
              aria-pressed={item.isFavorite}
              onClick={() => void run(() => api.itemSetFavorite(item.id, !item.isFavorite))}
            >
              <Star size={16} fill={item.isFavorite ? "currentColor" : "none"} />
              {item.isFavorite ? "Favorite" : "Add to favorites"}
            </button>
            <button type="button" className="btn" onClick={() => setEditing(true)}>
              <Pencil size={16} /> Edit details
            </button>
            <button type="button" className="btn" onClick={() => void changeArtwork()}>
              <ImagePlus size={16} /> Change artwork
            </button>
            {item.handler === "video" && (
              <button type="button" className="btn" onClick={() => void (backdrop ? run(() => api.itemSetBackdrop(item.id, null)) : changeBackdrop())}>
                <ImagePlus size={16} /> {backdrop ? "Remove background" : "Background…"}
              </button>
            )}
            <button type="button" className="btn" onClick={() => setRemoving(true)}>
              <Trash size={16} /> Remove
            </button>
          </div>
          {error && <div className="dialog-error">{error}</div>}
        </div>
      </section>

      <div className="item-layout">
        <div>
          {item.description && (
            <section className="panel">
              <h2>About</h2>
              <p className="description">{item.description}</p>
            </section>
          )}
          {item.handler === "audio" && item.parts.length > 0 && (
            <section className="panel">
              <h2>Tracks</h2>
              <TrackList filter={{ album: item.id }} empty="This album's tracks can't be found." showAlbum={false} compact />
            </section>
          )}
          <EpisodesPanel item={item} />
          {readable && <ChaptersPanel itemId={item.id} />}
          <SeriesPanel itemId={item.id} handler={item.handler} />
          <section className="panel">
            <h2>Details</h2>
            <dl className="facts">
              {facts(item, categories.data?.find((c) => c.key === item.category)?.fields ?? []).map(([label, value]) => (
                <div key={label} style={{ display: "contents" }}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
        <aside>
          <OrganizePanel item={item} />
          <section className="panel">
            <div className="panel-head">
              <h2>Your copies</h2>
              <div style={{ display: "flex", gap: 6 }}>
                <button type="button" className="btn btn-sm" onClick={() => setCopy("new")}>
                  <Plus size={14} /> Physical
                </button>
                <button type="button" className="btn btn-sm" onClick={() => setAttaching(true)}>
                  <FilePlus size={14} /> Files
                </button>
              </div>
            </div>
            {physical.length === 0 && digital.length === 0 && <p className="hint">No copies recorded yet.</p>}
            {[...physical, ...digital].map((version) => (
              <CopyCard key={version.id} item={item} version={version} onEdit={() => setCopy(version)} />
            ))}
            {digital.length === 0 && physical.length > 0 && (
              <p className="hint" style={{ marginTop: 12 }}>
                Not digitized yet. Use “Files” to add a scan, ebook or rip as its digital copy.
              </p>
            )}
          </section>
        </aside>
      </div>

      <EditItemDialog item={item} open={editing} onOpenChange={setEditing} />
      <PhysicalCopyDialog item={item} version={copy} onClose={() => setCopy(null)} />
      <RemoveItemDialog item={item} open={removing} onOpenChange={setRemoving} />
      <AttachFilesDialog item={item} open={attaching} onOpenChange={setAttaching} />
    </div>
  );
}

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { BookOpen, ChevronLeft, ChevronRight, Cloud, Download, ExternalLink, FolderOpen, HardDrive, ImagePlus, Pause, Pencil, Play, Star, Trash, Eye } from "lucide-react";
import { photoContext, viewList } from "../../lib/routes";
import { isTyping } from "../../lib/shortcuts";
import { BackButton } from "../../components/BackButton";
import { api, artworkUrl, errorText, type CoverShape, type ItemDetail, type OnlineJob, type VersionInfo } from "../../lib/api";
import { bytes, date, duration, formatLabel, longDuration, ROLE_LABELS } from "../../lib/format";
import { libraryChanged, useItem } from "../../lib/queries";
import { ReviewPanel } from "../../components/Review";
import { Cover } from "../../components/common";
import { SourceTag, sourceProps } from "../../components/SourceTag";
import { coverShapeOf, FILMS, SHAPE_ASPECT, usePreferences } from "../../lib/preferences";
import { useMusic } from "../../lib/music/MusicProvider";
import { HomePath, OrganizePanel } from "../organize/OrganizePanel";
import { canRead } from "../reader/ReaderPage";
import { ChaptersPanel, SeriesPanel } from "./SeriesPanels";
import { canWatch, EpisodesPanel, WatchButton, WatchedButton } from "./WatchPanels";
import { ArrangePagesDialog } from "../builder/BookBuilder";
import { EditItemDialog, RemoveItemDialog } from "./forms";
import { DownloadDialog } from "../online/DownloadDialog";
import { usePlayAndShow } from "../music/playAndShow";

/**
 * Downloads an online item (D-133). The download takes the online item's place, so once it's in
 * the library this page moves on to it.
 */
function DownloadButton({ item }: { item: ItemDetail }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [queued, setQueued] = useState(false);
  useEffect(() => {
    const stop = listen<OnlineJob[]>("online-queue", ({ payload }) => {
      const job = payload.find((j) => j.replaces === item.id);
      if (!job) return;
      setQueued(job.state === "pending" || job.state === "working");
      if ((job.state === "done" || job.state === "skipped") && job.itemId != null && job.itemId !== item.id) {
        void navigate({ to: "/item/$id", params: { id: String(job.itemId) }, replace: true });
      }
    });
    return () => void stop.then((unlisten) => unlisten());
  }, [item.id, navigate]);
  return (
    <>
      <button type="button" className="btn" disabled={queued} onClick={() => setOpen(true)}>
        <Download size={16} /> {queued ? "Downloading…" : "Download"}
      </button>
      <DownloadDialog ids={[item.id]} music={item.handler === "audio"} open={open} onOpenChange={setOpen} onQueued={() => setQueued(true)} />
    </>
  );
}

/**
 * Previous and next (D-138): the items of the view this one was opened from (its category or
 * collection, filter and sort), in its order; ← and → too, when not typing.
 */
function ItemSteps({ id }: { id: number }) {
  const navigate = useNavigate();
  const params = photoContext.params;
  const list = useQuery({ queryKey: ["item-steps", JSON.stringify(params)], queryFn: () => (params ? api.queryIds(params) : Promise.resolve([] as number[])), staleTime: 30_000 });
  const ids = list.data ?? [];
  const at = ids.indexOf(id);
  // Past the last it goes round to the first, and before the first to the last (D-142).
  const count = ids.length;
  const previous = at >= 0 && count > 1 ? ids[(at - 1 + count) % count] : undefined;
  const next = at >= 0 && count > 1 ? ids[(at + 1) % count] : undefined;
  // Stepping replaces the page in the history, so Back still returns to the list.
  const go = (to: number | undefined) => to != null && void navigate({ to: "/item/$id", params: { id: String(to) }, replace: true });
  const keys = useRef({ previous, next, go });
  keys.current = { previous, next, go };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || isTyping(event) || document.querySelector("[role=dialog]")) return;
      if (event.key === "ArrowLeft" && keys.current.previous != null) keys.current.go(keys.current.previous);
      else if (event.key === "ArrowRight" && keys.current.next != null) keys.current.go(keys.current.next);
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  if (at < 0 || ids.length < 2) return null;
  return (
    <div className="item-steps" role="group" aria-label="Previous and next">
      <button type="button" className="round-btn" aria-label="Previous item" title="Previous (←)" disabled={previous == null} onClick={() => go(previous)}>
        <ChevronLeft size={18} strokeWidth={2.6} />
      </button>
      <span className="item-steps-count">
        {at + 1} of {ids.length}
      </span>
      <button type="button" className="round-btn" aria-label="Next item" title="Next (→)" disabled={next == null} onClick={() => go(next)}>
        <ChevronRight size={18} strokeWidth={2.6} />
      </button>
    </div>
  );
}

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

function facts(item: ItemDetail): [string, ReactNode][] {
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
      add("Album", meta(item, "album"));
      add("Track", meta(item, "trackNumber"));
      add("Genre", meta(item, "genre"));
      add("Length", duration(Number(meta(item, "durationSec")) * 1000 || null));
      break;
  }
  rows.push(["Added", date(item.addedAt)]);
  return rows;
}

/** Where an item's file is (D-029: each file is its own item; a series or a book of images holds several). */
function FilePanel({ item, version }: { item: ItemDetail; version: VersionInfo }) {
  const [arranging, setArranging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const imageBook = version.format === "images" && version.files.length > 1;
  const missing = version.files.filter((f) => f.status !== "ok").length;
  const managed = version.files.some((f) => f.storage === "managed");
  const size = version.files.reduce((sum, f) => sum + (f.size ?? 0), 0);
  return (
    <section className="panel">
      <h2>{version.files.length > 1 ? "Files" : "File"}</h2>
      <div className="copy">
        <div className="copy-icon">
          <HardDrive size={18} />
        </div>
        <div className="copy-body">
          <div className="copy-title">
            {formatLabel(version.format)}
            <span className="chip">{managed ? "In library folder" : "Where you keep it"}</span>
            {missing > 0 && <span className="chip warning">{missing === version.files.length ? "Missing" : `${missing} missing`}</span>}
          </div>
          <div className="hint">{[version.files.length > 1 ? `${version.files.length} files` : null, bytes(size)].filter(Boolean).join(" · ")}</div>
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
          {imageBook && (
            <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
              <button type="button" className="btn btn-sm" onClick={() => setArranging(true)}>
                Arrange pages
              </button>
            </div>
          )}
          {error && <div className="dialog-error">{error}</div>}
        </div>
        {imageBook && <ArrangePagesDialog item={item} version={version} open={arranging} onOpenChange={setArranging} />}
      </div>
    </section>
  );
}

/** Colors offered for a cover without artwork. */
const COVER_COLORS = ["#1592d0", "#3fae49", "#f2a516", "#ef5f4f", "#d94f8c", "#8a63d2", "#2b3442", "#c9ced6"];

export function ItemPage() {
  const { id } = useParams({ from: "/item/$id" });
  const navigate = useNavigate();
  const playAndShow = usePlayAndShow();
  const queryClient = useQueryClient();
  const query = useItem(Number(id));
  const { preferences } = usePreferences();
  const music = useMusic();
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
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
  // Music as square covers or CDs, Videos horizontal or vertical, Movies & Series always vertical
  // (D-027); one that matches the default isn't stored.
  const ownShape = (item.metadata as Record<string, unknown>).coverShape as CoverShape | undefined;
  const shape = coverShapeOf({ handler: item.handler, category: item.category, coverShape: ownShape }, preferences.coverShapes);
  const setShape = (value: CoverShape) => {
    const usual = coverShapeOf({ handler: item.handler, category: item.category }, preferences.coverShapes);
    void run(() => api.itemsBulk([item.id], [{ op: "setCoverShape", shape: value === usual ? null : value }]));
  };
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
  // Videos (clips, recordings) just play: no resume and no watched mark (D-027).
  const clip = item.category === "videos";
  // A track is its own item; its one part is what the music player plays.
  const track = item.handler === "audio" ? item.parts.find((part) => part.kind === "track") : undefined;
  const trackPlaying = !!track && music.current?.id === track.id && !music.paused;
  // Imported from a link (D-028): online only, or downloaded and available offline.
  const source = item.online;
  const onlineOnly = !!source && !source.downloaded;
  const openOnline = () => void api.onlineOpen(item.id).catch((reason) => setError(errorText(reason)));
  // An online item can be downloaded (D-133), except Spotify's songs (DRM) and whole playlists saved as one link.
  const downloadable = onlineOnly && !!source && source.provider !== "spotify" && source.kind !== "playlist" && source.kind !== "album";
  const file = item.versions.find((v) => v.kind === "digital" && v.files.length > 0);

  return (
    <div className="page">
      <div className="page-top">
        <BackButton fallback={() => void navigate({ to: "/library/$scope", params: { scope: item.category } })} />
        <ItemSteps id={item.id} />
      </div>
      <section className="hero" aria-labelledby="item-title">
        {backdrop ? (
        <div className="hero-backdrop custom" style={{ backgroundImage: `url(${artworkUrl(backdrop, "cover")})` }} />
      ) : (
        item.coverKey && <div className="hero-backdrop" style={{ backgroundImage: `url(${artworkUrl(item.coverKey)})` }} />
      )}
        <div className="hero-cover" data-shape={shape} style={{ flexBasis: shape === "landscape" ? 360 : 220, aspectRatio: SHAPE_ASPECT[shape] }} {...sourceProps(onlineOnly && source?.provider !== "web" ? source?.service : null)}>
          <Cover item={item} size="cover" />
          <SourceTag service={onlineOnly && source?.provider !== "web" ? source?.service : null} />
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
          {/* A downloaded copy is a file like any other (D-136): only online items say where they live. */}
          {source && onlineOnly && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              <span className="chip online-chip" title="Plays in its service's own player and needs an internet connection">
                <Cloud size={12} /> {source.service} · Online, needs a connection
              </span>
            </div>
          )}
          <div className="hero-actions">
            {onlineOnly && (
              <Link to="/online/$id" params={{ id: String(item.id) }} className="btn btn-primary">
                <Play size={16} /> Play
              </Link>
            )}
            {downloadable && <DownloadButton item={item} />}
            {watchable && clip && (
              <Link to="/watch/$id" params={{ id: String(item.id) }} className="btn btn-primary">
                <Play size={16} /> Play
              </Link>
            )}
            {watchable && !clip && <WatchButton item={item} />}
            {watchable && !clip && <WatchedButton item={item} />}
            {track && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() =>
                  void run(async () => {
                    if (music.current?.id === track.id) return music.toggle();
                    // The rest of the list it was opened from plays after it (D-091).
                    const items = await viewList(item.id, "audio").catch(() => null);
                    const tracks = items ? await api.musicTracks({ items }).catch(() => []) : [];
                    const at = tracks.findIndex((t) => t.id === track.id);
                    return at >= 0 ? playAndShow(tracks.map((t) => t.id), at) : playAndShow([track.id], 0);
                  })
                }
              >
                {trackPlaying ? <Pause size={16} /> : <Play size={16} />} {trackPlaying ? "Pause" : "Play"}
              </button>
            )}
            {item.handler === "image" && (
              <Link to="/view/$id" params={{ id: String(item.id) }} className="btn btn-primary">
                <Eye size={16} /> View
              </Link>
            )}
            {readable && item.handler !== "image" && (
              <Link to="/read/$id" params={{ id: String(item.id) }} className="btn btn-primary">
                <BookOpen size={16} />
                {item.progress != null && item.progress > 0 && item.progress < 1 ? `Continue reading · ${Math.round(item.progress * 100)}%` : "Read"}
              </Link>
            )}
            {/* Where it came from, after Play, online or downloaded alike (D-143). */}
            {source && (
              <button type="button" className="btn" onClick={openOnline}>
                <ExternalLink size={16} /> Open on {source.service}
              </button>
            )}
            <button
              type="button"
              className="btn"
              aria-pressed={item.isFavorite}
              onClick={() => void run(() => api.itemSetFavorite(item.id, !item.isFavorite))}
            >
              <Star size={16} fill={item.isFavorite ? "currentColor" : "none"} />
              {item.isFavorite ? "Favorite" : "Add to favorites"}
            </button>
            <button type="button" className="btn" onClick={() => setEditing(true)}>
              <Pencil size={16} /> Edit details
            </button>
            {item.handler !== "image" && (
              <button type="button" className="btn" onClick={() => void changeArtwork()}>
                <ImagePlus size={16} /> Change artwork
              </button>
            )}
            {item.handler === "video" && (
              <button type="button" className="btn" onClick={() => void (backdrop ? run(() => api.itemSetBackdrop(item.id, null)) : changeBackdrop())}>
                <ImagePlus size={16} /> {backdrop ? "Remove background" : "Background…"}
              </button>
            )}
            <button type="button" className="btn" onClick={() => setRemoving(true)}>
              <Trash size={16} /> Remove
            </button>
          </div>
          {!item.coverKey && (
            <div className="cover-color-row" role="group" aria-label="Cover color">
              <span className="eyebrow">Cover color</span>
              {COVER_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  className="swatch"
                  style={{ background: color }}
                  aria-label={color}
                  aria-pressed={item.coverColor === color}
                  onClick={() => void run(() => api.itemsBulk([item.id], [{ op: "setCoverColor", color }]))}
                />
              ))}
              <label className="swatch swatch-custom" title="Another color" style={{ background: "conic-gradient(red, yellow, lime, aqua, blue, magenta, red)" }}>
                <span className="sr-only">Another color</span>
                <input type="color" value={item.coverColor ?? "#5b7290"} onChange={(event) => void run(() => api.itemsBulk([item.id], [{ op: "setCoverColor", color: event.target.value }]))} />
              </label>
              {item.coverColor && (
                <button type="button" className="btn btn-sm" onClick={() => void run(() => api.itemsBulk([item.id], [{ op: "setCoverColor", color: null }]))}>
                  Plain
                </button>
              )}
            </div>
          )}
          {(item.handler === "audio" || (item.handler === "video" && item.category !== FILMS)) && (
            <div className="cover-shape-row">
              <span className="eyebrow">Cover</span>
              <div className="segmented" role="group" aria-label="Cover shape">
                {(item.handler === "audio"
                  ? ([
                      ["square", "Square"],
                      ["disc", "CD"],
                    ] as const)
                  : ([
                      ["poster", "Vertical"],
                      ["landscape", "Horizontal"],
                    ] as const)
                ).map(([value, label]) => (
                  <button key={value} type="button" aria-pressed={shape === value} onClick={() => setShape(value)}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
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
          <EpisodesPanel item={item} />
          {readable && <ChaptersPanel itemId={item.id} />}
          <SeriesPanel itemId={item.id} handler={item.handler} />
          <section className="panel">
            <h2>Your review</h2>
            <ReviewPanel
              rating={item.rating}
              note={item.note}
              onSave={(rating, note) =>
                void api
                  .itemSetReview(item.id, rating, note)
                  .then(() => libraryChanged(queryClient))
                  .catch((e) => setError(errorText(e)))
              }
            />
          </section>
          <section className="panel">
            <h2>Details</h2>
            <dl className="facts">
              {facts(item).map(([label, value]) => (
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
          {file && <FilePanel item={item} version={file} />}
          {onlineOnly && source && (
            <section className="panel">
              <h2>Online</h2>
              <div className="copy">
                <div className="copy-icon">
                  <Cloud size={18} />
                </div>
                <div className="copy-body">
                  <div className="copy-title">
                    {source.service}
                    <span className="chip online-chip">Online</span>
                  </div>
                  <div className="hint">Not available offline: it stays on {source.service} and plays in its own player.</div>
                  <ul className="copy-files">
                    <li>
                      <span className="path" title={source.url}>
                        {source.url}
                      </span>
                    </li>
                  </ul>
                </div>
              </div>
            </section>
          )}
        </aside>
      </div>

      <EditItemDialog item={item} open={editing} onOpenChange={setEditing} />
      <RemoveItemDialog item={item} open={removing} onOpenChange={setRemoving} />
    </div>
  );
}

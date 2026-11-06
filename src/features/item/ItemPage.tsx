import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { open } from "@tauri-apps/plugin-dialog";
import { BookOpen, Cloud, CloudDownload, ExternalLink, FolderOpen, HardDrive, ImagePlus, Pause, Pencil, Play, Star, Trash } from "lucide-react";
import { api, artworkUrl, errorText, type CoverShape, type FieldDef, type ItemDetail, type VersionInfo } from "../../lib/api";
import { bytes, date, formatLabel, longDuration, ROLE_LABELS } from "../../lib/format";
import { libraryChanged, useCategories, useItem } from "../../lib/queries";
import { Cover } from "../../components/common";
import { SourceTag, sourceProps } from "../../components/SourceTag";
import { coverShapeOf, FILMS, SHAPE_ASPECT, usePreferences } from "../../lib/preferences";
import { useMusic } from "../../lib/music/MusicProvider";
import { duration } from "../music/Tracks";
import { HomePath, OrganizePanel } from "../organize/OrganizePanel";
import { canRead } from "../reader/ReaderPage";
import { ChaptersPanel, SeriesPanel } from "./SeriesPanels";
import { canWatch, EpisodesPanel, WatchButton, WatchedButton } from "./WatchPanels";
import { ArrangePagesDialog } from "../builder/BookBuilder";
import { customValues, formatCustom } from "./customFields";
import { EditItemDialog, RemoveItemDialog } from "./forms";

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
      add("Album", meta(item, "album"));
      add("Track", meta(item, "trackNumber"));
      add("Genre", meta(item, "genre"));
      add("Length", duration(Number(meta(item, "durationSec")) * 1000 || null));
      break;
  }
  const custom = customValues(item.metadata);
  for (const field of fields) add(field.label, formatCustom(field, custom[field.key]));
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
  const queryClient = useQueryClient();
  const query = useItem(Number(id));
  const categories = useCategories();
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
  const file = item.versions.find((v) => v.kind === "digital" && v.files.length > 0);

  return (
    <div className="page">
      <section className="hero" aria-labelledby="item-title">
        {backdrop ? (
        <div className="hero-backdrop custom" style={{ backgroundImage: `url(${artworkUrl(backdrop, "cover")})` }} />
      ) : (
        item.coverKey && <div className="hero-backdrop" style={{ backgroundImage: `url(${artworkUrl(item.coverKey)})` }} />
      )}
        <div className="hero-cover" data-shape={shape} style={{ flexBasis: shape === "landscape" ? 360 : 220, aspectRatio: SHAPE_ASPECT[shape] }} {...sourceProps(source?.provider === "web" ? null : source?.service)}>
          <Cover item={item} size="cover" />
          <SourceTag service={source?.provider === "web" ? null : source?.service} />
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
          {source && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {onlineOnly ? (
                <span className="chip online-chip" title="Plays in its service's own player and needs an internet connection">
                  <Cloud size={12} /> {source.service} · Online, needs a connection
                </span>
              ) : (
                <span className="chip" title="Downloaded into your library">
                  <CloudDownload size={12} /> From {source.service} · Available offline
                </span>
              )}
            </div>
          )}
          <div className="hero-actions">
            {onlineOnly && (
              <Link to="/online/$id" params={{ id: String(item.id) }} className="btn btn-primary">
                <Play size={16} /> Play
              </Link>
            )}
            {source && (
              <button type="button" className="btn" onClick={openOnline}>
                <ExternalLink size={16} /> Open on {source.service}
              </button>
            )}
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
                onClick={() => void run(() => (music.current?.id === track.id ? Promise.resolve(music.toggle()) : music.play([track.id], 0)))}
              >
                {trackPlaying ? <Pause size={16} /> : <Play size={16} />} {trackPlaying ? "Pause" : "Play"}
              </button>
            )}
            {readable && (
              <Link to="/read/$id" params={{ id: String(item.id) }} className="btn btn-primary">
                <BookOpen size={16} />
                {item.progress != null && item.progress > 0 && item.progress < 1 ? `Continue reading · ${Math.round(item.progress * 100)}%` : "Read"}
              </Link>
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

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { Link as RouterLink } from "@tanstack/react-router";
import { Check, ChevronDown, ChevronUp, CircleCheck, Cloud, Download, Link2, LoaderCircle, RotateCcw, Search, TriangleAlert, X } from "lucide-react";
import { api, errorText, type OnlineEntry, type OnlineJob, type OnlinePreview } from "../../lib/api";
import { libraryChanged, useCategories } from "../../lib/queries";
import { Dialog, Field, Switch } from "../../components/common";
import { DownloadOptions, useDownloadQuality } from "./DownloadDialog";

function clock(seconds: number | null): string {
  if (!seconds || seconds <= 0) return "";
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${rest}` : `${m}:${rest}`;
}

/** What will happen to an entry: downloaded, saved online, already here, or not available. */
function EntryStatus({ entry, download }: { entry: OnlineEntry; download: boolean }) {
  if (!entry.available) return <span className="chip warning">Unavailable</span>;
  if (entry.existing != null) return <span className="chip">In your library</span>;
  if (entry.live)
    return (
      <span className="chip online-chip" title="Live now: saved as an online item; it can be downloaded once the stream is over">
        <Cloud size={12} /> Live
      </span>
    );
  if (entry.downloadable && download)
    return (
      <span className="chip accent" title="Downloaded into your library and available offline">
        <Download size={12} /> Download
      </span>
    );
  return (
    <span className="chip online-chip" title="Saved as a link that plays in the service's own player; needs a connection">
      <Cloud size={12} /> Online
    </span>
  );
}

/** A playlist comes in a section at a time (D-146), never all of a long one at once. */
const SECTION = 25;

/** The entries of a section that can come in and aren't here yet. */
const fresh = (entries: OnlineEntry[], section: number) =>
  entries.map((entry, index) => (entry.available && entry.existing == null && Math.floor(index / SECTION) === section ? index : -1)).filter((i) => i >= 0);

/** What each kind of link menu takes (D-134): the sites it downloads from, and what's online only. */
const SITES = {
  music: {
    what: "Songs, albums and playlists, downloaded as sound (or saved online).",
    sites: ["YouTube Music", "YouTube (the sound)", "SoundCloud", "Bandcamp", "Mixcloud", "Internet Archive"],
    online: "Spotify: saved online, as its music is DRM-protected.",
    files: "Direct links to audio files: MP3, FLAC, M4A, Opus, OGG, WAV.",
  },
  video: {
    what: "Videos, playlists and channels, downloaded into Videos (or saved online).",
    sites: ["YouTube", "Twitch (past broadcasts)", "Dailymotion", "Internet Archive", "Bilibili", "Vimeo (videos that don't ask to sign in)"],
    online: "Live streams: saved online until they're over.",
    files: "Direct links to video files: MP4, MKV, WebM, MOV.",
  },
} as const;

/** An entry as this menu takes it: music in the music menu, videos in the videos menu (D-134). */
function fitFor(entry: OnlineEntry, mode: "music" | "video"): OnlineEntry {
  if (mode === "video" && entry.audio && entry.provider !== "youtube") return { ...entry, available: false, downloadable: false, reason: "It's music: add it from Music." };
  if (mode === "music" && entry.provider === "web" && !entry.audio) return { ...entry, available: false, downloadable: false, reason: "It's a video file: add it from Videos." };
  return entry;
}

/**
 * Adding from a link (D-028, D-133, D-134): one menu for music (a music category) and one for
 * videos (Videos), each saying which sites and links it takes. Paste a link, see what it holds,
 * pick what to import. What can be downloaded (direct files, and through yt-dlp YouTube,
 * SoundCloud and the other sites it knows) is downloaded and kept offline, as sound in the music
 * menu and as video in the videos one; the rest (Spotify, live streams) is saved as online items
 * played in the service's own player. Videos go to Videos; one can go to Movies & Series from there.
 */
export function ImportUrlDialog({ category, onClose }: { category: string | null; onClose: () => void }) {
  const categories = useCategories();
  const open = category != null;
  const onOpenChange = (next: boolean) => !next && onClose();
  const target = categories.data?.find((c) => c.key === category);
  const mode: "music" | "video" = target?.handler === "audio" ? "music" : "video";
  const sites = SITES[mode];
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<OnlinePreview | null>(null);
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [download, setDownload] = useState(true);
  const [section, setSection] = useState(0);
  // A playlist's songs go into a Digitify playlist and its videos into a collection (D-146), on by default.
  const [group, setGroup] = useState(true);
  const [groupName, setGroupName] = useState("");
  const [quality] = useDownloadQuality();

  useEffect(() => {
    if (!open) return;
    setUrl("");
    setPreview(null);
    setError(null);
    setBusy(false);
  }, [open]);

  const look = async (link = url) => {
    if (!link.trim()) return;
    setBusy(true);
    setError(null);
    setPreview(null);
    try {
      const found = await api.onlineInspect(link);
      setPreview(found);
      const fitted = found.entries.map((entry) => fitFor(entry, mode));
      // The first section with something new in it.
      const sections = Math.max(1, Math.ceil(fitted.length / SECTION));
      const first = Array.from({ length: sections }, (_, i) => i).find((i) => fresh(fitted, i).length > 0) ?? 0;
      setSection(first);
      setChosen(new Set(fresh(fitted, first)));
      setGroupName(found.title);
      setGroup(true);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };

  const entries = (preview?.entries ?? []).map((entry) => fitFor(entry, mode));
  // The menu decides: sound in the music one, video in the videos one (D-134).
  const picked = entries.filter((_, index) => chosen.has(index)).map((entry) => ({ ...entry, audio: mode === "music" }));
  const anyDownloadable = entries.some((entry) => entry.downloadable);
  const viaYtdlp = download && picked.some((entry) => entry.ytdlp);
  const offlineTracks = picked.filter((entry) => (entry.downloadable && download) || entry.existing != null).length;
  const sections = Math.ceil(entries.length / SECTION);
  const inSection = entries.map((entry, index) => ({ entry, index })).filter(({ index }) => Math.floor(index / SECTION) === section);
  const pickSection = (next: number) => {
    setSection(next);
    setChosen(new Set(fresh(entries, next)));
  };
  const grouping = !!preview?.collection && group && groupName.trim() !== "" && (mode === "video" || offlineTracks > 0);

  const start = async () => {
    if (!preview || picked.length === 0 || !category) return;
    setBusy(true);
    setError(null);
    try {
      await api.onlineImport({
        entries: picked,
        musicCategory: mode === "music" ? category : "music",
        videoCategory: "videos",
        download,
        playlistName: mode === "music" && grouping ? groupName : null,
        collectionName: mode === "video" && grouping ? groupName : null,
        quality,
      });
      onClose();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };

  const toggle = (index: number) =>
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      wide
      title={`Add ${mode === "music" ? (target?.name ?? "music") : "videos"} from a link`}
      description="Digitify goes online only to look the link up and to download."
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={!preview || picked.length === 0 || busy} onClick={() => void start()}>
            {picked.length > 1 ? `Import ${picked.length} items` : "Import"}
          </button>
        </>
      }
    >
      {!preview && (
        <div className="url-sites" aria-label="What this takes">
          <p>{sites.what}</p>
          <div className="url-site-list">
            {sites.sites.map((site) => (
              <span key={site} className="chip">
                {site}
              </span>
            ))}
            <span className="muted">and many more sites yt-dlp knows</span>
          </div>
          <p className="hint">{sites.online}</p>
          <p className="hint">{sites.files}</p>
          {mode === "video" && <p className="hint">To make one a movie or a series' episode: Movies & Series › Add › From Videos.</p>}
        </div>
      )}
      <form
        className="url-row"
        onSubmit={(event) => {
          event.preventDefault();
          void look();
        }}
      >
        <label className="search-pill url-field">
          <Link2 size={16} aria-hidden />
          <input
            type="url"
            autoFocus
            placeholder={mode === "music" ? "Paste a link to a song, album or playlist" : "Paste a link to a video, playlist or channel"}
            aria-label="Link"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            onPaste={(event) => {
              const pasted = event.clipboardData.getData("text").trim();
              if (pasted) {
                event.preventDefault();
                setUrl(pasted);
                void look(pasted);
              }
            }}
          />
        </label>
        <button type="submit" className="btn" disabled={busy || !url.trim()}>
          {busy && !preview ? <LoaderCircle size={15} className="spin" /> : <Search size={15} />} Look up
        </button>
      </form>
      {error && <div className="dialog-error">{error}</div>}

      {preview && (
        <>
          <div className="url-preview">
            {preview.thumbnail ? <img src={preview.thumbnail} alt="" className="url-thumb" referrerPolicy="no-referrer" /> : <span className="url-thumb" />}
            <div className="url-preview-text">
              <span className="eyebrow">
                {preview.service} · {preview.collection ? `${preview.kind === "album" ? "Album" : "Playlist"} · ${entries.length} items` : mode === "music" ? "Music" : "Video"}
              </span>
              <strong>{preview.title}</strong>
              {preview.creator && <span className="muted">{preview.creator}</span>}
            </div>
          </div>
          {preview.notes.map((note) => (
            <p key={note} className="hint url-note">
              {note}
            </p>
          ))}

          {sections > 1 && (
            <div className="url-sections">
              <label className="url-section-pick">
                <span>Section</span>
                <select className="input" aria-label="Section" value={section} onChange={(event) => pickSection(Number(event.target.value))}>
                  {Array.from({ length: sections }, (_, i) => {
                    const from = i * SECTION;
                    const to = Math.min(entries.length, from + SECTION);
                    const here = entries.slice(from, to).filter((e) => e.existing != null).length;
                    return (
                      <option key={i} value={i}>
                        {`${from + 1}–${to}`}
                        {here === to - from ? " · all in your library" : here > 0 ? ` · ${here} in your library` : ""}
                      </option>
                    );
                  })}
                </select>
              </label>
              <span className="hint">
                {SECTION} at a time. For the next ones, come back with the same link: what's already in your library shows as such.
              </span>
            </div>
          )}
          {inSection.length > 1 && (
            <div className="url-select">
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setChosen(new Set(inSection.filter(({ entry }) => entry.available).map(({ index }) => index)))}>
                Select all
              </button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setChosen(new Set())}>
                Select none
              </button>
              <span className="muted">{picked.length} selected</span>
            </div>
          )}
          <ul className="url-entries">
            {inSection.map(({ entry, index }) => (
              <li key={`${entry.externalId}:${index}`} className={entry.available ? "" : "off"}>
                <label>
                  <input type="checkbox" checked={chosen.has(index)} disabled={!entry.available} onChange={() => toggle(index)} />
                  {entry.thumbnail ? <img src={entry.thumbnail} alt="" className="url-entry-thumb" referrerPolicy="no-referrer" loading="lazy" /> : <span className="url-entry-thumb" />}
                  <span className="url-entry-text">
                    <strong>{entry.title}</strong>
                    <span className="muted">{[entry.creator, clock(entry.durationSec)].filter(Boolean).join(" · ")}</span>
                    {entry.reason && <span className="hint">{entry.reason}</span>}
                  </span>
                  <EntryStatus entry={entry} download={download} />
                </label>
              </li>
            ))}
          </ul>

          <div className="url-options">
            {anyDownloadable && (
              <Field
                label="Downloads"
                hint={`Downloaded files go into your library folder and play offline, like your own files.${mode === "music" ? " Videos come in as their sound." : ""} ${sites.online}`}
              >
                <label className="inline">
                  <Switch checked={download} onChange={setDownload} label="Download" /> Download, to keep and play offline
                </label>
              </Field>
            )}
            {viaYtdlp && <DownloadOptions video={mode === "video"} audio={mode === "music"} />}
            {preview.collection && (mode === "video" || offlineTracks > 0) && (
              <Field
                label={mode === "music" ? "Playlist" : "Collection"}
                hint={
                  mode === "music"
                    ? "Holds the songs that are available offline, in the original order. If you already have a playlist with this name, they join it (as the next sections do)."
                    : "The videos go into this collection in Videos. If it's already there, they join it (as the next sections do)."
                }
              >
                <label className="inline">
                  <Switch checked={group} onChange={setGroup} label={mode === "music" ? "Put them in a playlist" : "Put them in a collection"} />{" "}
                  {mode === "music" ? "Put them in a playlist" : "Put them in a collection"}
                </label>
                {group && <input className="input" aria-label={mode === "music" ? "Playlist name" : "Collection name"} value={groupName} maxLength={120} onChange={(event) => setGroupName(event.target.value)} />}
              </Field>
            )}
          </div>
        </>
      )}
    </Dialog>
  );
}

const STATE_TEXT: Record<OnlineJob["state"], string> = {
  pending: "Waiting",
  working: "",
  done: "",
  skipped: "Already in your library",
  failed: "Failed",
  cancelled: "Cancelled",
};

export function jobText(job: OnlineJob): string {
  if (job.state === "working") return job.action === "download" ? `Downloading ${Math.round((job.progress ?? 0) * 100)}%` : "Saving";
  if (job.state === "done") return job.action === "download" ? "Downloaded · offline" : "Added · online";
  if (job.state === "failed" || job.state === "skipped") return job.error ?? STATE_TEXT[job.state];
  return STATE_TEXT[job.state];
}

export function JobIcon({ job }: { job: OnlineJob }): ReactNode {
  switch (job.state) {
    case "working":
      return <LoaderCircle size={16} className="spin" aria-hidden />;
    case "done":
      return <CircleCheck size={16} color="var(--success)" aria-hidden />;
    case "skipped":
      return <Check size={16} aria-hidden />;
    case "failed":
      return <TriangleAlert size={16} color="var(--warning)" aria-hidden />;
    default:
      return job.action === "download" ? <Download size={16} aria-hidden /> : <Cloud size={16} aria-hidden />;
  }
}

/** The import queue (D-028): each link being downloaded or saved, with cancel and retry. */
export function OnlineQueuePanel() {
  const queryClient = useQueryClient();
  const initial = useQuery({ queryKey: ["online-queue"], queryFn: api.onlineQueue });
  const [jobs, setJobs] = useState<OnlineJob[]>([]);
  const [open, setOpen] = useState(true);
  // Once everything is done the corner clears by itself (D-183): soon when all went well, a little
  // later when something failed. The history stays in the title bar's Downloads button.
  const [away, setAway] = useState(false);
  useEffect(() => {
    if (initial.data) setJobs(initial.data);
  }, [initial.data]);
  useEffect(() => {
    const stop = listen<OnlineJob[]>("online-queue", ({ payload }) => {
      setJobs(payload);
      if (payload.some((job) => job.state === "pending" || job.state === "working")) {
        setOpen(true);
        setAway(false);
      }
    });
    return () => void stop.then((unlisten) => unlisten());
  }, []);
  const running = jobs.filter((job) => job.state === "pending" || job.state === "working");
  const finishedCount = useMemo(() => jobs.filter((job) => job.state === "done" || job.state === "skipped").length, [jobs]);
  useEffect(() => {
    if (finishedCount) libraryChanged(queryClient);
  }, [finishedCount, queryClient]);
  const anyFailed = jobs.some((job) => job.state === "failed");
  useEffect(() => {
    if (jobs.length === 0 || running.length > 0) return;
    const timer = window.setTimeout(() => setAway(true), anyFailed ? 12_000 : 6_000);
    return () => window.clearTimeout(timer);
  }, [jobs.length, running.length, anyFailed]);
  if (jobs.length === 0 || away) return null;
  const failed = jobs.filter((job) => job.state === "failed").length;
  const finished = jobs.length - running.length;
  const fraction = jobs.length ? (finished + running.reduce((sum, job) => sum + (job.progress ?? 0), 0)) / jobs.length : 0;
  return (
    <section className="online-queue" aria-live="polite" aria-label="Import queue">
      <header>
        {running.length ? <LoaderCircle size={18} className="spin" aria-hidden /> : failed ? <TriangleAlert size={18} color="var(--warning)" aria-hidden /> : <CircleCheck size={18} color="var(--success)" aria-hidden />}
        <span>
          {running.length ? `Importing ${finished + 1} of ${jobs.length}` : "Imports finished"}
          {failed > 0 && ` · ${failed} failed`}
        </span>
        <button type="button" className="icon-btn" aria-label={open ? "Hide the list" : "Show the list"} aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        </button>
        {running.length > 0 ? (
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => void api.onlineCancel(null)}>
            Cancel all
          </button>
        ) : (
          <button type="button" className="icon-btn" aria-label="Clear the list" title="Clear the list" onClick={() => void api.onlineClear()}>
            <X size={16} />
          </button>
        )}
      </header>
      <div className="progress">
        <span style={{ width: `${Math.round(fraction * 100)}%` }} />
      </div>
      {open && (
        <ul className="online-jobs">
          {jobs.map((job) => (
            <li key={job.id} className={`online-job ${job.state}`}>
              <JobIcon job={job} />
              <span className="online-job-text">
                {job.itemId != null && (job.state === "done" || job.state === "skipped") ? (
                  <RouterLink to="/item/$id" params={{ id: String(job.itemId) }} className="online-job-title">
                    {job.title}
                  </RouterLink>
                ) : (
                  <span className="online-job-title">{job.title}</span>
                )}
                <span className="online-job-status">
                  {job.service} · {jobText(job)}
                </span>
                {job.state === "working" && job.action === "download" && (
                  <span className="progress thin">
                    <span style={{ width: `${Math.round((job.progress ?? 0) * 100)}%` }} />
                  </span>
                )}
              </span>
              {(job.state === "pending" || job.state === "working") && (
                <button type="button" className="icon-btn" aria-label={`Cancel ${job.title}`} title="Cancel" onClick={() => void api.onlineCancel(job.id)}>
                  <X size={15} />
                </button>
              )}
              {(job.state === "failed" || job.state === "cancelled") && (
                <button type="button" className="icon-btn" aria-label={`Retry ${job.title}`} title="Retry" onClick={() => void api.onlineRetry(job.id)}>
                  <RotateCcw size={15} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

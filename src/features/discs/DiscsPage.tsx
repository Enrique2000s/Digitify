import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { BackButton } from "../../components/BackButton";
import { AudioLines, ChevronRight, Disc3, Download, FileIcon, Folder, HardDriveDownload, Pause, Play, ShieldAlert, Square, Upload, X } from "lucide-react";
import { api, cdTrackUrl, errorText, type DiscContents, type DiscJob, type DiscTitle, type DriveInfo, driveName, onLinux } from "../../lib/api";
import { useAmbientHold } from "../../lib/ambient/AmbientProvider";
import { DISC_KINDS, useDiscs } from "../../lib/discs";
import { useMusic } from "../../lib/music/MusicProvider";
import { bytes } from "../../lib/format";
import { libraryChanged } from "../../lib/queries";

function clock(seconds: number): string {
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}` : `${m}:${String(s % 60).padStart(2, "0")}`;
}

function languages(codes: string[]): string {
  const names = new Intl.DisplayNames(undefined, { type: "language" });
  const list = codes.map((code) => {
    if (!code) return "Unknown";
    try {
      return names.of(code) ?? code;
    } catch {
      return code;
    }
  });
  return list.length ? list.join(", ") : "None";
}

function JobRow({ job }: { job: DiscJob }) {
  const { dismissJob } = useDiscs();
  const running = job.phase !== "done" && job.phase !== "failed" && job.phase !== "cancelled";
  const phase = {
    reading: job.kind === "rip" ? "Reading and verifying" : "Copying",
    encoding: "Encoding",
    importing: "Adding to your library",
    done: "Done",
    failed: "Failed",
    cancelled: "Cancelled",
  }[job.phase];
  return (
    <div className={`disc-job ${job.phase}`} role="status">
      <div className="disc-job-head">
        <strong>
          {job.kind === "rip" ? "Ripping" : "Importing"} · {phase}
          {job.current ? ` · ${job.current}` : ""}
        </strong>
        {running ? (
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => void api.discJobCancel(job.id)}>
            <Square size={13} /> Cancel
          </button>
        ) : (
          <>
            {job.itemId && (
              <Link to="/item/$id" params={{ id: String(job.itemId) }} className="btn btn-sm btn-primary">
                Open in your library
              </Link>
            )}
            <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => dismissJob(job.id)}>
              <X size={15} />
            </button>
          </>
        )}
      </div>
      {running && <div className="meter" role="progressbar" aria-valuenow={Math.round(job.fraction * 100)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${job.fraction * 100}%` }} /></div>}
      {job.error && <div className="dialog-error">{job.error}</div>}
      {job.warnings.map((warning) => (
        <p key={warning} className="hint">
          {warning}
        </p>
      ))}
    </div>
  );
}

function AudioDisc({ letter, contents }: { letter: string; contents: Extract<DiscContents, { kind: "audio" }> }) {
  const music = useMusic();
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState<number | null>(null);
  const [paused, setPaused] = useState(true);
  const [album, setAlbum] = useState(contents.album ?? "");
  const [artist, setArtist] = useState(contents.artist ?? "");
  const [year, setYear] = useState("");
  const [format, setFormat] = useState<"flac" | "wav">("flac");
  const [titles, setTitles] = useState<Record<number, string>>(() => Object.fromEntries(contents.tracks.map((t) => [t.number, t.title ?? ""])));
  const [selected, setSelected] = useState<Set<number>>(() => new Set(contents.tracks.filter((t) => t.audio).map((t) => t.number)));
  const [error, setError] = useState<string | null>(null);
  useAmbientHold("media", playing !== null && !paused);

  const play = (number: number) => {
    const element = audio.current;
    if (!element) return;
    if (playing === number) {
      if (element.paused) void element.play();
      else element.pause();
      return;
    }
    if (music.active && !music.paused) music.pause();
    element.src = cdTrackUrl(letter, number);
    setPlaying(number);
    void element.play().catch((reason) => setError(errorText(reason)));
  };
  const rip = async () => {
    setError(null);
    try {
      await api.cdRip(letter, {
        tracks: [...selected].sort((a, b) => a - b),
        album,
        artist: artist.trim() || null,
        year: /^\d{4}$/.test(year.trim()) ? Number(year) : null,
        titles: Object.fromEntries(Object.entries(titles).filter(([, t]) => t.trim())),
        format,
      });
    } catch (reason) {
      setError(errorText(reason));
    }
  };
  const audioTracks = contents.tracks.filter((t) => t.audio);
  return (
    <div className="disc-body">
      <div className="field-row three">
        <label className="field">
          <span>Album</span>
          <input className="input" value={album} placeholder="Audio CD" onChange={(e) => setAlbum(e.target.value)} />
        </label>
        <label className="field">
          <span>Artist</span>
          <input className="input" value={artist} onChange={(e) => setArtist(e.target.value)} />
        </label>
        <label className="field">
          <span>Year</span>
          <input className="input" inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value)} />
        </label>
      </div>
      {!contents.album && <p className="hint">This CD has no CD-Text, so its names are up to you; they can also be edited later.</p>}
      <ol className="tracks disc-tracks">
        {contents.tracks.map((track) => (
          <li key={track.number} className={playing === track.number ? "playing" : undefined}>
            <input
              type="checkbox"
              aria-label={`Rip track ${track.number}`}
              disabled={!track.audio}
              checked={selected.has(track.number)}
              onChange={(e) =>
                setSelected((current) => {
                  const next = new Set(current);
                  if (e.target.checked) next.add(track.number);
                  else next.delete(track.number);
                  return next;
                })
              }
            />
            <span className="no">{track.number}</span>
            {track.audio ? (
              <input className="input track-name" aria-label={`Track ${track.number} title`} value={titles[track.number] ?? ""} placeholder={`Track ${track.number}`} onChange={(e) => setTitles({ ...titles, [track.number]: e.target.value })} />
            ) : (
              <span className="muted">Data track</span>
            )}
            <span className="muted">{clock(track.seconds)}</span>
            <button type="button" className="icon-btn" disabled={!track.audio} aria-label={playing === track.number && !paused ? `Pause track ${track.number}` : `Play track ${track.number}`} onClick={() => play(track.number)}>
              {playing === track.number && !paused ? <Pause size={16} /> : playing === track.number ? <AudioLines size={16} /> : <Play size={16} />}
            </button>
          </li>
        ))}
      </ol>
      <audio
        ref={audio}
        onPlay={() => setPaused(false)}
        onPause={() => setPaused(true)}
        onEnded={() => {
          const next = audioTracks.find((t) => t.number > (playing ?? 0));
          if (next) play(next.number);
          else setPlaying(null);
        }}
        onError={() => playing !== null && setError("This track can't be read from the disc.")}
      />
      <div className="disc-actions">
        <button type="button" className="btn btn-primary" disabled={selected.size === 0 || !album.trim()} onClick={() => void rip()}>
          <HardDriveDownload size={16} /> Rip {selected.size} track{selected.size === 1 ? "" : "s"} to your library
        </button>
        <label className="inline">
          Format
          <select className="select" value={format} onChange={(e) => setFormat(e.target.value as "flac" | "wav")}>
            <option value="flac">FLAC (lossless, smaller)</option>
            <option value="wav">WAV (uncompressed)</option>
          </select>
        </label>
      </div>
      <p className="hint">Every part of the disc is read twice and compared; parts that differ are read again until two reads agree.</p>
      {error && <div className="dialog-error">{error}</div>}
    </div>
  );
}

function VideoDisc({ letter, titles }: { letter: string; titles: DiscTitle[] }) {
  const [error, setError] = useState<string | null>(null);
  if (titles.length === 0) return <p className="hint">This disc has no titles Digitify can show.</p>;
  return (
    <div className="disc-body">
      <ol className="tracks disc-titles">
        {titles.map((title, index) => (
          <li key={title.number}>
            <span className="no">{index + 1}</span>
            <span>
              <strong>Title {title.number}</strong>
              {index === 0 && titles.length > 1 && <span className="chip">Longest</span>}
              <span className="hint">
                {title.chapters.length} chapter{title.chapters.length === 1 ? "" : "s"} · Audio: {languages(title.audio)} · Subtitles: {languages(title.subtitles)}
              </span>
            </span>
            <span className="muted">{clock(title.seconds)}</span>
            <span className="disc-title-actions">
              <Link to="/disc/$letter/$title" params={{ letter, title: String(title.number) }} className="btn btn-sm btn-primary">
                <Play size={14} /> Play
              </Link>
              <button type="button" className="btn btn-sm" onClick={() => void api.discImport(letter, title.number).catch((reason) => setError(errorText(reason)))}>
                <Download size={14} /> Import
              </button>
            </span>
          </li>
        ))}
      </ol>
      <div className="disc-actions">
      </div>
      <p className="hint">Titles play and import straight from the disc. Disc menus aren't shown. Import copies the title into your library as an MKV with its chapters, audio and subtitles, without re-encoding.</p>
      {error && <div className="dialog-error">{error}</div>}
    </div>
  );
}

function DataDisc({ letter, contents, onOpen }: { letter: string; contents: Extract<DiscContents, { kind: "data" }>; onOpen: (path: string) => void }) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => setSelected(new Set()), [contents.path]);
  const crumbs = contents.path ? contents.path.split(/[\\/]/) : [];
  // The disc's own separator: "\" on Windows, "/" on Linux.
  const separator = onLinux ? "/" : "\\";
  const join = (path: string) => `${contents.root.replace(/[\\/]$/, "")}${separator}${path}`;
  const importSelected = async () => {
    try {
      await api.importStart([...selected].map(join), "copy", null);
      libraryChanged(queryClient);
      setMessage(`Importing ${selected.size} item${selected.size === 1 ? "" : "s"}: copies go into your library folder, so they stay after the disc is out.`);
      setSelected(new Set());
    } catch (reason) {
      setMessage(errorText(reason));
    }
  };
  return (
    <div className="disc-body">
      <nav className="disc-crumbs" aria-label="Folder">
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => onOpen("")}>
          {driveName(letter)}
        </button>
        {crumbs.map((part, index) => (
          <span key={index}>
            <ChevronRight size={14} aria-hidden />
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => onOpen(crumbs.slice(0, index + 1).join(onLinux ? "/" : "\\"))}>
              {part}
            </button>
          </span>
        ))}
      </nav>
      {contents.entries.length === 0 ? (
        <p className="hint">This folder is empty.</p>
      ) : (
        <ul className="disc-files">
          {contents.entries.map((entry) => (
            <li key={entry.path}>
              <input
                type="checkbox"
                aria-label={`Select ${entry.name}`}
                checked={selected.has(entry.path)}
                onChange={(e) =>
                  setSelected((current) => {
                    const next = new Set(current);
                    if (e.target.checked) next.add(entry.path);
                    else next.delete(entry.path);
                    return next;
                  })
                }
              />
              {entry.dir ? <Folder size={16} aria-hidden /> : <FileIcon size={16} aria-hidden />}
              {entry.dir ? (
                <button type="button" className="disc-folder" onClick={() => onOpen(entry.path)}>
                  {entry.name}
                </button>
              ) : (
                <span>{entry.name}</span>
              )}
              <span className="muted">{entry.dir ? "" : bytes(entry.size)}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="disc-actions">
        <button type="button" className="btn btn-primary" disabled={selected.size === 0} onClick={() => void importSelected()}>
          <Upload size={16} /> Import {selected.size || ""} selected
        </button>
      </div>
      {message && <p className="hint">{message}</p>}
    </div>
  );
}

function DiscContentsView({ drive }: { drive: DriveInfo }) {
  const [path, setPath] = useState("");
  const key = `${drive.media?.kind}:${drive.media?.label}`;
  useEffect(() => setPath(""), [key]);
  const contents = useQuery({
    queryKey: ["disc-contents", drive.letter, key, path],
    queryFn: () => api.discContents(drive.letter, path || null),
    staleTime: Infinity,
    retry: false,
  });
  if (contents.isLoading) return <p className="hint">Reading the disc…</p>;
  if (contents.isError) return <div className="dialog-error">{errorText(contents.error)}</div>;
  const data = contents.data;
  if (!data || data.kind === "empty") return <p className="hint">This disc is blank or can't be read.</p>;
  switch (data.kind) {
    case "audio":
      return <AudioDisc key={key} letter={drive.letter} contents={data} />;
    case "dvd":
    case "bluray":
      return <VideoDisc letter={drive.letter} titles={data.titles} />;
    case "data":
      return <DataDisc letter={drive.letter} contents={data} onOpen={setPath} />;
    case "protected":
      return (
        <div className="disc-body">
          <div className="notice warning">
            <ShieldAlert size={18} aria-hidden style={{ flexShrink: 0 }} />
            <span>
              <strong>Copy-protected ({data.protection}).</strong> {data.message}
            </span>
          </div>
          <div className="disc-actions">
          </div>
        </div>
      );
  }
}

function DriveCard({ drive }: { drive: DriveInfo }) {
  const { jobs } = useDiscs();
  const [error, setError] = useState<string | null>(null);
  const media = drive.media;
  return (
    <section className="panel disc-drive">
      <div className="disc-head">
        <span className="disc-icon">
          <Disc3 size={26} aria-hidden />
        </span>
        <div className="disc-name">
          <span className="eyebrow">
            Drive {driveName(drive.letter)} {drive.name ? `· ${drive.name}` : ""}
          </span>
          <h2>{media ? (media.label ?? DISC_KINDS[media.kind]) : "No disc"}</h2>
          {media && (
            <div className="disc-chips">
              {media.label && <span className="chip">{DISC_KINDS[media.kind]}</span>}
              {media.protection && <span className="chip warning">Protected · {media.protection}</span>}
            </div>
          )}
        </div>
        {media && !drive.simulated && (
          <button type="button" className="btn btn-sm" onClick={() => void api.driveEject(drive.letter).catch((reason) => setError(errorText(reason)))}>
            Eject
          </button>
        )}
      </div>
      {error && <div className="dialog-error">{error}</div>}
      {jobs
        .filter((job) => job.letter === drive.letter)
        .map((job) => (
          <JobRow key={job.id} job={job} />
        ))}
      {media ? <DiscContentsView drive={drive} /> : <p className="hint">Insert a CD, DVD or Blu-ray; Digitify notices it on its own.</p>}
    </section>
  );
}

/** `/discs`: the optical drives and what's in them (Phase 4, D-022). */
export function DiscsPage() {
  const { drives } = useDiscs();
  return (
    <div className="library-view">
      <div className="discs-page">
        {/* A screen of its own (D-184): no Library header or categories above it. */}
        <BackButton />
        <div className="page-header">
          <div className="title-row">
            <span className="title-badge">
              <Disc3 size={26} aria-hidden />
            </span>
            <div>
              <h1 className="display">Discs</h1>
              <div className="count">
                {drives.length} drive{drives.length === 1 ? "" : "s"}
              </div>
            </div>
          </div>
        </div>
        {drives.length === 0 ? (
          <div className="empty">
            <p>No CD, DVD or Blu-ray drive is connected. Connect one (an external USB drive works), and it appears here.</p>
          </div>
        ) : (
          drives.map((drive) => <DriveCard key={drive.letter} drive={drive} />)
        )}
        <p className="hint discs-note">
          Audio CDs, home-made DVDs and Blu-rays, and data discs play and import. Commercial DVDs and Blu-rays are usually copy-protected; Digitify recognizes them, but
          never works around the protection.
        </p>
      </div>
    </div>
  );
}

/** A notice when a disc goes into a drive, with a way to open it. */
export function DiscNotice() {
  const { inserted, dismissInserted } = useDiscs();
  const navigate = useNavigate();
  useEffect(() => {
    if (!inserted) return;
    const timer = window.setTimeout(dismissInserted, 12000);
    return () => window.clearTimeout(timer);
  }, [inserted, dismissInserted]);
  if (!inserted?.media) return null;
  return (
    <div className="disc-notice" role="status">
      <Disc3 size={20} aria-hidden />
      <div>
        <strong>{DISC_KINDS[inserted.media.kind]} inserted</strong>
        <span>
          {inserted.media.label ?? "Untitled"} · Drive {driveName(inserted.letter)}
        </span>
      </div>
      <button
        type="button"
        className="btn btn-sm btn-primary"
        onClick={() => {
          dismissInserted();
          void navigate({ to: "/discs" });
        }}
      >
        Open
      </button>
      <button type="button" className="icon-btn" aria-label="Dismiss" onClick={dismissInserted}>
        <X size={15} />
      </button>
    </div>
  );
}

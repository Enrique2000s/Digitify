import { useEffect, useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-dialog";
import { Disc3, FileMusic, FilePlus, Folder, FolderPlus, X } from "lucide-react";
import { api, type ItemCard, type MusicSource } from "../../lib/api";
import { plural } from "../../lib/format";
import { useAmbient } from "../../lib/ambient/AmbientProvider";
import { useCategories } from "../../lib/queries";
import { Cover, Dialog, Switch } from "../../components/common";
import { Setting } from "./Setting";

/** Formats WebView2 plays without extra codecs (matches the core's list). */
const MUSIC_EXTENSIONS = ["mp3", "m4a", "aac", "flac", "ogg", "oga", "opus", "wav", "webm"];

const sourceKey = (source: MusicSource) => (source.kind === "item" ? `item:${source.id}` : `${source.kind}:${source.path.toLowerCase()}`);

function sourceLabel(source: MusicSource): string {
  return source.kind === "item" ? source.title : source.path;
}

/** Tracks (or any audio items with files) to add as ambient music. */
function AlbumPicker({ open: isOpen, onOpenChange, onAdd }: { open: boolean; onOpenChange: (open: boolean) => void; onAdd: (sources: MusicSource[]) => void }) {
  const categories = useCategories();
  const audioCategories = categories.data?.filter((category) => category.handler === "audio").map((category) => category.key) ?? [];
  const [search, setSearch] = useState("");
  const [chosen, setChosen] = useState<Map<number, string>>(new Map());
  const text = search.trim();
  const albums = useQuery({
    queryKey: ["album-picker", audioCategories, text],
    queryFn: async () => {
      const pages = await Promise.all(
        audioCategories.map((category) => api.query({ category, search: text || null, sort: text ? null : "title", offset: 0, limit: 500 })),
      );
      return pages.flatMap((page) => page.items).filter((item) => item.hasDigital);
    },
    enabled: isOpen && audioCategories.length > 0,
  });

  useEffect(() => {
    if (isOpen) {
      setSearch("");
      setChosen(new Map());
    }
  }, [isOpen]);

  const toggle = (item: ItemCard) =>
    setChosen((current) => {
      const next = new Map(current);
      if (next.has(item.id)) next.delete(item.id);
      else next.set(item.id, item.title);
      return next;
    });

  return (
    <Dialog
      open={isOpen}
      onOpenChange={onOpenChange}
      title="Add tracks from your library"
      description="They join your ambient music, played from wherever the files are."
      footer={
        <>
          <button type="button" className="btn" onClick={() => onOpenChange(false)}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={chosen.size === 0}
            onClick={() => {
              onAdd([...chosen].map(([id, title]) => ({ kind: "item", id, title })));
              onOpenChange(false);
            }}
          >
            {chosen.size > 1 ? `Add ${chosen.size} tracks` : "Add track"}
          </button>
        </>
      }
    >
      <input className="input" type="search" placeholder="Search tracks and artists" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search tracks" autoFocus />
      {albums.data?.length === 0 && <p className="hint">{text ? "No tracks match." : "There is no music with files in your library yet."}</p>}
      <ul className="album-picker">
        {albums.data?.map((item) => (
          <li key={item.id}>
            <label>
              <input type="checkbox" checked={chosen.has(item.id)} onChange={() => toggle(item)} />
              <span className="thumb">
                <Cover item={item} />
              </span>
              <span style={{ minWidth: 0 }}>
                <strong style={{ display: "block", fontWeight: 900 }}>{item.title}</strong>
                <span className="muted">{[item.subtitle, item.year].filter(Boolean).join(" · ")}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

/** Settings › Sound: ambient music (D-016) and interface sounds. */
export function SoundSettings() {
  const { music, updateMusic, playlist, interfaceSounds, setInterfaceSounds } = useAmbient();
  const [picking, setPicking] = useState(false);
  const custom = music.source === "custom";

  const addSources = (added: MusicSource[]) => {
    const known = new Set(music.sources.map(sourceKey));
    const fresh = added.filter((source) => !known.has(sourceKey(source)));
    if (fresh.length) updateMusic({ sources: [...music.sources, ...fresh] });
  };

  const addSongs = async () => {
    const picked = await open({ multiple: true, title: "Choose music", filters: [{ name: "Music", extensions: MUSIC_EXTENSIONS }] });
    const paths = Array.isArray(picked) ? picked : typeof picked === "string" ? [picked] : [];
    addSources(paths.map((path) => ({ kind: "file", path })));
  };

  const addFolder = async () => {
    const picked = await open({ directory: true, multiple: false, title: "Choose a music folder" });
    if (typeof picked === "string") addSources([{ kind: "folder", path: picked }]);
  };

  let summary: string | null = null;
  if (playlist.loading) summary = "Finding your music…";
  else if (playlist.error) summary = `Couldn't read your music: ${playlist.error}`;
  else if (music.sources.length > 0) {
    summary =
      playlist.tracks > 0
        ? `${plural(playlist.tracks, "song")} ready${playlist.truncated ? " (the first 10,000)" : ""}.`
        : "No playable music found in these sources.";
    if (playlist.unavailable > 0) summary += ` ${plural(playlist.unavailable, "source")} couldn't be found; the drive may be disconnected.`;
  }

  return (
    <section className="panel" id="sound">
      <h2>Sound</h2>
      <Setting title="Menu music" text="Plays softly while you browse, and pauses by itself while Digitify plays video. Also switched on and off next to Customize Home.">
        <Switch checked={music.enabled} onChange={(enabled) => updateMusic({ enabled })} label="Ambient music" />
      </Setting>
      <Setting
        title="Music"
        text={
          custom
            ? "Your own songs: files, folders, or tracks from your Digitify library."
            : "“Digitify Main Menu Music”, an original theme written for Digitify. It improvises a little, so it never plays exactly the same way twice."
        }
      >
        <div className="segmented" role="group" aria-label="Music">
          <button type="button" aria-pressed={!custom} onClick={() => updateMusic({ source: "lounge" })}>
            Digitify original
          </button>
          <button type="button" aria-pressed={custom} onClick={() => updateMusic({ source: "custom" })}>
            My music
          </button>
        </div>
      </Setting>
      {custom && (
        <div className="music-sources">
          {music.sources.length === 0 ? (
            <p className="hint">Add songs, a folder of music, or tracks from your library. Supported: MP3, AAC/M4A, FLAC, Ogg Vorbis, Opus, WAV and WebM audio.</p>
          ) : (
            <ul className="source-list" aria-label="Music sources">
              {music.sources.map((source, index) => (
                <li key={sourceKey(source)}>
                  {source.kind === "item" ? <Disc3 size={17} aria-hidden /> : source.kind === "folder" ? <Folder size={17} aria-hidden /> : <FileMusic size={17} aria-hidden />}
                  <span className={source.kind === "item" ? "label" : "path"} title={sourceLabel(source)}>
                    {sourceLabel(source)}
                  </span>
                  <button
                    type="button"
                    className="icon-btn"
                    style={{ width: 30, height: 30 }}
                    aria-label={`Remove ${sourceLabel(source)}`}
                    onClick={() => updateMusic({ sources: music.sources.filter((_, i) => i !== index) })}
                  >
                    <X size={16} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="actions">
            <button type="button" className="btn btn-sm" onClick={() => void addSongs()}>
              <FilePlus size={15} /> Add songs…
            </button>
            <button type="button" className="btn btn-sm" onClick={() => void addFolder()}>
              <FolderPlus size={15} /> Add a folder…
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setPicking(true)}>
              <Disc3 size={15} /> Add tracks from your library…
            </button>
          </div>
          {summary && <p className="hint" role="status">{summary}</p>}
        </div>
      )}
      {custom && (
        <Setting title="Shuffle" text="Play your music in a random order.">
          <Switch checked={music.shuffle} onChange={(shuffle) => updateMusic({ shuffle })} label="Shuffle" />
        </Setting>
      )}
      <Setting title="Volume" text="Also in the music capsule at the top of the window.">
        <div className="setting-control">
          <input
            type="range"
            min={0}
            max={100}
            value={music.volume}
            aria-label="Music volume"
            style={{ width: 180, "--fill": `${music.volume}%` } as CSSProperties}
            onChange={(event) => updateMusic({ volume: Number(event.target.value), muted: false })}
          />
          <output>{music.volume}%</output>
        </div>
      </Setting>
      <Setting title="Pause while reading" text="The reader stays quiet; the music picks up again when you close it.">
        <Switch checked={music.pauseWhileReading} onChange={(pauseWhileReading) => updateMusic({ pauseWhileReading })} label="Pause while reading" />
      </Setting>
      <Setting title="Pause when minimized" text="The music picks up again when you come back to Digitify.">
        <Switch checked={music.pauseWhenMinimized} onChange={(pauseWhenMinimized) => updateMusic({ pauseWhenMinimized })} label="Pause when minimized" />
      </Setting>
      <Setting title="Interface sounds" text="Soft tones when you point at tiles and covers, and when you press buttons.">
        <Switch checked={interfaceSounds} onChange={setInterfaceSounds} label="Interface sounds" />
      </Setting>
      <AlbumPicker open={picking} onOpenChange={setPicking} onAdd={addSources} />
    </section>
  );
}

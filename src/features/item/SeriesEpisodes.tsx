import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-dialog";
import { ArrowDown, ArrowUp, Check, Clapperboard, Film, FilePlus, GripVertical, ImagePlus, Loader2, RotateCcw, X } from "lucide-react";
import { api, artworkUrl, errorText, type Episode, type ImportMode, type ItemCard, type ItemDetail } from "../../lib/api";
import { plural } from "../../lib/format";
import { usePreferences } from "../../lib/preferences";
import { libraryChanged } from "../../lib/queries";
import { arrayMove, useReorder } from "../../lib/reorder";
import { Cover, Dialog } from "../../components/common";

const VIDEO_EXTENSIONS = ["mp4", "m4v", "mkv", "mov", "avi", "webm", "wmv", "mpg", "mpeg", "ts", "m2ts", "ogv", "flv"];
const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "gif", "bmp"];

/** "S1 · E3" for an episode. */
export function episodeCode(episode: Pick<Episode, "season" | "number">): string {
  const number = episode.number == null ? "" : Number.isInteger(episode.number) ? String(episode.number) : String(episode.number);
  return [episode.season != null ? `S${episode.season}` : null, number ? `E${number}` : null].filter(Boolean).join(" · ");
}

/** An episode's thumbnail, always horizontal (D-174): its own picture, a frame of it, or a film icon while none is made. */
export function EpisodeThumb({ episode, className = "episode-thumb" }: { episode: Pick<Episode, "thumb">; className?: string }) {
  return <span className={className}>{episode.thumb ? <img src={artworkUrl(episode.thumb)} alt="" loading="lazy" draggable={false} /> : <Film size={20} aria-hidden />}</span>;
}

/** Makes the thumbnails a series' episodes don't have yet (frames of them), then shows them. */
export function useEpisodeThumbs(id: number, enabled: boolean) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    api.episodeThumbsFill(id).then(
      (made) => {
        if (alive && made > 0) void queryClient.invalidateQueries({ queryKey: ["episodes", id] });
      },
      () => {},
    );
    return () => {
      alive = false;
    };
  }, [id, enabled, queryClient]);
}

/**
 * A series' episodes in Edit details (D-174): their order (dragged, or with the arrows), each one's
 * thumbnail, adding episodes from files or from Videos, and taking one out of the series (it goes
 * back to Videos, its file untouched). Each change is saved as it's made.
 */
export function SeriesEpisodesEditor({ item }: { item: ItemDetail }) {
  const queryClient = useQueryClient();
  const { preferences } = usePreferences();
  const episodes = useQuery({ queryKey: ["episodes", item.id], queryFn: () => api.episodesList(item.id) });
  const list = episodes.data ?? [];
  const lastSeason = list.reduce((max, e) => Math.max(max, e.season ?? 1), 1);
  const [season, setSeason] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<string[] | null>(null);
  const [picking, setPicking] = useState(false);
  useEpisodeThumbs(item.id, true);
  const target = season ?? lastSeason;

  const refresh = () => {
    libraryChanged(queryClient);
    void queryClient.invalidateQueries({ queryKey: ["episodes", item.id] });
  };
  const run = async (label: string | null, task: () => Promise<unknown>) => {
    setBusy(label);
    setError(null);
    try {
      await task();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(null);
      refresh();
    }
  };
  const arrange = (order: Episode[]) => {
    // Shown at once; the numbers catch up from the core.
    queryClient.setQueryData(["episodes", item.id], order);
    void run(null, () => api.episodesArrange(item.id, order.map((e) => e.id)));
  };
  const reorder = useReorder((from, to) => arrange(arrayMove(list, from, to)));

  const addFiles = async () => {
    const picked = await open({ multiple: true, title: "Choose the episodes' video files", filters: [{ name: "Videos", extensions: VIDEO_EXTENSIONS }] });
    const paths = Array.isArray(picked) ? picked : typeof picked === "string" ? [picked] : [];
    if (!paths.length) return;
    if (preferences.importMode === "ask") setFiles(paths);
    else void addWith(paths, preferences.importMode);
  };
  const addWith = (paths: string[], mode: ImportMode) => {
    setFiles(null);
    return run(`Adding ${plural(paths.length, "episode")}…`, () => api.seriesAddFiles(item.id, paths, target, mode));
  };
  const chooseThumb = async (episode: Episode) => {
    const path = await open({ multiple: false, title: "Choose the episode's thumbnail", filters: [{ name: "Images", extensions: IMAGE_EXTENSIONS }] });
    if (typeof path === "string") void run(null, () => api.episodeSetThumb(episode.id, path));
  };
  const frameThumb = (episode: Episode) => run(null, () => api.episodeSetThumb(episode.id, null).then(() => api.episodeThumbsFill(item.id)));

  return (
    <section className="series-editor" aria-label="Episodes">
      <div className="series-editor-head">
        <span className="series-editor-title">Episodes</span>
        <span className="muted">{plural(list.length, "episode")} · changes here are saved as you make them</span>
      </div>
      {list.length > 0 ? (
        <ul ref={reorder.listRef} className="episode-edit-list">
          {list.map((episode, index) => {
            const name = episode.title || `Episode ${episode.number ?? index + 1}`;
            return (
              <li key={episode.id} data-reorder style={reorder.style(index)}>
                <span {...reorder.handle(index)} aria-label={`Drag ${name}`}>
                  <GripVertical size={18} />
                </span>
                <EpisodeThumb episode={episode} />
                <span className="episode-edit-label">
                  <strong title={name}>{name}</strong>
                  <span className="muted">{[episodeCode(episode), episode.durationMs ? `${Math.max(1, Math.round(episode.durationMs / 60000))} min` : null].filter(Boolean).join(" · ")}</span>
                </span>
                <span className="episode-edit-actions">
                  <button type="button" className="icon-btn" aria-label="Move up" title="Move up" disabled={index === 0} onClick={() => arrange(arrayMove(list, index, index - 1))}>
                    <ArrowUp size={16} />
                  </button>
                  <button type="button" className="icon-btn" aria-label="Move down" title="Move down" disabled={index === list.length - 1} onClick={() => arrange(arrayMove(list, index, index + 1))}>
                    <ArrowDown size={16} />
                  </button>
                  <button type="button" className="btn btn-sm" onClick={() => void chooseThumb(episode)}>
                    <ImagePlus size={14} /> Thumbnail
                  </button>
                  {episode.thumbOwn && (
                    <button type="button" className="icon-btn" aria-label="Back to a frame of the episode" title="Back to a frame of the episode" onClick={() => void frameThumb(episode)}>
                      <RotateCcw size={16} />
                    </button>
                  )}
                  <button type="button" className="icon-btn" aria-label={`Take ${name} out of the series`} title="Take out of the series (it goes to Videos)" onClick={() => void run(null, () => api.episodeRemove(item.id, episode.id))}>
                    <X size={16} />
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="muted">{episodes.isLoading ? "Loading the episodes…" : "No episodes yet."}</p>
      )}
      <div className="series-editor-add">
        <label className="series-editor-season">
          <span>Add to season</span>
          <input className="input" type="number" min={0} max={999} value={target} onChange={(e) => setSeason(Math.max(0, Math.min(999, Math.round(Number(e.target.value) || 0))))} />
        </label>
        <button type="button" className="btn btn-sm" disabled={!!busy} onClick={() => void addFiles()}>
          <FilePlus size={14} /> Add from files…
        </button>
        <button type="button" className="btn btn-sm" disabled={!!busy} onClick={() => setPicking(true)}>
          <Clapperboard size={14} /> Add from Videos…
        </button>
      </div>
      {files && (
        <div className="series-editor-mode" role="group" aria-label="Where the files go">
          <span>{plural(files.length, "file")}: keep them where they are, or copy them into the library folder?</span>
          <button type="button" className="btn btn-sm" onClick={() => void addWith(files, "reference")}>
            Keep where they are
          </button>
          <button type="button" className="btn btn-sm" onClick={() => void addWith(files, "copy")}>
            Copy into the library
          </button>
          <button type="button" className="btn btn-sm" onClick={() => setFiles(null)}>
            Cancel
          </button>
        </div>
      )}
      {busy && (
        <p className="muted series-editor-busy">
          <Loader2 size={14} className="spin" /> {busy}
        </p>
      )}
      {error && <div className="dialog-error">{error}</div>}
      <VideosPicker
        open={picking}
        onOpenChange={setPicking}
        onPick={(ids) => void run(`Adding ${plural(ids.length, "episode")}…`, () => api.videosToFilms(ids, { existing: item.id, name: null, season: target }))}
      />
    </section>
  );
}

/** Videos from Videos to add as episodes, in the order they're picked (online ones have no file to play here). */
function VideosPicker({ open: shown, onOpenChange, onPick }: { open: boolean; onOpenChange: (open: boolean) => void; onPick: (ids: number[]) => void }) {
  const [picked, setPicked] = useState<number[]>([]);
  const videos = useQuery({
    queryKey: ["videos-for-series"],
    enabled: shown,
    queryFn: () => api.query({ category: "videos", sort: "title", offset: 0, limit: 2000 }),
  });
  useEffect(() => {
    if (shown) setPicked([]);
  }, [shown]);
  const items: ItemCard[] = (videos.data?.items ?? []).filter((v) => !v.online && v.hasDigital);
  const toggle = (id: number) => setPicked((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));
  return (
    <Dialog
      open={shown}
      onOpenChange={onOpenChange}
      wide
      title="Add episodes from Videos"
      description="Pick videos in the order the episodes go; they leave Videos and become episodes of this series."
      footer={
        <>
          <button type="button" className="btn" onClick={() => onOpenChange(false)}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!picked.length}
            onClick={() => {
              onPick(picked);
              onOpenChange(false);
            }}
          >
            {picked.length ? `Add ${plural(picked.length, "episode")}` : "Add"}
          </button>
        </>
      }
    >
      {videos.isLoading ? (
        <p className="muted">Loading Videos…</p>
      ) : items.length === 0 ? (
        <p className="muted">Videos has no videos with a file to add.</p>
      ) : (
        <ul className="video-pick-list">
          {items.map((video) => {
            const at = picked.indexOf(video.id);
            return (
              <li key={video.id}>
                <button type="button" aria-pressed={at >= 0} onClick={() => toggle(video.id)}>
                  <span className="video-pick-art">
                    <Cover item={video} />
                    {at >= 0 && <span className="video-pick-order">{at + 1}</span>}
                  </span>
                  <span className="video-pick-title">{video.title}</span>
                  {at >= 0 && <Check size={16} aria-hidden />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Dialog>
  );
}

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Check, Circle, Play } from "lucide-react";
import { api, type Episode, type ItemDetail } from "../../lib/api";
import { libraryChanged } from "../../lib/queries";
import { EpisodeThumb, useEpisodeThumbs } from "./SeriesEpisodes";

const VIDEO_FILES = /\.(mp4|m4v|mkv|mov|avi|webm|wmv|mpg|mpeg|ts|m2ts|ogv|flv)$/i;

/** Whether the video player can play this item: a film or series with a video file. */
export function canWatch(item: ItemDetail): boolean {
  return item.handler === "video" && item.versions.some((v) => v.kind === "digital" && v.files.some((f) => VIDEO_FILES.test(f.path)));
}

export const isSeries = (item: ItemDetail) => (item.metadata as Record<string, unknown>).kind === "series";

function minutes(ms: number | null): string {
  return ms ? `${Math.max(1, Math.round(ms / 60000))} min` : "";
}

function episodeLabel(episode: Episode): string {
  return `${episode.season != null ? `S${episode.season} · ` : ""}E${episode.number ?? "?"}`;
}

/** The episode "Play" goes to: the one being watched, else the first not yet seen. */
function nextUp(episodes: Episode[]): Episode | null {
  return episodes.find((e) => !e.completed && e.progress > 0) ?? episodes.find((e) => !e.completed) ?? episodes[0] ?? null;
}

export function useEpisodes(item: ItemDetail) {
  return useQuery({ queryKey: ["episodes", item.id], queryFn: () => api.episodesList(item.id), enabled: isSeries(item) });
}

/** The item page's play button: resume a film, or go on with a series. */
export function WatchButton({ item }: { item: ItemDetail }) {
  const episodes = useEpisodes(item);
  if (isSeries(item)) {
    const next = nextUp(episodes.data ?? []);
    const started = next && next.progress > 0 && !next.completed;
    return (
      <Link to="/watch/$id" params={{ id: String(item.id) }} search={next ? { part: next.id } : {}} className="btn btn-primary">
        <Play size={16} /> {next ? `${started ? "Continue" : "Play"} ${episodeLabel(next)}` : "Play"}
      </Link>
    );
  }
  const progress = item.progress ?? 0;
  return (
    <Link to="/watch/$id" params={{ id: String(item.id) }} className="btn btn-primary">
      <Play size={16} /> {progress > 0.01 && progress < 0.92 ? `Resume · ${Math.round(progress * 100)}%` : "Play"}
    </Link>
  );
}

/** Watched or not, for a film; for a series, all its episodes at once. */
export function WatchedButton({ item }: { item: ItemDetail }) {
  const queryClient = useQueryClient();
  const episodes = useEpisodes(item);
  const watched = isSeries(item) ? (episodes.data?.length ?? 0) > 0 && episodes.data!.every((e) => e.completed) : (item.progress ?? 0) >= 0.92;
  const toggle = async () => {
    await api.watchMark(item.id, null, !watched);
    libraryChanged(queryClient);
    void queryClient.invalidateQueries({ queryKey: ["episodes", item.id] });
  };
  return (
    <button type="button" className="btn" aria-pressed={watched} onClick={() => void toggle()}>
      {watched ? <Check size={16} /> : <Circle size={16} />} {watched ? "Watched" : isSeries(item) ? "Mark all watched" : "Mark as watched"}
    </button>
  );
}

/** Marks a book, comic or manga read or not (D-178), as Mark as watched does for films. */
export function ReadButton({ item }: { item: ItemDetail }) {
  const queryClient = useQueryClient();
  const read = (item.progress ?? 0) >= 0.999;
  const toggle = async () => {
    await api.readMark(item.id, !read);
    libraryChanged(queryClient);
  };
  return (
    <button type="button" className="btn" aria-pressed={read} onClick={() => void toggle()}>
      {read ? <Check size={16} /> : <Circle size={16} />} {read ? "Read" : "Mark as read"}
    </button>
  );
}

/** A series' seasons and episodes, each with its progress, a play link and a watched mark. */
export function EpisodesPanel({ item }: { item: ItemDetail }) {
  const queryClient = useQueryClient();
  const episodes = useEpisodes(item);
  // Each episode shows its thumbnail (D-174); the ones still missing are made from the episodes.
  useEpisodeThumbs(item.id, isSeries(item));
  if (!isSeries(item) || !episodes.data?.length) return null;
  const seasons = [...new Set(episodes.data.map((e) => e.season ?? 0))];
  const mark = async (episode: Episode) => {
    await api.watchMark(item.id, episode.id, !episode.completed);
    libraryChanged(queryClient);
    void queryClient.invalidateQueries({ queryKey: ["episodes", item.id] });
  };
  return (
    <section className="panel">
      <h2>Episodes</h2>
      {seasons.map((season) => (
        <div key={season} className="season">
          {seasons.length > 1 || season > 0 ? <h3 className="eyebrow">{season > 0 ? `Season ${season}` : "Specials"}</h3> : null}
          <ol className="tracks episodes">
            {episodes.data
              .filter((e) => (e.season ?? 0) === season)
              .map((episode) => (
                <li key={episode.id} className={episode.completed ? "watched" : undefined}>
                  <span className="no">{episode.number ?? ""}</span>
                  <Link to="/watch/$id" params={{ id: String(item.id) }} search={{ part: episode.id }} className="episode-thumb-link" tabIndex={-1} aria-hidden>
                    <EpisodeThumb episode={episode} />
                  </Link>
                  <Link to="/watch/$id" params={{ id: String(item.id) }} search={{ part: episode.id }} className="chapter-link episode-link">
                    <Play size={14} aria-hidden /> {episode.title || `Episode ${episode.number}`}
                  </Link>
                  <span
                    className="episode-meter"
                    style={{ "--fill": `${episode.progress * 100}%`, visibility: episode.progress > 0 && !episode.completed ? "visible" : "hidden" } as React.CSSProperties}
                    aria-label={`${Math.round(episode.progress * 100)}% watched`}
                  />
                  <span className="muted">{minutes(episode.durationMs)}</span>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-pressed={episode.completed}
                    aria-label={episode.completed ? "Mark as not watched" : "Mark as watched"}
                    title={episode.completed ? "Watched" : "Mark as watched"}
                    onClick={() => void mark(episode)}
                  >
                    {episode.completed ? <Check size={16} /> : <Circle size={16} />}
                  </button>
                </li>
              ))}
          </ol>
        </div>
      ))}
    </section>
  );
}

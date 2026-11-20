import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, Check, Clapperboard, Search } from "lucide-react";
import { api, artworkUrl, errorText, type ItemCard } from "../../lib/api";
import { plural } from "../../lib/format";
import { libraryChanged } from "../../lib/queries";
import { Dialog, Field } from "../../components/common";

/**
 * Movies & Series › Add › From Videos (D-135): videos already in Videos become movies, or the
 * episodes of a series (a new one, or one already there), in the order picked. The one way an item
 * crosses categories (D-126); online videos have no file, so they aren't offered.
 */
export function FromVideosDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<ItemCard[]>([]);
  const [asSeries, setAsSeries] = useState(false);
  const [target, setTarget] = useState<"new" | number>("new");
  const [name, setName] = useState("");
  const [season, setSeason] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const videos = useQuery({
    queryKey: ["from-videos", search],
    queryFn: () => api.query({ category: "videos", ownership: "digital", search: search.trim() || null, sort: "title", offset: 0, limit: 500 }),
    enabled: open,
  });
  const series = useQuery({ queryKey: ["films-series"], queryFn: api.filmsSeries, enabled: open });

  useEffect(() => {
    if (!open) return;
    setSearch("");
    setPicked([]);
    setAsSeries(false);
    setTarget("new");
    setName("");
    setSeason(1);
    setError(null);
  }, [open]);

  // A series picked: the next season it doesn't have yet is likelier than its first.
  const existing = typeof target === "number" ? series.data?.find((s) => s.id === target) : undefined;
  useEffect(() => {
    setSeason(existing ? existing.lastSeason : 1);
  }, [existing]);

  const pickedIds = useMemo(() => new Set(picked.map((v) => v.id)), [picked]);
  const toggle = (video: ItemCard) => setPicked((current) => (pickedIds.has(video.id) ? current.filter((v) => v.id !== video.id) : [...current, video]));
  const move = (index: number, by: number) =>
    setPicked((current) => {
      const next = [...current];
      const [item] = next.splice(index, 1);
      next.splice(Math.max(0, Math.min(next.length, index + by)), 0, item);
      return next;
    });

  const ready = picked.length > 0 && (!asSeries || target !== "new" || name.trim().length > 0);
  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const made = await api.videosToFilms(
        picked.map((v) => v.id),
        asSeries ? { existing: target === "new" ? null : target, name: target === "new" ? name.trim() : null, season } : null,
      );
      libraryChanged(queryClient);
      void queryClient.invalidateQueries({ queryKey: ["films-series"] });
      onOpenChange(false);
      if (made.length === 1) void navigate({ to: "/item/$id", params: { id: String(made[0]) } });
      else void navigate({ to: "/library/$scope", params: { scope: "video" } });
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };

  const list = videos.data?.items ?? [];
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      wide
      title="From Videos"
      description="Videos you already have become movies, or a series' episodes. They leave Videos; their files stay where they are."
      footer={
        <>
          <button type="button" className="btn" onClick={() => onOpenChange(false)}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={!ready || busy} onClick={() => void start()}>
            <Clapperboard size={15} /> {picked.length ? `Move ${plural(picked.length, "video")} to Movies & Series` : "Move to Movies & Series"}
          </button>
        </>
      }
    >
      <label className="search-pill from-videos-search">
        <Search size={16} aria-hidden />
        <input type="search" placeholder="Find a video" aria-label="Find a video" value={search} onChange={(event) => setSearch(event.target.value)} />
      </label>
      <ul className="from-videos" aria-label="Videos">
        {list.map((video) => (
          <li key={video.id}>
            <label className={pickedIds.has(video.id) ? "on" : ""}>
              <input type="checkbox" checked={pickedIds.has(video.id)} onChange={() => toggle(video)} />
              {video.coverKey ? <img src={artworkUrl(video.coverKey)} alt="" className="url-entry-thumb" loading="lazy" /> : <span className="url-entry-thumb" />}
              <span className="url-entry-text">
                <strong>{video.title}</strong>
                {video.year != null && <span className="muted">{video.year}</span>}
              </span>
              {pickedIds.has(video.id) && <Check size={16} aria-hidden />}
            </label>
          </li>
        ))}
        {videos.isSuccess && list.length === 0 && <li className="muted from-videos-empty">{search ? "No video matches." : "Videos has no videos with a file to bring."}</li>}
      </ul>

      <Field label="They become">
        <div className="segmented" role="group" aria-label="They become">
          <button type="button" aria-pressed={!asSeries} onClick={() => setAsSeries(false)}>
            Each one a movie
          </button>
          <button type="button" aria-pressed={asSeries} onClick={() => setAsSeries(true)}>
            A series' episodes
          </button>
        </div>
      </Field>
      {asSeries && (
        <>
          <Field label="Series">
            <select className="input" value={target === "new" ? "new" : String(target)} onChange={(event) => setTarget(event.target.value === "new" ? "new" : Number(event.target.value))}>
              <option value="new">A new series</option>
              {series.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title} ({plural(s.episodes, "episode")})
                </option>
              ))}
            </select>
          </Field>
          {target === "new" && (
            <Field label="Name">
              <input className="input" value={name} maxLength={200} placeholder="The series' name" onChange={(event) => setName(event.target.value)} />
            </Field>
          )}
          <Field label="Season" hint={existing ? "Its episodes are numbered on from the last one in that season." : "Its episodes are numbered from 1, in this order."}>
            <input className="input from-videos-season" type="number" min={0} max={999} value={season} onChange={(event) => setSeason(Math.max(0, Math.min(999, Number(event.target.value) || 0)))} />
          </Field>
          {picked.length > 0 && (
            <ol className="from-videos-order" aria-label="Episode order">
              {picked.map((video, index) => (
                <li key={video.id}>
                  <span className="muted">{index + 1}</span>
                  <span className="from-videos-title">{video.title}</span>
                  <button type="button" className="icon-btn" aria-label={`Move “${video.title}” up`} disabled={index === 0} onClick={() => move(index, -1)}>
                    <ArrowUp size={15} />
                  </button>
                  <button type="button" className="icon-btn" aria-label={`Move “${video.title}” down`} disabled={index === picked.length - 1} onClick={() => move(index, 1)}>
                    <ArrowDown size={15} />
                  </button>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
      {error && <div className="dialog-error">{error}</div>}
    </Dialog>
  );
}

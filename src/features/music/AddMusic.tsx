import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Check, Search } from "lucide-react";
import { api, errorText, type Playlist } from "../../lib/api";
import { Dialog } from "../../components/common";
import { AlreadyInPlaylistDialog, duration, useTracks } from "./Tracks";

const ROW = 48;

/**
 * Adds music from the library to a playlist without leaving it: search every track (by title,
 * artist, album or genre), tick the ones to add, and they go to the end of the playlist.
 */
export function AddMusicDialog({ playlist, open, onOpenChange }: { playlist: Playlist; open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [already, setAlready] = useState<{ id: number; title: string } | null>(null);
  const tracks = useTracks({ search: query || undefined });
  const inPlaylist = useTracks({ playlist: playlist.id });
  const alreadyIn = useMemo(() => new Set(inPlaylist.data?.map((t) => t.id)), [inPlaylist.data]);
  const scroller = useRef<HTMLDivElement>(null);
  const list = open ? (tracks.data ?? []) : [];
  const virtual = useVirtualizer({ count: list.length, getScrollElement: () => scroller.current, estimateSize: () => ROW, overscan: 10 });

  useEffect(() => {
    if (!open) return;
    setSearch("");
    setQuery("");
    setPicked([]);
    setError(null);
  }, [open]);
  // Searching waits for a pause in typing.
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(search.trim()), 200);
    return () => window.clearTimeout(timer);
  }, [search]);

  const toggle = (id: number) => setPicked((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));
  // Tracks already in the playlist show as ticked and can't be added twice.
  const shown = list.map((t) => t.id).filter((id) => !alreadyIn.has(id));
  const allShown = shown.length > 0 && shown.every((id) => picked.includes(id));
  const add = async () => {
    setBusy(true);
    try {
      await api.playlistAdd(playlist.id, picked);
      void queryClient.invalidateQueries({ queryKey: ["playlists"] });
      void queryClient.invalidateQueries({ queryKey: ["tracks"] });
      onOpenChange(false);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Add music to “${playlist.name}”`}
      description="Pick tracks from your library; they're added at the end of the playlist."
      wide
      footer={
        <>
          <span className="add-music-count" role="status">
            {picked.length ? `${picked.length} track${picked.length === 1 ? "" : "s"} picked` : " "}
          </span>
          <button type="button" className="btn" onClick={() => onOpenChange(false)}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={!picked.length || busy} onClick={() => void add()}>
            Add to playlist
          </button>
        </>
      }
    >
      <div className="add-music-head">
        <label className="search-pill add-music-search">
          <Search size={16} aria-hidden />
          <input type="search" autoFocus placeholder="Search by track, artist, album or genre" value={search} onChange={(event) => setSearch(event.target.value)} />
        </label>
        <button
          type="button"
          className="btn btn-sm"
          disabled={!shown.length}
          onClick={() => setPicked((current) => (allShown ? current.filter((id) => !shown.includes(id)) : [...current, ...shown.filter((id) => !current.includes(id))]))}
        >
          {allShown ? "Unpick these" : `Pick all ${shown.length}`}
        </button>
      </div>
      <div ref={scroller} className="add-music-list">
        {!tracks.isLoading && list.length === 0 && <p className="hint">{query ? "No tracks match." : "No music in your library yet."}</p>}
        <div style={{ height: virtual.getTotalSize(), position: "relative" }}>
          {virtual.getVirtualItems().map((row) => {
            const track = list[row.index];
            const inside = alreadyIn.has(track.id);
            const on = inside || picked.includes(track.id);
            return (
              <button
                key={track.id}
                type="button"
                role="checkbox"
                aria-checked={on}
                className={`add-music-row${on ? " on" : ""}${inside ? " inside" : ""}`}
                style={{ position: "absolute", top: row.start, left: 0, right: 0, height: ROW - 4 }}
                onClick={() => (inside ? setAlready(track) : toggle(track.id))}
              >
                <span className="add-music-check">{on && <Check size={14} strokeWidth={3} />}</span>
                <span className="track-title">
                  <strong>{track.title}</strong>
                  <span>{[track.artist, track.album].filter(Boolean).join(" · ")}</span>
                </span>
                {inside && <span className="chip">In playlist</span>}
                <span className="track-time">{duration(track.durationMs)}</span>
              </button>
            );
          })}
        </div>
      </div>
      {error && <div className="dialog-error">{error}</div>}
      {already && <AlreadyInPlaylistDialog track={already} playlist={playlist} onClose={() => setAlready(null)} />}
    </Dialog>
  );
}

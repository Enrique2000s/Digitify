import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useVirtualizer } from "@tanstack/react-virtual";
import { DropdownMenu } from "radix-ui";
import { AudioLines, ChevronDown, ChevronUp, Disc3, Heart, ListEnd, ListMusic, ListPlus, MoreHorizontal, Pencil, Play, Plus, Shuffle, X } from "lucide-react";
import { api, errorText, type Track, type TrackFilter } from "../../lib/api";
import { useMusic } from "../../lib/music/MusicProvider";
import { Dialog, Field } from "../../components/common";

const ROW = 46;

export function duration(ms: number | null): string {
  if (!ms) return "";
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function shuffled<T>(list: T[]): T[] {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function useTracks(filter: TrackFilter) {
  return useQuery({ queryKey: ["tracks", filter], queryFn: () => api.musicTracks(filter) });
}

export function usePlaylists() {
  return useQuery({ queryKey: ["playlists"], queryFn: api.playlistsList });
}

/** Names a new playlist, created with these tracks. */
export function NewPlaylistDialog({ tracks, open, onOpenChange }: { tracks: number[]; open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setName("");
      setError(null);
    }
  }, [open]);
  const create = async () => {
    try {
      await api.playlistCreate(name, tracks);
      void queryClient.invalidateQueries({ queryKey: ["playlists"] });
      onOpenChange(false);
    } catch (reason) {
      setError(errorText(reason));
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="New playlist"
      footer={
        <>
          <button type="button" className="btn" onClick={() => onOpenChange(false)}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={!name.trim()} onClick={() => void create()}>
            Create{tracks.length ? ` with ${tracks.length} track${tracks.length === 1 ? "" : "s"}` : ""}
          </button>
        </>
      }
    >
      <Field label="Name">
        <input className="input" autoFocus value={name} maxLength={120} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => event.key === "Enter" && name.trim() && void create()} />
      </Field>
      {error && <div className="dialog-error">{error}</div>}
    </Dialog>
  );
}

/** A track's own details, kept in the catalog only; the file isn't changed (D-009). */
function EditTrackDialog({ track, open, onOpenChange }: { track: Track; open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const music = useMusic();
  const [title, setTitle] = useState(track.title);
  const [artist, setArtist] = useState(track.artist ?? "");
  const [number, setNumber] = useState(track.number != null ? String(track.number) : "");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setTitle(track.title);
      setArtist(track.artist ?? "");
      setNumber(track.number != null ? String(track.number) : "");
      setError(null);
    }
  }, [open, track]);
  const save = async () => {
    const parsed = number.trim() ? Number(number) : null;
    if (parsed !== null && !Number.isFinite(parsed)) {
      setError("The track number should be a number.");
      return;
    }
    try {
      await api.trackUpdate(track.id, { title, artist: artist.trim() || null, number: parsed });
      music.updateTrack({ ...track, title: title.trim(), artist: artist.trim() || null, number: parsed });
      void queryClient.invalidateQueries({ queryKey: ["tracks"] });
      onOpenChange(false);
    } catch (reason) {
      setError(errorText(reason));
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Edit track"
      description="Changes are kept in your Digitify library; the music file itself isn't modified."
      footer={
        <>
          <button type="button" className="btn" onClick={() => onOpenChange(false)}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={!title.trim()} onClick={() => void save()}>
            Save
          </button>
        </>
      }
    >
      <Field label="Title">
        <input className="input" autoFocus value={title} onChange={(event) => setTitle(event.target.value)} />
      </Field>
      <div className="field-row">
        <Field label="Artist" hint="Leave empty to use the album's artist.">
          <input className="input" value={artist} onChange={(event) => setArtist(event.target.value)} />
        </Field>
        <Field label="Track number">
          <input className="input" inputMode="decimal" value={number} onChange={(event) => setNumber(event.target.value)} />
        </Field>
      </div>
      {error && <div className="dialog-error">{error}</div>}
    </Dialog>
  );
}

/** Play next, add to the queue or a playlist, edit, and (in a playlist) move or remove. */
function TrackMenu({ track, onEdit, onNewPlaylist, playlist }: {
  track: Track;
  onEdit: () => void;
  onNewPlaylist: () => void;
  playlist?: { move: (step: number) => void; remove: () => void; first: boolean; last: boolean };
}) {
  const music = useMusic();
  const queryClient = useQueryClient();
  const playlists = usePlaylists();
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button type="button" className="icon-btn" aria-label={`More for ${track.title}`}>
          <MoreHorizontal size={17} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="menu" align="end" sideOffset={6}>
          <DropdownMenu.Item className="menu-item" onSelect={() => void music.enqueue([track.id], true)}>
            <ListPlus size={17} /> Play next
          </DropdownMenu.Item>
          <DropdownMenu.Item className="menu-item" onSelect={() => void music.enqueue([track.id], false)}>
            <ListEnd size={17} /> Add to queue
          </DropdownMenu.Item>
          <DropdownMenu.Sub>
            <DropdownMenu.SubTrigger className="menu-item">
              <ListMusic size={17} /> Add to playlist
            </DropdownMenu.SubTrigger>
            <DropdownMenu.Portal>
              <DropdownMenu.SubContent className="menu" sideOffset={6}>
                {playlists.data?.map((list) => (
                  <DropdownMenu.Item
                    key={list.id}
                    className="menu-item"
                    onSelect={() => void api.playlistAdd(list.id, [track.id]).then(() => queryClient.invalidateQueries({ queryKey: ["playlists"] }))}
                  >
                    {list.name}
                  </DropdownMenu.Item>
                ))}
                {playlists.data?.length ? <DropdownMenu.Separator className="menu-separator" /> : null}
                <DropdownMenu.Item className="menu-item" onSelect={onNewPlaylist}>
                  <Plus size={17} /> New playlist…
                </DropdownMenu.Item>
              </DropdownMenu.SubContent>
            </DropdownMenu.Portal>
          </DropdownMenu.Sub>
          <DropdownMenu.Item className="menu-item" onSelect={onEdit}>
            <Pencil size={17} /> Edit details…
          </DropdownMenu.Item>
          <DropdownMenu.Item className="menu-item" asChild>
            <Link to="/item/$id" params={{ id: String(track.itemId) }}>
              <Disc3 size={17} /> Go to album
            </Link>
          </DropdownMenu.Item>
          {playlist && (
            <>
              <DropdownMenu.Separator className="menu-separator" />
              <DropdownMenu.Item className="menu-item" disabled={playlist.first} onSelect={() => playlist.move(-1)}>
                <ChevronUp size={17} /> Move up
              </DropdownMenu.Item>
              <DropdownMenu.Item className="menu-item" disabled={playlist.last} onSelect={() => playlist.move(1)}>
                <ChevronDown size={17} /> Move down
              </DropdownMenu.Item>
              <DropdownMenu.Item className="menu-item danger" onSelect={playlist.remove}>
                <X size={17} /> Remove from playlist
              </DropdownMenu.Item>
            </>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/**
 * A list of tracks to play: "Play" and "Shuffle" for all of them, and per track play, favorite and
 * a menu. Long lists are virtualized. In a playlist, tracks can be moved and removed.
 */
export function TrackList({ filter, empty, playlistId, showAlbum = true, compact = false }: {
  filter: TrackFilter;
  empty: string;
  playlistId?: number;
  showAlbum?: boolean;
  /** Inside an item page: no own scrolling. */
  compact?: boolean;
}) {
  const music = useMusic();
  const queryClient = useQueryClient();
  const tracks = useTracks(filter);
  const [editing, setEditing] = useState<Track | null>(null);
  const [creating, setCreating] = useState<number[] | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const list = tracks.data ?? [];
  const virtual = useVirtualizer({ count: compact ? 0 : list.length, getScrollElement: () => scroller.current, estimateSize: () => ROW, overscan: 8 });
  const ids = list.map((t) => t.id);

  const favorite = async (track: Track) => {
    await api.musicSetFavorite(track.id, !track.favorite);
    music.updateTrack({ ...track, favorite: !track.favorite });
    void queryClient.invalidateQueries({ queryKey: ["tracks"] });
  };
  const setPlaylist = async (next: number[]) => {
    if (playlistId == null) return;
    await api.playlistSet(playlistId, next);
    void queryClient.invalidateQueries({ queryKey: ["tracks"] });
    void queryClient.invalidateQueries({ queryKey: ["playlists"] });
  };

  const row = (track: Track, index: number, style?: React.CSSProperties) => {
    const playing = music.current?.id === track.id;
    return (
      <div key={`${track.id}:${index}`} className={`track-row${playing ? " playing" : ""}`} style={style} onDoubleClick={() => void music.play(ids, index)}>
        <button type="button" className="track-play" aria-label={`Play ${track.title}`} onClick={() => void music.play(ids, index)}>
          <span className="track-no">{playing ? <AudioLines size={15} /> : (track.number ?? index + 1)}</span>
          <Play size={15} className="track-play-icon" />
        </button>
        <div className="track-title">
          <strong>{track.title}</strong>
          <span>{[track.artist, showAlbum ? track.album : null].filter(Boolean).join(" · ")}</span>
        </div>
        <span className="track-genre">{track.genre ?? ""}</span>
        <span className="track-time">{duration(track.durationMs)}</span>
        <button type="button" className="icon-btn" aria-pressed={track.favorite} aria-label={track.favorite ? "Remove from favorites" : "Add to favorites"} onClick={() => void favorite(track)}>
          <Heart size={16} fill={track.favorite ? "currentColor" : "none"} />
        </button>
        <TrackMenu
          track={track}
          onEdit={() => setEditing(track)}
          onNewPlaylist={() => setCreating([track.id])}
          playlist={
            playlistId != null
              ? {
                  first: index === 0,
                  last: index === list.length - 1,
                  move: (step) => {
                    const next = [...ids];
                    [next[index], next[index + step]] = [next[index + step], next[index]];
                    void setPlaylist(next);
                  },
                  remove: () => void setPlaylist(ids.filter((_, i) => i !== index)),
                }
              : undefined
          }
        />
      </div>
    );
  };

  return (
    <div className="track-list">
      <div className="track-actions">
        <button type="button" className="btn btn-primary btn-sm" disabled={list.length === 0} onClick={() => void music.play(ids, 0)}>
          <Play size={15} /> Play
        </button>
        <button type="button" className="btn btn-sm" disabled={list.length < 2} onClick={() => void music.play(shuffled(ids), 0)}>
          <Shuffle size={15} /> Shuffle
        </button>
        {list.length > 0 && playlistId == null && (
          <button type="button" className="btn btn-sm" onClick={() => setCreating(ids)}>
            <ListMusic size={15} /> Save as playlist
          </button>
        )}
        <span className="hint">{tracks.isLoading ? "" : `${list.length} track${list.length === 1 ? "" : "s"}`}</span>
      </div>
      {music.error && <div className="dialog-error">{music.error}</div>}
      {!tracks.isLoading && list.length === 0 ? (
        <p className="hint">{empty}</p>
      ) : compact ? (
        <div className="track-rows">{list.map((track, index) => row(track, index))}</div>
      ) : (
        <div ref={scroller} className="track-rows scroll">
          <div style={{ height: virtual.getTotalSize(), position: "relative" }}>
            {virtual.getVirtualItems().map((item) => row(list[item.index], item.index, { position: "absolute", top: item.start, left: 0, right: 0, height: ROW }))}
          </div>
        </div>
      )}
      {editing && <EditTrackDialog track={editing} open onOpenChange={(open) => !open && setEditing(null)} />}
      <NewPlaylistDialog tracks={creating ?? []} open={creating !== null} onOpenChange={(open) => !open && setCreating(null)} />
    </div>
  );
}

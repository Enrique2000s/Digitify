import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { DropdownMenu } from "radix-ui";
import { ArrowLeft, Clock, Heart, ListMusic, ListPlus, Mic2, MoreHorizontal, Music2, Pencil, Play, Plus, Trash } from "lucide-react";
import { api, errorText, type Category, type Playlist } from "../../lib/api";
import { useMusic } from "../../lib/music/MusicProvider";
import { usePreferences } from "../../lib/preferences";
import { AddMusicDialog } from "./AddMusic";
import { CategoryIcon } from "../../components/common";
import { CategoryStrip } from "../../components/CategoryStrip";
import { useArrival } from "../../lib/arrival";
import { duration, NewPlaylistDialog, TrackList, usePlaylists } from "./Tracks";

export const MUSIC_TABS = ["tracks", "artists", "playlists", "recent", "favorites"] as const;
export type MusicTab = (typeof MUSIC_TABS)[number];

const LABELS: Record<MusicTab, [string, ReactNode]> = {
  tracks: ["Tracks", <Music2 size={15} aria-hidden />],
  artists: ["Artists", <Mic2 size={15} aria-hidden />],
  playlists: ["Playlists", <ListMusic size={15} aria-hidden />],
  recent: ["Recently played", <Clock size={15} aria-hidden />],
  favorites: ["Favorites", <Heart size={15} aria-hidden />],
};

/** The tabs over a music category: tracks (the library view, each track an item, D-027) and the music player's own lists. */
export function MusicTabs({ category, tab }: { category: Category; tab: MusicTab }) {
  const navigate = useNavigate();
  const { update } = usePreferences();
  return (
    <div className="segmented music-tabs" role="tablist" aria-label="Music">
      {MUSIC_TABS.map((key) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={tab === key}
          aria-pressed={tab === key}
          onClick={() => {
            update({ musicTab: key });
            void navigate({ to: "/library/$scope", params: { scope: category.key }, search: { tab: key }, replace: true });
          }}
        >
          {LABELS[key][1]} {LABELS[key][0]}
        </button>
      ))}
    </div>
  );
}

function Header({ category, tab }: { category: Category; tab: MusicTab }) {
  const titleArriving = useArrival(`title:${category.name}`);
  return (
    <>
      <CategoryStrip />
      <div className="page-header">
        <div className={`title-row${titleArriving ? " arriving" : ""}`}>
          <span className="title-badge">
            <CategoryIcon icon={category.icon} size={26} />
          </span>
          <div>
            <div className="title-line">
              <h1 className="display">{category.name}</h1>
              <MusicTabs category={category} tab={tab} />
            </div>
            <div className="count">{LABELS[tab][0]}</div>
          </div>
        </div>
      </div>
    </>
  );
}

function Artists() {
  const artists = useQuery({ queryKey: ["artists"], queryFn: api.musicArtists });
  const [artist, setArtist] = useState<string | null>(null);
  if (artist) {
    return (
      <>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setArtist(null)}>
          <ArrowLeft size={15} /> All artists
        </button>
        <h2 className="music-sub">{artist}</h2>
        <TrackList filter={{ artist }} empty="No tracks." />
      </>
    );
  }
  if (!artists.data?.length) return <p className="hint">{artists.isLoading ? "" : "No artists yet. Import some music."}</p>;
  return (
    <div className="artist-grid">
      {artists.data.map((entry) => (
        <button key={entry.name} type="button" className="artist-card" onClick={() => setArtist(entry.name)}>
          <span className="artist-avatar">{entry.name.slice(0, 1).toUpperCase()}</span>
          <strong>{entry.name}</strong>
          <span>
            {entry.tracks} track{entry.tracks === 1 ? "" : "s"}
          </span>
        </button>
      ))}
    </div>
  );
}

function PlaylistView({ playlist, onBack, startAdding }: { playlist: Playlist; onBack: () => void; startAdding: boolean }) {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(startAdding);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(playlist.name);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["playlists"] });
  const rename = async () => {
    try {
      await api.playlistRename(playlist.id, name);
      setRenaming(false);
      refresh();
    } catch (reason) {
      setError(errorText(reason));
    }
  };
  return (
    <>
      <div className="playlist-head">
        <button type="button" className="btn btn-sm btn-ghost" onClick={onBack}>
          <ArrowLeft size={15} /> All playlists
        </button>
        {renaming ? (
          <input className="input" autoFocus value={name} onChange={(event) => setName(event.target.value)} onBlur={() => void rename()} onKeyDown={(event) => event.key === "Enter" && void rename()} />
        ) : (
          <h2 className="music-sub">{playlist.name}</h2>
        )}
        <button type="button" className="btn btn-sm btn-primary" onClick={() => setAdding(true)}>
          <ListPlus size={15} /> Add music
        </button>
        <button type="button" className="btn btn-sm" onClick={() => setRenaming(true)}>
          <Pencil size={14} /> Rename
        </button>
        {confirming ? (
          <button
            type="button"
            className="btn btn-sm btn-danger"
            onClick={() =>
              void api.playlistDelete(playlist.id).then(() => {
                refresh();
                onBack();
              })
            }
          >
            Delete “{playlist.name}”
          </button>
        ) : (
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirming(true)}>
            <Trash size={14} /> Delete
          </button>
        )}
      </div>
      {error && <div className="dialog-error">{error}</div>}
      <TrackList filter={{ playlist: playlist.id }} playlistId={playlist.id} empty="This playlist is empty. Use “Add music” to pick tracks from your library." />
      <AddMusicDialog playlist={playlist} open={adding} onOpenChange={setAdding} />
    </>
  );
}

/** A playlist's card on the Playlists tab, with its own menu. */
function PlaylistCard({ playlist, onOpen, onAdd }: { playlist: Playlist; onOpen: () => void; onAdd: () => void }) {
  const queryClient = useQueryClient();
  const music = useMusic();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(playlist.name);
  const [deleting, setDeleting] = useState(false);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["playlists"] });
  const play = async () => {
    const tracks = await api.musicTracks({ playlist: playlist.id });
    if (tracks.length) await music.play(tracks.map((t) => t.id), 0);
  };
  return (
    <div className="artist-card playlist-card">
      <button type="button" className="playlist-open" onClick={onOpen}>
        <span className="artist-avatar">
          <ListMusic size={22} />
        </span>
        {renaming ? null : <strong>{playlist.name}</strong>}
        <span>
          {playlist.tracks} track{playlist.tracks === 1 ? "" : "s"}
          {playlist.durationMs ? ` · ${duration(playlist.durationMs)}` : ""}
        </span>
      </button>
      {renaming && (
        <input
          className="input playlist-rename"
          autoFocus
          aria-label="Playlist name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => void api.playlistRename(playlist.id, name).then(refresh).finally(() => setRenaming(false))}
          onKeyDown={(event) => {
            if (event.key === "Enter") (event.target as HTMLInputElement).blur();
            if (event.key === "Escape") setRenaming(false);
          }}
        />
      )}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button type="button" className="icon-btn playlist-menu" aria-label={`More for ${playlist.name}`}>
            <MoreHorizontal size={17} />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="menu" align="end" sideOffset={6}>
            <DropdownMenu.Item className="menu-item" disabled={!playlist.tracks} onSelect={() => void play()}>
              <Play size={17} /> Play
            </DropdownMenu.Item>
            <DropdownMenu.Item className="menu-item" onSelect={onAdd}>
              <ListPlus size={17} /> Add music…
            </DropdownMenu.Item>
            <DropdownMenu.Item className="menu-item" onSelect={onOpen}>
              <ListMusic size={17} /> Edit tracks
            </DropdownMenu.Item>
            <DropdownMenu.Item className="menu-item" onSelect={() => setRenaming(true)}>
              <Pencil size={17} /> Rename
            </DropdownMenu.Item>
            <DropdownMenu.Separator className="menu-separator" />
            <DropdownMenu.Item className="menu-item danger" onSelect={() => setDeleting(true)}>
              <Trash size={17} /> Delete…
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      {deleting && (
        <div className="playlist-confirm">
          <button type="button" className="btn btn-sm btn-danger" onClick={() => void api.playlistDelete(playlist.id).then(refresh)}>
            Delete “{playlist.name}”
          </button>
          <button type="button" className="btn btn-sm" onClick={() => setDeleting(false)}>
            Keep
          </button>
        </div>
      )}
    </div>
  );
}

function Playlists() {
  const playlists = usePlaylists();
  const [open, setOpen] = useState<{ id: number; adding: boolean } | null>(null);
  const [creating, setCreating] = useState(false);
  const current = playlists.data?.find((p) => p.id === open?.id);
  if (current && open) return <PlaylistView key={current.id} playlist={current} startAdding={open.adding} onBack={() => setOpen(null)} />;
  return (
    <>
      <div className="track-actions">
        <button type="button" className="btn btn-sm" onClick={() => setCreating(true)}>
          <Plus size={15} /> New playlist
        </button>
      </div>
      {playlists.data?.length ? (
        <div className="artist-grid">
          {playlists.data.map((playlist) => (
            <PlaylistCard
              key={playlist.id}
              playlist={playlist}
              onOpen={() => setOpen({ id: playlist.id, adding: false })}
              onAdd={() => setOpen({ id: playlist.id, adding: true })}
            />
          ))}
        </div>
      ) : (
        <p className="hint">{playlists.isLoading ? "" : "No playlists yet."}</p>
      )}
      <NewPlaylistDialog tracks={[]} open={creating} onOpenChange={setCreating} />
    </>
  );
}

/** A music category's lists beyond its tracks: artists, playlists, recently played, favorites. */
export function MusicPage({ category, tab }: { category: Category; tab: Exclude<MusicTab, "tracks"> }) {
  return (
    <div className="library-view">
      <div className="music-page">
      <Header category={category} tab={tab} />
      <div className="view-stage music-stage" key={tab}>
        {tab === "artists" && <Artists />}
        {tab === "playlists" && <Playlists />}
        {tab === "recent" && <TrackList filter={{ recent: true }} empty="Nothing played yet." />}
        {tab === "favorites" && <TrackList filter={{ favorites: true }} empty="No favorite tracks yet. Use the heart next to a track." />}
      </div>
      </div>
    </div>
  );
}

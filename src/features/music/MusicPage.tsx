import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Clock, Disc3, Heart, ListMusic, Mic2, Music2, Pencil, Plus, Search, Trash } from "lucide-react";
import { api, errorText, type Category, type Playlist } from "../../lib/api";
import { CategoryIcon } from "../../components/common";
import { CategoryStrip } from "../../components/CategoryStrip";
import { duration, NewPlaylistDialog, TrackList, usePlaylists } from "./Tracks";

export const MUSIC_TABS = ["albums", "artists", "tracks", "playlists", "recent", "favorites"] as const;
export type MusicTab = (typeof MUSIC_TABS)[number];

const LABELS: Record<MusicTab, [string, ReactNode]> = {
  albums: ["Albums", <Disc3 size={15} aria-hidden />],
  artists: ["Artists", <Mic2 size={15} aria-hidden />],
  tracks: ["Tracks", <Music2 size={15} aria-hidden />],
  playlists: ["Playlists", <ListMusic size={15} aria-hidden />],
  recent: ["Recently played", <Clock size={15} aria-hidden />],
  favorites: ["Favorites", <Heart size={15} aria-hidden />],
};

/** The tabs over a music category: albums (the library view) and the music player's own lists. */
export function MusicTabs({ category, tab }: { category: Category; tab: MusicTab }) {
  const navigate = useNavigate();
  return (
    <div className="segmented music-tabs" role="tablist" aria-label="Music">
      {MUSIC_TABS.map((key) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={tab === key}
          aria-pressed={tab === key}
          onClick={() => void navigate({ to: "/library/$scope", params: { scope: category.key }, search: key === "albums" ? {} : { tab: key }, replace: true })}
        >
          {LABELS[key][1]} {LABELS[key][0]}
        </button>
      ))}
    </div>
  );
}

function Header({ category, tab }: { category: Category; tab: MusicTab }) {
  return (
    <>
      <CategoryStrip />
      <div className="page-header">
        <div className="title-row">
          <span className="title-badge">
            <CategoryIcon icon={category.icon} size={26} />
          </span>
          <div>
            <h1 className="display">{category.name}</h1>
            <div className="count">{LABELS[tab][0]}</div>
          </div>
        </div>
      </div>
      <MusicTabs category={category} tab={tab} />
    </>
  );
}

function AllTracks() {
  const [search, setSearch] = useState("");
  return (
    <>
      <label className="search-pill music-search">
        <Search size={16} aria-hidden />
        <input type="search" placeholder="Search by track, artist, album or genre" value={search} onChange={(event) => setSearch(event.target.value)} />
      </label>
      <TrackList filter={{ search: search.trim() || undefined }} empty={search ? "No tracks match." : "No music in your library yet."} />
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
            {entry.albums} album{entry.albums === 1 ? "" : "s"} · {entry.tracks} track{entry.tracks === 1 ? "" : "s"}
          </span>
        </button>
      ))}
    </div>
  );
}

function PlaylistView({ playlist, onBack }: { playlist: Playlist; onBack: () => void }) {
  const queryClient = useQueryClient();
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
      <TrackList filter={{ playlist: playlist.id }} playlistId={playlist.id} empty="This playlist is empty. Use a track's menu › Add to playlist." />
    </>
  );
}

function Playlists() {
  const playlists = usePlaylists();
  const [open, setOpen] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const current = playlists.data?.find((p) => p.id === open);
  if (current) return <PlaylistView playlist={current} onBack={() => setOpen(null)} />;
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
            <button key={playlist.id} type="button" className="artist-card" onClick={() => setOpen(playlist.id)}>
              <span className="artist-avatar">
                <ListMusic size={22} />
              </span>
              <strong>{playlist.name}</strong>
              <span>
                {playlist.tracks} track{playlist.tracks === 1 ? "" : "s"}
                {playlist.durationMs ? ` · ${duration(playlist.durationMs)}` : ""}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p className="hint">{playlists.isLoading ? "" : "No playlists yet."}</p>
      )}
      <NewPlaylistDialog tracks={[]} open={creating} onOpenChange={setCreating} />
    </>
  );
}

/** A music category's lists beyond albums: artists, tracks, playlists, recently played, favorites. */
export function MusicPage({ category, tab }: { category: Category; tab: Exclude<MusicTab, "albums"> }) {
  return (
    <div className="library-view">
      <div className="music-page">
      <Header category={category} tab={tab} />
      {tab === "tracks" && <AllTracks />}
      {tab === "artists" && <Artists />}
      {tab === "playlists" && <Playlists />}
      {tab === "recent" && <TrackList filter={{ recent: true }} empty="Nothing played yet." />}
      {tab === "favorites" && <TrackList filter={{ favorites: true }} empty="No favorite tracks yet. Use the heart next to a track." />}
      </div>
    </div>
  );
}

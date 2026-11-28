import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { DropdownMenu } from "radix-ui";
import { ArrowLeft, Clock, ListMusic, ListPlus, Mic2, MoreHorizontal, Music2, Pencil, Play, Plus, Search, Trash, Star } from "lucide-react";
import { api, errorText, type Category, type Playlist } from "../../lib/api";
import { usePlayAndShow } from "./playAndShow";
import { AddMusicDialog } from "./AddMusic";
import { CardSizeSlider, CategoryIcon } from "../../components/common";
import { usePreferences } from "../../lib/preferences";
import { CategoryStrip } from "../../components/CategoryStrip";
import { AddMenu } from "../../components/AddMenu";
import { useArrival } from "../../lib/arrival";
import { NewPlaylistDialog, TrackList, usePlaylists } from "./Tracks";
import { duration } from "../../lib/format";

export const MUSIC_TABS = ["tracks", "playlists", "artists", "recent", "favorites"] as const;
export type MusicTab = (typeof MUSIC_TABS)[number];

const LABELS: Record<MusicTab, [string, ReactNode]> = {
  tracks: ["Tracks", <Music2 size={15} aria-hidden />],
  artists: ["Artists", <Mic2 size={15} aria-hidden />],
  playlists: ["Playlists", <ListMusic size={15} aria-hidden />],
  recent: ["Recently played", <Clock size={15} aria-hidden />],
  // The same star as every category's Favorites tab (D-098).
  favorites: ["Favorites", <Star size={15} aria-hidden />],
};

/** The tabs over a music category: tracks (the library view, each track an item, D-027) and the music player's own lists. */
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
          onClick={() => {
            void navigate({ to: "/library/$scope", params: { scope: category.key }, search: { tab: key }, replace: true });
          }}
        >
          {LABELS[key][1]} {LABELS[key][0]}
        </button>
      ))}
    </div>
  );
}

/** Each tab's sorts (D-184); the first is how the list comes. */
const SORTS: Record<Exclude<MusicTab, "tracks">, [string, string][]> = {
  artists: [
    ["", "Name"],
    ["name-desc", "Name, Z to A"],
    ["tracks", "Most tracks"],
  ],
  playlists: [
    ["", "Name"],
    ["name-desc", "Name, Z to A"],
    ["tracks", "Most tracks"],
    ["duration", "Longest"],
  ],
  recent: [
    ["", "Last played"],
    ["title", "Title"],
    ["artist", "Artist"],
    ["album", "Album"],
    ["duration", "Duration"],
  ],
  favorites: [
    ["", "Title"],
    ["artist", "Artist"],
    ["album", "Album"],
    ["duration", "Duration"],
  ],
};
/** The sort chosen on each tab, kept while Digitify is open. */
const chosenSorts: Partial<Record<MusicTab, string>> = {};

/** What a music tab's tools set (D-184): words to find, and a sort. */
interface MusicTools {
  find: string;
  sort: string;
}

/**
 * Music's other tabs have the Tracks tab's tools beside the categories (D-184): Find in this view,
 * Size (the cards of Artists and Playlists, the rows of the track lists) and Sort.
 */
function Tools({ tab, tools, setTools }: { tab: Exclude<MusicTab, "tracks">; tools: MusicTools; setTools: (next: MusicTools) => void }) {
  const { preferences, update } = usePreferences();
  return (
    <>
      <label className="arcade-search view-find">
        <Search size={15} aria-hidden />
        <input type="search" placeholder="Find in this view" value={tools.find} onChange={(event) => setTools({ ...tools, find: event.target.value })} aria-label="Find in this view" />
      </label>
      <label className="arcade-size">
        <span>Size</span>
        <CardSizeSlider value={preferences.cardSize} onChange={(cardSize) => update({ cardSize })} />
      </label>
      <label className="arcade-sort">
        <span>Sort</span>
        <select
          value={tools.sort}
          onChange={(event) => {
            chosenSorts[tab] = event.target.value;
            setTools({ ...tools, sort: event.target.value });
          }}
        >
          {SORTS[tab].map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}

function Header({ category, tab, onNewPlaylist, tools }: { category: Category; tab: MusicTab; onNewPlaylist: () => void; tools: ReactNode }) {
  const titleArriving = useArrival(`title:${category.name}`);
  return (
    <>
      <CategoryStrip tools={tools} />
      <div className="page-header">
        <div className={`title-row${titleArriving ? " arriving" : ""}`}>
          <span className="title-badge">
            <CategoryIcon icon={category.icon} size={26} />
          </span>
          <div>
            <div className="title-line">
              <h1 className="display">{category.name}</h1>
            </div>
            <div className="count">{LABELS[tab][0]}</div>
          </div>
        </div>
        {/* Add where the Tracks tab has it; on Playlists, New playlist beside it (D-145). */}
        <div className="header-actions">
          {tab === "playlists" && (
            <button type="button" className="btn" onClick={onNewPlaylist}>
              <Plus size={17} /> New playlist
            </button>
          )}
          <AddMenu align="end" category={category.key}>
            <button type="button" className="btn btn-primary">
              <Plus size={17} strokeWidth={2.6} /> Add
            </button>
          </AddMenu>
        </div>
      </div>
      {/* The tabs sit where every category has its tabs (D-094). */}
      <div className="toolbar arcade-toolbar">
        <MusicTabs category={category} tab={tab} />
      </div>
    </>
  );
}

/** Words found in any of these texts, ignoring case. */
const matches = (words: string, ...texts: (string | null | undefined)[]) => {
  const w = words.trim().toLowerCase();
  return !w || texts.some((t) => t?.toLowerCase().includes(w));
};

/** The cards' size from the Size slider, as the library's covers (D-184). */
const gridSize = (cardSize: number) => ({ "--card-min": `${Math.round(cardSize * 1.06)}px` }) as CSSProperties;

function Artists({ tools }: { tools: MusicTools }) {
  const artists = useQuery({ queryKey: ["artists"], queryFn: api.musicArtists });
  const { preferences } = usePreferences();
  const [artist, setArtist] = useState<string | null>(null);
  if (artist) {
    return (
      <>
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setArtist(null)}>
          <ArrowLeft size={15} /> All artists
        </button>
        <h2 className="music-sub">{artist}</h2>
        <TrackList filter={{ artist }} empty="No tracks." find={tools.find} />
      </>
    );
  }
  if (!artists.data?.length) return <p className="hint">{artists.isLoading ? "" : "No artists yet. Import some music."}</p>;
  const shown = artists.data.filter((entry) => matches(tools.find, entry.name));
  if (tools.sort === "name-desc") shown.reverse();
  if (tools.sort === "tracks") shown.sort((a, b) => b.tracks - a.tracks);
  if (!shown.length) return <p className="hint">No artist matches “{tools.find.trim()}”.</p>;
  return (
    <div className="artist-grid" style={gridSize(preferences.cardSize)}>
      {shown.map((entry) => (
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
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(playlist.name);
  const [deleting, setDeleting] = useState(false);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["playlists"] });
  const playAndShow = usePlayAndShow();
  const play = async () => {
    const tracks = await api.musicTracks({ playlist: playlist.id });
    if (tracks.length) await playAndShow(tracks.map((t) => t.id), 0);
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

function Playlists({ creating, setCreating, tools }: { creating: boolean; setCreating: (open: boolean) => void; tools: MusicTools }) {
  const playlists = usePlaylists();
  const { preferences } = usePreferences();
  const [open, setOpen] = useState<{ id: number; adding: boolean } | null>(null);
  const current = playlists.data?.find((p) => p.id === open?.id);
  if (current && open) return <PlaylistView key={current.id} playlist={current} startAdding={open.adding} onBack={() => setOpen(null)} />;
  const shown = (playlists.data ?? []).filter((p) => matches(tools.find, p.name));
  if (tools.sort === "name-desc") shown.reverse();
  if (tools.sort === "tracks") shown.sort((a, b) => b.tracks - a.tracks);
  if (tools.sort === "duration") shown.sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0));
  return (
    <>
      {playlists.data?.length && !shown.length ? (
        <p className="hint">No playlist matches “{tools.find.trim()}”.</p>
      ) : playlists.data?.length ? (
        <div className="artist-grid" style={gridSize(preferences.cardSize)}>
          {shown.map((playlist) => (
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
  const [creating, setCreating] = useState(false);
  // Find, Size and Sort work here as on the Tracks tab (D-184); each tab starts with nothing to find.
  const [tools, setTools] = useState<MusicTools>({ find: "", sort: chosenSorts[tab] ?? "" });
  useEffect(() => setTools({ find: "", sort: chosenSorts[tab] ?? "" }), [tab]);
  const [finding, setFinding] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => setFinding(tools.find), 200);
    return () => window.clearTimeout(timer);
  }, [tools.find]);
  const shown = { find: finding, sort: tools.sort };
  return (
    <div className="library-view">
      <div className="music-page">
      <Header category={category} tab={tab} onNewPlaylist={() => setCreating(true)} tools={<Tools tab={tab} tools={tools} setTools={setTools} />} />
      <div className="view-stage music-stage" key={`${tab}:${tools.sort}`}>
        {tab === "artists" && <Artists tools={shown} />}
        {tab === "playlists" && <Playlists creating={creating} setCreating={setCreating} tools={shown} />}
        {tab === "recent" && <TrackList filter={{ recent: true }} empty="Nothing played yet." find={shown.find} sort={shown.sort} />}
        {tab === "favorites" && <TrackList filter={{ favorites: true }} empty="No favorite tracks yet. Use the heart next to a track." find={shown.find} sort={shown.sort} />}
      </div>
      </div>
    </div>
  );
}

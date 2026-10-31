-- Phase 3 music (D-020): favorite tracks, playlists, and what was played recently.
-- Tracks are the parts of album items (`parts.kind = 'track'`).

ALTER TABLE parts ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0;

CREATE TABLE playlists (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE playlist_tracks (
    id          INTEGER PRIMARY KEY,
    playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    part_id     INTEGER NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
    position    INTEGER NOT NULL
);
CREATE INDEX playlist_tracks_order ON playlist_tracks(playlist_id, position);

CREATE TABLE plays (
    id        INTEGER PRIMARY KEY,
    part_id   INTEGER NOT NULL REFERENCES parts(id) ON DELETE CASCADE,
    played_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX plays_recent ON plays(played_at);

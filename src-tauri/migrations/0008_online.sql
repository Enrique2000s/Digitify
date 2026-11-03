-- D-028: items imported from a link. One row per item that came from an online service or a web
-- link: where it lives, and whether Digitify holds a downloaded copy (otherwise it's online only,
-- played in the service's own player and needing a connection).
CREATE TABLE online_sources (
    item_id     INTEGER PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE,
    -- youtube (YouTube and YouTube Music share ids), spotify, soundcloud, web
    provider    TEXT NOT NULL,
    -- The service as shown: YouTube, YouTube Music, Spotify, SoundCloud, Web
    service     TEXT NOT NULL,
    -- video, track, playlist, album, file
    kind        TEXT NOT NULL,
    external_id TEXT NOT NULL,
    url         TEXT NOT NULL,
    downloaded  INTEGER NOT NULL DEFAULT 0,
    added_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE UNIQUE INDEX online_sources_external ON online_sources(provider, kind, external_id);

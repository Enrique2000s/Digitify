-- D-034: Arcade, a launcher for the games of the emulators on this computer (Dolphin for GameCube
-- and Wii, Project64 and RMG for Nintendo 64). Games aren't library items: Arcade keeps its own list.

-- An emulator's program, when it was pointed at by hand (otherwise it's looked for where it's
-- usually installed).
CREATE TABLE arcade_emulators (
    kind TEXT PRIMARY KEY CHECK (kind IN ('dolphin', 'project64', 'rmg')),
    path TEXT
);

-- Game folders added in Digitify, besides those set up in the emulators themselves.
CREATE TABLE arcade_folders (
    id        INTEGER PRIMARY KEY,
    path      TEXT NOT NULL UNIQUE,
    recursive INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE arcade_games (
    id             INTEGER PRIMARY KEY,
    path           TEXT NOT NULL UNIQUE,
    platform       TEXT NOT NULL CHECK (platform IN ('gamecube', 'wii', 'n64')),
    title          TEXT NOT NULL,
    sort_title     TEXT NOT NULL,
    -- The disc's ID (GMSE01) or the cartridge's code (NSME), from the game's header.
    game_id        TEXT,
    size           INTEGER,
    cover_key      TEXT,
    cover_color    TEXT,
    -- Where the cover came from: 'dolphin' (its cache), 'gametdb' or 'user'.
    cover_source   TEXT,
    is_favorite    INTEGER NOT NULL DEFAULT 0,
    play_seconds   INTEGER NOT NULL DEFAULT 0,
    play_count     INTEGER NOT NULL DEFAULT 0,
    last_played_at TEXT,
    -- Its file wasn't found at the last scan (an unplugged drive): kept, with its play time.
    missing        INTEGER NOT NULL DEFAULT 0,
    added_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX arcade_games_sort ON arcade_games(sort_title, id);

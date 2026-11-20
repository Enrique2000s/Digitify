-- D-148: Arcade's collections, as in Steam's library. A collection of the player's own holds the
-- games put in it; a dynamic one holds no games, its rules (JSON: words in the name, consoles and
-- launchers, play state) pick them as they come and go.
CREATE TABLE arcade_collections (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL CHECK (length(trim(name)) > 0),
    dynamic    INTEGER NOT NULL DEFAULT 0,
    rules      TEXT,
    position   INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE TABLE arcade_collection_games (
    collection_id INTEGER NOT NULL REFERENCES arcade_collections(id) ON DELETE CASCADE,
    game_id       INTEGER NOT NULL REFERENCES arcade_games(id) ON DELETE CASCADE,
    added_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (collection_id, game_id)
);
CREATE INDEX arcade_collection_games_game ON arcade_collection_games (game_id);

-- D-148: the emulator one game starts in, over the one chosen for its console.
ALTER TABLE arcade_games ADD COLUMN emulator TEXT;

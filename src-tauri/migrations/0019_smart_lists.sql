-- D-051: smart lists, saved rules that fill a list by themselves. `query` holds the rules as
-- the fields of a library query (JSON).
CREATE TABLE smart_lists (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    query      TEXT NOT NULL DEFAULT '{}',
    position   REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

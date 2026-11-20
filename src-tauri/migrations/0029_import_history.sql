-- D-137: what was imported, kept until the owner clears it: each entry imported from a link, and
-- each import of files and folders. What's still running comes from the queues themselves.
CREATE TABLE import_history (
    id          INTEGER PRIMARY KEY,
    -- link (one entry from a link) or files (one import of files and folders)
    kind        TEXT NOT NULL CHECK (kind IN ('link', 'files')),
    title       TEXT NOT NULL,
    -- Links: the service. Files: the category they went into.
    detail      TEXT,
    -- Links: download or link (saved online).
    action      TEXT,
    -- done, skipped (already in the library), failed or cancelled
    state       TEXT NOT NULL,
    error       TEXT,
    item_id     INTEGER REFERENCES items(id) ON DELETE SET NULL,
    -- Files: {"total", "imported", "duplicates", "skipped", "failed"}.
    counts      TEXT NOT NULL DEFAULT '{}',
    -- Links: the entry and how it was asked for, so it can be tried again.
    request     TEXT,
    finished_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX import_history_finished ON import_history(finished_at);

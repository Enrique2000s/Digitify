-- D-066: achievements reached, and when (so each is announced once).
CREATE TABLE achievements (
    key         TEXT PRIMARY KEY,
    unlocked_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

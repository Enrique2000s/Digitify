-- Phase 5 (D-023): time spent reading, watching and listening, per local day and item, for the
-- statistics on Home. It stays in this library on this computer, like everything else.

CREATE TABLE activity (
    day     TEXT NOT NULL,
    item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    kind    TEXT NOT NULL CHECK (kind IN ('read', 'watch', 'listen')),
    seconds INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, item_id, kind)
);
CREATE INDEX activity_item ON activity(item_id);

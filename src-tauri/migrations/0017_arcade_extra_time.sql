-- D-043: time played outside Digitify, added by hand to a game's total; the time Digitify counts
-- stays apart in play_seconds.
ALTER TABLE arcade_games ADD COLUMN extra_seconds INTEGER NOT NULL DEFAULT 0;

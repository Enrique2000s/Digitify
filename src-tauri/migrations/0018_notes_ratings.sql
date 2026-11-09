-- D-049: the user's own rating (1-5 stars) and note on items and games. Items already had a
-- rating column (unused until now).
ALTER TABLE items ADD COLUMN note TEXT;
ALTER TABLE arcade_games ADD COLUMN rating INTEGER;
ALTER TABLE arcade_games ADD COLUMN note TEXT;

-- D-149: a game can be marked as completed (and when). Smart lists are gone: Library's collections
-- and Arcade's dynamic collections do their job with less clutter; their saved rules and their
-- hand-arranged orders go with them.
ALTER TABLE arcade_games ADD COLUMN completed_at TEXT;
DROP TABLE IF EXISTS smart_lists;
DELETE FROM custom_order WHERE view LIKE 'smart:%';

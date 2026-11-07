-- D-037: PC games installed through Steam, Epic Games, the Xbox app or Heroic join Arcade. Their
-- console is 'pc' (the platform CHECK is widened in Rust right after this script, `reshape::d037`);
-- `path` holds `store://<store>/<id>`, and they start through their store.
ALTER TABLE arcade_games ADD COLUMN store TEXT;
ALTER TABLE arcade_games ADD COLUMN store_key TEXT;
ALTER TABLE arcade_games ADD COLUMN launch TEXT;
ALTER TABLE arcade_games ADD COLUMN install_dir TEXT;
-- A store game taken off Arcade's list stays off (it's still installed, so a search would find it).
ALTER TABLE arcade_games ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;

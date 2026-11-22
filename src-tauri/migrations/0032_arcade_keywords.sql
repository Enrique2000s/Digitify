-- D-160: keywords of your own on Arcade's games (a JSON list), found by the search and by dynamic
-- collections' words as if they were in the name.
ALTER TABLE arcade_games ADD COLUMN keywords TEXT;

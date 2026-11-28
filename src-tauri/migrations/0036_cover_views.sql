-- D-184: how a game's cover is framed in its box (zoom and middle), as a profile picture is; for
-- the cover it was made for. Items keep theirs in their metadata ($.coverView).
ALTER TABLE arcade_games ADD COLUMN cover_view TEXT;

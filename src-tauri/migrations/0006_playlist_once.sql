-- A track is in a playlist once (owner's request). Repeats left by earlier versions are removed,
-- keeping each track's first place.

DELETE FROM playlist_tracks WHERE id NOT IN (SELECT min(id) FROM playlist_tracks GROUP BY playlist_id, part_id);
CREATE UNIQUE INDEX playlist_tracks_once ON playlist_tracks(playlist_id, part_id);

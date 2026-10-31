-- Digitify library schema, version 2: artwork tint and indexes for the library views.

-- Average color of the cover artwork, used for shelf spines and artwork-tinted backgrounds.
ALTER TABLE items ADD COLUMN cover_color TEXT;

CREATE INDEX items_year ON items(year, sort_title);
CREATE INDEX items_favorite ON items(is_favorite) WHERE is_favorite = 1;
CREATE INDEX versions_kind ON versions(item_id, kind);
CREATE INDEX files_status ON files(status) WHERE status <> 'ok';

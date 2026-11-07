-- D-039: categories are fixed: only their order and visibility change. Built-in categories get
-- their own names, icons and reading directions back; categories made by the user stay as they
-- are. Custom fields are no longer shown or searched; their values stay in each item's metadata.
-- The search index is rebuilt in Rust right after this script (`reshape::after`).

UPDATE categories SET name = 'Books', icon = 'book' WHERE key = 'books' AND is_builtin = 1;
UPDATE categories SET name = 'Comics', icon = 'comic', settings = json_set(settings, '$.readingDirection', 'ltr') WHERE key = 'comics' AND is_builtin = 1;
UPDATE categories SET name = 'Manga', icon = 'manga', settings = json_set(settings, '$.readingDirection', 'rtl') WHERE key = 'manga' AND is_builtin = 1;
UPDATE categories SET name = 'Movies & Series', icon = 'film' WHERE key = 'video' AND is_builtin = 1;
UPDATE categories SET name = 'Music', icon = 'music' WHERE key = 'music' AND is_builtin = 1;
UPDATE categories SET name = 'Videos', icon = 'play' WHERE key = 'videos' AND is_builtin = 1;
UPDATE categories SET name = 'Pictures', icon = 'image' WHERE key = 'pictures' AND is_builtin = 1;

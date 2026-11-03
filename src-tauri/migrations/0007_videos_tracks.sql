-- D-027: Videos (clips, recordings, personal videos) get their own built-in category, apart from
-- Movies & Series. Music loses albums: each track becomes its own item; that split, moving loose
-- videos to Videos and the new category order are done in Rust right after this script
-- (`reshape::d027`), since they need more than one statement per row.

-- A custom category that happens to use the key keeps working under a new one.
UPDATE categories SET key = key || '-custom' WHERE key = 'videos' AND is_builtin = 0;

INSERT INTO categories (key, name, icon, handler, sort_order, is_builtin, settings)
    VALUES ('videos', 'Videos', 'play', 'video', 0, 1, '{}');

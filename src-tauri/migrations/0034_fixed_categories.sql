-- D-174: the categories are fixed, the same for everyone. Categories made in an early version
-- (when new ones could be created) go, with what they held; the files stay where they are on disk.
DELETE FROM items_fts WHERE rowid IN (
    SELECT i.id FROM items i JOIN categories c ON c.id = i.category_id WHERE c.is_builtin = 0
);
DELETE FROM items WHERE category_id IN (SELECT id FROM categories WHERE is_builtin = 0);
DELETE FROM categories WHERE is_builtin = 0;

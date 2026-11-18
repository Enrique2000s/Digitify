-- D-090: collections are one level: any inside another moves up to the top of its category,
-- keeping its items.
UPDATE collections SET parent_id = NULL WHERE parent_id IS NOT NULL;

-- D-092: Tags and Later are gone; their records with them (the library is backed up before this
-- upgrade, as before every schema change).
DELETE FROM item_tags;
DELETE FROM tags;
DELETE FROM later;

-- D-171: Tags and Later left with D-092 (v23 emptied them); their empty tables go now. Nothing
-- reads them anymore. The search index keeps its `tags` column, left empty.
DROP TABLE IF EXISTS item_tags;
DROP TABLE IF EXISTS tags;
DROP TABLE IF EXISTS later;

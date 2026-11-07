-- D-033: a Pictures category for photos, and 'image' as a category type. The category type is a
-- CHECK constraint, widened in Rust right after this script (`reshape::d033`) along with the new
-- category, so no table is rebuilt.
SELECT 1;

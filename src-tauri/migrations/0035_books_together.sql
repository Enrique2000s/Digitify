-- D-183: Books, Comics and Manga become one category, Books, as Movies & Series holds movies and
-- series: each item keeps what it is in its metadata (`kind`: book, comic or manga). Comics' and
-- manga's reading direction moves onto their items (manga reads right to left unless set otherwise),
-- and their collections, watched folders and hand-arranged orders join Books'.

-- What each item is.
UPDATE items SET metadata = json_set(coalesce(metadata, '{}'), '$.kind', 'book')
 WHERE category_id = (SELECT id FROM categories WHERE key = 'books') AND json_extract(metadata, '$.kind') IS NULL;
UPDATE items SET metadata = json_set(coalesce(metadata, '{}'), '$.kind', 'comic')
 WHERE category_id = (SELECT id FROM categories WHERE key = 'comics');
UPDATE items SET metadata = json_set(coalesce(metadata, '{}'), '$.kind', 'manga')
 WHERE category_id = (SELECT id FROM categories WHERE key = 'manga');

-- A direction set for the whole category goes onto each of its items that has none of its own.
UPDATE items SET metadata = json_set(metadata, '$.readingDirection',
        coalesce(json_extract((SELECT settings FROM categories WHERE key = 'comics'), '$.readingDirection'), 'ltr'))
 WHERE category_id = (SELECT id FROM categories WHERE key = 'comics') AND json_extract(metadata, '$.readingDirection') IS NULL
   AND json_extract((SELECT settings FROM categories WHERE key = 'comics'), '$.readingDirection') IS NOT NULL;
UPDATE items SET metadata = json_set(metadata, '$.readingDirection',
        coalesce(json_extract((SELECT settings FROM categories WHERE key = 'manga'), '$.readingDirection'), 'rtl'))
 WHERE category_id = (SELECT id FROM categories WHERE key = 'manga') AND json_extract(metadata, '$.readingDirection') IS NULL;

-- A hand-arranged order of Comics or Manga comes after Books' own.
UPDATE custom_order SET view = 'books', position = position + 1000000 WHERE view = 'comics';
UPDATE custom_order SET view = 'books', position = position + 2000000 WHERE view = 'manga';
UPDATE custom_order_collections SET view = 'books', position = position + 1000000 WHERE view = 'comics';
UPDATE custom_order_collections SET view = 'books', position = position + 2000000 WHERE view = 'manga';

-- Everything that belonged to Comics or Manga now belongs to Books.
UPDATE items SET category_id = (SELECT id FROM categories WHERE key = 'books')
 WHERE category_id IN (SELECT id FROM categories WHERE key IN ('comics', 'manga'));
UPDATE collections SET category_id = (SELECT id FROM categories WHERE key = 'books')
 WHERE category_id IN (SELECT id FROM categories WHERE key IN ('comics', 'manga'));
UPDATE watched_folders SET category_id = (SELECT id FROM categories WHERE key = 'books')
 WHERE category_id IN (SELECT id FROM categories WHERE key IN ('comics', 'manga'));

DELETE FROM categories WHERE key IN ('comics', 'manga');

-- Digitify library schema, version 1.
-- Model (D-005): Category -> Collection tree -> Item -> Versions (physical | digital) -> Files.
-- Parts (chapters, episodes, tracks) carry their own progress.

CREATE TABLE categories (
    id          INTEGER PRIMARY KEY,
    key         TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    icon        TEXT NOT NULL DEFAULT 'folder',
    color       TEXT,
    handler     TEXT NOT NULL CHECK (handler IN ('book', 'comic', 'video', 'audio', 'generic')),
    sort_order  INTEGER NOT NULL DEFAULT 0,
    is_hidden   INTEGER NOT NULL DEFAULT 0,
    is_builtin  INTEGER NOT NULL DEFAULT 0,
    settings    TEXT NOT NULL DEFAULT '{}',
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- User-defined metadata fields, per category.
CREATE TABLE field_definitions (
    id          INTEGER PRIMARY KEY,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    key         TEXT NOT NULL,
    label       TEXT NOT NULL,
    kind        TEXT NOT NULL CHECK (kind IN ('text', 'longtext', 'number', 'date', 'rating', 'boolean', 'choice', 'url')),
    options     TEXT NOT NULL DEFAULT '{}',
    sort_order  INTEGER NOT NULL DEFAULT 0,
    UNIQUE (category_id, key)
);

-- Nested collections inside a category: series, franchises, plain folders.
CREATE TABLE collections (
    id          INTEGER PRIMARY KEY,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    parent_id   INTEGER REFERENCES collections(id) ON DELETE CASCADE,
    kind        TEXT NOT NULL DEFAULT 'folder',
    name        TEXT NOT NULL,
    sort_name   TEXT NOT NULL,
    description TEXT,
    cover_key   TEXT,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    settings    TEXT NOT NULL DEFAULT '{}',
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX collections_parent ON collections(category_id, parent_id, sort_order);

-- The work itself. Its single home is a category, optionally inside a collection (D-004).
CREATE TABLE items (
    id             INTEGER PRIMARY KEY,
    category_id    INTEGER NOT NULL REFERENCES categories(id),
    collection_id  INTEGER REFERENCES collections(id) ON DELETE SET NULL,
    title          TEXT NOT NULL,
    sort_title     TEXT NOT NULL,
    subtitle       TEXT,
    year           INTEGER,
    description    TEXT,
    position       REAL,
    cover_key      TEXT,
    is_favorite    INTEGER NOT NULL DEFAULT 0,
    rating         INTEGER,
    metadata       TEXT NOT NULL DEFAULT '{}',
    added_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    last_opened_at TEXT
);
CREATE INDEX items_sort ON items(sort_title, id);
CREATE INDEX items_category_sort ON items(category_id, sort_title, id);
CREATE INDEX items_collection ON items(collection_id, position);
CREATE INDEX items_added ON items(added_at);
CREATE INDEX items_opened ON items(last_opened_at);

CREATE TABLE people (
    id        INTEGER PRIMARY KEY,
    name      TEXT NOT NULL UNIQUE,
    sort_name TEXT NOT NULL
);

CREATE TABLE item_people (
    item_id   INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    role      TEXT NOT NULL,
    position  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (item_id, person_id, role)
);
CREATE INDEX item_people_person ON item_people(person_id);

-- Ordered units inside an item: chapters, episodes, tracks, discs.
CREATE TABLE parts (
    id          INTEGER PRIMARY KEY,
    item_id     INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    kind        TEXT NOT NULL,
    number      REAL,
    title       TEXT,
    duration_ms INTEGER,
    position    INTEGER NOT NULL DEFAULT 0,
    metadata    TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX parts_item ON parts(item_id, position);

-- Physical copies and digital editions of an item.
CREATE TABLE versions (
    id          INTEGER PRIMARY KEY,
    item_id     INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    kind        TEXT NOT NULL CHECK (kind IN ('physical', 'digital')),
    label       TEXT,
    format      TEXT,
    edition     TEXT,
    condition   TEXT,
    location    TEXT,
    acquired_at TEXT,
    notes       TEXT,
    is_primary  INTEGER NOT NULL DEFAULT 0,
    metadata    TEXT NOT NULL DEFAULT '{}',
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX versions_item ON versions(item_id);

-- Files of a digital version: one file, or ordered pages / tracks.
CREATE TABLE files (
    id           INTEGER PRIMARY KEY,
    version_id   INTEGER NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
    part_id      INTEGER REFERENCES parts(id) ON DELETE SET NULL,
    position     INTEGER NOT NULL DEFAULT 0,
    path         TEXT NOT NULL,
    storage      TEXT NOT NULL CHECK (storage IN ('referenced', 'managed')),
    volume_id    TEXT,
    size         INTEGER,
    modified_at  INTEGER,
    quick_hash   TEXT,
    full_hash    TEXT,
    mime         TEXT,
    status       TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'missing', 'unreadable')),
    last_seen_at TEXT,
    metadata     TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX files_version ON files(version_id, position);
CREATE INDEX files_quick_hash ON files(quick_hash);
CREATE INDEX files_path ON files(path);

-- Reading, watching and listening progress. part_id 0 means the whole item.
CREATE TABLE progress (
    item_id    INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    part_id    INTEGER NOT NULL DEFAULT 0,
    locator    TEXT,
    fraction   REAL NOT NULL DEFAULT 0,
    completed  INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (item_id, part_id)
);
CREATE INDEX progress_recent ON progress(updated_at);

CREATE TABLE bookmarks (
    id         INTEGER PRIMARY KEY,
    item_id    INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    part_id    INTEGER NOT NULL DEFAULT 0,
    locator    TEXT NOT NULL,
    label      TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX bookmarks_item ON bookmarks(item_id);

-- Shelves: user-ordered groups that cut across categories; an item can sit on many.
CREATE TABLE shelves (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT,
    icon        TEXT,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    settings    TEXT NOT NULL DEFAULT '{}',
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE shelf_items (
    shelf_id INTEGER NOT NULL REFERENCES shelves(id) ON DELETE CASCADE,
    item_id  INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    position INTEGER NOT NULL DEFAULT 0,
    added_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (shelf_id, item_id)
);
CREATE INDEX shelf_items_item ON shelf_items(item_id);

CREATE TABLE tags (
    id    INTEGER PRIMARY KEY,
    name  TEXT NOT NULL UNIQUE COLLATE NOCASE,
    color TEXT
);

CREATE TABLE item_tags (
    item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    tag_id  INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (item_id, tag_id)
);
CREATE INDEX item_tags_tag ON item_tags(tag_id);

CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Full-text search index; rowid = items.id. The core keeps it in sync when items, people or tags change.
CREATE VIRTUAL TABLE items_fts USING fts5(
    title, people, tags, extra,
    tokenize = 'unicode61 remove_diacritics 2'
);

INSERT INTO categories (key, name, icon, handler, sort_order, is_builtin, settings) VALUES
    ('books',  'Books',           'book',  'book',  1, 1, '{}'),
    ('comics', 'Comics',          'comic', 'comic', 2, 1, '{"readingDirection":"ltr"}'),
    ('manga',  'Manga',           'manga', 'comic', 3, 1, '{"readingDirection":"rtl"}'),
    ('video',  'Movies & Series', 'film',  'video', 4, 1, '{}'),
    ('music',  'Music',           'music', 'audio', 5, 1, '{}');

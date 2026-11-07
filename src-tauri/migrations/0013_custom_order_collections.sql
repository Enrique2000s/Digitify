-- D-036: in a custom order, collections take places among the items. Positions share one count with
-- `custom_order`'s items of the same view; collections never placed come first, as before.
CREATE TABLE custom_order_collections (
    view          TEXT NOT NULL,
    collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    position      INTEGER NOT NULL,
    PRIMARY KEY (view, collection_id)
);

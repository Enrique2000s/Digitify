-- Custom order (owner's request after Phase 5): the order a user arranges a view in by hand, per
-- view ("books", "all", "favorites", "collection:3", "tag:2", "shelf:5" for a smart shelf).
-- Items not arranged yet come after the arranged ones, by title.

CREATE TABLE custom_order (
    view     TEXT NOT NULL,
    item_id  INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    PRIMARY KEY (view, item_id)
);
CREATE INDEX custom_order_item ON custom_order(item_id);

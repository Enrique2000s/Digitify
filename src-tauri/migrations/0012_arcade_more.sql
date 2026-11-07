-- D-035: Arcade's game folders can be set per emulator (replacing the ones read from its settings),
-- and games can be put in an order of the user's own.
ALTER TABLE arcade_emulators ADD COLUMN custom_folders INTEGER NOT NULL DEFAULT 0;

-- An emulator's game folders as set in Arcade, used instead of its own while `custom_folders` is on.
CREATE TABLE arcade_emulator_folders (
    emulator  TEXT NOT NULL CHECK (emulator IN ('dolphin', 'project64', 'rmg')),
    path      TEXT NOT NULL,
    recursive INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (emulator, path)
);

-- Custom order: games are dragged into place; those never placed come after, by title.
ALTER TABLE arcade_games ADD COLUMN position REAL;

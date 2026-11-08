-- D-041: time played per day, so games count in Home's statistics like reading, watching and
-- listening. Recorded when a game session ends (on the day it ends); earlier play time stays in
-- each game's total only.
CREATE TABLE arcade_activity (
    day     TEXT NOT NULL,
    game_id INTEGER NOT NULL REFERENCES arcade_games(id) ON DELETE CASCADE,
    seconds INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, game_id)
);

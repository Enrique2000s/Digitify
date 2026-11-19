-- D-101: more consoles in Arcade. Any console's name fits `platform` now (RetroArch plays many):
-- its CHECK is widened in Rust right after this script (`reshape::after`), as are the emulator
-- tables' (DuckStation, PCSX2, RPCS3, melonDS, DeSmuME and RetroArch join them).
-- A game from RetroArch's playlists: the core that plays it, and RetroArch's name for its console.
ALTER TABLE arcade_games ADD COLUMN core TEXT;
ALTER TABLE arcade_games ADD COLUMN system TEXT;

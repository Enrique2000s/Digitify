-- D-111: Kega Fusion, ZSNES, Snes9x, Nestopia, nullDC and ares join Arcade's emulators. The emulator
-- tables' CHECKs are widened in Rust right after this script (`reshape::after`) to any emulator's
-- name, as `arcade_games.platform` was (D-101), so later emulators need no migration.
SELECT 1;

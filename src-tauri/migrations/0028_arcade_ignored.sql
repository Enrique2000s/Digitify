-- D-117: an emulator Arcade finds can be set aside ("Don't use"): it isn't looked for, its folders
-- aren't searched and no game starts in it, until it's used again.
ALTER TABLE arcade_emulators ADD COLUMN ignored INTEGER NOT NULL DEFAULT 0;

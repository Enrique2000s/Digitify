# Architecture

This page describes the approved direction (decisions D-001 to D-017). It is updated as each subsystem is built.

## Overview

```
Digitify.exe (Tauri 2)
├─ UI · React + TypeScript, rendered by WebView2
│    Dashboard · library views (grid/shelf/list/detail, virtualized)
│    Page reader (PDF/images/comics) · EPUB reader · player controls
│        ▲ typed commands & events · private digitify:// media protocol
│        ▼
└─ Core · Rust
     Library DB (SQLite + full-text search) · import & job queue
     Metadata extractors · thumbnail cache · archives · PDF renderer
     Relinker · backups · player controller · optical service · CD ripper
        │ JSON IPC (named pipe)            │ pipes
        ▼                                  ▼
     mpv.exe: video, music, discs       ffmpeg / ffprobe: probing, thumbnails, encoding, remux
```

## Processes
| Process | Role |
|---|---|
| `digitify.exe` | Tauri host: the Rust core and the WebView2 UI |
| `mpv.exe` | One instance per active player. Controlled over JSON IPC on a named pipe. For video, it draws into a child "video host" window kept underneath the transparent web UI. |
| `ffmpeg.exe` / `ffprobe.exe` | Short-lived helpers for probing, thumbnails, encoding and remuxing |

## Rust core (`src-tauri/src`)
| Module | Responsibility |
|---|---|
| `setup` | App status, choosing or opening the library folder, preferences, background maintenance (missing-file check), opening Digitify's page on GitHub (`REPOSITORY`, D-172) |
| `config` | Machine-specific `config.json` (library path, interface preferences) in `%LOCALAPPDATA%\com.digitify.desktop`, or `DIGITIFY_CONFIG_DIR` |
| `library_folder` | Library folder layout and cloud-sync detection |
| `db` | SQLite connection, WAL mode, migrations tracked by `PRAGMA user_version` (with a snapshot before upgrading an existing library), snapshots, and swapping in a restored database |
| `online` | Import from URL (D-028, D-133): `link` recognizes links offline; `providers` asks YouTube, Spotify and SoundCloud through oEmbed or their Web APIs, or yt-dlp; `ytdlp` runs the shipped yt-dlp (with Deno and FFmpeg) to list and download, and updates it; `http` (ureq over Windows' TLS) spaces requests and explains failures; `queue` downloads or saves online items on two workers; `keys` keeps API keys encrypted with DPAPI |
| `optical::linux` / `optical::win` | The drives behind one interface (`drive_io`): Linux's CD-ROM ioctls and SG_IO, or Windows' DeviceIoControl (D-031) |
| `reshape` | The Rust half of a migration that SQL can't do alone (D-027: tracks out of albums, loose videos into Videos, the new category order) |
| `backup` | Library backups in `backups\` (`library-YYYYMMDD-HHMMSS-<kind>.db`); validate and restore, keeping the current state as a backup first |
| `library` | Catalog queries (views, dashboard, details, full-text search, "select all" ids) and edits (items, people, physical copies, favorites, artwork, removal) |
| `organize` | Nested collections (tree queries with recursive CTEs, moving without cycles, deleting by moving contents up) and bulk edits applied in one transaction, limited to what fits every selected item (`bulk_actions`, D-027) |
| `autostart` | Starting Digitify at sign-in: the user's Run key on Windows, a freedesktop autostart entry on Linux (D-047) |
| `check` | Library check: missing files and duplicates (D-057) |
| `media` | System media controls through `souvlaki`: Windows' media overlay, Linux's MPRIS; reports what's playing and turns its buttons into `media-key` events (D-058) |
| `tray` | The tray icon and its menu, and keeping the window hidden when closed (D-059) |
| `history` | The imports history (D-137): each link entry's and each file import's outcome, kept in the library until cleared |
| `profile` | The personal profile (D-149): name, line, picture and banner in `<config>/profile`, the share card's PNG saved where chosen |
| `manual` | The built-in manual (D-149): put in Books once, replaced by a newer edition, left gone when deleted (state in the library's `settings`) |
| `films` | Videos into Movies & Series (D-135): as movies, or as a series' episodes; editing a series (D-174): its episodes' order, adding them from files (`import::import_videos`) or Videos, taking one out to Videos, and their thumbnails (a frame of each, or a picture chosen) |
| `watched` | Watched folders: a look every 2 minutes that imports new files into each folder's category (D-060); a new category or Look now tries again what was skipped (D-183) |
| `session` | The computer's lock screen (D-183): `session-locked` for the page, which holds the menu music meanwhile |
| `year` | Your year, your week (D-164), achievements and the activity calendar, from the activity records (D-065…D-067); the profile's level, ratings and most played songs (D-183) |

What's new (D-081) reads `src/lib/releaseNotes.ts` (one entry per version, in plain words) and shows it from `features/app/AppDialogs.tsx`, beside the close question (D-080).

Big Picture's players (D-071) share `features/bigpicture/consoleControls.tsx`: `usePlayerController` turns the controller into the bars' selection (or the quick buttons while they're away), with `PlayerHints` and `BpClock`; its startup is `Intro.tsx` with `ambientEngine.introSound()` (D-070), and Now playing is `NowPlayingScreen.tsx` (D-072).
| `categories` | Category order and visibility (categories are fixed, D-039; old custom field values stay in `metadata.custom`) |
| `import` | Background import jobs: scan, then in parallel fingerprint, skip duplicates and extract metadata, then save. Also attaches files to existing items. |
| `formats` | Embedded metadata readers: EPUB OPF, ComicInfo.xml in any comic archive, audio tags (lofty), ffprobe |
| `artwork` | Artwork cache: cover (≤1400 px) and thumb (400 px wide) JPEGs keyed by content hash, plus average color |
| `files` | Fingerprints, volume serials, safe names, natural ordering, reveal in Explorer, missing-file check, relinking moved files by content |
| `tools` | Locating helper programs (mpv, ffmpeg, ffprobe; `find_on_path`) and running them without console windows, and the small helpers shared everywhere (`wide` strings for Windows, `base64`, D-171) |
| `media_protocol` | The `digitify` URI scheme: artwork, ambient tracks (range requests), book pages and ebook files, photos, and Videos' hover previews |
| `ambient` | Ambient music from the user's files, folders and library tracks (D-016), a playlist per menu (main, Settings, Big Picture, D-174) |
| `pages` | The page engine: a digital copy as numbered pages (CBZ entries in natural order, image files, PDF pages), page sizes for layout, pages served scaled to the reader's width with a 128 MB cache, `progress_save`, and `reader_open`, which picks the page reader or the ebook reader for an item |
| `ebooks` | Ebooks (D-014): finds a copy's EPUB, MOBI, AZW3 or FB2 file, refuses copy-protected books (checks only, never decrypts), and `ebook_progress_save` (a CFI and a fraction) |
| `bookmarks` | Bookmarks: a page, or an ebook CFI with its fraction and location, with a label |
| `chapters` | Chapters of page-based books (D-019): detected from folders or a PDF outline, or the reader's own (stored as `parts` of kind `chapter`) |
| `series` | Series navigation: the items sharing a series name (or a collection) in volume and number order; series from comic file names |
| `builder` | The image-set book builder: previews of picked images and reordering an image book's pages (`import::book_from_images` creates the book) |
| `archives` | Comic archives (D-017): ZIP, RAR (UnRAR), 7z and TAR recognized by their first bytes; listing, reading one entry, and one pass over all entries (fast for solid archives) |
| `pdf` | PDFium, loaded from `pdfium.dll` on first use (D-013): page sizes, page rendering, and title, author, year, page count and cover at import |
| `player` | mpv for video: process lifecycle, IPC events (`player-event`; `time-pos` at most ten times a second, which the music player shares), the video host window under the WebView, subtitle files |
| `watch` | Films and episodes in the player (Phase 3): the file and start position for an item or episode, the next episode, progress every few seconds, watched marks, read marks for books, comics and manga (D-178), and a series' summed-up progress (part 0) |
| `episodes` | Episode names at import (D-018): "S01E02", "1x02", season folders |
| `optical` | Discs (Phase 4, D-022): `win` (Windows drive calls: drives, media, TOC, CD-Text, raw audio sectors, DVD copyright descriptor, eject), `cd` (TOC and CD-Text parsing, verified ripping), `dvd` (IFO titles, chapters, languages; CSS scrambling check), `bluray` (MPLS playlists; AACS/BD+), and the service: drive watcher (`drives-changed`), contents, playing titles through mpv (EDL plus a chapters file), CD audio over the media server, rip and import jobs (`disc-job`), cataloging. `DIGITIFY_FAKE_DRIVES` adds simulated drives for testing. |
| `stats` | Recorded time (`activity`: day, item, read/watch/listen, seconds) and Home's statistics; the queries Your year and Your week share (all activity, top artists, D-171) |
| `music` | The music player (D-020): a second, audio-only mpv whose playlist is the queue (gapless), tracks and artists, favorites, playlists, recently played, track edits |
| `updates` | Updates (D-181, D-182): the newest GitHub release, asked by the repository's number, this system's file, the download checked against SHA256SUMS.txt, and installing it (Windows installer, AppImage, .deb through pkexec, Arch script in a terminal) |
| `previews` | Videos' hover previews (D-179): a short silent WebM clip made once with FFmpeg, kept in the library's `cache/previews`, cleared for videos no longer in Videos |
| `pictures` | Photos (D-033): EXIF details, upright thumbnails with the viewer's turn and mirror, the file behind a photo, album covers |
| `arcade` | Arcade (D-034, D-035, D-101, D-106, D-107, D-111, D-112): `mod.rs` holds the one list of which emulators play each console (`PLAYS`); `detect` finds Dolphin, Project64, RMG, DuckStation, PCSX2, RPCS3, melonDS, DeSmuME, Mesen, FCEUX, Nestopia, Snes9x, ZSNES, mGBA, Kega Fusion, nullDC, Flycast, PPSSPP, Azahar, Cemu, Ryujinx, xemu, Xenia, ares and RetroArch and reads their game folders (or Arcade's own per emulator); `games` recognizes discs and ROMs by their headers (GameCube/Wii discs, N64 and DS ROMs, PlayStation discs by `SYSTEM.CNF`, PlayStation 3 folders by PARAM.SFO) and names libretro box art; `retroarch` reads RetroArch's playlists and box art; `stores` reads the installed games of Steam, Epic Games, the Xbox app, GOG, itch.io (its `butler.db`, read-only) and Heroic, `icons` reads the emulators' own icons, `sgdb` asks SteamGridDB (with the user's key), `artsources` keeps LaunchBox's index, libretro-thumbnails' list of boxes per console and the searching by words (D-148), and asks Nintendo's store and the Microsoft Store, `collections` keeps Arcade's collections (`arcade_collections`, `arcade_collection_games`; a dynamic one's rules as JSON, applied by the app, D-148; a game's own keywords in `arcade_games.keywords`, matched by the search and those rules, D-160; `arcade_change_keywords` for several at once, D-162), and `launchers` reads those of Ubisoft Connect, the EA app, Battle.net, the Rockstar Games Launcher, the Riot Client, Amazon Games and Lutris (registry, installer data, their databases, read-only), `minecraft` finds Minecraft: Java Edition's launcher, Bedrock and Prism Launcher's and MultiMC's instances (D-153), `registry` reads the Windows registry directly, read-only, in `reg query`'s text (D-152: starting `reg.exe` took seconds), and the Xbox app's folders are looked for only on the computer's own disks and plugged-in drives; the stores' games are kept for 60 seconds for the panel and the covers, and dropped when their installs change (D-173); `covers` finds, offers and keeps the covers (the emulators' art, the stores', GameTDB, libretro-thumbnails, LaunchBox, SteamGridDB) and `play` starts games (in their emulator or through their store), keeps their sessions and play time, notices games started elsewhere and watches the stores' installs (both split from `mod.rs`, D-173); programs added by hand start by themselves; play time per day goes to `arcade_activity` for the statistics (D-041); scanning, covers (Dolphin's cache, GameTDB, libretro-thumbnails), selecting, custom order, launching with play time while the window hides ; `programs` lists the programs on this computer to add as games (D-183) |
| `localhost` | Linux: the loopback page hosting YouTube's player (D-032) |

Planned modules: none for now.

### Import pipeline
1. **Scan** the picked or dropped paths into candidates:
   - one per ebook, PDF, comic archive or video
   - one per folder of images, unless that folder also holds audio or video (then the images are artwork)
   - one per music track (D-027: no albums; the album's name is kept as a detail)
   - videos with a year go to Movies & Series, others to Videos; a category picked in the import dialog applies to the files it can hold
2. **Prepare** each candidate in parallel (rayon, 8 at a time):
   - fingerprint each file (size + sampled BLAKE3) and drop files already in the library
   - read embedded metadata and artwork
3. **Save** each one:
   - copy into `media\<Category>\[<Item>\]` in Copy mode
   - store the artwork
   - insert the item, people, parts and a digital version with its files, then reindex for search
   - progress is reported through `import-progress` events, and `library-changed` tells views to refresh

## UI (`src`)
React + TypeScript via Vite, organized by feature:

| Path | Contents |
|---|---|
| `app/` | Router (hash history) and root layout |
| `components/` | Header capsule with the music capsule, category strip, "Add to library" menu, cards, covers, dialogs, switch |
| `features/reader/` | The reader screen at `/read/$id` (`?page=` opens a page): the page reader (layout of views, spreads and strips), the ebook reader around foliate-js, their shared controls (full screen, controls that hide, bookmarks, display), contents, and page turns (CSS 3D turn and a WebGL curl shader) |
| `features/player/` | The video player at `/watch/$id` (`?part=` an episode) and `/disc/$letter/$title` (a disc title) |
| `features/discs/` | **Discs** (`/discs`): drives and their contents, ripping, importing, cataloging, data-disc browsing, and the insert notice; `lib/discs.tsx` keeps drives and jobs current |
| `features/library/ArrangeDialog.tsx` | "Arrange…": a view's custom order (or a shelf's own order), dragged into place |
| `features/bigpicture/` | Big Picture (D-025) at `/bp`: its screens, the on-screen keyboard, the cursor and the menu; `Launcher.tsx` opens it with the controller and maps buttons to shortcuts in the readers and the player. `lib/gamepad.ts` reads Xbox and PlayStation controllers (Gamepad API); `lib/bigpicture.ts` keeps whether it's on and moves the selection |
| `features/arcade/` | Arcade: `ArcadePage.tsx` (the views, the games' board, the Sort menu), `GamePanel.tsx` (a game's panel), `BulkBar.tsx` (several selected games), `Setup.tsx` (Emulators & folders, also in Settings › Arcade), `Collections.tsx`, `ArcadeScreen.tsx` (Big Picture's), `shared.tsx` (badges and the helpers they share) (D-173) |
| `features/home/` | Home: sections in the user's order, "Customize Home", Featured today and Statistics |
| `features/music/` | The music category's tabs (artists, tracks, playlists, recently played, favorites) and track lists with their menus and dialogs |
| `lib/music/` | The music provider: the queue and playback state from `music-event`s, shared by every screen |
| `features/builder/` | "Book from images…" and "Arrange pages": the page grid with pointer dragging (the window's file drop takes over HTML drag and drop) |
| `vendor/foliate-js/` | foliate-js at a pinned commit (D-014; see its README), loaded only when an ebook opens |
| `features/` | Home (category tiles), library views (virtualized grid/list/shelf with multi-select and the bulk bar), organize (collections, move dialogs), item page and forms, import UI, onboarding, settings (Categories, Sound) |
| `lib/` | Typed API, TanStack Query hooks, paged item cache, preferences (look, palette, theme, accent, motion, music, shelf material, Home's layout, shortcuts), accent contrast math, formatting, `shortcuts.ts` (every keyboard action, its default keys and the user's), `activity.ts` (recording time for Statistics), `reorder.ts` (dragging rows into a new order, for short lists and virtualized ones) |
| `lib/ambient/` | Ambient music and interface sounds: the "Morning Lounge" composition and synth (`lounge.ts`), the Settings and Big Picture themes (`themes.ts`, D-174), the playback engine with a channel per menu and crossfades between them (`engine.ts`), and its React provider, which picks the channel from the address |
| `styles/` | Breeze tokens and app styles (D-016); `looks.css` (Cinematic and the Breeze palettes, as token overrides) and `views.css` (shelf materials, detailed and carousel views, Home's widgets) (D-023). `app.css` and `views.css` only load their parts, in order (`styles/app/`: base, shell, pages, readers, viewer and Arcade; `styles/views/`: shelves and Home, statistics and music, online and extras, Now playing to the profile; D-173), so the cascade is the one file's. Nunito, Inter and Archivo are bundled via Fontsource, never loaded online |

### Ambient music and interface sounds (D-016)
- **One engine per session** (`lib/ambient/engine.ts`), driven by the provider from preferences. It keeps playing across screens.
- **"Morning Lounge"** (`lounge.ts`), Digitify's own theme, is synthesized live with Web Audio:
  - a small additive synth, with a noise shaker and a convolution reverb
  - notes scheduled 250 ms ahead of the audio clock from a 40 ms timer; after a stall, missed steps are skipped rather than played at once
  - every other 8-bar pass plays the fixed theme; the passes in between improvise from chord tones
  - each voice disconnects its nodes when it ends, so long sessions don't accumulate audio nodes
- **Interface sounds** use the same audio context through their own gain:
  - hover blips on elements marked `data-blip` (tiles, covers, category pills), at most one every 70 ms
  - a press tone on buttons, links, menu items and switches (mouse, Enter or Space)
- **The user's own music** plays through an `<audio>` element:
  - `ambient_playlist` (Rust) resolves the chosen files, folders (walked in natural order) and library tracks (the primary digital copy's files) into a playlist of up to 10,000 playable files
  - it remembers those files under a new generation number; the UI streams them from `/ambient/<generation>/<index>`, so older URLs stop working when the list changes
  - track titles come from tags (`ambient_track_info`); an unplayable file is skipped, and playback stops only if every file fails
  - volume follows a squared curve for recorded music, and fades are applied on play, pause and source changes
- **Pausing:** music pauses while the window is minimized (unless turned off) and while anything holds it (`useAmbientHold`: every player).
- **Idle:** the audio context is suspended after 5 s with nothing synthesized playing, and resumes on the next sound.
- **Autoplay:** WebView2 starts audio without a click because wry passes `--autoplay-policy=no-user-gesture-required` by default. If audio is ever blocked, the engine starts on the first click or key press, and the capsule says so.

## Data model
```
Category       Pictures · Music · Videos · Movies & Series · Books (books, comics and manga, D-183)
 │               icon, custom fields, default reader/player, layouts, sorting
 └ Collection    one level: an album, a series, a plain folder (Books ▸ One Piece)
    └ Item       the work: "One Piece Vol. 01", "Blade Runner", "Abbey Road"
       ├ Versions  physical: hardcover, DVD, 4K Blu-ray, CD (edition, condition, location)
       │           digital: CBZ, MKV, FLAC (files, referenced or copied)
       └ Parts     optional: chapters, episodes, tracks, each with its own progress
Tags: cross-cutting labels (shelves were removed in D-029 and became collections)
```
The schema lives in `src-tauri/migrations/` (v3 adds `playlists`, `playlist_tracks`, `plays` and `parts.is_favorite`; v4 adds `activity`; v5 adds `custom_order`; v6 lets a track be in a playlist once; v9 turns shelves into collections, splits extra copies into items and moves disc formats into items (`reshape::d029`); v8 adds `online_sources` (where an imported link lives and whether it was downloaded); v7 adds the Videos category and turns each album's tracks into items of their own, done by `reshape::after` in the same transaction since it needs more than SQL). Tables: `categories`, `field_definitions`, `collections`, `items`, `people`, `item_people`, `parts`, `versions`, `files`, `progress`, `bookmarks`, `shelves` and `shelf_items` (kept since v9, empty of use), `activity`, `custom_order` (hand-arranged order per view), `settings` and `items_fts` (full-text index; its `tags` column stays, empty). `tags`, `item_tags` and `later` went with v33 (D-171); v34 removes categories made in early versions, with their items (D-174).

## Media serving
On Windows, the UI loads library resources from `http://digitify.localhost/<route>`:
- `/thumb/<key>` and `/cover/<key>`: cached artwork
- `/ambient/<generation>/<index>`: a track of the current ambient playlist (only files the user chose), served in 1 MiB HTTP range slices
- `/file/<id>`: a library file, with HTTP Range support (Phase 2, for readers and players)
- `/page/<copy>/<n>?w=<width>`: a page of a book for the reader, scaled down to the width asked for (rounded up to 400 px steps)
- `/book/<copy>`: the ebook file of a digital copy, which foliate-js lays out in the WebView
- `/cd/<drive>/<track>`: an audio CD track read straight from the disc as WAV, in range slices

Only resources registered in the library are served. Paths never come straight from the UI.

## Security
- The UI only gets `core:default`, logging and Digitify's own commands (Tauri capabilities).
- The production Content Security Policy only allows scripts from the app bundle. Frames, styles and fonts may also come from `blob:` URLs (ebook chapters and their resources), and forms can't be submitted anywhere (`form-action 'none'`).
- Media files are treated as untrusted input:
  - Ebook chapters load in frames that inherit the Content Security Policy, so their scripts and inline handlers never run, and they can't load anything from the internet. Website links in books are shown, not opened.
  - Copy-protected ebooks are refused before they are read (D-007).
  - Archive entries are validated against path traversal and size limits.
- Core features make no network calls (D-008).

## Storage
| Location | Contents |
|---|---|
| Library folder (chosen at first run) | `library.db`, `cache\covers\`, `cache\thumbs\`, `media\` (copies made by Copy imports), `backups\` |
| `%LOCALAPPDATA%\com.digitify.desktop\` | `config.json` (library path, preferences), WebView2 profile, `logs\` |

## Helper engines
The built-in manual (D-149) is written in `docs/manual/manual.html` and built by `npm run manual` (`scripts/build-manual.mjs`: the app's lucide icons and Nunito font, printed to `src-tauri/resources/manual/Digitify-Manual.pdf` by Edge or Chrome without a window); the PDF is committed and carried by the installers.

`scripts/fetch-deps.ps1` downloads pinned builds, verifies their SHA-256 hashes and refuses any build that contains DVD/Blu-ray decryption code (D-007). Binaries live in `src-tauri/binaries/` (git-ignored) and are copied next to the app at build time.

| Engine | Pinned build | Notes |
|---|---|---|
| mpv | 0.41.0, official x86_64 MSVC release (`mpv.exe` + `vulkan-1.dll`, ~56 MB) | Plays every file format we need. It contains no CSS/AACS decryption code and no `dvd://`, `bd://` or `cdda://` modules. |
| FFmpeg | 9.0.2, BtbN LGPL shared build | Development tool for now (test media). Probing and thumbnails come in Phase 1. |

Because the bundled mpv has no disc modules, unprotected discs go through Digitify's own disc layer (D-022, approved):
- Rust reads the disc structure (DVD IFO files, Blu-ray MPLS playlists, the CD table of contents and CD-Text).
- mpv plays the unencrypted VOB/M2TS streams directly, as one title through an EDL, with a chapters file.
- Audio CDs are read sector by sector: by the media server for playback, by the ripper for import. FFmpeg encodes FLAC and remuxes titles to MKV.

This avoids GPL disc libraries and any decryption code.

### Embedding mpv video under the web UI
Proven in PoC 1; see STATUS.md.

1. The core creates a child window (`DigitifyVideoHost`) at the bottom of the z-order, below the WebView2 child window. The host must **not** have `WS_CLIPSIBLINGS`: with it, Windows clips the video away under the WebView.
2. mpv is started with `--wid` pointing at that host, so it renders inside it.
3. While a video is open, the page background is transparent and the React controls float above the picture.
4. The UI reports the video area in physical pixels (`player_set_rect`).
5. The core moves the host window and stretches mpv's window to fill it.

# Feature status

**Updated:** 2026-10-31 · **Current phase:** all five phases built; waiting for the owner's check with real files and a real optical drive

Legend: ✅ done and tested · 🟡 implemented, needs manual testing · 🧪 proof-of-concept only · 🔄 in progress · ⬜ not started · ⛔ won't do (see the linked decision)

A feature is only marked ✅ after it has been implemented and tested. "Tested" means automated checks: Rust unit tests, plus an end-to-end run of the real app window driven through WebView2's DevTools protocol against generated sample media. See **How Phase 1 was tested** below.

## Phase 0: done
| Item | Status | Notes |
|---|---|---|
| Development environment | ✅ | Node.js 26 LTS, Rust 1.99 (MSVC), Visual Studio C++ tools, WebView2 156 |
| Visual direction | ✅ | **Cinematic** chosen first (D-015), then replaced by **Breeze** (D-016), both from the visual concepts canvas |
| App scaffold | ✅ | Tauri 2.12, React 19.3, TypeScript 7, Vite 8, SQLite (rusqlite 0.41) |
| Helper engines | ✅ | mpv 0.41.0 official build; FFmpeg 9.0.2 LGPL (ffmpeg + ffprobe, bundled in `ffmpeg\`) |
| PoC 1: video under the web UI | 🧪 ✅ | See the Phase 0 results below; it becomes the real player in Phase 3 |
| PoC 2: 50k-item library | 🧪 ✅ | 144 fps scrolling and 5 ms page queries; the same paging approach is used by the real views |

## Phase 1: core library
| Feature | Status | Notes |
|---|---|---|
| First-run library folder setup | ✅ | Suggests `%USERPROFILE%\Digitify Library`. Warns about OneDrive, Dropbox, Google Drive, iCloud and Box (D-010). Reports an unreachable library on startup. |
| Breeze shell (D-016) | ✅ | Header capsule: logo (Home), back/forward, library search (Ctrl+F), music capsule, Settings, round window buttons; the whole bar drags the window. Library pages have a strip of section pills with live counts (replaces the sidebar). New Breeze app icon. |
| Theme, accent, motion, cover size | ✅ | Light (default), night or system. Accent presets (Sky by default) or a custom color, adjusted for 4.5:1 contrast. Animations follow Windows or can be set to full, reduced or off. Saved between sessions. Settings saved under Cinematic start once from Breeze's theme and accent. |
| Ambient music: "Morning Lounge" | ✅ | Original theme generated live (D-016). Starts at launch with no click needed, at 40%. Capsule: play/pause, mute, volume. |
| Ambient music: your own music | ✅ | Songs, folders or albums from the library (Settings › Sound), in order or shuffled, with a "Next track" button. Titles and artists come from tags. Unplayable files are skipped. Streamed in slices; only the files you chose can be served. |
| Music pauses when minimized and during video | ✅ | "Pause when minimized" is on by default. The video lab pauses it; the Phase 3 players will use the same hold. |
| Interface sounds | 🟡 | Hover blips on tiles, covers and section pills; a press tone on buttons, links, menus and switches. On by default, with a switch on Home and in Settings. The wiring is tested; how they sound has to be judged by ear. |
| Import: files, folders | ✅ | Background job with progress, cancel and an error list; "Keep files where they are" or "Copy into the library folder" |
| Import: drag and drop | 🟡 | Wired to Tauri's native drop events; can't be automated, so please try it |
| Format detection | ✅ | EPUB, PDF, MOBI, AZW3, FB2, CBZ, CBR, CB7, folders of page images, video and audio (see ARCHITECTURE.md) |
| Embedded metadata | ✅ | EPUB (title, authors, publisher, date, description, language, cover); ComicInfo.xml (series, volume, number, writer, artist, summary, manga → right-to-left); audio tags grouped into albums with track parts; video via ffprobe (duration, resolution, codecs, audio/subtitle tracks, chapters, frame as artwork) |
| PDF metadata and covers | ✅ | Since Phase 2, with PDFium: title (placeholder titles such as "Microsoft Word - …" are ignored), author, year, page count, and a cover from the first page. PDFs imported earlier get their cover and page count once, in the background. |
| Artwork cache | ✅ | Full-size and grid sizes, stored once per image by content hash, with an average color for spines and tints |
| Duplicate detection | ✅ | Size plus a sampled BLAKE3 fingerprint. A second import of the same files added 0 and copied nothing. |
| Missing-file detection | ✅ | Checked in the background at startup. Missing files are flagged on cards, the item page and Home. |
| Relink moved files | ✅ | "Find moved files…" (Home notice, Settings) searches a folder and matches by size and fingerprint. Tested with a file moved into a nested folder and renamed. |
| Grid, List, Shelf (covers/spines) views | ✅ | Virtualized. Shelf shows Blu-ray/DVD case bands and spines tinted from the artwork. Layout is remembered per view. |
| Search | ✅ | Full-text over titles, people, series, albums, genres and track names |
| Sort and ownership filters | ✅ | Sort by title, recently added, year or creator. Filter: on the shelf, digital, not digitized. |
| Favorites | ✅ | |
| Item details page | ✅ | Artwork-tinted hero, about, details per kind, track list, copies with file paths and "Show in folder" |
| Edit details | ✅ | Title, subtitle, year, category, people and roles, description, per-kind fields; stored in the database only (D-009) |
| Change artwork | ✅ | |
| Physical copies | ✅ | Format, edition, condition, location, date acquired, notes. Add, edit and remove. |
| Catalog a physical-only item | ✅ | |
| Add files to an existing item | ✅ | Becomes a digital copy next to the physical one (tested with Copy mode) |
| Remove from library | 🟡 | Never deletes files. Copies inside the library folder can optionally go to the Recycle Bin after confirmation. The code path is in place, but the Recycle Bin option hasn't been exercised by the automated run. |
| Home | ✅ | Greeting, quick toggles (interface sounds, night mode), large category tiles with cover collages and counts (plus Favorites, Everything, and Add to library), "Pick up where you left off" (fills in once readers and players exist), Recently added, Favorites, totals |
| Nested collections and moving items | ✅ | Collections inside collections, per category (D-004). Category pages show their collections as tiles, with breadcrumbs inside. Collections can be created, renamed, moved (no cycles) and deleted; deleting moves everything inside up one level. Items move with Organize › Move (or in bulk). Search finds items by their collections' names. |
| Shelves (your own lists) | ✅ | Lists across categories, kept in the order items were added ("Shelf order" sort). Shelves page, a page per shelf, "Your shelves" on Home, and a menu on each item to put it on shelves or take it off. Deleting a shelf never removes its items. |
| Tags | ✅ | Added on the item page (with suggestions) or in bulk. Tags page with counts, a page per tag, rename (renaming onto an existing tag merges them) and delete. Unused tags disappear. Searchable. |
| Multi-select and bulk editing | ✅ | "Select" in any view (grid, shelf or list): click, Shift+click for a range, Ctrl+A or "Select all" for every match. Then: add to shelf, take off this shelf, add or remove tags, move, favorites, year, series, or remove from the library (files are never deleted). |
| Custom categories and fields | ✅ | Settings › Categories: create categories with a name, icon and kind of media, plus custom fields (text, long text, number, date, 1–5 rating, yes/no, choice, web address) filled in under Edit details and shown in Details. Built-in categories can be renamed, re-iconed and given fields too. Deleting your own category asks where its items go. |
| Category order and visibility | ✅ | Move categories up or down and show or hide them; Home tiles and section pills follow. Hidden categories' items still appear in Everything and in search. |
| Backup and restore | ✅ | "Back up now" saves a consistent snapshot (`VACUUM INTO`) in `backups\`. Restoring validates the backup, saves the current state first, then swaps the database while the app runs. A copy is also kept automatically before any schema upgrade. Tested: backup, remove an item, restore, and all 8 items are back. |
| Recently opened | ⬜ | Moved to Phase 2: it needs readers and players |
| NSIS installer | ✅ | `Digitify_0.1.0_x64-setup.exe`, 67.8 MB, per-user (no admin). Tested on the development PC (silent install):<br>• **Install:** 5 s into `%LOCALAPPDATA%\Digitify` (about 220 MB with mpv and FFmpeg), with Start menu and desktop shortcuts and an Apps & features entry (publisher "Digitify").<br>• **Run:** the installed copy imported the test set; its bundled ffprobe/ffmpeg read video metadata and artwork, and its mpv passed the video-lab checks.<br>• **Uninstall:** removes the app, shortcuts and entry, and keeps the library, settings and logs. |
| Third-party notices | ✅ | `THIRD_PARTY_NOTICES.md`, shipped with the app (Settings › About). A full transitive license list is due before the first public release. |

### How Phase 1 was tested (2026-10-30)
- `cargo test`: 8 unit tests pass (natural sort, safe file names, EPUB paths, ISBN/year parsing, ComicInfo manga detection, titles from file names, search queries).
- `scripts\make-samples.ps1` generates synthetic media (no copyrighted content): an EPUB with a cover and description, a PDF, a folder of page photos, a manga CBZ with ComicInfo.xml, a plain comic CBZ, a three-track FLAC album with `cover.jpg`, and a 1080p MKV.
- End-to-end run of the release build against a throwaway config and library:
  1. Onboarding, then choosing a library folder.
  2. Import: 7 items in 0.5 s, each with the right category, title, creator, year and format. 6 have artwork; the PDF has none. The album's `cover.jpg` became album art, not a stray book.
  3. Grid, shelf (covers and spines) and list views.
  4. Item pages for the manga, the album, the video and the EPUB.
  5. Catalog a physical hardcover, then add a scanned PDF to it in Copy mode. It was copied to `media\Books\My Hardcover Copy\`.
  6. Re-import everything in Copy mode: "0 added, 7 already in library", and no files copied.
  7. Search "middle" finds the album through a track title.
  8. Settings, then light theme.
  9. Hide a referenced file and restart: 1 missing file reported, and the card is flagged.
- **Not covered by automation:** native file dialogs, drag and drop, mouse hover effects, and the Recycle Bin option. Please try these by hand.

### How organizing was tested (2026-10-31)
- `cargo test`: 17 unit tests pass. They include an in-memory library that checks:
  - nested collections: counts, cycle and cross-category refusals, deleting without losing items, and search by collection name
  - tags: names cleaned up, merges on rename, and unused tags removed
  - shelves: order kept, repeats ignored
  - custom categories: keys, field keys kept on rename, duplicate names refused, and items moved when a category is deleted
- End-to-end run of the release build, through the real interface, on the test library:
  1. Settings › Categories: create "Board Games" (gamepad icon, catalog only) with "Players" (number) and "Box condition" (choice).
  2. Fill those fields in Edit details. Details shows them, and search finds the item by "Good".
  3. Create a collection in Manga, then one inside it. Breadcrumbs read Manga › Starfall Academy › Year One Arc. Organize › Move puts the manga there, and the Manga page shows the collection tile with 1 item.
  4. Create a shelf, then select three items in Everything and add them. The shelf page lists them in shelf order, and Home shows "Your shelves".
  5. In bulk, add tags "friday, family", then add to favorites and set the year to 2001.
  6. On an item, add the tags "signed, first edition"; renaming "first edition" to "Signed" merges them.
  7. Move Music up and hide Comics; Home's tiles follow.
  8. Delete the inner collection: the manga moves up to Starfall Academy. Deleting "Board Games" without choosing where its item goes is refused; choosing Books moves it there.
- The Breeze run (onboarding, import, views, item pages, music) was repeated afterwards as a regression check.
- Minimizing and restoring four times in a row paused the music and brought it back each time. The window is now also checked when it regains focus and periodically while minimized, so a missed resize event can't leave the music paused.

### How the Breeze update was tested (2026-10-30)
- `cargo test`: 12 unit tests pass, adding HTTP range parsing, playable audio formats, and refusal of stale playlist generations.
- `scripts\make-samples.ps1` now also generates `samples\music-test\`: two tagged songs (FLAC, Opus) and a deliberately broken MP3.
- End-to-end run of the release build against a throwaway config and library:
  1. Onboarding opens in the light theme with the Sky accent. Morning Lounge is playing, and the WebAudio context reports "running" with no click.
  2. The capsule's mute, pause and play update both the music and its status.
  3. Empty home, then import of the test set; the tiles show collages from the imported covers.
  4. Grid, shelf (covers and spines), list, a category page, the item pages, attaching a scan, search, settings and the "Add" menu.
  5. Night mode from the Home toggle, in the home, grid, shelf, item and settings views.
  6. Minimizing pauses the music and restoring resumes it. Opening the video lab pauses it; the audio context goes idle and wakes on return.
  7. A second run uses your own music from a folder. The capsule shows "Breeze Test Song · Digitify Test Tones" from the tags. Next track works. The broken file is skipped back to the first song. Adding the test album from the library gives "6 songs ready".
  8. The `ambient/` route returns 206 for a range, 200 for the whole file, 404 for a stale generation or unknown track, 416 for an impossible range, and 400 for a malformed address.
  9. The missing-file notice, backup, remove, restore and relink were run again on the new interface.
- **Not covered by automation:** how the music and interface sounds actually sound, native file and folder dialogs, drag and drop, and hover effects. Please listen and try these by hand.

### Phase 0 results (summary)
- **PoC 1:** mpv video shows through the transparent WebView with translucent React controls. Tested at 1280×800, 960×600 and fullscreen. Hardware decoding (d3d11va) was active, and mpv always exits with the app. The video host window must not use `WS_CLIPSIBLINGS`.
- **PoC 2:** 50,000 synthetic items scrolled at 144 fps with 0 dropped frames, both steady and fast. Jumping anywhere settled in 35–42 ms, a page of 200 cards loaded in about 4 ms of SQLite time, and search took 11 ms or less. Peak memory was 39 MB for the app process and 586 MB with WebView2.

## Phase 2: readers (done; waiting for the owner's check with real files)
| Feature | Status | Notes |
|---|---|---|
| Page reader | ✅ | Opens comic archives (CBZ, CBR, CB7, CBT), folders of page images and PDFs. Modes: one page, two pages and a continuous scroll. In two-page mode the cover stands alone and wide pages stand alone. |
| Reading direction | ✅ | Right to left for manga (from the item or its category). It can be switched in the reader and is remembered for the item. |
| Fit, zoom and pan | ✅ | Fit page or fit width, zoom from 100% to 400% (buttons, + and −, or Ctrl+wheel), and drag to pan. |
| Turning pages | ✅ | Arrow keys (they follow the reading direction), Page Up/Down, Space, Home/End, the mouse wheel, clicking either side, or the page slider. |
| Page transitions | ✅ | Slide, fade, a 3D turn around the spine, and a page curl drawn with WebGL (D-021). With the curl, a page's outer corner can be dragged: let go past halfway and it turns, earlier and it falls back. Two-page views turn like a book (the back of the leaf is the next left page); a wide page or the cover alone slides instead. Off with reduced motion. Chosen in the reader's Display panel. |
| Progress and resume | ✅ | Saved as you read and when you close the reader; just opening a book doesn't change it. Shown as "Continue reading · 83%" on the item, on cards, and in "Pick up where you left off". |
| Recently opened | ✅ | A row on Home. |
| Page serving | ✅ | `/page/<copy>/<page>?w=<width>`: large pages are scaled down to the width shown (in 400 px steps) and the latest 128 MB are cached. PDF pages are rendered by PDFium. |
| Full screen and window | ✅ | Full screen (F or the button). The reader's controls hide after a moment and come back when the mouse moves. |
| Music while reading | ✅ | Ambient music pauses while the reader is open ("Pause while reading" in Settings › Sound, on by default). |
| EPUB, MOBI, AZW3, FB2 | ✅ | The ebook reader (foliate-js, D-014). One page, two facing pages when the window is wide enough, or a continuous scroll. Fixed-layout EPUBs keep the publisher's layout. |
| Text and themes | ✅ | Text size (70–200%, also + and − or Ctrl+wheel), font (the book's own, Serif or Sans), line spacing, page width and justification. Paper, Sepia and Night themes; Night repaints the book's own colors so text stays readable. Remembered for all books. |
| Contents and position | ✅ | The book's table of contents with the current chapter marked, a position slider, and the chapter and percentage in the title. Turning pages: arrow keys (they follow the book's direction), Page Up/Down, Space, the wheel, or clicking either side. |
| Ebook progress | ✅ | Saved as a CFI as you read and resumed on the next open; feeds "Continue reading" and "Pick up where you left off" like the page reader. |
| Ebook safety | ✅ | Scripts and inline handlers in books never run. Website links show their address with "Copy address" instead of opening. Copy-protected books (Adobe, Readium LCP, Apple, Kindle) are refused with an explanation; Digitify doesn't remove DRM. |
| CBR, CB7, CBT | ✅ | D-017: RAR through RARLAB's UnRAR code, 7z read-only, TAR. Archives are recognized by their contents, so a RAR named `.cbz` still opens. At import they get a cover from their first page, a page count and their ComicInfo.xml, like CBZ. |
| Bookmarks | ✅ | Both readers: B or the bookmark button marks what's on screen; the list goes to, renames or removes them. Ebook bookmarks are kept as a CFI with foliate-js's "locations", so they don't depend on the window size. |
| Night mode, brightness, backgrounds | ✅ | Page reader: brightness 40–100%, night mode (dimmer, warmer pages), and Night, Black, Gray, Paper or your own color behind the pages. Ebooks: brightness, with Paper, Sepia and Night themes. |
| Chapters (D-019) | ✅ | Detected from the folders inside a comic archive or among an image book's files, and from a PDF's outline. "Contents" in the page reader lists them, marks the current one, and lets you start a chapter on the page shown, rename or remove one (then the item keeps your own list). The item page lists them; each opens the reader at its page. |
| Series and volumes | ✅ | Items of a category sharing a series (from ComicInfo, the edit form, or names such as "Saga v02", "Saga #12", "Saga 001"), else the items of a collection, ordered by volume and number. "In this series" on the item page; "Next: …" at the end of a book opens the next volume. |
| Image-set book builder | ✅ | "Book from images…" in "Add to library": pick images (previews load a few at a time), drag them into order or use the arrows, sort by file name, take pages out, then name the book and choose a category and whether to copy the files. "Arrange pages" on an image book's copy reorders or takes out pages; taken-out pages stay on disk unless you choose the Recycle Bin for copies Digitify made. |

### How the rest of Phase 2 was tested (2026-10-31)
- `cargo test`: 32 unit tests pass. The new ones cover bookmark places and labels, chapters from folders (and a cover before the first chapter), cleaning edited chapters, series from file names ("Catch 22" is not a series), series order, and base64 for previews.
- `scripts\make-samples.ps1` now also writes `Night Market Tales 02.cbz`, with its pages in three chapter folders, and gives the sample PDF an outline.
- End-to-end run of the release build on a fresh library:
  1. "Night Market Tales 01" and "02" form a series from their names. The item page of #2 shows its three chapters and "In this series".
  2. The end of #1 offers "Next: #2 · Night Market Tales 02", which opens it at "Chapter 1 - Lanterns".
  3. Contents marks the current chapter and goes to "Chapter 3 - Rain". Marking page 6 adds "Chapter 4"; the saved list has all four.
  4. B bookmarks page 6 and the button shows it. Night mode on Paper gives pages `brightness(0.82) sepia(0.32)`.
  5. The 3D turn plays a leaf over the next page. In two-page mode the curl plays forward and back; a corner dragged a little falls back, and dragged past halfway turns to pages 4–5.
  6. The PDF's outline gives "Section 1–3". Previews come back as JPEG data. A book built from four images in reverse order keeps that order; dragging page 1 onto page 3 and "Sort by file name" saves page-01 to page-04.
  7. An ebook bookmark is saved with its chapter, 34% and location 2.
- **Found and fixed while testing:** Escape closed the page reader while one of its panels was open (it now closes the panel first); the reader's top bar squeezed the book title out (labels hide sooner).

### How the ebook reader was tested (2026-10-31)
- `cargo test`: 25 unit tests pass. The new ones:
  - copy protection: an EPUB with only font obfuscation opens; one that encrypts a chapter with AES is refused; a MOBI header declaring encryption is refused; a missing file isn't mistaken for a protected one
  - ebook files and their types are recognized
- `scripts\make-samples.ps1`:
  - the sample EPUB now has three chapters long enough to turn pages
  - chapter 1 carries a script and an inline handler that must never run, and chapter 2 links to a website
  - new: `The Night Ferry.mobi` (a hand-written Mobipocket 6 file with a table of contents) and `The Clockmaker's Garden.fb2`
- End-to-end run of the release build on a fresh library (with a stand-in protected EPUB added):
  1. The EPUB's item page offers **Read**. It opens in two pages at 17%. The book's script and inline handler did not run, and the console shows them blocked by the Content Security Policy. The policy sent with the page has no nonce on `style-src`, so book styles still apply.
  2. Two page turns reach chapter 2 (51%). Contents lists the three chapters with chapter 2 marked, and picking one goes there.
  3. Clicking the website link shows its address and opens nothing.
  4. Night theme and 120% text: the book's background becomes `rgb(19, 24, 30)`, its text `rgb(205, 213, 221)`, and paragraphs 19.2 px.
  5. Scroll and one-page layouts keep the place. Closing saves 42%, and opening again resumes in chapter 2 at 42%.
  6. The MOBI opens; its contents list both chapters and lead to chapter 2. The FB2 opens, turns pages, and lists its sections.
  7. The protected EPUB is refused with the copy-protection message.
  8. The page reader and comic-archive tests still pass after their controls moved to shared code.
- **Not covered yet:** AZW3 (KF8) files, which are much harder to write by hand than MOBI, and real-world books with complex styling. Both need the owner's own DRM-free books.
- **Found and fixed while testing:** the selected option in the reader's dark controls used the light theme's accent text and was hard to read; both readers now use the dark theme's accent.

### How comic archives were tested (2026-10-31)
- `cargo test`: 23 unit tests pass. The new ones:
  - a RAR archive written in the test (stored files, as the format allows) is detected even when named `.cbz`, then listed in natural page order and read through UnRAR
  - a TAR archive is listed and read
  - a file that isn't an archive is refused
- `scripts\make-samples.ps1` now also writes `Harbor Lights 02.cbr` (a hand-written RAR 4 with a ComicInfo.xml), `Sky Garden 01.cb7` and `Paper Lanterns 01.cbt` (both made with Windows' own `tar`).
- End-to-end run on a fresh library:
  - All three import with a cover and 6 pages. The CBR's ComicInfo gives "Harbor Lights #2", its subtitle and its series.
  - Each opens in the reader and turns to page 2 with the pages drawn.

### How Phase 2 (so far) was tested (2026-10-31)
- `cargo test`: 20 unit tests pass, adding page-width buckets, copy classification (PDF, images, ebooks and CBR refused with a reason) and PDF placeholder titles.
- End-to-end run of the release build on a fresh library:
  1. Import: the PDF arrives with its title, its author "Digitify Test Suite", 3 pages and a cover rendered from page 1.
  2. The right-to-left manga opens from its page with **Read**. ← turns forward. Two-page mode shows pages 2–3 with page 2 on the right. Scroll mode shows a continuous strip. End goes to page 6. The controls hide after 2.6 s.
  3. Closing leads back to the item, which offers "Continue reading · 83%". Opening again resumes at page 5.
  4. A folder of scans and the PDF open; PDF pages are drawn by PDFium. A page requested at 300 px wide is scaled down (38 KB → 12 KB).
  5. Home lists "Pick up where you left off" and "Recently opened".
  6. An EPUB was refused with an explanation (before the ebook reader existed).
  7. A PDF imported before PDFium was added got its cover and page count from the background task.
- **Found and fixed while testing:**
  - The sample PDF generator wrote a broken cross-reference table.
  - Closing the reader could remount it for a moment and save page 1 over your progress. Two fixes: the full-window decision now follows the route being shown, not the address, and the reader no longer saves progress unless you moved.

## Phase 3: media playback (done; waiting for the owner's check with real files)
| Feature | Status | Notes |
|---|---|---|
| Video player | ✅ | mpv draws under the window (as proven in PoC 1); Digitify's own controls float over it and hide while watching. Play/pause, seek with chapter marks (exact, with a preview while dragging; see Phase 5 › Smoother playback), volume, previous/next episode, full screen. Keys (changeable in Settings › Keyboard): Space or K, ←/→ (5 s, Shift for 30 s), ↑/↓ volume, M, C (subtitles), F, Shift+N (next episode), Esc. Library music pauses for a video, as ambient music does. |
| Subtitles, audio, chapters, speed | ✅ | Menus list the file's audio and subtitle tracks (with their languages), its chapters, and speeds from 0.5× to 2×. Subtitle files next to the video whose names contain its name load with it; "Load a subtitle file…" adds another (SRT, ASS, SSA, VTT, SUB, SUP). |
| Volume | ✅ | The video and music players start at 35% and remember where you left each one (like the ambient music). |
| Resume and watched | ✅ | Saved every 5 seconds and on closing; opening again resumes 2 s before ("Resumed at 0:21", with "Start over"). Past 92% counts as watched. Films and episodes can be marked watched or not by hand. |
| TV series (D-018) | ✅ | At import, files named like "Show S01E02 - Title", "show.s01e02" or "Show 1x02" become one series item; a season folder's parent names the show. Later episodes join the existing series. The item page lists seasons and episodes with progress, a play link and a watched mark; "Play S1 · E3" or "Continue" picks the next one. At the end of an episode the next one starts after 8 seconds unless cancelled. |
| Continue watching | ✅ | A Home row of films and series in progress (a series' own progress sums up its episodes). Reading keeps "Pick up where you left off". Films and series also appear in "Recently opened". |
| Posters and backgrounds | ✅ | "Change artwork" sets the poster; "Background…" on a film or series sets a picture for its page (stored like artwork, removable). |
| Music player (D-020) | ✅ | A second, audio-only mpv plays the queue as its playlist, so tracks follow each other without gaps and every format FFmpeg reads plays. Music keeps playing across screens. |
| Mini-player and Now playing | ✅ | While library music plays, the title-bar capsule shows the track with pause and next; it opens "Now playing" (cover, favorite, seek, previous/next, shuffle, repeat all or one, volume, the queue to jump to or remove from, "Stop and clear"). Ambient music pauses meanwhile and comes back after. |
| Music library | ✅ | The music category has tabs: Albums (the usual view), Artists, Tracks (search by track, artist, album or genre), Playlists, Recently played and Favorites. Every list can be played or shuffled and saved as a playlist; each track has play, a favorite heart and a menu (play next, add to queue, add to a playlist or a new one, edit details, go to album, and in a playlist move or remove). |
| Track details | ✅ | Title, artist and number can be edited; the change is kept in the catalog, not written into the file (D-009). At import, a track's artist is kept when it differs from the album's (compilations). |

### How Phase 3 was tested (2026-10-31)
- `cargo test`: 39 unit tests pass. The new ones cover episode names ("S01E02", "s02e10", "1x03", "S01 E04", season folders) and what isn't one ("Blade Runner 2049", "1917", "Mission 2x4"), a series' progress summed from its episodes, the next episode to play, and finding tracks by title, artist, album, genre or a track's own artist, in a given order.
- `scripts\make-samples.ps1` now also writes a small series, "Harbor Watch" (three episodes in "Season 1", one in "Season 2" named `harbor.watch.s02e01.mkv`).
- End-to-end runs of the release build on fresh libraries:
  1. Video: "Harbor Watch" imports as one item with S1E1–E3 and S2E1 in order. The sample film plays; its audio menu lists "Tone 440 Hz · English" and "Tono 660 Hz · Spanish" and switches; subtitles list English; chapters "Opening, Middle, Ending" jump to 0:20; speed 1.5× is applied. Closing saves 38%, the page offers "Resume · 38%", and reopening resumes at 0:21 with "Start over".
  2. Series: "Play S1 · E1" plays it; near the end "Next episode in 8 · S1 · E2 · The Fog" appears and "Play now" goes on. E1 is watched, E2 started, the series at 28%; Home shows both under "Continue watching". "Mark all watched" marks every episode.
  3. Music: artists and tracks are listed; searching "middle" finds "Middle Tone". Playing the album shows the mini-player ("Low Tone · Digitify Test Ensemble") and marks the row; next goes to "Middle Tone", which becomes a favorite. "Now playing" shows the queue; repeat goes to "all". "Save as playlist" makes "Evening Tones (3)". Recently played lists both tracks; an edited track's new artist appears under Artists. "Stop and clear" brings the ambient capsule back.
  4. Every earlier suite (Breeze, ambient music, organizing, readers, archives, ebooks, the rest of Phase 2) passes again.
- **Not covered by the tests:** what mpv draws can't be captured by the WebView's screenshots, so video pictures and audio were checked by mpv's own state (positions, tracks, chapters, end of file), not by eye or ear. Gapless joins need listening on real albums.
- **Found and fixed while testing:** choosing an option in a player menu now closes it (Esc after it closed the player); the first track of a new queue wasn't recorded as played when its details arrived after mpv started it; music lists now refresh after imports and plays.

## Phase 4: physical media (built; not yet tried on a real drive)
| Feature | Status | Notes |
|---|---|---|
| Drive service | 🟡 | Lists the CD/DVD/Blu-ray drives and what's in them; a disc going in or out is noticed within 2 seconds and announced ("DVD inserted · Drive E: · Open"). The title bar shows a disc button (with a dot when a disc is in) that opens **Discs**. Eject. Media type: audio CD, DVD, Blu-ray, data disc, or blank/unreadable. |
| Protection detection (D-007) | 🟡 | DVDs: the drive's copyright descriptor, else scrambled sectors in the first title set. Blu-rays: `AACS` or `BDSVM` folders. Protected discs show why, and only offer cataloging. |
| Audio CDs | 🟡 | Tracks and lengths from the table of contents, names from CD-Text (else "Track 1…", editable). Tracks play straight from the disc (one after another). Ripping to FLAC or WAV reads everything twice and re-reads parts that differ; parts that never agree are listed. Tracks are tagged (title, album, artist, number, year) and imported as an album in the library's music folder. |
| DVDs and Blu-rays | 🟡 | Titles with their length, chapters, audio and subtitle languages (DVD IFO files; Blu-ray playlists, longest first). A title plays in the video player with its chapters; "Import" copies it into the library as an MKV with chapters, audio and subtitles, without re-encoding, then adds it. No disc menus (D-022). |
| Data discs | 🟡 | Browse folders, pick files or folders, and import them; they're copied into the library, since the disc leaves the drive. |
| One-click cataloging | 🟡 | "Catalog this disc" records an audio CD (album, artist, tracks), a DVD or a Blu-ray (title from the volume label, length) as a physical item, protected or not. |

🟡 here means built and tested end to end with simulated drives, but not yet on a real drive.

### How Phase 4 was tested (2026-10-31)
- `cargo test`: 48 unit tests pass. The new ones cover a CD's table of contents (audio and data tracks, the 2-second lead-in), CD-Text across packs and "same as before" entries, ripping verification (a block that settles on a second read, one that never does, cancelling), DVD titles, chapters and languages from generated IFO files, CSS-scrambled sectors, Blu-ray playlists (clips, chapters, languages, duplicates and short playlists left out, AACS), volume labels, mpv's EDL and FFmetadata chapters, and data-disc paths that can't leave the disc.
- Simulated drives (`DIGITIFY_FAKE_DRIVES`): the app writes the disc structures (IFO, MPLS, a CD image with CD-Text and tones) and FFmpeg makes the video streams. End-to-end run of the release build:
  1. Six drives: R DVD (two titles), S Blu-ray, T audio CD "Harbor Songs", U DVD with CSS, V data disc, W empty. The title bar's disc button shows a disc is in.
  2. R lists "Title 1 · 3 chapters · Audio: English, Spanish · Subtitles: English · 0:12" and "Title 2". S lists "Title 800 · 2 chapters". T lists "Low Tide, Fog Bell, Last Ferry Home". U explains the protection and offers only cataloging. V lists its folder and file.
  3. A CD track plays from the disc (2 s into 6). Ripping makes three tagged FLAC files under "The Lighthouse Keepers - Harbor Songs", imported as one album with its tracks and lengths.
  4. DVD title 1 and the Blu-ray title play in the video player with their chapters ("Chapter 1 0:00, Chapter 2 0:04, Chapter 3 0:08"). Importing DVD title 1 makes an MKV with 3 chapters, added to Movies & Series.
  5. Cataloging the protected DVD makes a physical DVD copy noted "Copy-protected (CSS): cataloged only". A PDF imported from the data disc is stored as a managed copy.
  6. A DVD put into a new drive while Digitify runs brings up "DVD inserted · Drive X:".
- **Not covered yet:** a real drive. Reading the table of contents, CD-Text, raw audio sectors and the DVD copyright descriptor goes through Windows calls that only a drive can answer. Ripping speed, drive caches, scratched discs and real DVD/Blu-ray structures need the owner's drive and discs.
- **Found and fixed while testing:** chapters weren't shown when playing from a disc (the chapter file is now in a format mpv reads); the insert notice didn't close itself while a rip was running.

## Phase 5: advanced personalization (done)
| Feature | Status | Notes |
|---|---|---|
| Looks and palettes (D-023) | ✅ | Settings › Appearance: **Style** Breeze or Cinematic (charcoal glass, amber, Inter with expanded Archivo headings; light and night). Breeze **palettes**: Sky, Sunset, Midnight (always dark; the theme buttons say so) and High contrast. A look or palette brings its own accent unless you picked one. Readers and the player keep their own dark controls. |
| Shelf materials | ✅ | In the shelf view's toolbar (the brush button) or Settings › Appearance › Shelves: Breeze, Wood, Glass (covers reflect in it) and Dark metal (a pegboard). Work with covers and spines, light and night. |
| Customize Home | ✅ | "Customize Home" puts a bar on each section to move it up or down and to hide or show it, even sections that are empty right now; "Reset" brings the original order back. Saved as you go. |
| Featured today | ✅ | A big card on Home with one item's artwork, description and facts, and Read/Play/Details. The pick changes each day and stays the same all day; unfinished items come first. |
| Statistics | ✅ | Reading, watching and listening time this month and year; the last 14 days as bars (with each day's figures on hover and as a table); finished this month and year; in progress; most played artists this year; items per category. Time is counted while a reader is open and in use (up to 5 minutes after the last page turn or input) or while a video or music plays, and kept in the library only. |
| Detailed view | ✅ | Rows with big artwork, title, creator and year, category, formats, facts ("320 pages", "12 tracks · 48 min", "2 episodes", "1080p"), whether you have it on the shelf or digital, the start of the description, tags and progress. The cover-size slider sets the row height. |
| Carousel view | ✅ | Covers in a 3D row with reflections: arrows, the wheel, dragging, clicking a side cover or the slider move along; Enter or a click on the front cover opens it. Its keys can be changed. |
| Smart shelves | ✅ | "New smart shelf" on the Shelves page: rules on category, kind of media, tags, year, creator, title, format, progress, favorite, copies, when added or last opened; match all or any; an order and "only the first N". A live count shows how many items match, and a rule that doesn't make sense says why. Smart shelves show a sparkle, fill and order themselves, aren't offered in "Add to shelf", and their menu has "Edit rules…". |
| Keyboard shortcuts | ✅ | Settings › Keyboard lists every shortcut by where it works (Everywhere, Library views, Readers, Video player). "+" records a new key (Esc cancels); a key already in use asks "Use it here instead?"; keys can be removed, and one action or all reset. Buttons' tooltips and the search box show the current keys. New everywhere: Alt+Home (Home), Ctrl+, (Settings), Ctrl+P (music play/pause), Ctrl+Shift+→/← (next/previous track). |

### Linux (D-031, 2026-11-06)
| Part | Status | Notes |
|---|---|---|
| Linux build | 🟡 | `.github/workflows/build.yml` builds a `.deb` and an AppImage on Ubuntu 22.04 (and the Windows installer); download them from the run's artifacts, or build them in WSL. Tried: Ubuntu 22.04 and Arch in WSL (window, artwork, GStreamer), and an Arch laptop with Hyprland and Intel Iris Xe, where video thumbnails and slowness led to the AppImage environment and DMA-BUF fixes. Then the video player froze at the first click (the audio context waking up) and the video caught the mouse; both fixed and tried in Arch WSL (play, pause, resume, Escape, music player). YouTube's embedded player needed a Referer (error 153): a local page hosts it now (D-032); it plays in Digitify installed with the Arch script (tried in Arch WSL, which also ran that script for the first time). The AppImage has no H.264 decoder, so YouTube doesn't play there yet. Not yet tried on real hardware after those fixes: discs. |
| Video on Linux | 🟡 | mpv in an X11 window inside Digitify's, kept clear of the player's bars and menus. Untested on Linux. |
| Disc drives on Linux | 🟡 | `/dev/sr*` through the kernel's CD-ROM calls. Untested (needs a real drive). |
| Keys, browser, file manager | 🟡 | Desktop keyring, `xdg-open`. Untested. |
- **Checked on Windows:** the app still builds and its 58 core tests pass with the Linux changes in place (the Linux code is compiled only on Linux).

### Big Picture of its own, collections, motion, light mode (D-030, 2026-11-06)
| Change | Status | Notes |
|---|---|---|
| Big Picture mouse cursor | ✅ | In selection mode the mouse drives the round cursor; the controller takes back over. Real controllers still untested. |
| Big Picture online player | 🟡 | Its own screen with big buttons for YouTube, YouTube Music, SoundCloud and Spotify. YouTube's play/pause and position work (tested); SoundCloud's and Spotify's buttons use their embeds' messages, not yet tried with those services. |
| Big Picture Home | ✅ | Home's sections (with Statistics and its charts) in Home's order; arrows on every row. |
| Collections filter | ✅ | All shows collections first among the items, in every layout; Collections shows them alone. |
| Animations | ✅ | Entrances for views, filters, sorts, categories, tabs, Home and Big Picture; switchable in Settings. |
| Light mode | ✅ | Settings › Appearance › "Light mode for slower computers". |
- **Tested** (`check-d030`, `check-d030b`): Books shows All / Digital / Collections with no row above, "6 items · 1 collection", and the "Weekend" collection first (427×240, beside 160×240 books); Collections shows it alone and opens it; it leads the list and carousel views too; right after a filter change the covers run "pop-in" and the stage "view-in", and it stops after a moment; light mode turns off the hero's animation and backdrop and comes off again; Big Picture's Home lists Library, Featured today, Favorites, Continue watching, Pick up where you left off, Recently opened, Recently added, Statistics, and its right arrow scrolled a row 438 px and brought a left arrow; the mouse showed the round cursor in selection mode and the D-pad put it away; "Play online" stayed in Big Picture with its top bar, the YouTube embed reported 0:03 / 0:19, and X paused it.

### One item per file, fewer features, link sources (D-029, 2026-11-06)
| Change | Status | Notes |
|---|---|---|
| Source tag and border | ✅ | YouTube, YouTube Music, Spotify and SoundCloud items show the service's color around the cover and its name in the corner (grid, list, shelf, detailed, carousel, item page, Big Picture). |
| Filters | ✅ | All / Digital; Music and Videos also have Online. "On the shelf" and "Not digitized" are gone. |
| Shelves | Removed | Existing shelves became collections (schema 9); smart shelves are gone. The shelf view stays. |
| Catalog a physical item, Your copies | Removed | Also "Catalog this disc" on the Discs page and adding files or physical copies to an item; an item's page shows its file instead. |
| One item per file | ✅ | Items with several digital copies were split; a series stays one item. |
| Disc format | ✅ | Edit details › Disc format for Movies & Series, shown as the DVD/BLU-RAY band; set when importing a disc title. |
| Menu music toggle | ✅ | The slash runs like the interface sounds' one. |
- **Tested** (`check-d029`, on the test library with a shelf, a Blu-ray copy and a book in two files added before upgrading): the "Weekend" shelf became a "Weekend" collection in Movies & Series and in Books holding its items, and no shelves remain; the book became two items (EPUB and PDF); the film got the Blu-ray disc format and its band; Music and Videos show All / Digital / Online and Books All / Digital; Online in Music lists the Spotify song, with a green border and a "Spotify" tag; the YouTube item's page shows a red border and a "YouTube" tag; the Add menu has no catalog entry; an item page shows Details, Organize and File, Organize has only Home and Tags; Edit details offers the disc format; `/shelves` shows nothing; Home has no shelves section; the menu-music slash is rotated 45° like the sounds icon's. A backup was saved before the upgrade.

### Import from URL (D-028, 2026-11-03)
| Feature | Status | Notes |
|---|---|---|
| Import from URL | ✅ | "Add › Import from URL…": paste a link, see what it holds (title, creator, length, thumbnail, service, and per entry whether it downloads, stays online, is already in the library or is unavailable), pick entries, choose Videos or Movies & Series for videos and whether to download, and optionally make a playlist. |
| YouTube / YouTube Music | ✅ | Online items in YouTube's player inside Digitify; playlists listed with a YouTube API key, otherwise kept as one link. |
| Spotify | ✅ | Online items in Spotify's player; with keys, track details and album songs; playlists listed only when Spotify allows (their owner's). |
| SoundCloud | 🟡 | Online items in SoundCloud's player without keys. With keys: sets listed and downloadable tracks downloaded; built from SoundCloud's documented API but not yet tried with real keys. |
| Direct file links | ✅ | Downloaded into `<Category>\Downloads` in the library folder and added like local files. |
| Import queue | ✅ | Bottom-corner panel: progress per item and overall, cancel one or all, retry, clear; failures don't stop the rest. |
| Online vs offline | ✅ | A cloud on online items' covers; their page says "Online, needs a connection" and offers Play (in the service's player) and "Open on …"; downloads say "Available offline". |
| Settings › Online services | ✅ | Optional keys for YouTube, Spotify and SoundCloud, stored encrypted. |
- **Tested** (`check-d028`, real services without keys and a local web server): a direct link downloaded into Music\Downloads, with its tags, as a managed file the music player plays; the same link again and the same file under another link were skipped as already in the library; a missing file failed ("It isn't on the site anymore…") while a slow download beside it carried on; cancelling half way left no partial file, and retry finished it; YouTube ("Me at the zoo", with channel and thumbnail), YouTube Music (as music), a YouTube playlist without a key (one link, with the note), Spotify and SoundCloud were looked up; a web page and a removed YouTube video were refused with clear messages; the YouTube video and Spotify song were saved as online items with their artwork and a cloud, and a selection with the online song offers no "Add to playlist"; the online item's page shows "YouTube · Online, needs a connection" with Play and "Open on YouTube", and the video played inside Digitify; the dialog, opened from Add, looked a pasted SoundCloud link up by itself; after a restart online items were still online and downloads offline. Not tried: YouTube, Spotify and SoundCloud API keys (none available here).

### Tracks, Videos and selections that fit (D-027, 2026-11-03)
| Feature | Status | Notes |
|---|---|---|
| Music without albums | ✅ | Each track is its own item with its own cover; tabs Tracks (every layout, sort and selection, with Play and Shuffle), Artists, Playlists, Recently played, Favorites. A library with albums is upgraded (schema 7) keeping playlists, favorites, plays and files. |
| Videos | ✅ | A category for clips and personal videos: Play from the start, no Resume or watched mark, horizontal covers by default (vertical on request). Movies & Series keeps progress and has vertical covers only. |
| Sort by duration | ✅ | "Duration: Shortest First" and "Longest First" in views that can hold music or video; items without a length come last. |
| Mass select and edit | ✅ | "Add to playlist" for tracks; "Cover…" puts one image on every selected item and changes their shape. Options appear only when every selected item supports them (decided by the core, which also refuses the rest). |
| Category order | ✅ | Everything, Music, Videos, Movies & Series, Books, Comics, Manga, Favorites, Shelves, Tags, on Home, the category strip and Big Picture. |
| Carousel | ✅ | Every cover's shape is known before it loads, so mixed shapes keep their places and sizes; quick presses on the arrows are never lost (a press that wobbles is no longer taken as a drag); the wheel moves one cover at a time; covers space by their own widths. |
| Home | ✅ | "Add to library" is a small + next to Customize Home; interface sounds are a compact toggle. |
| Carousel, second pass | ✅ | The arrows answer every press: pressing a round button moved it with its own transform, which dropped the arrow's centering and pulled it from under the pointer, so a press on its lower half was lost. The row now runs to the window's edges and fades out there instead of being cut 40 px in. |
| One cover size everywhere | ✅ | The grid uses one art height in every view, so a video, a track or a book is the same size in its category and in Everything (it used to depend on the category's usual shape). |
| Opening and closing a video | ✅ | The player opens behind a curtain with the item's artwork (its blurred background and cover) that fades in over the library and lifts on the first frame; closing brings it back before returning. No more black gap while mpv starts. |
| Menu music | ✅ | Switched on and off with a toggle next to interface sounds on Home (and in Settings › Sound), not played or paused: the capsule has no play/pause for it, and with it off says "No music playing". Ctrl+P plays or pauses library music only. |
- **Tested, second pass** (`check-r10`): five real mouse presses on the lower half of the carousel's arrow moved five covers; the row spans the whole window (0 to 1360 of 1360) with faded edges; a clip is 427×240 in both Videos and Everything, a track 240×240; opening a clip, the curtain showed and then lifted once it played, and came back while closing; with the menu music off the capsule says "No music playing" with no volume, Ctrl+P leaves it off, and it comes back on from the toggle.
- **Tested** (`check-d027`, on a copy of a library with an album): categories in the new order; the 3-track album became 3 items, 6 tracks for 6 items; a playlist made before the upgrade kept its tracks in order, now showing their album; favorites kept; sorted by duration 6 s, 6 s, 12 s… with the untimed track last either way; a clip without a year imported into Videos with a horizontal cover and only Play; five songs offer "Add to playlist", with a clip added they don't, and the core refuses it; one image on two tracks; a clip moved to Movies & Series loses its horizontal cover and can't get it back; three quick clicks on the carousel arrow move three covers, and a wobbly press on the other arrow still moves one; Play on a track plays it and turns into Pause; Home has the + (with the import menu) and a 44 px sounds toggle, and Everything comes first; Big Picture lists Everything, Music, Videos, Movies & Series, Books, Comics, Manga, Favorites. After a restart nothing changed and nothing migrated twice.

### Fixes and additions after Big Picture (D-026, 2026-10-31)
- **Big Picture:** the selection reaches everything on screen, the top bar's corner included (it used to jump back to the content); in cursor mode A clicks the control under the cursor (it clicked nothing, or the icon inside a button). Tiles are exactly as wide as their cover, so the art is never stretched or cropped differently from the rest of the app, and selecting one only adds a ring and a small lift. Item pages show the cover whole in its own shape.
- **"Resumed at… Start over"** sits above the player's controls instead of on them.
- **CDs stay round:** shelf covers are sized by width, so a crowded shelf shrinks them whole.
- **Cover colors:** an item without artwork gets a "Cover color" choice on its page.
- **Layout transitions:** the new layout draws complete in its first frame (it used to appear a moment late, so covers popped in), and only the covers in view move (ones scrolled out of sight flew over the toolbar); the old and new pictures blend while each cover moves.
- **Title bar:** Home, Library and Search.
- **Settings:** "Digitify is free and open source." at the end.
- **Discs on Home:** a "Discs" section (it can be moved or hidden like the others) says what a disc drive can do even when none is connected, and which drives are ready or have a disc when there are some; "Add" also has "From a disc (CD, DVD, Blu-ray)…".
- **Featured today** has its own badge (an award ribbon), no longer the smart shelves' sparkle.
- **Title bar:** Home and Library (the search box is next to them, so no separate Search button).
- **Big Picture Home:** "Continue" sits under the categories, with smaller covers (190 px) than the other rows; the first category is selected on arrival.
- **Collections** of a category sit under the toolbar, above its items.
- **Add music** lists the library's tracks as soon as it opens (it stayed blank until something was typed).
- **Big Picture's cursor over the player and readers** works every control: buttons, menus (they open on a press), the position bar (A jumps there) and sliders like the volume.
- **Music lists** end with a margin above the window's edge instead of running into it.
- **The installer:** `npm run installer` builds and copies it to the project's `installer` folder (`installer\Digitify_0.1.0_x64-setup.exe`).
- **In Big Picture, over a reader or the player:** no window or full-screen buttons (the app is already full screen), and the cursor hides with the bars when it's left alone; moving it or pressing a button brings it back.
- **CDs without artwork** show only their color, no title or icon on the disc.
- **No cut glow:** collection tiles have room for their lift and glow.
- **Category buttons** sit at the same height on every page (library pages, Shelves, Tags, Music).
- **Home's default order:** Discs, Library sections, Featured today, Favorites, Your shelves, Continue watching, Pick up where you left off, Recently opened, Recently added, Statistics (a Home still in the old default moves to it).
- **Cards line up:** every card keeps a line for its year, and rows align at the top, so a card with a year isn't higher than one without.
- **Big Picture, steadier:** the selection is drawn with a class (it no longer vanishes when the window loses focus) and comes back if the selected element goes away; picking Home, Library or Search (or a category tab) keeps the selection there; the right stick scrolls the page (and the selected row sideways) quickly; the music playing sits in the top bar next to Search.
- **Big Picture cursor:** the mouse moves the round cursor (the system pointer is hidden inside the window); readers and the player opened from Big Picture always show it: the left stick points, A clicks, the D-pad and bumpers turn pages or seek, X plays or pauses, Y subtitles, View mutes, B closes.
- **Big Picture cursor mode** is cursor only: the D-pad and stick don't move a selection, nothing is selected for you, and A clicks what the cursor points at (in the menu too).
- **Tested** (`e2e-bigpicture`): up from the content reaches "Home", right reaches "Exit Big Picture", left "Menu", down returns to the content; the cursor over "Movies & Series" plus A opens it; a selected tile is 180 wide with 180×270 art; "Start over" sits 38 px above the controls; CDs on a shelf measure 123×123; a layout change names the 8 covers in view of 17, draws the grid at once and clears the names after; the title bar's Library opens Everything and Search focuses the search box; a coral cover color shows on an album without art; the credit is in Settings.

### Big Picture and this round's requests (D-025, 2026-10-31)
| Feature | Status | Notes |
|---|---|---|
| Big Picture | 🟡 | Full-screen TV interface: Home, library by category (LB/RB), item pages, search with an on-screen keyboard, the music bar, and a menu (selection or cursor, cursor speed, exit). Enter with the title bar's controller button or the Xbox / PS button (or Start + Select). Tested with simulated controller buttons; needs trying with a real Xbox and PlayStation controller. |
| Controller in readers and the player | 🟡 | From Big Picture: ←/→ turn pages, LB/RB previous/next page, LT/RT zoom, Y bookmark, B closes; in the player A play/pause, ←/→ 5 s, LB/RB 30 s, ↑/↓ volume, X subtitles, Y mute, RT next episode, B closes. They stay full screen. |
| Watch again | ✅ | At the end of a video the play button becomes "Watch again" and starts it from the beginning. |
| Covers of one height | ✅ | Horizontal videos are as tall as vertical covers next to them: the grid lays out rows of one height (each cover as wide as its shape), and Home's rows, the shelf, the detailed view and the carousel do the same. |
| Carousel with CDs and horizontal covers | ✅ | Fixed: round CD covers were taken out of the carousel's layout and drawn in the wrong place. Wide covers now push their neighbours out. |
| A track once per playlist | ✅ | Adding a track that's already there does nothing; repeats from before are removed (schema v6). "Add to playlist" shows a checkmark on playlists that have the track, and picking one asks to remove it or keep it; "Add music" shows them ticked and asks the same. |
| Layout transition | ✅ | Switching grid, shelf, list, detailed and carousel moves each cover from its old place to its new one (not with animations off). |
| Midnight | ✅ | No Theme setting and no light/night switch on Home, since Midnight is only dark. |
| Settings | ✅ | Centered in the window. |

**Tested** (`e2e-bigpicture`, with simulated controller buttons): the Xbox button opens Big Picture full screen with "Books" selected; right, down and up move the selection; A opens Comics, RB goes to Manga and LB back; A on a comic opens its page with "Read" selected, A reads, RB turns to page 2 while staying full screen, B returns. Y opens search and the on-screen keyboard types "night" (5 results), X deletes. Start opens the menu; cursor mode shows the cursor; "Exit Big Picture" leaves full screen. A playlist made with a repeat holds the track once, adding it again does nothing, "Add to playlist" shows "Once [in]", picking it asks, and "Remove from playlist" empties it. The carousel's CDs and horizontal covers sit in place; a layout change runs a view transition over 17 named covers; the mixed grid is 240 px tall throughout. At the end of the film the button reads "Watch again" and replays from 0:00. Midnight hides the switch and the Theme setting; Settings are centered. `cargo test`: 53 unit tests.

### Views that stay put, custom order and cover shapes (D-024, 2026-10-31)
| Feature | Status | Notes |
|---|---|---|
| Same view everywhere | ✅ | The layout and the copies filter are remembered and shared by every category (or kept per category: Settings › Appearance › "Same view in every category"). |
| Remembered sorts | ✅ | Each view keeps its sort. |
| Custom order | ✅ | "Custom order" in the sort menu, then "Arrange…": drag items by their handle (the list scrolls by itself near its edges), send one to the top or bottom, or start from Title, Recently added, Year or Creator. Kept per view; new items go after the arranged ones. A hand-made shelf's "Shelf order" is arranged the same way. |
| Dragging to reorder | ✅ | Home's sections (as a list in Customize Home), categories and custom fields (Settings › Categories), playlist tracks and the custom order. Arrows still work. |
| Playlists | ✅ | A menu on each playlist (Play, Add music…, Edit tracks, Rename, Delete). "Add music" searches every track by title, artist, album or genre; "Pick all" picks the ones shown; tracks already in the playlist are marked. |
| Music tab | ✅ | The music category opens on the tab used last (Albums, Artists, Tracks, Playlists, Recently played, Favorites). |
| Cover shapes | ✅ | Albums: square or round CD (with a center hole and shine). Videos: vertical or horizontal (wider cards in the grid). A default in Settings › Appearance, and per item on its page ("Cover: Square / CD", "Vertical / Horizontal"). Every view follows: grid, shelf, list, detailed, carousel, Home and the item page. |

**Tested** (`e2e-customize`): List and Digital chosen in Books show in Comics and Movies; per category, Books on Shelf leaves Comics on Grid. Books sorted by Year stays so while Comics keeps Title. Custom order: the first book dragged to third and the fourth sent to the top give "The Night Ferry, The Clockmaker's Garden, The Lighthouse at Brightwater, The Cartographer's Notebook, Sample Scanned Book", also after a restart. Statistics dragged to the top of Home and Movies & Series to the top of the categories are saved. The music category reopens on Tracks; "Add music…" from a playlist's menu adds 5 tracks found by "tone", and dragging the first to third is saved. With CDs and horizontal videos the cards are round and 256 × 144; one film set to Vertical shows as a poster. `cargo test`: 52 unit tests, with custom order per view, shelf order and cover shapes.

### Smoother playback (2026-10-31)
- **Seeking in the video player** was sometimes slow or ignored and needed several clicks. The position bar is now Digitify's own: a click lands on the exact frame, a drag previews as it goes and lands where it's let go, and the bar stays at the target until mpv gets there instead of jumping back. Hovering shows the time (and chapter) under the pointer. ←/→ now move exactly 5 s (they jumped by keyframes, so a long gap between keyframes could swallow the step). mpv keeps up to 150 MB ahead and 100 MB behind in memory, so jumping back and forth nearby doesn't reread the disk, and a spinner shows if a jump or the disk takes a moment.
- **Fewer redraws:** mpv reports the position on every frame; the UI now gets it ten times a second (and at once after a jump), for both the video and the music player.
- The music player's "Now playing" uses the same position bar.

### How Phase 5 was tested (2026-10-31)
- `cargo test`: 51 unit tests pass. The new ones cover smart-shelf rules (each kind of rule, all or any, an order with a limit, values bound rather than pasted into SQL, LIKE's own characters, rules that don't fit refused, stored rules that stopped fitting matching nothing) and recorded time (adding up per day and kind, a cap per report, unknown items and kinds).
- Seeking (`e2e-seek`), on a 3-minute video with a keyframe only every 12 seconds: a click at 50% and at 25% lands at 1:30 and 0:45 by mpv's own position (45.04 s) within about a quarter of a second, and the bar is at the target the moment it's clicked. A drag from 25% to 80% lands at 2:24; three quick clicks land on the last one (2:42); ←, Home and the player's → move exactly. Pointing at 75% shows "2:15".
- Phase 5 (`e2e-phase5`), on a fresh library:
  1. Home shows "Featured today" (the same pick on every call that day). Recorded time shows in Statistics ("Reading this month 20 min", today's bar and tooltip). Customizing hides "Recently added" and moves Statistics up; the order is saved.
  2. Keyboard: Ctrl+K is added to "Search the library" and focuses the search; Ctrl+P asks to move from "Play or pause the music", which is left with no key; the ambient music isn't paused by the keys being recorded. "Reset all" empties the changes.
  3. Cinematic switches the fonts and the accent to amber and back; Sunset brings coral; Midnight forces dark and disables the theme buttons; High contrast. Screenshots of each in light and night.
  4. The four shelf materials in light and night, with covers and spines; picking one closes the menu.
  5. Detailed rows show facts, ownership and descriptions. The carousel moves with →, a click on the next cover, a drag (3 → 9 of 17) and opens the front cover with Enter.
  6. A smart shelf "Comics not started" (progress not started, kind comics) counts 6 live, lists them, can't be added to by hand, and opens again in "Edit rules…"; a year of "soon" is refused.
  7. Playing a film for 36 seconds adds 38 s of watching; reading a comic for 36 seconds adds 36 s of reading.
- **Found and fixed while testing:** a key being recorded in Settings could also trigger the shortcut it already had; the search box always said "Ctrl F".

## Product features by phase
| Area | Status |
|---|---|
| Core library (Phase 1) | ✅ See above |
| PDF, image and comic reader | ✅ Phase 2 |
| EPUB reader | ✅ Phase 2: EPUB, MOBI, AZW3 and FB2 |
| Video player | ✅ Phase 3 |
| Music player and playlists | ✅ Phase 3 |
| Optical drives, audio CD, DVD/Blu-ray | 🟡 Phase 4: built, waiting for a real drive |
| Advanced personalization | ✅ Phase 5 |
| DRM circumvention | ⛔ D-007 |

## Known limitations
- **Protected discs:** most commercial DVDs (CSS) and virtually all commercial Blu-rays (AACS/BD+) can be detected and cataloged but not played or imported (D-007).
- **Disc menus:** DVD and Blu-ray menus aren't shown; titles and chapters are picked in Digitify (D-022). Discs whose main feature is split by a menu-driven playlist may need the right title picked by length.
- **CD verification:** reading twice can't catch an error a drive repeats the same way every time; AccurateRip (online) isn't used (D-022).
- **Disc titles and CD names:** offline only: CD-Text, volume labels, or what you type.
- **Password-protected PDFs:** they can't be opened; the reader says so.
- **MOBI/AZW3/FB2 details at import:** they import with the title from the file name and no cover; their own title, author and cover show only inside the reader.
- **Ebook fonts:** "Serif" and "Sans" use Windows' own Georgia and Segoe UI. Fixed-layout EPUBs ignore text settings.
- **Website links in books:** Digitify doesn't open them (no network use, D-008); it shows the address to copy.
- **Encrypted comic archives:** password-protected RAR, 7z or ZIP archives can't be opened.
- **Solid RAR and 7z archives:** reading page by page means unpacking the pages before it, so late pages of large solid archives take longer. Most CBR files aren't solid.
- **Partial album imports:** importing an album whose tracks are partly in the library adds the new tracks as a separate item. Merging into the existing album is not built yet.
- **Window snap layouts:** with the custom title bar, the Windows 11 snap-layout flyout on the maximize button is not available. Win+Z and dragging to screen edges still work.
- **Page curl:** only in the page reader (D-021): ebook pages are live HTML laid out by foliate-js. A wide page or the cover alone in two-page mode slides instead of turning.
- **Chapters in image folders:** importing a folder still makes one item per folder of images, so a volume whose chapters are separate folders becomes several items. "Book from images…" can join them into one book, and its chapters then follow the folders.
- **DRM-protected ebooks:** Kindle, Adobe, Readium LCP and Apple DRM ebooks can't be opened; the reader says why (D-007).
- **HEIC photos:** need Microsoft's HEIF extension, or conversion at import.
- **Episodes without a marker:** a video only joins a series when its name has "S01E02" or "1x02". Files named "Episode 3.mkv" import as separate films; their titles can be fixed by hand.
- **Track artists in older imports:** albums imported before Phase 3 don't have per-track artists, so compilations show the album artist until re-imported or edited.
- **Video in screenshots:** the picture is drawn by mpv under the window, so it doesn't appear in captures made by the WebView itself (Windows' own screenshots show it).
- **Disc testing:** the development PC has no optical drive yet.
- **Windows 10:** best effort only.
- **Ripping legality:** whether ripping your own CDs is legal varies by country.
- **Ambient music formats:** your own music can be MP3, AAC/M4A, FLAC, Ogg Vorbis, Opus, WAV or WebM audio. Other formats (WMA, ALAC, APE) are skipped.
- **Interface sounds:** hover sounds respond to the mouse only, not touch or pen.
- **Folder names with apostrophes:** the Windows resource compiler cannot handle an apostrophe in the project path. `src-tauri/build.rs` works around it.

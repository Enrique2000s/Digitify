# Feature status

**Updated:** 2026-10-31 · **Current phase:** 1 (core library), feature-complete; waiting for the owner's check with real files

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

## Phase 2: readers (in progress)
| Feature | Status | Notes |
|---|---|---|
| Page reader | ✅ | Opens comic archives (CBZ, CBR, CB7, CBT), folders of page images and PDFs. Modes: one page, two pages and a continuous scroll. In two-page mode the cover stands alone and wide pages stand alone. |
| Reading direction | ✅ | Right to left for manga (from the item or its category). It can be switched in the reader and is remembered for the item. |
| Fit, zoom and pan | ✅ | Fit page or fit width, zoom from 100% to 400% (buttons, + and −, or Ctrl+wheel), and drag to pan. |
| Turning pages | ✅ | Arrow keys (they follow the reading direction), Page Up/Down, Space, Home/End, the mouse wheel, clicking either side, or the page slider. |
| Page transitions | 🟡 | Slide and fade (none with reduced motion). The 3D turn and page curl are still to come. |
| Progress and resume | ✅ | Saved as you read and when you close the reader; just opening a book doesn't change it. Shown as "Continue reading · 83%" on the item, on cards, and in "Pick up where you left off". |
| Recently opened | ✅ | A row on Home. |
| Page serving | ✅ | `/page/<copy>/<page>?w=<width>`: large pages are scaled down to the width shown (in 400 px steps) and the latest 128 MB are cached. PDF pages are rendered by PDFium. |
| Full screen and window | ✅ | Full screen (F or the button). The reader's controls hide after a moment and come back when the mouse moves. |
| Music while reading | ✅ | Ambient music pauses while the reader is open ("Pause while reading" in Settings › Sound, on by default). |
| EPUB, MOBI, AZW3, FB2 | ⬜ | The reader explains that ebooks come next (foliate-js, D-014). |
| CBR, CB7, CBT | ✅ | D-017: RAR through RARLAB's UnRAR code, 7z read-only, TAR. Archives are recognized by their contents, so a RAR named `.cbz` still opens. At import they get a cover from their first page, a page count and their ComicInfo.xml, like CBZ. |
| Bookmarks, night mode, brightness, backgrounds | ⬜ | |
| Series navigation, image-set book builder | ⬜ | |

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
  6. An EPUB is refused with an explanation.
  7. A PDF imported before PDFium was added got its cover and page count from the background task.
- **Found and fixed while testing:**
  - The sample PDF generator wrote a broken cross-reference table.
  - Closing the reader could remount it for a moment and save page 1 over your progress. Two fixes: the full-window decision now follows the route being shown, not the address, and the reader no longer saves progress unless you moved.

## Product features by phase
| Area | Status |
|---|---|
| Core library (Phase 1) | 🔄 See above |
| PDF, image and comic reader | 🔄 Phase 2: page reader done (CBZ, CBR, CB7, CBT, images, PDF); transitions and tools to come |
| EPUB reader | ⬜ Phase 2 |
| Video player | ⬜ Phase 3 (embedding proven) |
| Music player and playlists | ⬜ Phase 3 |
| Optical drives, audio CD, DVD/Blu-ray | ⬜ Phase 4 |
| Advanced personalization | ⬜ Phase 5 |
| DRM circumvention | ⛔ D-007 |

## Known limitations
- **Protected discs:** most commercial DVDs (CSS) and virtually all commercial Blu-rays (AACS/BD+) can be detected and cataloged but not played or imported (D-007).
- **Disc playback engine:** the bundled mpv has no disc modules, so Phase 4 will use Digitify's own disc layer (see ARCHITECTURE.md).
- **Password-protected PDFs:** they can't be opened; the reader says so.
- **Other ebook formats:** MOBI/AZW3/FB2 import without embedded metadata and can't be read yet; they arrive with the ebook reader later in Phase 2.
- **Encrypted comic archives:** password-protected RAR, 7z or ZIP archives can't be opened.
- **Solid RAR and 7z archives:** reading page by page means unpacking the pages before it, so late pages of large solid archives take longer. Most CBR files aren't solid.
- **Partial album imports:** importing an album whose tracks are partly in the library adds the new tracks as a separate item. Merging into the existing album is not built yet.
- **Window snap layouts:** with the custom title bar, the Windows 11 snap-layout flyout on the maximize button is not available. Win+Z and dragging to screen edges still work.
- **Page curl:** realistic page curl will be limited to fixed-layout pages (Phase 2).
- **DRM-protected ebooks:** Kindle and Adobe DRM ebooks cannot be opened.
- **HEIC photos:** need Microsoft's HEIF extension, or conversion at import.
- **Disc testing:** the development PC has no optical drive yet.
- **Windows 10:** best effort only.
- **Ripping legality:** whether ripping your own CDs is legal varies by country.
- **Ambient music formats:** your own music can be MP3, AAC/M4A, FLAC, Ogg Vorbis, Opus, WAV or WebM audio. Other formats (WMA, ALAC, APE) are skipped.
- **Interface sounds:** hover sounds respond to the mouse only, not touch or pen.
- **Folder names with apostrophes:** the Windows resource compiler cannot handle an apostrophe in the project path. `src-tauri/build.rs` works around it.

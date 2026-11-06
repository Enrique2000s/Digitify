# Roadmap

Legend: ✅ done and tested · 🔄 in progress · ⬜ not started

Each phase ends with a runnable build and updated docs. No dates are given; each milestone has exit criteria instead. Scope changes go through [DECISIONS.md](DECISIONS.md).

---

## Phase 0 — Foundations and risk spikes (done)
- ✅ Development environment: Node.js LTS, Rust stable, Visual Studio C++ tools, WebView2
- ✅ Repository and living docs
- ✅ Visual concepts canvas published; **Cinematic** chosen first (D-015), later replaced by **Breeze** (D-016)
- ✅ Tauri 2 + React + TypeScript scaffold with logging, building to an `.exe`
- ✅ Helper engines (mpv, FFmpeg) fetched, pinned and verified free of DRM-circumvention code
- ✅ **PoC 1:** mpv video underneath the web UI with floating, translucent React controls (passed; see STATUS.md)
- ✅ **PoC 2:** a 50,000-item library staying smooth at 144 fps with 5 ms page queries (passed; see STATUS.md)

**Exit criteria:** both proofs-of-concept pass, and a visual direction is chosen (both done).

## Phase 1 — Core library (feature-complete; waiting for the owner's check with real files)
1. **Shell:**
   - ✅ Custom title bar, navigation, design tokens (light/dark, accent color, motion), persistent settings, first-run library-folder setup
   - ✅ Breeze identity (D-016): every screen restyled, home category tiles, a section strip on library pages in place of the sidebar, ambient music (original "Morning Lounge" or your own music), interface sounds
   - ✅ Customizable navigation: hide and reorder categories (Home tiles and section pills)
2. **Data layer:**
   - ✅ Schema v1 + v2, migrations (automatic backup before upgrades), backup and restore
3. **Import:**
   - ✅ Files and folders, Reference or Copy, background job with progress, metadata (audio, EPUB, ComicInfo, video), artwork, duplicate detection, missing-file detection, relinking moved files
   - 🟡 Drag and drop (needs manual testing)
   - ⬜ PDF metadata (Phase 2)
4. **Library views:**
   - ✅ Grid, List and Shelf (covers/spines), detail page with the physical/digital copies editor, add files to an item, catalog physical items, search, sort, ownership filters, favorites, dashboard v1
   - ✅ Tags, shelves (your own lists), nested collections with move, multi-select with bulk edits
   - ➡️ Recently opened moves to Phase 2 (it needs readers)
5. **Categories:**
   - ✅ Five built-in categories
   - ✅ Create, edit, hide and reorder categories, with custom fields

6. **Release engineering:**
   - ✅ NSIS installer (per-user): installs, runs from its own folder, uninstalls cleanly while keeping user data
   - ✅ Third-party notices

**Exit criteria:** the owner's real files import and browse end to end, and an installer build works.

## Phase 2 — Readers (done)
1. **Page engine:**
   - ✅ PDF (PDFium), CBZ, folders of page images and single images
   - ✅ CBR, CB7 and CBT archives (D-017), recognized by content whatever their extension
   - ✅ single page, two-page spreads (cover alone, wide pages alone) and a continuous vertical strip
   - ✅ left-to-right and right-to-left
   - ✅ fit page or width, zoom (up to 400%) and drag to pan, preloading
2. **Page transitions:**
   - ✅ slide and fade, off with reduced motion
   - ✅ 3D turn and a WebGL page curl that can be dragged from a corner (D-021)
3. ✅ **EPUB/MOBI/AZW3/FB2** via foliate-js (D-014):
   - one page, two facing pages or a continuous scroll
   - text size, font, line spacing, page width and justification; Paper, Sepia and Night themes
   - table of contents, a position slider, progress and resume
   - book scripts blocked, website links shown instead of opened, copy-protected books refused
4. **Reading tools:**
   - ✅ progress and resume, full screen
   - ✅ bookmarks in both readers
   - ✅ night mode, brightness and backgrounds (presets or your own color); ebooks have brightness and their Night theme
   - ✅ an image-set book builder ("Book from images…") and "Arrange pages" for existing image books
5. **Series navigation:**
   - ✅ "Pick up where you left off"
   - ✅ series and volumes ("In this series", "Next volume" at the end of a book), chapters detected from archive folders and PDF outlines or marked by hand (D-019)
6. ✅ **Recently opened** on Home.
7. ✅ **PDF details at import** (title, author, year, page count and a cover from the first page). PDFs imported earlier get their cover and page count in the background.

**Exit criteria:** every reader feature in the brief works on the owner's files (waiting for the owner's check).

## Phase 3 — Media playback (done)
1. ✅ **Video player:** controls, subtitles (embedded, files next to the video, or a file you pick), audio tracks, chapters, speed, resume, watched state and fullscreen.
2. ✅ **Series organization (D-018):** one item per series with seasons and episodes, grouped at import; posters (artwork) and backgrounds; "Continue watching" and the next episode.
3. ✅ **Music (D-020):**
   - artists, albums and tracks, with search by track, artist, album or genre
   - queue, gapless playback (mpv), shuffle and repeat
   - playlists, favorite tracks and recently played
   - the mini-player in the title-bar capsule, "Now playing", and editing a track's details

**Exit criteria:** the owner's films, series and music play end to end (waiting for the owner's check).

## Phase 4 — Physical media (built; waiting for a real drive to validate)
Built on Digitify's own disc layer (D-022) and tested with simulated drives; drive I/O itself needs a real drive.
1. ✅ **Drive service:** enumeration, insert/eject (checked every 2 seconds, with a notice), media type, protection detection (CSS, AACS, BD+), eject.
2. ✅ **Audio CD:** track listing, CD-Text, playback straight from the disc, ripping to FLAC or WAV with read-twice verification, import as an album.
3. **DVD/Blu-ray:**
   - ✅ read disc structure (titles, chapters, languages)
   - ✅ play and import (remux to MKV) unprotected discs
   - ✅ one-click cataloging of any disc, protected or not
4. ✅ **Data discs:** browse and import (copied into the library).

## Phase 5 — Advanced personalization (done)
Scope chosen by the owner in D-023.
1. ✅ **Expanded themes:** Cinematic as an optional look; Breeze palettes Sky, Sunset, Midnight and High contrast.
2. ✅ **Shelf appearance:** Wood, Glass and Dark metal besides Breeze.
3. ✅ **Custom dashboard:** Home's sections reordered and hidden; Featured today; Statistics (with recorded reading, watching and listening time).
4. ✅ **More layouts:** Detailed and Carousel, besides Grid, Shelf and List.
5. ✅ **Advanced organization:** smart shelves that fill themselves from rules (removed with shelves in D-029; collections and tags remain).
6. ✅ **Keyboard-shortcut editor.**
7. ✅ Backup and restore, custom categories and fields were already done in Phase 1.

## Library refinements (D-027)
1. ✅ Music without albums (each track an item), Videos apart from Movies & Series, sort by duration, mass edit of covers, "Add to playlist" for selections, actions that fit the whole selection, the new category order, carousel fixes, Home's + button.
3. ✅ One item per file, no shelves, physical copies or catalog, disc formats, link sources (D-029).
4. ✅ Big Picture's own online player and full Home, collections among the items, motion everywhere, light mode (D-030).
2. ✅ Import from URL (D-028): YouTube, YouTube Music, Spotify and SoundCloud links with the services' own players; downloads only where allowed (direct file links, downloadable SoundCloud tracks); playlists through the owner's API keys; an import queue. To try: real API keys for each service.

## Release engineering (ongoing)
NSIS installer, third-party license notices, then decisions on code signing and on an update strategy.

---

## Open decisions
| Topic | When |
|---|---|
| Online metadata providers (MusicBrainz, Open Library, TMDB, ComicVine, AniList, …) | When metadata work starts; offline-only until approved |
| Optional proposals P1–P9 (Digitize Studio, generated covers/spines, collector tools, smart collections, watch folders, Windows integration, reading/listening extras, licensed-player handoff, importers) | Any time. Smart collections arrived as smart shelves (D-023); the rest are not approved yet |
| Code signing | Before the first public build |

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

## Phase 2 — Readers (current)
1. **Page engine:**
   - ✅ PDF (PDFium), CBZ, folders of page images and single images
   - ✅ CBR, CB7 and CBT archives (D-017), recognized by content whatever their extension
   - ✅ single page, two-page spreads (cover alone, wide pages alone) and a continuous vertical strip
   - ✅ left-to-right and right-to-left
   - ✅ fit page or width, zoom (up to 400%) and drag to pan, preloading
2. **Page transitions:**
   - ✅ slide and fade, off with reduced motion
   - ⬜ 3D turn and realistic curl
3. ✅ **EPUB/MOBI/AZW3/FB2** via foliate-js (D-014):
   - one page, two facing pages or a continuous scroll
   - text size, font, line spacing, page width and justification; Paper, Sepia and Night themes
   - table of contents, a position slider, progress and resume
   - book scripts blocked, website links shown instead of opened, copy-protected books refused
4. **Reading tools:**
   - ✅ progress and resume, full screen
   - ⬜ bookmarks
   - ⬜ night mode, brightness and backgrounds for the page reader (pages sit on a dark backdrop; ebooks already have a Night theme)
   - ⬜ an image-set book builder that orders photos into one item
5. **Series navigation:**
   - ✅ "Pick up where you left off"
   - ⬜ series, volumes and chapters
6. ✅ **Recently opened** on Home.
7. ✅ **PDF details at import** (title, author, year, page count and a cover from the first page). PDFs imported earlier get their cover and page count in the background.

## Phase 3 — Media playback
1. **Video player:** controls, subtitles (embedded and external), audio tracks, chapters, speed, resume, watched state and fullscreen.
2. **Series organization:** series and season organization, posters and backgrounds, "continue watching".
3. **Music:**
   - artists, albums and tracks
   - queue, gapless playback, shuffle and repeat
   - playlists, favorites and recently played
   - mini-player and metadata editing

## Phase 4 — Physical media (a drive is needed to validate)
1. **Drive service:** enumeration, insert/eject events, media type, protection detection.
2. **Audio CD:** track listing, CD-Text, playback, ripping (FLAC/WAV with verification), import as an album.
3. **DVD/Blu-ray:**
   - read disc structure (titles, chapters, languages)
   - play and import (remux) unprotected discs
   - one-click cataloging of any disc, protected or not
4. **Data discs:** browse and import.

## Phase 5 — Advanced personalization
Expanded themes, shelf appearance and custom shelves, custom dashboard widgets, more layouts, advanced metadata and organization, and a keyboard-shortcut editor.

## Release engineering (ongoing)
NSIS installer, third-party license notices, then decisions on code signing and on an update strategy.

---

## Open decisions
| Topic | When |
|---|---|
| Online metadata providers (MusicBrainz, Open Library, TMDB, ComicVine, AniList, …) | When metadata work starts; offline-only until approved |
| Optional proposals P1–P9 (Digitize Studio, generated covers/spines, collector tools, smart collections, watch folders, Windows integration, reading/listening extras, licensed-player handoff, importers) | Any time; none approved yet |
| How unprotected discs are played (the bundled official mpv 0.41 build has no DVD/Blu-ray/CD modules; see ARCHITECTURE.md › Helper engines) | Start of Phase 4 |
| Code signing | Before the first public build |

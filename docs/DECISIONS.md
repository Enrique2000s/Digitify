# Decision log

Every product or architecture decision is recorded here with its reason. Anything not listed is either an internal implementation detail or still open (see **Open decisions** in [ROADMAP.md](ROADMAP.md)). New features and design changes are proposed first and only recorded here once the project owner approves them.

---

### D-001 · Platform and stack
- **Date:** 2026-10-30 · **Approved by:** project owner
- **Decision:** Tauri 2 desktop shell with a Rust core, a React + TypeScript UI (built with Vite) and a SQLite database.
- **Why:** Rust suits the native work: drive I/O, CD ripping, fingerprinting large files, archives, PDF rendering and background jobs. WebView2 (the Chromium/Edge engine) gives full design freedom and the best reader libraries. The footprint is small and capabilities are permission-based.
- **Alternatives considered:**
  - Electron: heavier, and native add-ons are still needed.
  - .NET WinUI 3 / WPF: custom visuals are much slower to build, and EPUB still needs a WebView.
  - Flutter + media_kit: weak reader ecosystem.

### D-002 · Media engines run as separate helper programs
- **Date:** 2026-10-30 · **Approved by:** project owner
- **Decision:**
  - **mpv** handles video, music and disc playback.
  - **FFmpeg** (LGPL build) handles probing, thumbnails, encoding and remuxing.
  - Both run as separate processes controlled over IPC/pipes, never linked into Digitify.
- **Why:**
  - Format coverage: MKV/AVI/HEVC/AV1, AC3/DTS, ASS/PGS subtitles, chapters, audio tracks, unprotected DVD/Blu-ray titles and CD audio.
  - A crash in a helper engine can't take Digitify down.
  - Licensing stays flexible.
- **Risk:** showing mpv's native video under the web UI. Proof-of-concept 1 in Phase 0 validates this.

### D-003 · Distribution model: undecided, all options kept open
- **Date:** 2026-10-30 · **Approved by:** project owner
- **Decision:**
  - No GPL code is linked into Digitify. GPL tools ship only as separate executables, with their license and a source offer.
  - Core features avoid services that are free only for non-commercial use.

### D-004 · Organization model
- **Date:** 2026-10-30 · **Approved by:** project owner
- **Decision:**
  - Every item has exactly one home: a category, optionally inside a collection tree of any depth. Moving an item always has one clear meaning.
  - An item can also sit on any number of **shelves** (many-to-many, like playlists) and carry **tags**.

### D-005 · Core data model
- **Date:** 2026-10-30 · **Approved by:** project owner
- **Decision:** `Category → Collection tree → Item (the work) → Versions (physical or digital) → Files`.
  - Optional **Parts** (chapters, episodes, tracks) each carry their own progress.
  - A physical-only item is simply an item with no digital version.
  - Physical versions record format, edition, condition and storage location.

### D-006 · Roadmap adjustments
- **Date:** 2026-10-30 · **Approved by:** project owner
- **Decision:**
  - Added **Phase 0**: scaffold plus two proofs-of-concept (mpv video under the web UI, and a 50,000-item library staying smooth).
  - Moved the physical/digital data model and basic physical cataloging into Phase 1. Only disc-hardware work stays in Phase 4.
  - Moved backup/restore into Phase 1.
  - A first Shelf view ships in Phase 1. Deep shelf customization stays in Phase 5.

### D-007 · DRM policy
- **Date:** 2026-10-30 · **Source:** project brief (non-negotiable)
- **Decision:**
  - Digitify never circumvents DRM. No CSS/AACS/BD+ decryption library or key is bundled, downloaded or loaded.
  - Bundled engine builds are checked to contain no such library (enforced by `scripts/fetch-deps.ps1`).
  - Discs are checked for CSS/AACS before playback or import. Protected content is declined with a clear explanation and never handed to an engine.
  - **Supported:** unprotected DVDs/Blu-rays (home-made, camcorder), data discs and audio CDs. Protected discs can still be cataloged as physical items.
- **Pending:** proposal P8 ("open in a licensed player").

### D-008 · Privacy and network
- **Date:** 2026-10-30 · **Approved by:** project owner
- **Decision:**
  - Fully offline: no telemetry, no update checks and no network calls of any kind until the owner approves a specific online feature.
  - Logs stay on the local machine.

### D-009 · File safety
- **Date:** 2026-10-30 · **Approved by:** project owner
- **Decision:**
  - Metadata embedded in files is read on import. Edits are stored in Digitify's database, and files are never modified unless the user explicitly chooses an action such as "write tags to file".
  - Removing an item never touches files.
  - Deleting a copied file requires explicit confirmation and goes to the Recycle Bin.

### D-010 · Library folder
- **Date:** 2026-10-30 · **Approved by:** project owner
- **Decision:**
  - At first launch the user chooses a library folder. It holds the database, artwork cache, managed (copied) media and backups, so it is easy to back up or move.
  - Digitify warns if the folder is inside OneDrive, Dropbox or another sync folder.

### D-011 · Platform target
- **Date:** 2026-10-30 · **Approved by:** project owner
- **Decision:** Windows 11 x64 first. Windows 10 22H2 is best effort, since it is past end of support.

### D-012 · Language
- **Date:** 2026-10-30 · **Approved by:** project owner
- **Decision:** English UI, built translation-ready. Spanish can be added as a second language later.

### D-013 · PDF rendering
- **Date:** 2026-10-30 · **Approved by:** project owner (part of the approved stack)
- **Decision:** PDFium runs in the Rust core and renders pages for one shared page engine that also handles image sets and comic archives. PDF.js was considered and not chosen.

### D-014 · Reflowable ebooks
- **Date:** 2026-10-30 · **Approved by:** project owner (part of the approved stack)
- **Decision:** foliate-js (MIT, vendored at a pinned commit) handles EPUB, MOBI, AZW3 and FB2.
- **Built (2026-10-31):**
  - Vendored from commit `78914aef4466eb960965702401634c2cb348e9b1` into `src/vendor/foliate-js/`, with its `pdf.js` replaced by a stand-in so PDF.js (about 10 MB) isn't bundled. PDFs stay with PDFium (D-013).
  - Book scripts never run: chapters load in frames that inherit Digitify's Content Security Policy, which allows no inline or `blob:` scripts.
  - Copy-protected books (an `encryption.xml` that encrypts more than fonts, or a MOBI/AZW header that declares encryption) are refused with an explanation. Nothing is decrypted (D-007).

### D-024 · Views that stay put, custom order, dragging, cover shapes
- **Date:** 2026-10-31 · **Approved by:** project owner (asked for each of these)
- **Same view everywhere:** the layout (grid, shelf, list, detailed, carousel) and the copies filter (All, On the shelf, Digital, Not digitized) are shared by every view and remembered. Settings › Appearance › "Same view in every category" turns this off to keep one per category.
- **Sorts are remembered** per view. Every view (except search) also has **Custom order**: "Arrange…" lists its items to drag into place (or send to the top or bottom, or start again from another sort). The order is kept per view in a new `custom_order` table (schema v5); items added later come after the arranged ones. On a hand-made shelf, "Shelf order" is arranged the same way.
- **Dragging to reorder** wherever things can be put in order: Home's sections (Customize Home now shows them as a list), categories and their custom fields, playlist tracks and the custom order. The arrows stay for the keyboard.
- **Playlists:** each has a menu (Play, Add music…, Edit tracks, Rename, Delete); "Add music" searches the whole music library and adds the picked tracks. The music category reopens on the tab used last.
- **Cover shapes:** albums as square covers or round CDs, videos as vertical posters or horizontal frames, as a default in Settings › Appearance and per item on its page (stored in the item's `metadata.coverShape`).

### D-023 · Phase 5: what personalization includes
- **Date:** 2026-10-31 · **Approved by:** project owner (picked from bundled options; the keyboard-shortcut editor was already in the roadmap)
- **Looks and palettes:**
  - **Cinematic returns as an optional look** (D-015): charcoal glass surfaces, an amber accent, Inter with expanded Archivo headings, light and dark. It restyles the same layout; Breeze stays the default (D-016).
  - **Breeze palettes:** Sky (the original), Sunset (warm, with a coral accent), Midnight (pure black, always dark) and High contrast (black and white with strong edges, accent text at 7:1).
  - A look or palette brings its own accent unless the accent was changed by hand.
  - Not chosen: an interface font setting, a picture of your own behind Home.
- **Shelf materials** for the shelf view: Breeze (as before), Wood, Glass (with reflections) and Dark metal (a pegboard). They're drawn with CSS and an SVG noise filter for the grain; no image files. Not chosen: a material per shelf.
- **Home:** its sections can be reordered and hidden ("Customize Home"). Two new sections:
  - **Featured today:** one item with artwork, picked anew each day (unfinished items first), with its description and Read/Play.
  - **Statistics:** time spent reading, watching and listening this month and year, the last 14 days, what was finished, the most played artists and the library's make-up. Time is recorded while a reader is open and in use (it stops after 5 minutes without a page turn or input) or while a video or music plays, in a new `activity` table (schema v4). It never leaves the library.
  - Not chosen: a row of any shelf, tag or collection; a "recent music" section.
- **Layouts:** a **Detailed** view (the brief's "large artwork, description and metadata") and a **Carousel** view (covers in a 3D row).
- **Smart shelves:** shelves that fill themselves from rules (category, kind of media, tags, year, creator, title, format, progress, favorite, copies, added or last opened within some days), matching all or any, with an order and an optional "only the first N". The rules live in the shelf's `settings`; the shelves table didn't change. Not chosen: a personal status and star rating.
- **Keyboard shortcuts:** every shortcut is listed in Settings › Keyboard by where it works (everywhere, library views, readers, video player). Keys can be added, removed and reset; a key already in use asks before it moves. New everywhere-shortcuts: Home (Alt+Home), Settings (Ctrl+,), and the music's play/pause (Ctrl+P), next and previous (Ctrl+Shift+→/←).

### D-022 · Optical discs: Digitify's own disc layer
- **Date:** 2026-10-31 · **Approved by:** project owner (chose the own disc layer over an mpv build with libdvdnav/libbluray; offline-only ripping and titles)
- **Decision:**
  - **Reading:** Digitify reads disc structure itself in Rust through Windows: the drive list and inserted media, an audio CD's table of contents and CD-Text, a DVD's titles, chapters and languages (IFO files), and a Blu-ray's playlists, clips, chapters and languages (MPLS files).
  - **Playing:** the bundled mpv plays the unencrypted streams (DVD VOB, Blu-ray M2TS); audio CDs play straight from the disc through Digitify's media server. There are no interactive disc menus: titles and chapters are picked in Digitify.
  - **Importing:** FFmpeg (already bundled) remuxes a DVD or Blu-ray title into MKV with its chapters, and encodes ripped CD audio to FLAC (or keeps WAV).
  - **CD verification:** every block of audio is read twice and compared; mismatches are re-read until two reads agree, and tracks that never agree are reported. Fully offline; no AccurateRip.
  - **CD titles:** CD-Text when the disc has it, otherwise "Track 1, Track 2…" to edit. No online lookups (D-008).
  - **Protection (D-007):** DVDs are checked for CSS (the drive's copyright descriptor, or scrambled sectors), Blu-rays for AACS/BD+ (their `AACS` and `BDSVM` folders). Protected discs are never played or imported; they can still be cataloged in one click.
- **No new dependencies**, and no GPL disc libraries.
- **Testing:** the development PC has no optical drive, so drive I/O is tested with generated disc structures and simulated sector reads until the owner tries real discs.

### D-018 · TV series: one item per series
- **Date:** 2026-10-31 · **Approved by:** project owner (chose "one item per series" over "one item per episode")
- **Decision:** a series is one library item. Its episodes are parts (`parts.kind = 'episode'`, with season and episode numbers), each with its own progress and watched mark. The grid shows one poster per series; "Continue watching" offers the next episode.
- **Import:** video files are grouped into a series by their folders and by names such as `S01E02` or `1x02`. A single film stays an item of its own.
- **Tradeoff:** an episode can't carry its own tags or shelves; the series does.

### D-019 · Chapters inside comic and manga volumes
- **Date:** 2026-10-31 · **Approved by:** project owner (chose "detect and mark" over "one item per chapter")
- **Decision:** a volume's chapters are detected from the folders inside its archive or image folder. You can also mark the page where a chapter starts, rename chapters, or remove them. Chapters appear in the page reader's contents and on the item page.
- **Series:** volumes are items of a series (the `series` field and number, or their collection), with "Next volume" at the end of a book.

### D-020 · Music player: mini-player in the title-bar capsule, played by mpv
- **Date:** 2026-10-31 · **Approved by:** project owner (chose the title-bar capsule over a bottom bar or a separate window)
- **Decision:** while library music plays, the title-bar music capsule becomes the mini-player (cover, title, pause, next) and opens "Now playing" with the queue. Ambient music pauses while your music plays.
- **Engine (engineering choice within D-002):** library music plays through a second, audio-only mpv process. mpv gives true gapless playback and reads every format FFmpeg reads (including ALAC, APE and WMA, which the WebView can't play).

### D-021 · Page transitions: 3D turn and page curl
- **Date:** 2026-10-31 · **Approved by:** project owner (chose "3D turn and curl" over "3D turn only")
- **Decision:** the page reader gains two transitions beside slide and fade: a 3D turn around the spine, and a realistic page curl drawn with WebGL that can be dragged from a page corner. Both are off with reduced motion.
- **Limit:** ebooks keep their slide: their pages are live HTML laid out by foliate-js, which can't be curled.

### D-017 · Comic archives: RAR through the UnRAR library
- **Date:** 2026-10-31 · **Approved by:** project owner (chose "unrar" over 7-Zip as a separate program)
- **Decision:**
  - **CBR (RAR):** RARLAB's official UnRAR source, compiled into Digitify through the `unrar` crate. It reads every RAR version.
  - **CB7 (7z):** `sevenz-rust2`, pure Rust (Apache-2.0), built for reading only.
  - **CBT (TAR):** the `tar` crate.
  - Archives are recognized by their contents, so a RAR named `.cbz` (or the reverse) still opens.
- **License:** the UnRAR license is free, commercial use included. Its only restriction is that the code may not be used to create RAR archives. That fits D-003 (no GPL code linked, nothing limited to non-commercial use). The license text ships in the third-party notices.
- **Alternative considered:** 7-Zip as a separate helper program. It would cover RAR, 7z and TAR with one program, but it is heavier and slower page by page.

### D-016 · Visual identity: Breeze, with ambient music (replaces D-015)
- **Date:** 2026-10-30 · **Approved by:** project owner (requested a Wii-era console-menu style; chose concept "D · Breeze" on the visual concepts canvas to **replace** Cinematic)
- **Look:** an *original* style inspired by mid-2000s console menus:
  - bright, airy and rounded, with glossy gel buttons, big category tiles and soft blue glows
  - Nunito typeface, bundled with the app
  - light by default, with a night (dark) variant
  - no Nintendo designs, logos or assets are used
- **Ambient music:** plays while browsing.
  - **Default track:** "Morning Lounge", an original piece written for Digitify and generated live with Web Audio. A fixed theme alternates with improvised passes, so nothing is downloaded or licensed.
  - **Defaults:** on, at 40% volume.
  - **Controls:** a capsule in the title bar (play/pause, mute, volume). Settings › Ambient music offers on/off, volume, the source (Digitify original or your music: files, folders, or albums from the Digitify library), shuffle, and "pause when minimized" (on by default).
  - **Ducking:** pauses automatically while Digitify plays video (and, from Phase 3, any media).
- **Name (2026-10-31, owner's request):** the original theme is shown as "Digitify Main Menu Music" (it was "Morning Lounge").
- **Interface sounds:** soft hover and press tones. On by default, with a switch in Settings.
- Cinematic could come back later as an optional theme (Phase 5), only if requested. It did, as an optional look (D-023).

### D-015 · Visual identity: Cinematic (superseded by D-016)
- **Date:** 2026-10-30 · **Approved by:** project owner (chosen from the visual concepts canvas)
- **Decision:** Concept A, "Cinematic":
  - dark-first, with a full light mode
  - deep charcoal surfaces, glassy panels, amber accent by default (the user can change it)
  - expanded Archivo display type over Inter for the interface
  - artwork-forward cards, and covers standing on dark shelves
- **Fonts:** bundled with the app (no online font loading, D-008).
- **Not included:** other concepts' elements (e.g. warm wooden shelves) are not part of the identity. They could come back later as optional shelf appearances (Phase 5 customization), only if approved.

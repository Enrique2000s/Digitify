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
- **Interface sounds:** soft hover and press tones. On by default, with a switch in Settings.
- Cinematic could come back later as an optional theme (Phase 5), only if requested.

### D-015 · Visual identity: Cinematic (superseded by D-016)
- **Date:** 2026-10-30 · **Approved by:** project owner (chosen from the visual concepts canvas)
- **Decision:** Concept A, "Cinematic":
  - dark-first, with a full light mode
  - deep charcoal surfaces, glassy panels, amber accent by default (the user can change it)
  - expanded Archivo display type over Inter for the interface
  - artwork-forward cards, and covers standing on dark shelves
- **Fonts:** bundled with the app (no online font loading, D-008).
- **Not included:** other concepts' elements (e.g. warm wooden shelves) are not part of the identity. They could come back later as optional shelf appearances (Phase 5 customization), only if approved.

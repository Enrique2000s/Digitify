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
  - Approved online feature: Import from URL (D-028), only when a link is pasted, while an import runs, and while an online item plays.
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
- **Decision:** Windows 11 x64 first. Windows 10 22H2 is best effort, since it is past end of support. Linux x64 was added in D-031.

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

### D-042 · Home's order and labels, slim featured cards; Library's own header
- **Date:** 2026-11-07 · **Approved by:** project owner (asked for this order, labels and layout)
- **Home's default order:** Discs, Library sections, Featured today, Game of the day, Favorites (Library), Favorites (Arcade), Continue watching, Continue playing, Pick up where you left off, Recently added, Recently opened (kept, after Recently added), Statistics. A Home still in an earlier default order moves to this one; one arranged by hand keeps its order, with new sections at their default places.
- **Labels:** each section says where it's from, "(Library)", "(Arcade)" or "(Library & Arcade)" for Statistics, on Home, in Customize Home and in Big Picture.
- **Featured today and Game of the day** are slim cards (a smaller cover, a two-line description, smaller buttons). Featured today can be a photo, with View opening it in the image viewer.
- **Library's header:** above the section buttons, like Arcade's: its logo (Arcade's shape, the accent's colors), "Library" and a line about it, on every page with the section buttons (the views, Music, Tags, Discs). The section buttons are Arcade's view buttons (the same segmented control and size), with each section's count. Each view's own title stays under them, a step smaller, with its plain badge (D-041's colored badge moved up to the Library logo).

### D-041 · Home with Arcade, games in the statistics, what Digitify does while a game runs, Library like Arcade
- **Date:** 2026-11-07 · **Approved by:** project owner (asked for all of it; chose low tiles, all four Arcade sections, Library laid out like Arcade, and quitting without counting play time)
- **Home:** the Library sections are low cards, up to six to a row, with Arcade among them (its covers and game count). New sections, each movable and hideable in Customize Home: Continue playing (last played games), Favorite games, and Game of the day (one game a day, like Featured today). In a game row, the cover opens the game in Arcade (`/arcade?game=<id>`) and ▶ starts it.
- **Statistics:** time played counts like reading, watching and listening: a fourth series, Playing (a magenta checked against the other three for normal and colorblind vision in light and dark), in the month and year tiles and the 14-day chart; Most played games this year; Games among Your library. Migration 16 adds `arcade_activity` (day, game, seconds), recorded when a session ends; earlier play stays in each game's total only.
- **While a game runs** (Settings › Arcade): stay open and silence the music (the default; Home's music button, the title bar's mute button and Big Picture's menu switch it back on or off for the game, and it comes back when the game ends), hide and come back after (D-035's behavior), or close Digitify completely once the game starts (it stays closed; play time isn't counted, and Settings says so).
- **Library like Arcade:** the header's badge is a colored tile like Arcade's; the toolbar runs views, filters, a "Find in this view" box, Select, Size, then Sort on the right, with Arcade's look. Nothing was removed (layouts, shelf options, Arrange and the category buttons stay). A view narrowed by Find can't be dragged into a custom order (the hidden items would lose their places).
- **Pop-in:** Arcade's games pop in like the library's items when the view, sort or search changes; Big Picture's Arcade pops a new console's games in.
- **Big Picture:** its Home has the Arcade tile and the three game sections (A plays), its statistics include games, and its menu has a Music on/off switch (during a game, for the game).

### D-040 · Store games opened through the Windows shell
- **Date:** 2026-11-07 · **Approved by:** project owner (reported Epic games opening File Explorer)
- **Fix:** on Windows a store game's link was handed to `explorer.exe`, which opens Epic's link (it has a query string: `?action=launch&silent=true`) as a folder instead, so File Explorer came up instead of the game. Links and app targets now go to the Windows shell itself (`ShellExecuteW`), which hands each to the program registered for it (Epic Games Launcher, Steam, the Xbox app). Linux still uses `xdg-open`. Web links (Online services) use the same helper.

### D-039 · Fixed categories; Epic games found; Default cover
- **Date:** 2026-11-07 · **Approved by:** project owner (asked for fixed categories; chose built-in names back, custom fields out of view and Default cover for every game)
- **Categories are fixed:** Settings › Categories only puts them in order and shows or hides them, like Arcade's views. They can't be renamed, re-iconed, created or deleted, and custom fields can't be added, so the library keeps its structure. Migration 15 gives the built-in categories their own names, icons and reading directions back; categories made earlier by the user stay, fixed. Custom fields are no longer shown, edited or searched; their values stay in each item's metadata. Supersedes the category editing of D-004 and D-005.
- **Epic games:** a main game's `MainGameAppName` is empty in Epic's manifests, which was taken for add-on content, so no Epic game was found. Fixed.
- **Launcher art:** a PC game's cover comes from its launcher: Steam's cache and the Xbox app's logos on this computer; with "Download covers", the art Epic's catalog cache (`catcache.bin`) or Heroic's library cache names, and Steam's by app id.
- **Default cover** (a game's panel and Select): puts the game's own cover back after a picture of the user's: its launcher's for PC games, Dolphin's, GameTDB's or libretro's for the others.

### D-038 · Arcade's views: their order, which show, one "All games" or two
- **Date:** 2026-11-07 · **Approved by:** project owner (asked for this order and these settings)
- **Views, in their default order:** All PC games, All ROM games, Steam, Epic Games, Xbox, Wii, GameCube, Nintendo 64, Favorites. A store's view shows only where the store exists: Epic Games and Xbox on Windows, Heroic (after Xbox) on Linux. Big Picture's tabs (LB/RB) follow the same list.
- **Settings › Arcade:** the views are put in order by dragging or with the arrows, and each can be switched off. A switch combines All PC games and All ROM games into one "All games" view, at the first of the two places; separating them again puts both back there. Off by default.
- **Saved views:** the order is kept with every view, those of the other system included, so a settings file moved between Windows and Linux keeps its order. A view saved before D-038 as "PC" opens as All PC games; a hidden or missing view falls back to the first one shown.

### D-037 · Arcade: PC store games; reordering per console; sizes; a centered grid
- **Date:** 2026-11-07 · **Approved by:** project owner (asked for these; chose Steam + Heroic on Linux, watching for the game's own program, and local art first then Steam's)
- **PC games:** installed games only, read from each store's own files: Steam (Windows and Linux: `libraryfolders.vdf`, `appmanifest_*.acf` with the fully-installed flag; its software and tools left out by the type in `appcache/appinfo.vdf`), Epic Games (Windows: the launcher's `.item` manifests, add-ons and unfinished installs left out), the Xbox app (Windows: `.GamingRoot` / `XboxGames` folders, `MicrosoftGame.config` and the package identity → `shell:AppsFolder\<family>!<app>`), Heroic Games Launcher (Linux: its Epic and GOG `installed.json`). Console `pc` (migration 14). The list follows installs and removals by itself: a light check of the stores' records every 20 seconds.
- **Starting them:** through their store (`steam://rungameid/…`, `com.epicgames.launcher://…`, `shell:AppsFolder\…`, `heroic://launch/…`). Digitify then watches for a program running from the game's install folder (its program, working folder or command line — Proton games show their Windows path there); once it's seen, Digitify hides and goes quiet and counts play time, and comes back when no program from that folder is left. A game not seen within 90 seconds leaves Digitify as it was, with a note.
- **Covers:** Steam's cached library art and the Xbox app's installed logos first; Steam's public art by app id with "Download covers"; Epic and Heroic games keep a drawn cover or a picture of the user's.
- **Taking a store game off the list** hides it (it's still installed, so a search would find it again); Emulators & folders can show the hidden ones again.
- **Custom order per console:** dragging works in any console's view (and with a search): the games shown trade places among themselves; the others keep theirs.
- **Size:** Arcade has its own cover size slider. Its grid, and the Library's grid, sit centered instead of hugging the left edge.
- **Select** shows whenever a view holds anything to select, collections included (also in the Collections filter); Ctrl+A selects the collections too.

### D-036 · Collections: selected, placed and deleted like items
- **Date:** 2026-11-07 · **Approved by:** project owner (asked for it; chose deleting a collection to keep what's inside, and collections anywhere among the items in a custom order)
- **Selecting:** in every view, a collection among the items can be selected like an item (click, Shift+click ranges, Select all). Item-only actions (tags, edit, cover, playlist) apply to the selected items; Move moves collections too (inside another collection of their category, or to its top); Remove deletes the selected collections — their items and collections move up one level, nothing leaves the library — and removes the selected items as before, with one confirmation.
- **Custom order:** a collection takes a place among the items like any of them, dragged into place; collections never placed stay first. Places are stored per view in `custom_order_collections` (migration 13), sharing one count with the view's items; an order of items alone (the Arrange dialog) leaves the collections' places as they were.

### D-035 · Arcade, more: folders, N64 covers, selecting, custom order, quiet while playing; dragging in the Library
- **Date:** 2026-11-07 · **Approved by:** project owner (asked for these; chose libretro-thumbnails for N64 covers, "hide and go silent" while playing, and dragging covers in place in the Library)
- **Game folders per emulator:** each emulator's folders can be changed, removed or added in Arcade, replacing the ones read from its settings (`arcade_emulator_folders`, migration 12), and set back to the emulator's own. A game that isn't in any game folder anymore is hidden as missing, with its play time kept.
- **Covers:** after Dolphin's cache and GameTDB, libretro-thumbnails (the box-art collection RetroArch uses, on GitHub) for every console, by the game's No-Intro/Redump name: the file's name first, then the title with the usual regions. Online only when covers are downloaded (the same switch).
- **Selecting:** "Select" in Arcade for favorites on or off, finding covers again, and removing games from Digitify (with a confirmation; files are never deleted). A game can be renamed in its panel.
- **Custom order:** "Custom order" sort; games are dragged into place while all show (`arcade_games.position`).
- **While playing:** Digitify hides (out of the taskbar) and goes silent — the menu music is held and the music player paused — and comes back where it was, focused, with the music carrying on, when the game closes (D-034's process watch).
- **The game panel** is drawn above the page, so it no longer moves when the page scrolls.
- **Library:** in a custom order, covers are dragged straight to a new place in the grid, list, shelf and detailed views (the Arrange dialog stays). Both use one pointer-based drag (`lib/gridDrag`): a press becomes a drag after a few pixels, a copy follows the pointer, a line shows where it lands, the view scrolls near its edges.

### D-034 · Arcade: a launcher for the emulators' games
- **Date:** 2026-11-07 · **Approved by:** project owner (asked for "Arcade" beside Home and Library, a universal launcher for Dolphin and Project64; chose RMG for Nintendo 64 on both systems and GameTDB covers)
- **What:** a third section in the title bar (and in Big Picture's menu) listing the games of the emulators installed on the computer, and starting the chosen one in its emulator, which runs with its own settings. Digitify never ships, downloads or changes games, BIOS files, emulators or their settings.
- **Emulators:** Dolphin (GameCube, Wii) on Windows and Linux (installed, portable, on the PATH, or Flatpak); Project64 (Nintendo 64) on Windows only; RMG, Rosalie's Mupen GUI (Nintendo 64), on Windows and Linux, so both systems play the same games. Found where they're usually installed, or pointed at by hand. When both N64 emulators are there, the user picks which one plays.
- **Games:** from the folders set up in each emulator (Dolphin's `Dolphin.ini` `ISOPaths`/`ISOPath<n>`/`RecursiveISOPaths`; Project64's `Config\Project64.cfg` `[Game Directory]`; RMG's `mupen64plus.cfg` `[Rosalie's Mupen GUI RomBrowser]`) and folders added in Arcade. Recognized by their headers: ISO/GCM/CISO, RVZ/WIA, WBFS disc headers (ID and title), WAD and GCZ by file name; N64 ROMs in any byte order (.z64/.v64/.n64). Only headers are read. A game whose file is gone is kept as missing, with its play time.
- **Launching:** `Dolphin -b -e <game>` (closes with the game), `Project64 <rom>`, `RMG --quit-after-emulation <rom>`; one game at a time; play time and sessions are counted until the emulator closes (starts under 5 seconds don't count), and Digitify comes back to the front.
- **Covers:** Dolphin's own cover cache first, then GameTDB by the disc's ID (GameCube and Wii; on by default, switchable — an online exception like D-028), or a picture the user picks. Nintendo 64 games have a drawn box unless given a picture.
- **Data:** `arcade_emulators`, `arcade_folders`, `arcade_games` (migration 11); games aren't library items.

### D-033 · Pictures and the image viewer
- **Date:** 2026-11-07 · **Approved by:** project owner (asked for a Pictures category and an image viewer; chose albums from folders, and a slideshow, photo info, rotate and flip, and album cover / Home background)
- **Category:** Pictures, a new kind of category (`image`), right after Everything. Images are imported as photos, each an item of its own; a picked folder and its subfolders become nested albums (collections). A folder of images becomes a book only when a book or comic category is picked, or through "Book from images…".
- **Formats:** JPG, PNG, WebP, GIF (animated in the viewer), BMP and TIFF (converted for the viewer). AVIF and HEIC aren't imported: they can't be decoded for thumbnails without native libraries.
- **What's read:** EXIF date taken, camera, lens, exposure, GPS location and orientation; the file's date when there's no EXIF date. Thumbnails are upright (EXIF orientation). Cards are wide, tall or square by the photo's proportions. Pictures sort by date taken by default.
- **Image viewer:** full window; zoom (wheel, buttons, keys, double-click) and drag; previous/next through the album or view it was opened from (buttons, arrows, swipe); slideshow (3–20 s per photo); info panel; turn and mirror (stored in Digitify, applied to thumbnails, never to the file); use as album cover; use as Home background (removable in Customize Home). Controller: left/right, A zoom, X slideshow, Y info, LB/RB zoom, B back. In Big Picture, photos open in the same viewer.

### D-032 · Linux: a local page hosts YouTube's player
- **Date:** 2026-11-07 · **Approved by:** project owner (chose a local server over opening YouTube videos in the browser)
- **Why:** on Linux the interface is a `tauri://localhost` page, which sends no Referer; YouTube's embedded player refuses to play without one (error 153). Windows (`http://tauri.localhost`) is not affected.
- **What:** on Linux only, the player's frame loads a small page from `http://localhost:<port>` that embeds YouTube's player and passes its IFrame API messages to and from Digitify (so Digitify's and Big Picture's buttons still work). The rest of the app stays a `tauri://` page: serving the whole interface over http would have made it a remote page in Tauri's eyes, with every command needing to be declared.
- **Limits of the server:** that one page only, for YouTube's embed addresses only (`https://www.youtube-nocookie.com/embed/…`); loopback only; requests must name the server as `localhost:<port>` or `127.0.0.1:<port>` (no DNS rebinding); the port is picked by the system at first use and held from then on; strict Content-Security-Policy with a fresh nonce, framed only by Digitify. It starts the first time an online YouTube item is opened.
- **Decoding:** YouTube sends H.264 to WebKit, which needs GStreamer's libav plugin; the `.deb` depends on `gstreamer1.0-libav` and `gstreamer1.0-plugins-bad`, and the Arch script installs `gst-libav` and `gst-plugins-bad`.

### D-031 · Linux, built by GitHub Actions
- **Date:** 2026-11-06 · **Approved by:** project owner (asked for a Linux installer; chose GitHub Actions to build it, and the whole app, disc drives included). Widens D-011: Windows 11 stays the main target, Linux x64 is now built too.
- **Packages:** a `.deb` (it depends on the distribution's `mpv`, `ffmpeg` and `udisks2`) and an AppImage (which needs `mpv` and `ffmpeg` installed, and carries its own GStreamer for the web view's sound), built on Ubuntu 22.04 by `.github/workflows/build.yml`, which also builds the Windows installer. PDFium ships with the app (`scripts/fetch-deps.sh`, pinned and hash-checked, scanned for decryption code like on Windows). The system programs Digitify starts (mpv, ffmpeg, xdg-open, udisksctl) get the system's environment back, without the library paths the AppImage sets for itself; otherwise they load the AppImage's older libraries and fail on newer distributions such as Arch. WebKitGTK's DMA-BUF renderer is turned off only with NVIDIA's own driver; Intel, AMD and other Mesa drivers keep it, as it draws much faster. The video window takes no mouse input (an empty X input shape), so the pointer always reaches the player's controls, and the player page is black rather than see-through. The Web Audio context for interface sounds stays awake on Linux: WebKitGTK wakes a sleeping one by waiting on GStreamer in the page's thread, which froze the player at the first click sound.
- **What differs on Linux:**
  - **Video:** mpv draws into an X11 window inside Digitify's (`--wid`); Digitify runs on X11, through XWayland on Wayland desktops. That window sits above the page, so the player keeps the video clear of its bars while they show, out of the way while a menu is open, and behind the opening curtain until the first frame.
  - **mpv's control channel** is a Unix socket instead of a named pipe.
  - **Disc drives:** `/dev/sr0`… (shown as "sr0"), through Linux's CD-ROM calls: disc present, table of contents, CD-Text, raw audio sectors, the DVD copyright descriptor (to detect protection only, D-007), eject; a data disc is mounted through udisks when the desktop hasn't.
  - **API keys** go to the desktop's keyring (Secret Service) instead of DPAPI.
  - **The browser and the file manager** open through `xdg-open`; external drives are recognized by their file system's UUID; the private media scheme is `digitify://localhost`.
- **Not verified yet:** none of this has run on a real Linux machine; the first builds are the check. Disc drives can only be tried with real hardware.

### D-030 · Big Picture of its own, collections among the items, motion, light mode
- **Date:** 2026-11-06 · **Approved by:** project owner (asked for the changes)
- **Big Picture's mouse:** in selection mode the mouse also drives Big Picture's round cursor (the system pointer hides inside the window); it shows when the mouse moves and goes when the controller or keyboard moves the selection.
- **Big Picture's online player:** online items (D-028) play in a Big Picture screen of its own (`/bp?screen=online`), not the regular app's page: the service's official player with its colored frame, and big buttons a controller reaches (play/pause, 10 s back and ahead, "Open on …"; X plays or pauses, LB/RB go back or ahead). The buttons talk to the embed through each service's documented messages: YouTube's IFrame API (`enablejsapi=1`), SoundCloud's Widget API; Spotify's embed answers the same kind of messages (best effort). Videos from the library and the readers keep their own full-screen players, as before.
- **Big Picture's Home** has Home's sections, in the order and with the ones hidden set in "Customize Home": Library, Featured today, Favorites, Continue watching, Pick up where you left off, Recently opened, Recently added, Statistics (with its charts). Discs stays on the regular Home. Every row has arrows at its ends for the mouse and the cursor (the selection scrolls rows by itself).
- **Collections among the items:** a category's (or collection's) filter is All, Digital, (Online in Music and Videos) and Collections. "All" puts its collections first, among the items and as wide as a horizontal video, in every layout; "Collections" shows them alone. The row of collections above the items is gone.
- **Motion:** changing category, view, filter, sort or a music tab brings the content in with a fade and its covers popping into place row by row; Home's sections and Big Picture's screens and rows come in one after another; an item's cover pops in. "Animations" in Settings turns it all on or off ("Reduced" keeps gentle fades only).
- **Light mode for slower computers** (Settings): no blur, reflections, big blurred backdrops, heavy shadows, glows or animations (spinners still turn), and fewer covers drawn ahead while scrolling.

### D-029 · One item per file; no shelves, physical copies or catalog; where a link came from
- **Date:** 2026-11-06 · **Approved by:** project owner (asked for the changes; chose keeping physical-only items, shelves into collections, one item per file, and a disc format field)
- **Downloads from YouTube and Spotify:** asked for and declined (YouTube's terms forbid it and its files sit behind technical protection; Spotify's are DRM-protected, D-007). The owner then kept links as online items (D-028) and turned down the lawful alternatives offered (replacing an online item with an owned file, Internet Archive, Vimeo downloads the author allows, Google Takeout).
- **Removed:** "On the shelf" and "Not digitized" filters, Shelves (page, Home section, "Add to shelf", smart shelves), "Catalog a physical item" (Add menu, Home, and "Catalog this disc" on the Discs page) and "Your copies" (with "Add physical copy" and "Add files to this item"). The shelf view layout stays.
- **Each file is its own item** (a series keeps its episodes, and a book of images is one file set). An item's page shows its file in a "File" panel (where it is, Show in folder, Arrange pages for image books).
- **Migration (schema 9):** each hand-filled shelf became a collection of the same name in each of its items' categories; an item already in a collection kept it and got the shelf's name as a tag. Smart shelves were rules, not lists, so nothing moved (their rows stay in the database, unused). Every digital copy past an item's first became an item of its own with the same details, cover, people, tags and collection, told apart by its format. A film's DVD or Blu-ray physical copy became its disc format. Items recorded only as physical copies stay as items without files. Nothing is deleted; the library is backed up before upgrading.
- **Disc format:** "Disc format" in Edit details for Movies & Series (None, DVD, Blu-ray, 4K UHD Blu-ray, 3D Blu-ray), shown as the case band on the cover; a title imported from a DVD or Blu-ray goes to Movies & Series with it set.
- **Filters:** All and Digital everywhere; Online too in Music and Videos (items added from a link that play online).
- **Where a link came from:** items from YouTube, YouTube Music, Spotify or SoundCloud wear the service's color as their cover's border and its name as a tag, in every view, on the item page and in Big Picture (YouTube red, YouTube Music coral, Spotify green, SoundCloud orange).
- **Menu music toggle:** its slash runs the same way as the interface sounds' off icon.

### D-028 · Import from URL: online items, and downloads only where allowed
- **Date:** 2026-11-03 · **Approved by:** project owner (asked for Import from URL; chose links with the services' own players, downloads only where allowed, and playlists through their own API keys)
- **Network (an approved exception to D-008):** Digitify goes online only when a link is pasted into "Import from URL", while an import runs, and while an online item plays in its service's player. Nothing else changed: no telemetry, no update checks.
- **Services and what each allows** (checked against their current terms and APIs, November 2026):
  - **YouTube and YouTube Music:** saved as online items and played in YouTube's embedded player (youtube-nocookie, with the app's origin, since YouTube refuses embeds that don't say where they are; "Open on YouTube" is always there for videos whose owners block embedding). Never downloaded: YouTube's terms don't allow it. Without a key a link is looked up through YouTube's public oEmbed (title, channel, thumbnail) and a playlist stays one link; with a YouTube Data API v3 key, playlists are listed video by video with lengths and availability (up to 500).
  - **Spotify:** saved as online items and played in Spotify's embedded player (previews unless signed in to Spotify there). Never downloaded. With the owner's client ID and secret, a track's artists and length and an album's songs are listed; since February 2026 Spotify lists a playlist's songs only to its owner or collaborators, so other playlists are saved as one link. Spotify also requires the developer app's owner to have Premium.
  - **SoundCloud:** with the owner's client ID and secret (client-credentials flow), tracks and sets are resolved and a set's tracks listed; a track whose uploader made it downloadable is downloaded; everything else is an online item played in SoundCloud's widget. Without keys a link is saved as one online item.
  - **Direct links to audio or video files:** downloaded.
- **Three kinds of items:** local files; downloaded media (a normal managed file in the library folder, under `<Category>\Downloads`, available offline, with where it came from recorded); online items (no files, marked with a cloud on their cover and "Online, needs a connection" on their page, played at `/online/<id>`). They're all ordinary items (favorites, tags, shelves, sorting, search, covers, selection, Big Picture). An online song isn't a playable track, so "Add to playlist" isn't offered for a selection that includes one, and the library's music player skips nothing it can't play.
- **Duplicates:** the same thing from the same service (YouTube and YouTube Music count as one), or the same downloaded file (by its fingerprint), is skipped and pointed at the existing item; nothing is replaced, except that downloading something kept as an online item replaces that online item, carrying over its favorite mark, tags and shelves.
- **The queue:** two workers in the background; per-item progress, cancel (no half-downloaded files left) and retry; one failure doesn't stop the rest; requests to a service are spaced and a "slow down" answer is waited out once; errors are explained (removed, private or region-locked, no connection, keys refused, rate-limited, not a media file).
- **Playlists:** importing a music playlist can make a Digitify playlist of its songs that are available offline, in the original order.
- **Keys:** entered in Settings › Online services, stored encrypted for the Windows account (DPAPI) in the config folder, never sent back to the interface or written to logs.
- **Not done, on purpose:** no downloading from YouTube or Spotify, no stream capture, no scraping of web pages, no signing in to the services.

### D-027 · Tracks instead of albums, Videos apart from Movies & Series, selections that fit
- **Date:** 2026-11-03 · **Approved by:** project owner (asked for the changes; chose "Tracks, Artists, Playlists…" tabs, moving loose videos automatically, two rounds, and links plus their own API keys for importing from URLs)
- **Music without albums:** each track is an item of its own, with its own cover (the album's art), artist, favorite mark, tags and shelves; the album's name stays as a detail. Playlists are the way to group music. Music's tabs: Tracks (the library view, with every layout, sort and selection; Play and Shuffle play the view in its order), Artists (a filter, not a container), Playlists, Recently played, Favorites. A track keeps one `track` part, so playlists, favorites and plays still point at the same rows.
- **Migration (schema 7):** every album's tracks became items, copying the album's cover, people, tags, shelves and favorite mark (an album that was a favorite makes its tracks favorites); each track's file moved to its own copy of the album's version. A track's own artist became its item's artist. Nothing is deleted, and the library is backed up before upgrading, as with every migration. Audio CDs cataloged from a drive become one item per track too, each noting the CD.
- **Videos and Movies & Series:** a built-in **Videos** category for clips, recordings and personal videos: Play only (always from the start, no Resume, no watched mark, not in "Continue watching"), horizontal covers by default and vertical on request. **Movies & Series** keeps progress, Resume and the watched mark, and its covers are always vertical. On upgrade, videos that weren't a series, had no year and sat in no collection moved to Videos. On import, a video with a year goes to Movies & Series and one without to Videos; a category picked in the import dialog applies to the files it can hold. Moving an item between them adapts its cover.
- **Category order:** Everything, Music, Videos, Movies & Series, Books, Comics, Manga, Favorites, Shelves, Tags (Home, the category strip and Big Picture). An order the owner arranged themself is kept, with Videos after Movies & Series.
- **Selections that fit:** the core decides what a selection allows beyond what every item takes (favorites, tags, shelves, moving, the year, a cover image, removing): "Add to playlist" only when every item is a track, a cover shape only when they all take the same shapes (music square/CD, Videos horizontal/vertical), a series name only for books and comics. The bulk bar asks the core on every change, and the core refuses anything else, so both follow one set of rules. Mass edit adds "Cover…": one image for every selected item, and the shape.
- **Also:** sort by duration (shortest or longest first; items without a length last), Play as the main action on a track's page with Favorites as a neutral button, Home's "Add to library" as a small + next to Customize Home, and interface sounds as a compact toggle.
- **Second pass (owner's requests):** one art height in every grid, so covers are the same size in every category; the carousel runs to the window's edges with faded ends; videos open and close behind a curtain with the item's artwork; the menu music is switched on or off (a toggle on Home and in Settings), never played or paused, and with it off the music capsule says nothing is playing.
- **Import from URL (next round):** links from YouTube, YouTube Music, Spotify and SoundCloud are kept as online items with their official players, clearly marked as needing a connection; files are downloaded only where the provider allows it (SoundCloud tracks their uploader made downloadable, direct links to media files). Playlists are listed with API keys the owner enters in Settings. Digitify goes online only when a link is pasted (an approved exception to D-008).

### D-026 · Title bar navigation, cover colors, credit
- **Date:** 2026-10-31 · **Approved by:** project owner (asked for each)
- The title bar has Home and Library, as Big Picture does (the labels give way to icons in narrow windows); the search box sits next to them.
- Home has a "Discs" section so disc features are visible without a drive; "Featured today" has its own badge.
- In Big Picture's cursor mode only the cursor selects.
- A cover without artwork can be given a color on the item's page (stored as the item's cover color until it gets artwork); CDs stay round everywhere.
- Settings end with "Digitify is free and open source."

### D-025 · Big Picture: a TV interface for controllers
- **Date:** 2026-10-31 · **Approved by:** project owner (chose each option)
- **Interface:** its own full-screen interface for the TV, like Steam's Big Picture: Home (continue, categories, recently added, favorites), the library by category (LB/RB to switch), an item's page (Read, Play, Play album with its tracks, favorite), search, and a menu. Always dark, big type, a ring around the selection.
- **Controllers:** Xbox and PlayStation controllers, wired or Bluetooth, through the Gamepad API of WebView2 (no extra software). Button names and symbols follow the controller in use.
- **Moving around:** by selection (the D-pad or left stick moves to the nearest item in that direction) or with a cursor (left stick moves it, right stick scrolls, A clicks); chosen in the Big Picture menu, with the cursor's speed.
- **Where the controller works:** in Big Picture and in the readers, the video player and the music started from it. In the readers and the player each button presses a keyboard shortcut (Settings › Keyboard), so changed keys keep working. Not in the normal interface.
- **Typing:** an on-screen keyboard for search (X deletes, Y types a space).
- **Entering:** a controller button in the title bar, or the Xbox / PS button; because Windows may keep the Xbox button for its Game Bar, Start + Select together do the same. Leaving: the menu's "Exit Big Picture" or the ✕ at the top.
- **Also in this round (owner's requests):** a "Watch again" button at the end of a video; horizontal covers as tall as vertical ones (the grid lays out rows of one height; Home's rows, the shelf, the detailed view and the carousel follow); a track only once per playlist (repeats removed, schema v6), with checkmarks in "Add to playlist" and a dialog to remove it or keep it; covers gliding into place when the layout changes (view transitions); Midnight shows no theme choice and no light/night switch; Settings centered.

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

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

### D-156 · A game's cover whole in its panel
- **Date:** 2026-11-21 · **Approved by:** project owner (reported the cover cut at the top of a game's panel)
- **The cause:** the panel is a column that scrolls; when its contents were taller than the window (a note, several facts), the cover's box was squeezed shorter and its picture cut. Its box was also capped at 340 px high, which cut 20 px off a 2 : 3 cover.
- **Now:** the cover's box is never squeezed (the panel scrolls instead), and a cover whose shape would make it taller than 340 px is shown narrower instead of cut.

### D-155 · Java Edition says how to start Minecraft straight away
- **Date:** 2026-11-21 · **Approved by:** project owner (asked for Java Edition to start directly; agreed to this note when that isn't possible)
- **Why not directly:** Mojang's Minecraft Launcher has no way to be asked to start the game (its options open it; Quick Play's are the game's own). Starting Java without it needs the player's signed-in Microsoft account: Digitify would have to ask for it or read the launcher's encrypted sign-in, which it won't do (D-037: stores are only read), and an offline start isn't a legitimate way to play an account's game.
- **The note:** Minecraft: Java Edition's panel says, under Play, that Play opens the Minecraft Launcher, and that Prism Launcher (signed in there once) has each of its instances show in Arcade and start directly (D-153).

### D-154 · Minecraft's games in the Xbox view
- **Date:** 2026-11-21 · **Approved by:** project owner (asked: Minecraft counts as Xbox games; sorted by console, the Xbox view shows Xbox's games and Minecraft's)
- **On Windows:** Minecraft has no view of its own; its games (Java Edition, Bedrock, the Prism Launcher and MultiMC instances) are in the **Xbox** view, which shows once either has a game. Sorted by console, the Xbox view has an **Xbox** heading and a **Minecraft** heading under it; in the PC games and All views Minecraft comes right after Xbox. Its badge, its row in Launchers and collections by the Xbox view include them.
- **On Linux,** which has no Xbox view, Minecraft keeps a view of its own.

### D-153 · Minecraft in Arcade: Java Edition, Bedrock and each Prism Launcher or MultiMC instance
- **Date:** 2026-11-21 · **Approved by:** project owner (asked for Minecraft Java; chose the official launcher plus Prism Launcher and MultiMC, Bedrock too, and a Minecraft launcher of its own with a grass block)
- **A launcher of its own:** **Minecraft** in Emulators & folders › Launchers, a Minecraft view (on Windows, the Xbox view since D-154) and a green badge with a grass block drawn by Digitify (no maker's mark), on Windows and Linux. Only read, like the other stores (D-037); nothing of Minecraft's is changed.
- **Minecraft: Java Edition:** Mojang's Minecraft Launcher, from the Xbox app's game folders, the Microsoft Store (its installed package, `Microsoft.4297127D64EC6`, read from the registry) or the older installer (`MinecraftLauncher.exe`); on Linux `minecraft-launcher` or its Flatpak. Starting it opens the launcher, where Play starts the game as always (signing in stays the launcher's). Its time counts while its Java runs from the launcher's data (the package's folder, or `~/.minecraft`).
- **Minecraft for Windows (Bedrock):** from the Xbox app's game folders or the Microsoft Store (`Microsoft.MinecraftUWP`), started as the app it is. Neither is listed under Xbox any more.
- **Prism Launcher and MultiMC:** each instance is a game ("Minecraft: Fabulously Optimized", its own name when it says Minecraft), started directly (`--launch <instance>`), from the instances folder their settings name. Prism Launcher installed (its uninstall entry, its usual folder, Scoop, portable beside its program) or on Linux in the PATH or as a Flatpak; MultiMC in a `MultiMC` folder in the usual places on Windows, or `~/.local/share/multimc` on Linux. A new Prism instance shows by itself. The time counts while Java plays the instance (its command line names the instance's folder; on Windows only Java's command line is read for this).
- **Covers:** by the edition's name (an instance is Java Edition): the Microsoft Store, LaunchBox and SteamGridDB, as for other PC games; the package's own square logo only when none is found.
- **Manual:** Arcade's PC stores name Minecraft (edition 3).

### D-152 · Arcade stays quick: removing a folder and Look for games no longer wait
- **Date:** 2026-11-20 · **Approved by:** project owner (a tester's report: removing a game folder took over a minute, Look for games never seemed to finish; "the app should run quickly, without freezing")
- **The cause:** every time Arcade looked at its launchers (each refresh of Emulators & folders, so after removing or adding a folder, and every Look for games) it started Windows' `reg.exe` several times to read the programs installed (Ubisoft Connect, the EA app, Battle.net, GOG). Each start took seconds (5 s in all here, far more on a computer with many programs or an antivirus that checks each one).
- **Read directly:** the registry is now read through Windows itself (`src-tauri/src/arcade/registry.rs`, read-only), in the same text `reg query` gave, so what each launcher reads is unchanged. Here: Arcade's refresh 5–6 s → 0.12 s; Look for games 5.7 s → 0.13 s; removing a folder (with its refresh) 0.12 s.
- **Only this computer's drives:** the Xbox app's game folders were looked for on every letter from C: to Z:, every 20 seconds too; a network drive that's offline makes each look wait for it, a disc drive spins up. Now only the computer's disks and plugged-in USB drives (a card reader only with a card in it).
- **Emulators' icons once:** an emulator whose icon Windows couldn't read had Windows PowerShell started again on every refresh; it's now tried once (until the program is updated), its initials shown instead.
- **Windows' own folders skipped:** Look for games no longer goes through a drive's recycle bin (`$RECYCLE.BIN` and other `$` folders) or `System Volume Information`.

### D-151 · No line under the profile's banner, no faded ends on sliding names
- **Date:** 2026-11-20 · **Approved by:** project owner (asked for both)
- **The profile's banner:** while the page arrived, the banner's picture showed its last row as a line (or a gap) at its bottom: its layers moved a pixel apart during the entrance. The picture now stops 12 px short of the banner's bottom, which is plain panel, its shade turns solid panel colour before the bottom (on its own layer, under the name and picture), so nothing of the picture can show there.
- **Sliding names have sharp ends:** a name sliding to show the rest (cards, Arcade, Home, Big Picture, the profile, the players) no longer fades its first and last letters; the text is simply cut at the edges. Scrolling rows' fades (Arcade's views, the carousel) stay.

### D-150 · The manual's own cover, Performance mode, framed profile pictures, sliding names, Aero's moving bubbles
- **Date:** 2026-11-20 · **Approved by:** project owner (asked for each; the name Performance mode and frames with a shape and a ring chosen by the owner)
- **The manual's cover:** a book-shaped (2 : 3) cover of its own, made with the manual (`docs/manual/cover.html` → `Digitify-Manual-cover.png`, 1200 × 1800, the app's font inlined), put on the manual's item, so Books shows it whole instead of a cut wide page; the item keeps its shape. The manual's edition is now 2, so libraries take the new one.
- **Performance mode:** "Light mode for slower computers" is now **Performance mode for slower computers** (and "Turn performance mode on by itself", and its notice), so it isn't mistaken for the light theme.
- **Framed profile pictures:** the picture and the banner are kept whole (no bigger than 1200 and 2400 px) and each has a view: **Adjust…** drags it to choose what's in the middle and zooms it in (slider or wheel, 1 to 4 times), with Reset. The picture's **frame**: a circle, a rounded square or a hexagon, with a turning rainbow ring (flowing on the other shapes), the accent, gold, or no ring. The page, Big Picture, the title bar and the share card all show them so. A profile saved before reads with the defaults.
- **Use a cover** shows each cover whole, all at one height.
- **Sliding names:** a name too long for its card ends in "…" and slides to show the rest while the card is pointed at, has the keyboard, or is Big Picture's selection: Library's cards (everywhere they appear), Arcade's games, Home's games, collections' cards and Big Picture's tiles and collections. The profile's Most played and Completed: each item as wide as its cover, a long name sliding by itself, so items no longer spread apart.
- **Profile banner:** no line under it while the page arrives (its shade reaches past the bottom, its drift on a layer of its own).
- **Frutiger Aero:** the slider's and switches' knobs are solid glass (the track showed through them), and the bubbles float slowly in two layers at their own pace (still with motion off or in performance mode).

### D-149 · Collections on their own screen, Favorites as a collection, sort by console, Completed, no smart lists, Big Picture's collections, a personal profile, Frutiger Aero and Minimal, the built-in manual
- **Date:** 2026-11-20 · **Approved by:** project owner (asked for each; Favorites in Arcade only, the profile's avatar in the title bar, a designed PDF manual, and both new styles in light and dark chosen by the owner)
- **Arcade's Collections is a place, not a switch:** the Collections button opens the collections' own screen (in the address: `/arcade?board=collections`, one collection `?collection=<id>`), which has a Back to all games; a collection's bar has a Back to the collections. Pressing Collections again doesn't toggle back.
- **Favorites is a collection:** Arcade's first collection, always there and never deleted or renamed ("Default"); its games are the favorite ones. It's gone from Arcade's views (and from Settings › Arcade's view list; a saved Favorites view falls back to the first). A game's Collections menu ticks Favorites like any collection; inside Favorites, Take out of collection unfavorites. Library's Favorites tabs stay as they are.
- **Sort by Console:** Arcade's new sort groups the games by console and launcher, in the views' order (Settings › Arcade), each group under a heading with its symbol, name, count and a line across; under headings the games start at the left. In Big Picture too.
- **Mark as completed:** a game's panel has Mark as completed (and when it was, in its facts); selected games, Completed › Mark as completed / Not completed. A completed game's box wears a green seal (Arcade, Home, Big Picture). Dynamic collections filter by Completed / Not completed. Kept in the library (schema 31: `arcade_games.completed_at`).
- **Epic's covers fill their boxes:** a PC game's box takes its store's cover shape: Epic Games and Heroic 3 : 4 (Epic's covers are 1050 × 1400), GOG 0.71, Steam and the rest 2 : 3, so Epic's covers no longer show with bands.
- **Library's collection window** centers its items instead of lining them up against the left.
- **Smart lists are gone** from Library: their page, their Library pill, the command palette's entries and the core's commands; their saved rules and orders are removed with the library's upgrade (the library is backed up first). Library's collections and Arcade's dynamic collections do their job.
- **Big Picture's collections:** Library has a Collections tab (every category's collections as big cards; Music has playlists) and Arcade a Collections tab first (Favorites and yours, dynamic ones marked); one opens its items or games; Back returns.
- **A personal profile:** your picture in the title bar (beside Downloads) opens `/profile`: a banner and a picture of your choosing (a picture of yours, or a cover from your games or library, cut to shape), your name and a line about you, then your figures counting up (items in the library, games, hours played, games completed, achievements, best streak), this year's time per activity, your library by category, most played artists, most played and completed games, and your achievements, arriving with gentle motion (none with motion off or in light mode). Kept on this computer beside the settings (`<config>/profile`), no account. **Share as image** draws a 1600 × 900 card (banner, picture, name, line, four figures, most played covers, this year's bars, "Made with Digitify" and the date) on a canvas in the app; Save PNG (where you choose) or Copy. In Big Picture, your picture in the top bar opens your profile.
- **Two new styles,** each in light and dark: **Frutiger Aero** (a bright sky over aqua with glass bubbles, frosted glass panels, glossy aqua buttons with a lit top half, Segoe UI where there is one) and **Minimal** (calm and flat like a game launcher: neutral greys, one accent, no gloss or glow, small corners, a flat title bar, Inter). Every style was checked on Home, Library, Arcade, an item, Settings and the profile in both themes; Minimal's switches show their knob, Aero's glass turns solid in light mode.
- **The built-in manual:** "Digitify Manual", a designed 15-page PDF (landscape, for the screen) explaining every feature in plain words, comes with Digitify and is put in Library › Books the first time a library opens. It can be read, marked, moved or deleted; deleted, it stays gone until Books › Add › Digitify Manual brings it back. A newer Digitify with a newer manual replaces the library's copy in place (it keeps its marks). Its source is `docs/manual/manual.html`, built with `npm run manual` (the app's own icons and font, printed by Edge or Chrome); its edition is `manual.rs`'s `VERSION`. It is updated with every feature added, changed or removed.

### D-148 · Arcade's collections, covers by any of their words, badge styles, box shapes per console, an emulator for one game
- **Date:** 2026-11-20 · **Approved by:** project owner (asked for each; one Collections button, the dynamic filters and whole covers chosen by the owner)
- **Collections, as in Steam's library:** one Collections button beside Emulators & folders shows them as cards (up to four of their covers, their name, how many games, "Dynamic" on dynamic ones), with New collection and New dynamic collection; a card's menu renames, edits filters or deletes it (its games stay). A collection opens its games in Arcade's grid, with its bar (Back to Collections, name, count, Rename or Edit filters, Delete) where the console views are, and the same Find, Size, Select and Sort. Games go into collections of your own from a game's panel (Collections: each ticked when the game is in it) or several selected (Add to collection); inside one, Take out of collection. A game can be in several; a game leaving Arcade leaves them. Kept in the library (schema 30).
- **Dynamic collections** keep filters, not games: words the name has (all or any; apart by spaces or commas, "a phrase" in quotes; capitals and accents don't matter), words it doesn't have, consoles and launchers (any of those chosen), played or never played, favorites only, your rating at least. The editor counts the games that match as you change them; the collection fills and empties by itself as games come and go.
- **Covers by any of their words:** Find covers' search no longer needs the exact name. Besides the exact lookups, it finds the games with any of its words (whole words first, then most words, the very name, a US box): in LaunchBox's database (their names and other names), in libretro-thumbnails (every box of the console, from GitHub's list of its files, kept a month on this computer), and less strictly in Nintendo's store and the Microsoft Store; Steam's search gives a few more. Up to 30 covers show, each saying which game it's of.
- **Badges:** Settings › Arcade › Games' badges: the console's or store's logo and name (as before), the logo alone (the name where there's no logo), or no badge; on Arcade's tiles, Home's games and Big Picture.
- **Box shapes per console:** measured on libretro-thumbnails' boxes (US, Europe, Japan, about 14 each): Nintendo DS (0.90 → 1.12) and 3DS (0.88 → 1.13) were wrong, their boxes being wider than tall; NES 0.70, Super Nintendo 1.41, Sega CD 0.60 (US long boxes), Master System and Game Gear 0.71, Saturn 0.63, PlayStation 2, Xbox and Xbox 360 0.71, Atari 2600 0.73. The rest matched (GameCube, Wii, Wii U 0.71; Nintendo 64 1.38; PlayStation 1.0; PlayStation 3 0.86; PSP 0.58; Switch 0.62; Genesis 0.70; Game Boys, PC Engine, Dreamcast 1.0).
- **Whole covers:** a cover of another shape than its console's box (another region's: a Japanese Nintendo 64 box is tall; a store's square art) shows whole inside it, over a blur of itself, never cut; one within 6% of the box's shape fills it.
- **An emulator for one game:** an emulated game's panel has Plays in: its console's emulator (as chosen in Emulators & folders › Consoles) or any emulator found that plays that console, for this game alone. If the one chosen isn't found anymore, Play says so instead of using another.
- **Also fixed:** Escape in a game panel's menus or dialogs closed the whole panel; now it closes only them.

### D-147 · Dark by default; covers found by a game's other names
- **Date:** 2026-11-19 · **Approved by:** project owner (asked for both)
- **Dark by default:** a first start is dark (it was light, D-016). A theme already chosen stays. The page is dark before the settings load too, so a dark start never flashes light; light and System are in Settings › Appearance as before.
- **A game's other names:** Animal Forest (Nintendo 64) got no cover by its name: libretro-thumbnails has it only as "Doubutsu no Mori (Japan)". LaunchBox's database knows most games' other names, so the names it finds a game by (up to three, "A: B" written "A - B" as libretro does) are now tried in libretro-thumbnails and RetroArch's thumbnails too: "Animal Forest" found libretro's box beside LaunchBox's five. Without LaunchBox's database, typing the original name ("Doubutsu no Mori") finds libretro's.
- **When nothing is found** and LaunchBox's database isn't downloaded, the cover picker says it knows games' other names and where to download it (Settings › Arcade).

### D-146 · Covers by another name, a corner video that never shows the desktop, playlists a section at a time, Look for games with the folders
- **Date:** 2026-11-19 · **Approved by:** project owner (asked for each; section size and the collection switch chosen by the owner)
- **Find covers takes another name:** the cover picker has a search box holding the game's name; change it (the full or original title, with or without its region) and Search looks for covers under that name, in every place Arcade looks by name (libretro, LaunchBox, Nintendo's store, the Microsoft Store, Steam, SteamGridDB). A search's covers always show, even one alone. A name typed with its region, like "(USA, Europe)", is tried as it is.
- **The corner video never shows the desktop:** on Windows the page has a hole where the video plays, and the picture (mpv's window, under the page) moves only once Digitify asks. The hole used to move at once, ahead of the picture, so a quick drag showed the desktop through it for a moment. Now the hole opens only where the picture surely is: while it's moving, over where it was and where it's going both; at its new place once it's there. Where the picture hasn't arrived, the frame is black.
- **A playlist a section at a time:** a link's list (a playlist, a channel, an album) shows 25 at a time; a Section menu picks which 25 (saying how many of each are already in the library), the first one with something new chosen and only its new entries ticked. Nothing brings in more than a section at once; for the next, come back with the same link.
- **Into a collection or a playlist:** a playlist's videos go into a collection in Videos, its songs into a Digitify playlist, named after it (editable), with a switch to turn it off (on by default). If one with that name is already there (any case), they join it: a playlist's later sections add to it after what it holds, in their original order, and videos already in Videos without a collection go in too (none is taken from another collection).
- **Look for games moved:** from Arcade's page to Emulators & folders › Folders & covers, beside the folders it looks in (also in Settings › Arcade). Arcade still looks by itself on the first visit; while it does, the page says "Looking for games…".
- **Also fixed:** a link's list of videos was squeezed to one line when the download options were open; the dialog scrolls instead.

### D-145 · Twelve refinements: symbols, counts, the title bar, players, Big Picture's queue, the corner video
- **Date:** 2026-11-19 · **Approved by:** project owner (asked for each)
- **PC games' badge** has a symbol too: a monitor for a PC game without a store (one added by its .exe), as store games show their store's.
- **Counts in a box:** Library's and Arcade's sections (and Search's filter) show how many each holds in a small box of its own, so the number isn't read as part of the name.
- **The title bar's Home / Library / Arcade** slide their highlight to the chosen one, as Library's sections do.
- **Downloads and imports** moved from Home to the title bar, left of Settings (beside Big Picture), reachable from every screen.
- **Book from images, one per category:** Books' Add has "Book from images…", Comics' "Comic from images…", Manga's "Manga from images…"; each makes its item in that category (the category field is gone).
- **Music:** every Music tab has Add where the Tracks tab has it; on Playlists, "New playlist" sits left of Add (it was above the playlists).
- **New collection** shows only on a category's Collections tab, in the same place.
- **Players' names scroll:** the video player's, the readers', the photo viewer's, the corner video's and the music players' names and details are one line that slides to show the rest when long, never "…".
- **Nothing moves:** an item's previous and next stay in place from item to item (pages keep their scrollbar's room, the count its width); the music player's buttons stay put from song to song (title and artist are one scrolling line each), in the app and in Big Picture. The music player's cover backdrop no longer makes its page scroll sideways.
- **Big Picture's queue:** a song played from Big Picture's Library (or Search) queues the songs after it in that list, as the regular app does (D-091).
- **A song without a cover** shows the audio symbol in the title bar's player (and Big Picture's), not its first letters.
- **The corner video moves:** dragged by its bar, it follows the mouse and settles in the nearest of the four corners when let go (the top ones below the title bar), and stays there next time.

### D-144 · Whole selections and tidy cards
- **Date:** 2026-11-19 · **Approved by:** project owner (asked for the selection's glow uncut, and for other visual glitches to be fixed)
- **Big Picture's selection is whole:** a row that scrolls sideways (Home's categories and rows) cut a selected tile's ring, glow, lift and shadow at its edges; rows now keep room for them on every side (without moving the tiles), the screen scrolls a selection near its top or bottom in with room to spare, and the music queue's list has room for a selected song's ring.
- **The ring over a service's color:** an online item's colored border (YouTube's red…) covered Big Picture's selection ring; selected, that border steps inside the cover so the ring shows.
- **Achievements:** the cards of a row start at the same height (a gap meant for stacked panels pushed all but the first down), in the app and in Big Picture.
- **Nothing playing:** Big Picture's empty music screen keeps its icon and words together, and both music screens speak of songs and playlists (there are no albums since D-027).

### D-143 · Nothing seems stuck: Working…, a way out of a failed screen, and fixes
- **Date:** 2026-11-19 · **Approved by:** project owner (asked for the fixes and for an indicator wherever something takes a moment)
- **Big Picture's crash fixed** ("l is not a function", with no way back): in newer WebView2 (Edge 157) `scrollTo` returns a promise, and the music screen's effect returned it, so leaving the screen (to Search, with songs queued) called the promise as its clean-up. That effect no longer returns anything; no other effect or ref returned such a value.
- **A failed screen has a way out:** instead of the router's bare "Something went wrong!", a screen that fails says so, with its reason, and offers **Back** and **Home** (Esc and the controller's B go back, Menu goes Home), in the app and in Big Picture.
- **Working…:** anything asked of the core that takes more than half a second shows a small pill at the bottom, in the app and Big Picture, saying what's being done ("Looking for games and emulators…" while setting, adding or setting aside an emulator or a folder, "Saving the picture…", "Removing…", "Backing up…", "Checking the library…", "Adding to the queue…"…), so nothing looks frozen. Reads that draw their own placeholders, saves that run by themselves and actions with their own progress (looking a link up, a cover picker, downloads) stay quiet. Every command that runs on the main thread was checked: each is quick.
- **The online player's Back** is every page's Back (D-138): it returns to where it was opened from, so the item's page no longer sends you forward to the player again.
- **Where it came from, after Play:** "Open on YouTube" (or the site) comes after Play on an item's page, for downloaded items as for online ones.

### D-142 · Previous and next go round; Play opens the music player
- **Date:** 2026-11-19 · **Approved by:** project owner (asked for both)
- An item's previous and next (D-138) go round too, as the video player's do (D-140): past the last item to the first, and before the first to the last.
- Every Play that starts music opens the music player's screen, as Big Picture does: a song's page, a song's play button or double-click in a list, Music's Play and Shuffle, a playlist's Play. Its Back returns to where Play was pressed. Pausing or resuming the song already playing stays where you are.

### D-141 · Back keeps the video playing
- **Date:** 2026-11-19 · **Approved by:** project owner (asked for it, with a setting to keep them apart)
- The video player's Back (and Esc, once menus and full screen are closed) leaves the video playing in the corner (D-053) while you browse, instead of closing it; it's closed from the corner. **Settings › Library › Watching › Back keeps the video playing**, on by default: turned off, Back closes the video, and "Keep watching in a corner" sits right beside Back (it was at the other end of the bar). A disc, full screen, Big Picture or a video that has ended just close.

### D-140 · The player's previous and next pass online videos and go round
- **Date:** 2026-11-19 · **Approved by:** project owner (asked for it)
- Outside a series, the video player's previous and next (D-091) step through the videos with a file in the view it was opened from, so an online video (which plays in its service's player, not here) is passed by instead of showing "This can't be played". Past the last video they go round to the first, and before the first to the last.

### D-139 · One height in a collection's window
- **Date:** 2026-11-19 · **Approved by:** project owner (asked for it)
- A collection's window (D-090) gives every card one cover height, as the category's grid does, so a wide video beside a tall one is as tall, not smaller (they were one width before).

### D-138 · A page's own Back, and an item's previous and next
- **Date:** 2026-11-19 · **Approved by:** project owner (asked for it; chose the arrows beside Back, and turning off the mouse's side buttons and Alt+←/→ too)
- **No back or forward in the title bar** (D-026's arrows are gone), and the mouse's side buttons and Alt+←/→ don't go back or forward either. Every page past Home, Library and Arcade has its own **Back**, in the same place at its top, as the music player's screen had: an item's page, Search, Settings, Achievements, Discs, the library check, a smart list and the music player. It returns to the screen the page was opened from, or (when it was the first one shown) to its natural place (an item's category, Settings, the smart lists, Home). Players and readers keep their round one; a collection's window keeps its close button.
- **An item's previous and next:** on an item's page, opposite Back, "‹ 3 of 24 ›" steps through the view it was opened from (its category or collection, filter and sort), in its order; ← and → too, when not typing. Stepping doesn't pile up: Back still returns to the list. (Since D-142 they go round at the ends.) An item opened from Home or anywhere without a list shows no arrows.

### D-137 · Downloads and imports, with their history
- **Date:** 2026-11-19 · **Approved by:** project owner (asked for a Home button with the downloads and imports, current and past, and clearing them; chose links and file imports, kept across restarts)
- **Home's button** (a download arrow, with how many are running; in the title bar since D-145) opens **Downloads and imports**: what's coming in now (link downloads with their progress and cancel, file imports with theirs), then the history, newest first: each entry imported from a link (its service, downloaded or saved online, already in the library, failed with why, cancelled) and each import of files and folders (where it went; how many were added, already there, left out, failed), with when it ended. A line opens the item it made; a failed or cancelled link entry can be tried again from there, even after a restart. **Clear history** empties it (and the import queue's finished lines); the library isn't touched.
- **Kept** in the library's database (schema 29, `import_history`), up to the last 2,000. A watched folder's look that brought nothing new isn't kept.

### D-136 · A downloaded copy is a file like any other
- **Date:** 2026-11-19 · **Approved by:** project owner (asked for it; chose keeping "Open on …")
- Something downloaded from a link wears no service tag, colored border or "From … · Available offline" note, in any view, on its page or in Big Picture: it looks like any file added by hand. Its page keeps "Open on YouTube" (or the site it came from), after Play (D-143). Online items keep their tag, border and "Online, needs a connection". Where it came from stays recorded, so the same thing isn't downloaded twice.

### D-135 · Videos into Movies & Series
- **Date:** 2026-11-19 · **Approved by:** project owner (asked for it; chose movie or series)
- **Movies & Series › Add › From Videos…** lists the videos in Videos that have a file (online ones have none to watch), with a search. Picked ones become **each a movie**, or together **a series' episodes**: a new series (named there) or one already in Movies & Series, in a season (a series' last one by default), numbered on from that season's last episode, in an order set with up and down arrows. A movie keeps its details, favorite mark and tags, and takes Movies & Series' vertical cover; episodes take their video's title and length, the video items go, and a new series takes the first one's picture as its cover. Files stay where they are. This is the one way across categories (D-126), and only from Videos to Movies & Series.

### D-134 · Music's link menu and Videos' apart
- **Date:** 2026-11-19 · **Approved by:** project owner (asked for it)
- **From a link…** opens a menu of its own for music (in Music, or any music category) and for videos (in Videos), from the category's Add or Home's Add › the category, and the command palette has one of each. Each says what it takes before a link is pasted: music, songs, albums and playlists from YouTube Music, YouTube (the sound), SoundCloud, Bandcamp, Mixcloud, the Internet Archive and the other sites yt-dlp knows, Spotify saved online, and direct links to audio files; videos, videos, playlists and channels from YouTube, Twitch (past broadcasts), Dailymotion, the Internet Archive, Bilibili, Vimeo (videos that don't ask to sign in) and the others, live streams saved online, and direct links to video files. (These sites were each checked to work without signing in; TikTok, Reddit and X often refuse or ask to sign in, so they aren't named.)
- **The menu decides what comes in:** the music menu downloads sound (into the category it was opened from) and the videos menu video (into Videos), so the "Download as" choice is gone; music in the videos menu (Spotify, SoundCloud, an audio file) and a video file in the music menu are shown as not taken, with where to add them. Videos from links can't go to Movies & Series (the core refuses it); a video goes there from Videos (D-135).

### D-133 · Downloads from YouTube and other sites, with yt-dlp
- **Date:** 2026-11-19 · **Approved by:** project owner (decided that Digitify downloads from YouTube, changing D-028; chose yt-dlp and Deno inside the installers, Deno as yt-dlp's JavaScript engine, picking quality and format, downloading items saved online, listing playlists without a key, and other sites too)
- **What:** Import from URL downloads videos and songs from YouTube, YouTube Music, SoundCloud and the other sites yt-dlp knows (Vimeo, Twitch, Dailymotion, Bandcamp…) as files in the library folder (`<Category>\Downloads`) that play offline like any other. Spotify stays online only: its media is DRM-protected (D-007). Live streams are saved as online items until they're over. Digitify never signs in anywhere: what needs a sign-in (age-restricted, members-only, private) says so. yt-dlp is asked only about sites it knows by name, never to guess at any web page.
- **Choices** (in Import from URL, remembered): download as video, or the sound alone into Music (since D-134 the menu decides: music's downloads sound, Videos' video); the video's quality (Best, 4K, 1440p, 1080p, 720p or 480p: the tallest up to it, or a smaller one when that's all there is) and format (MKV keeps the best picture and sound; MP4 plays on more devices); the sound as MP3 (LAME V0, about 245 kbps), M4A (AAC, kept as the site sends it when it can) or the original (usually Opus). The site's picture becomes the cover; songs carry it inside, with their title and artist.
- **A video and its sound are two items:** the same YouTube video can be in Videos and, as sound, in Music. The same one again, as the same kind, is "Already in your library".
- **Items saved online can be downloaded:** "Download" on an online item's page and in the selection bar (not Spotify's songs, nor a playlist kept as one link), as video or as sound. The download takes the online item's place, keeping its favorite mark, tags and collection, and its page moves on to the new item.
- **Playlists and channels without a key:** yt-dlp lists a YouTube playlist's or channel's videos (up to 500) and a SoundCloud set's tracks without keys. With a YouTube key, YouTube's API lists playlists as before; with SoundCloud keys, a track its uploader allows is still downloaded as the original file.
- **The programs:** yt-dlp's official build (2026.10.26; Unlicense, carrying its own Python and libraries) and Deno 2.9.8 (MIT), which runs the JavaScript yt-dlp needs for YouTube, ship inside the Windows installer, the `.deb` and the AppImage, pinned and hash-checked by `fetch-deps`; FFmpeg joins picture and sound and makes the MP3s. "Update yt-dlp" in Settings › Online services downloads its newest release from GitHub, checked against the release's SHA-256 list, into the config folder; that copy is used while it's newer than the shipped one. Digitify never checks for updates by itself (D-008).
- **The queue:** progress, cancel (nothing left behind) and retry, as for other imports; a site's passing refusal is tried once more by itself; errors are explained (removed or private, age-restricted, sign-in needed, DRM, not out yet, no connection, the site changed: update yt-dlp).
- **Changed:** D-028's "never downloaded" for YouTube and its "no downloading from YouTube", and D-029's decline, give way to this. The network exception (D-008) also covers downloading and the update button. Spotify, DRM and signing in stay out.

### D-132 · A video added to Music keeps its sound
- **Date:** 2026-11-19 · **Approved by:** project owner
- Videos added to Music (a music video, a concert) become tracks: FFmpeg makes an MP3 of the video's sound (LAME at its best variable quality, about 245 kbps, with the video's title and artist tags) in the library folder, `<Music>\From videos`, and that MP3 is imported as any track is, with a frame of the video as its cover when it has none. The video itself isn't touched or moved, and isn't added to Videos. An MP3 already made for a video is used again. A video without sound says so. Music's file picker takes videos too.

### D-131 · Covers from LaunchBox, Nintendo's store and the Microsoft Store
- **Date:** 2026-11-19 · **Approved by:** project owner (chose all three; SteamGridDB and IGDB answer nothing without the user's own key or a registered app, so they stay as they are)
- **LaunchBox Games Database:** its whole database, published as one file (about 110 MB), is downloaded when the user asks in Settings › Arcade (and refreshed or removed there). Digitify keeps a small index of it (each game's names, platform and front-box pictures; about 45 MB, made in seconds) and searches it on this computer: front boxes by the game's name on its console (other names too; North America's first, then the world's, Europe's, Japan's). Only the picture chosen is downloaded.
- **Nintendo eShop:** Nintendo's store search, for Nintendo consoles' games, by name: its square store art, among the covers to choose from.
- **Microsoft Store:** its catalogue, for PC and Xbox games, by name: the game's vertical poster, else its square box art (games only, not their add-ons).
- In Find covers they join the others; for a game without a cover, LaunchBox comes after GameTDB, and the Microsoft Store after Steam's store, before SteamGridDB. A launcher's own cover still comes first.

### D-130 · Home's tiles, centred and lively
- **Date:** 2026-11-19 · **Approved by:** project owner
- A tile's covers sit in the middle of its screen (an old rule kept them at the top, cut off): the middle one in front and a little larger, the others tilted out and lower. On hover they fan apart and rise; they come in one after another. Reduced motion and light mode keep them still.

### D-129 · Light mode by itself
- **Date:** 2026-11-19 · **Approved by:** project owner
- Digitify watches how smoothly it draws while it's in front and in use (not while a game, a video or a disc plays, nor in its first seconds): when it stays under 24 frames a second, or a third of its frames come late, for three looks of four seconds in a row, it turns light mode on (D-031's fewer effects and animations) and a notice says so, with **Turn it off**. Settings › General has "Turn light mode on by itself"; turning light mode off by hand stops it, so the choice stays the user's.

### D-128 · Covers from SteamGridDB, and by name
- **Date:** 2026-11-19 · **Approved by:** project owner
- With the user's own SteamGridDB API key (free, from their account's preferences; entered in Settings › Arcade, checked with SteamGridDB, kept on this computer and sent only to SteamGridDB), its community's box art comes into Find covers (a Steam game's by its app id; any other game, emulated ones too, by its name, the two closest matches) and is the last place looked for a game without a cover. Emulated games are no longer found by their ID alone. A launcher's own cover still comes first; another one is chosen by hand.

### D-127 · Home's tiles in each category's shapes
- **Date:** 2026-11-19 · **Approved by:** project owner
- The covers fanned on Home's category tiles have the shape they have in their category: a video's wide frame, a photo's own proportions, a film's poster, an album's square (each kind of shape one height, centred), instead of all as book covers.

### D-126 · Items stay in their category
- **Date:** 2026-11-19 · **Approved by:** project owner
- Each category keeps its own kind of media: an item can't move to another category, not from its edit form (its category is shown, not chosen), nor with Move (which now only puts items in one of their category's collections, from the category's own view), and the core refuses it either way. The one way across: videos from Videos into Movies & Series (D-135).

### D-125 · Add, by category
- **Date:** 2026-11-19 · **Approved by:** project owner
- A category's **Add** offers only its own ways in (files and a folder of its kind; a link for Music and Videos; a book from images for Books, Comics and Manga; a disc for Music, Videos and Movies & Series), and what's added goes into it: nothing is guessed. Files it can't hold are left out (the import says how many) instead of landing in another category. On **Home** and in **Everything**, Add lists each category with its ways in, and Home adds "A game, for Arcade". Files dropped on the window go to the category open then, or the one chosen; "Detect automatically" is gone. Music's Add is blue like the others'.

### D-124 · Emulators & folders in Settings too
- **Date:** 2026-11-19 · **Approved by:** project owner
- Settings › Arcade has the same Emulators & folders panel as Arcade (its four tabs), under the views' settings.

### D-123 · The emulators' own icons
- **Date:** 2026-11-19 · **Approved by:** project owner
- Each emulator found shows its own icon beside its name, read from its program on this computer (on Windows from its .exe, once, then kept; on Linux the icon its Flatpak or desktop entry installs), as the launchers' art is: nothing is shipped or downloaded. One not found shows its initials in its colour; RetroArch has its symbol (Simple Icons).

### D-122 · Names and symbols
- **Date:** 2026-11-19 · **Approved by:** project owner
- Epic Games' badge says "Epic Games"; the views are "PC games" and "ROM games"; All, Digital and Online have their symbols.

### D-121 · Fewer buttons, grouped
- **Date:** 2026-11-19 · **Approved by:** project owner (asked for all six)
- **Arcade's header:** Look for games and Emulators & folders; Add a game… is in Emulators & folders › Launchers.
- **A game's panel:** one **Cover** menu (Find covers…, Choose a picture…, its default or launcher's cover) instead of three buttons; with several games selected, one **Covers** menu (Find covers…, Default covers).
- **Arcade's views:** a maker's consoles share one view, **Nintendo**, **PlayStation**, **Sega**, **Xbox consoles** or **More consoles**, with their total; it opens the list of its consoles (each with its symbol and count) and then shows the one chosen ("Nintendo · Wii U"). A maker with one console with games keeps it as a view of its own. Stores, the All views, Others and Favorites stay as they were; Big Picture's LB and RB still go through every view.
- **Settings in tabs:** General (appearance, window and startup), Library (the library, reading, online services, backups), Arcade, Sound, Keyboard and About; the address names the tab, so links open the right one (a missing backup drive opens Library).
- **Big Picture's game screen** shows your rating and note too.

### D-120 · Big Picture all the way
- **Date:** 2026-11-19 · **Approved by:** project owner
- A game in Big Picture (Arcade, Home's rows, Game of the day, search) opens its own screen first, as Arcade's panel does in the regular mode: its cover, console, time played and sessions, **Play** (selected first) and favorite. Achievements and "Your year" open as Big Picture screens (the statistics' buttons go there) instead of the regular pages; the monthly goals are typed in, so they're set outside Big Picture. Big Picture's music screen opens again from a song's screen (its address had been refused). The readers and players stay full screen as they are.

### D-119 · Symbols for every store and console
- **Date:** 2026-11-19 · **Approved by:** project owner
- The symbols are drawn at a whole-pixel size (14 px on badges) with room around them, so they're sharp and no edge is cut. New ones: Ubisoft, EA, Battle.net, Rockstar, Riot, Amazon, itch.io, Lutris, the Wii U, Switch and 3DS, the PSP (PlayStation's), Sega's consoles (Sega's S), the Xbox consoles (Xbox's), and Digitify's own Game Boy, Game Boy Advance, NES and Super Nintendo controllers and Wii U GamePad. They also show beside the launchers' and consoles' names in Emulators & folders.

### D-118 · Find covers to choose from
- **Date:** 2026-11-19 · **Approved by:** project owner (chose going game by game)
- **Find covers**, in a game's panel and for selected games, looks everywhere at once (the launcher's art, Dolphin's and RetroArch's, a PlayStation 3 game's icon; GameTDB, libretro-thumbnails, Steam and GOG, and Steam's store by name with a few close matches) and shows each cover found once, with where it's from and its size, to pick one. With several games it goes one by one ("Game 2 of 5"): one with a single cover gets it, one with none is passed, the rest wait for a pick or Skip; a summary follows. It goes online as asked by the click.

### D-117 · Don't use an emulator
- **Date:** 2026-11-19 · **Approved by:** project owner (an old nullDC folder in Documents was being found)
- A found emulator's row in Emulators & folders has **Don't use**: Arcade stops looking for it, its folders aren't searched and no game opens in it; its games stay, opening in another emulator for their console if there is one. Its row then says "Not used" with **Use again**; pointing to it by hand uses it again too. Migration 28 keeps the choice.

### D-116 · PSP, 3DS, Wii U, Xbox, Xbox 360 and Switch; Rockstar and Riot
- **Date:** 2026-11-19 · **Approved by:** project owner
- **Emulators:** PPSSPP (PSP), Flycast (Dreamcast, before nullDC), Cemu (Wii U), Azahar / Lime3DS / Citra (3DS), xemu (Xbox), Xenia (Xbox 360, Windows) and Ryujinx (Switch), found installed or portable (Flatpak and the PATH on Linux) or pointed at; their game folders from `ppsspp.ini`, `emu.cfg`, `settings.xml`, `qt-config.ini`, `xemu.toml` and `Config.json`. Cemu starts with `-g`, xemu with `-dvd_path`, the others on the game.
- **Games:** PSP discs by their "PSP GAME" system (named and numbered by their PARAM.SFO; CSO discs by their first sectors, so a PlayStation 2's stays a PlayStation 2's) and PSP EBOOTs; 3DS cartridges by NCSD/NCCH (their product code is GameTDB's ID); Wii U discs and installed folders (`code/*.rpx` with `meta/meta.xml` naming them, their GameTDB ID from the product code); Xbox and Xbox 360 discs by where their file system sits (a trimmed image by `default.xbe` or `default.xex`), and an Xbox 360 game as a folder with its `default.xex`; Switch packages and cartridges (their title ID from the name). Covers: GameTDB for 3DS and Wii U, libretro-thumbnails for the rest.
- **Launchers (Windows):** the Rockstar Games Launcher's games by their uninstall entries (GTA V, RDR2, GTA IV, the trilogy, L.A. Noire, Max Payne 3, Bully), started by their program with `-launchTitleInFolder`, which hands them to the launcher; the Riot Client's games by each product's settings (League of Legends, VALORANT, Legends of Runeterra…), started with `--launch-product` and `--launch-patchline`.

### D-115 · Others: the games added by hand
- **Date:** 2026-11-19 · **Approved by:** project owner
- The PC games added by their program (D-107) have their own view, **Others**, after the stores' views, so they don't have to be looked for in All PC games. Like a store's view it shows once it has a game (and goes when the last one is removed), and can be reordered or hidden in Settings › Arcade.

### D-114 · Search, a screen of its own
- **Date:** 2026-11-18 · **Approved by:** project owner (chose Library first, with a filter to reach Arcade)
- Replaces D-105's layout: the title bar's search opens its own screen, not a Library view: no categories, Size, Select, Sort, Add or layouts. It shows "N media in Library", then "N games in Arcade", each in a grid that goes on downward (more media load as you scroll), never sideways, and nothing behind See all. A filter above them shows All, only Library or only Arcade, each with its count, so the games are one click away however much media matched. Big Picture's search lists the media first too.

### D-113 · Emulators & folders in tabs
- **Date:** 2026-11-18 · **Approved by:** project owner (chose tabs by kind)
- With 18 emulators and 11 launchers, the panel has four tabs. **Launchers**: each store this system has, with its games or "not found", programs added by hand (and Add a game…), store games taken off the list. **Emulators**: grouped by maker (Nintendo, Sony, Sega, many consoles), one row each with its consoles; a found emulator's program and folders open beneath its row; the others have Locate… (or "Windows only"). **Consoles**: each console with its games and which emulator plays it, a choice wherever more than one is found (replacing the separate Nintendo 64, Nintendo DS, NES and Game Boy choices, which carry over). **Folders & covers**: more game folders, Download covers and Find missing covers.

### D-112 · Ubisoft Connect, the EA app, Battle.net, Amazon Games and Lutris
- **Date:** 2026-11-18 · **Approved by:** project owner (chose Battle.net, Amazon Games and Lutris beside Ubisoft and EA)
- Read only, from what each launcher keeps of its installed games; each its own view once it has a game. **Ubisoft Connect** (Windows): its `Installs` registry key, named by the games' uninstall entries, started with `uplay://launch/<id>/0`. **EA app** (Windows): the games whose folder has EA's `__Installer\installerdata.xml` (found through the uninstall entries and EA's usual game folders), named by it and started by the program it names, which brings up the EA app as it needs. **Battle.net** (Windows): the uninstall entries Battle.net writes (`--uid`), started with `Battle.net.exe --exec="launch <code>"` for the games Arcade knows the code of (World of Warcraft, Diablo, Overwatch, StarCraft, Hearthstone, Call of Duty…). **Amazon Games** (Windows): its `GameInstallInfo.sqlite`, started with `amazon-games://play/<id>`. **Lutris** (Linux): its `pga.db` (Steam's games left to Steam), started with `lutris:rungameid/<id>`, with Lutris's cover art. Covers otherwise from Steam's store by name (D-108).

### D-111 · Kega Fusion, ZSNES, Snes9x, Nestopia, nullDC and ares
- **Date:** 2026-11-18 · **Approved by:** project owner
- **Emulators:** Kega Fusion (Mega Drive, Sega CD, Master System, Game Gear), ZSNES and Snes9x (Super Nintendo), Nestopia (NES), nullDC (Dreamcast, Windows) and ares (NES, Super Nintendo, Nintendo 64, Game Boy, Game Boy Advance, Master System, Game Gear, Mega Drive, Sega CD, PC Engine). Found installed or as portable copies (Flatpak and the PATH on Linux) or pointed at; their game folders read from their settings (`Fusion.ini`, `zsnesw.cfg`, `snes9x.conf`, `nestopia.xml`, `nullDC.cfg`, ares's `settings.bml`): recent games' folders and their ROM folders. nullDC starts the disc at once (`-config ImageReader:DefaultImage=…`); Fusion and ares are told when a disc is a Sega CD's.
- **Games:** Mega Drive / Genesis and 32X cartridges by their header ("SEGA" at 0x100, also as `.bin` and zipped), Sega CD discs by their signature (ISO, BIN/CUE, CHD in Fusion's folders), Dreamcast GD-ROMs (`.gdi`, its tracks not games of their own; named by their folder when the file is "disc.gdi") and DiscJuggler images, SuperGrafx with PC Engine. Each console its own view; covers from libretro-thumbnails.
- **One list** says which emulators play each console, in Arcade's order: it decides what each emulator's folders are searched for, the consoles it shows, the choices in Consoles (D-113) and which emulator a game starts in (the chosen one if found, else the first found). Migration 27 lets the emulator tables take any emulator's name, so later emulators need no migration.

### D-110 · Two purposes: Library and Arcade
- **Date:** 2026-11-18 · **Approved by:** project owner
- Digitify is described as a home for all your media (Library) and a universal launcher for your games (Arcade): in the README, the installer's description, the welcome screen and Settings › About.

### D-109 · Arcade's views in one row that scrolls
- **Date:** 2026-11-18 · **Approved by:** project owner (asked that many consoles never run off the screen or push anything away)
- **Fixed (0.6.1):** the arrows are placed without a transform (a pressed round button's own nudge used to replace it, jumping the arrow from under the pointer, so the click was lost), stay in the page when there's nothing more that way (hidden, not removed mid-click), and each click moves on from where the row is heading, so quick clicks all count.
- Replaces D-102's second line: the views stay one row that shrinks to the room beside Find, Size, Select and Sort and scrolls sideways (the mouse wheel, the trackpad, or round arrows at its ends, which show only when there's more that way; its edges fade). The view chosen is scrolled into sight. In a narrow window the tools go under the row instead of off the page.

### D-108 · Covers for every game, from one button
- **Date:** 2026-11-18 · **Approved by:** project owner
- Emulators & folders › Covers has **Find missing covers**: every game without a cover is looked for again at once, this time online even when downloads are off (the click is the go-ahead): what's on this computer first (Dolphin's, RetroArch's, the launchers'), then GameTDB (GameCube, Wii), libretro-thumbnails (every other console, by the game's name), the stores (Steam and GOG by ID, itch.io's own picture). PC games from elsewhere (added by hand, itch.io, Epic, Xbox, Heroic) without art also try Steam's public store search by their name, taking only an exact name match. Looking for games still finds covers by itself for new games, as before.

### D-107 · itch.io and games added by their program
- **Date:** 2026-11-18 · **Approved by:** project owner
- **itch.io (Windows and Linux):** the games installed by the itch app, read from its own database (`butler.db`, opened read-only): each install's folder and the program itch's check picked for this system; web games, tools and assets left out. They start by their own program from their folder (as itch does), are watched like a store's game, and use itch's cover. Its own view shows once it has a game.
- **Add a game…** (Arcade's header): any PC game no store here installed, by its program (a `.exe` on Windows; any program on Linux). It's named after the program, or its folder when the program has a generic name ("Game.exe"); it can be renamed, given a cover, removed (the file stays). It starts by itself from its folder, its play time counted while a program from that folder runs. It shows in All PC games, and stays as long as its file is there.

### D-106 · Mesen, FCEUX and mGBA
- **Date:** 2026-11-18 · **Approved by:** project owner
- **Emulators:** Mesen (NES, Super Nintendo, Game Boy, Game Boy Color, Game Boy Advance, PC Engine, Master System, Game Gear), FCEUX (NES) and mGBA (Game Boy, Game Boy Color, Game Boy Advance), found where they're installed or kept as portable copies (or Flatpak / the PATH on Linux), or pointed at by hand. Their game folders come from their settings (Mesen's `settings.json`, FCEUX's `fceux.cfg`, mGBA's `config.ini`): the folders of the games opened recently and the folder last opened from. Each starts on the game with its own settings. NES games play in Mesen or FCEUX, Game Boy games in mGBA or Mesen, as chosen beside the covers (Mesen and mGBA first).
- **Recognizing games:** only headers are read: iNES/UNIF/FDS for NES, Nintendo's logo (and the colour flag) for Game Boy, the fixed byte, title and code for Game Boy Advance; Super Nintendo, PC Engine, Master System and Game Gear by their kind of file. A ZIP holding one of these is that game, named after the ZIP. Each console has its own view, shown once it has a game; covers from libretro-thumbnails by name. Migration 26 lets the emulator tables take the three.

### D-105 · One search for media and games
- **Date:** 2026-11-18 · **Approved by:** project owner
- The title bar's "Search your collection" (and Big Picture's search) also finds Arcade's games: by their title, console, store or game ID, in a row of game tiles above the matching media ("3 games in Arcade", with See all). A cover opens the game in Arcade; ▶ plays it. When only games match, the media part says so instead of "No matches".

### D-104 · A category opens on its media
- **Date:** 2026-11-18 · **Approved by:** project owner
- Going back to a category always shows its Media (Tracks for Music), not the tab used last; Library still opens the category used last (D-075). The tabs are still in the address while you move around, so Back returns to the tab you were on.

### D-103 · Every emulator and store in Emulators & folders
- **Date:** 2026-11-18 · **Approved by:** project owner
- The emulators found get their card (program, game folders, or RetroArch's playlists); every other emulator Arcade knows is listed below them in one line each, with the consoles it plays and Locate… (or "Windows only"), so it's clear what Arcade can use. The stores list every store for this system with its games or "not found". Two emulators for one console (Nintendo 64, Nintendo DS) get a "plays in" choice beside the covers setting.

### D-102 · A view only with games
- **Date:** 2026-11-18 · **Approved by:** project owner
- A store's or console's view shows in Arcade (and in Settings › Arcade) only once it has at least one game; All PC games, All ROM games, the combined All games and Favorites are always there. With many consoles the views wrap onto a second line instead of running off the page.

### D-101 · PlayStation, Nintendo DS, RetroArch and GOG in Arcade
- **Date:** 2026-11-18 · **Approved by:** project owner (chose one view per console, and one preferred emulator per console where two can play it)
- **Emulators:** DuckStation (PlayStation) and PCSX2 (PlayStation 2), their game folders from `[GameList]` in their settings; RPCS3 (PlayStation 3), its installed games, its `games` folder and the folders of the discs in `games.yml`; melonDS (its last ROM folder) and DeSmuME (its recent games' folders) for Nintendo DS, with a preference between them (melonDS first). Found where they're usually installed or kept as portable copies (Program Files, the user's folders, Scoop, Flatpak and the PATH on Linux), or pointed at by hand. Each starts with its own settings: DuckStation and PCSX2 in batch mode (closing with the game), RPCS3 without its game list on the disc's EBOOT.BIN, melonDS and DeSmuME on the ROM.
- **Recognizing games:** only headers are read. A disc image's `SYSTEM.CNF` says PlayStation or PlayStation 2 and gives its ID (ISO, BIN/CUE; a CUE's tracks and an M3U's discs aren't games of their own); compressed discs (CHD, CSO) go by CD or DVD and the emulator's folder; a PSP EBOOT holding a PlayStation game counts; a PlayStation 3 game is its folder, named by its PARAM.SFO (updates and game data left out), with its ICON0 as the cover when nothing better is downloaded; DS ROMs by their header.
- **RetroArch:** the games in its playlists (`playlists/*.lpl`; its history and favorites lists left out), each in its console's view (Super Nintendo, Game Boy Advance, Mega Drive…; consoles without a view of their own share "Other consoles"), started in RetroArch with the core its playlist names. Its downloaded box art is used first. A game that an emulator of its own also finds opens in that emulator.
- **GOG (Windows):** installed games from GOG's records in the registry (written by GOG Galaxy and by GOG's installers; extra content left out), started through GOG Galaxy when it's there, else by their own program; box art from GOG's public catalogue by the game's ID, when downloads are on. On Linux, GOG games keep coming through Heroic.
- Digitify still ships, downloads or changes no games, BIOS files or emulators, nor their settings.

### D-100 · Achievements on Home
- **Date:** 2026-11-18 · **Approved by:** project owner
- Home's buttons start with Achievements (the medal and its name), beside Customize Home, opening the achievements screen (D-093).

### D-099 · Game counts on Arcade's views
- **Date:** 2026-11-18 · **Approved by:** project owner
- Each of Arcade's views (All PC games, Steam, Wii…) shows how many games it holds, like Library's sections.

### D-098 · The filter only for online media; Music's tabs in order
- **Date:** 2026-11-18 · **Approved by:** project owner
- All / Digital / Online shows only in Music and Videos, where links are imported to; Pictures, Movies & Series, Books, Comics and Manga are all on this computer and show just their tabs. Music's tabs go Tracks, Playlists, Artists, Recently played, Favorites, and its Favorites tab has the same star as every category's.

### D-097 · Logos on Arcade's badges
- **Date:** 2026-11-18 · **Approved by:** project owner (chose small one-colour logos)
- A game's badge shows its store's or console's symbol before its name, in the badge's own colour and the size of its text, in Arcade, on Home and in Big Picture. Steam, Epic Games and GameCube come from Simple Icons 13.21 and Xbox from Simple Icons 9.21 (CC0 drawings of their owners' marks, used only to say where a game is from). Nintendo 64 shows its block "N" and Wii a Wii Remote (so the badge doesn't read "Wii Wii"), both drawn simply by Digitify, as no free versions exist; Heroic shows its name only (owner's request, same day).

### D-096 · A calm Library header (keeps the layout of D-094)
- **Date:** 2026-11-18 · **Approved by:** project owner (chose to keep the three bands, aligned, with nothing jumping)
- **Aligned:** the tabs, the filter and the layout buttons share one line and one height (the tabs had kept a margin from beside the title); the title band keeps its height while a title arrives.
- **Category changes:** the filter and the layout buttons slide from where they were in the category before (a FLIP slide, `lib/glide.ts`) instead of jumping when the tabs are wider or the filter isn't there; a filter that appears fades in once they've moved.
- **Layout changes:** the header, the strip and the toolbar are left out of the view transition (no two toolbars cross-fading), covers and collections fly to their new places, a cover with no place in the new layout leaves quickly and a new one comes in after, and covers no longer also replay their pop-in.

### D-095 · Music has no collections
- **Date:** 2026-11-18 · **Approved by:** project owner (chose to turn them into playlists)
- Music groups songs with playlists only. The upgrade (v24, `reshape::d095`) turns each music collection into a playlist of the same name with its songs in order, then removes the collection (the songs stay in Music); the core refuses new music collections.

### D-094 · A category's tabs: Media, Collections, Favorites (changes D-030, D-044)
- **Date:** 2026-11-18 · **Approved by:** project owner (chose Music's tabs in the same place, and to drop the Favorites tile but keep Home's Favorites row)
- Every category has tabs in its toolbar, first and always in the same place, beside All / Digital / Online: Media (its items, with no collections mixed in), Collections (its collections alone) and Favorites (its favorites). Music's tabs (Tracks, Artists, Playlists, Recently played, Favorites) moved there too. The tab is remembered per category. Pictures shows no ownership filter (every photo is on this computer), nor does the Collections tab. The global Favorites left Library's strip, Home's tiles, Big Picture's library and Ctrl+K; Home's Favorites row stays.

### D-093 · Achievements screen
- **Date:** 2026-11-18 · **Approved by:** project owner (chose a summary in Statistics plus a screen)
- `/achievements` shows every family with its levels as medals, what each counts, how far to the next, and the day each was reached. Statistics on Home keeps a small card ("3 of 40 reached · latest: Player I") with "See all"; Ctrl+K has Achievements too.

### D-092 · No more Tags or Later (removes D-062 and the tags of Phase 2)
- **Date:** 2026-11-18 · **Approved by:** project owner (chose to remove them and their records)
- To keep Library simple, Tags (the Tags page, tag editing on an item, tags in the detailed view, bulk tags, the smart-list tag rule) and Later (its section, Home and Big Picture rows, the item button, Ctrl+K) are gone. The upgrade (v23) deletes their records; the library is backed up before it, as before every schema change.

### D-091 · Next follows the list
- **Date:** 2026-11-18 · **Approved by:** project owner (chose next and previous by button only for videos)
- As photos already did (D-033), what's opened from a library view knows its list: in the video player, outside a series, previous and next go to the videos before and after it in that view's order (also from the media keys); a song played from its page queues the rest of the view's songs after it, in order.

### D-090 · Collections as folders, one level (changes D-030)
- **Date:** 2026-11-18 · **Approved by:** project owner (chose to move nested collections up)
- A collection opens in a window over its category (its items, its name and count, Rename and Delete; Back or Esc closes it) instead of becoming the page. Collections are one level: the core refuses one inside another, and the upgrade (v23) moves any that were nested up to the top of their category with their items. "New collection" is only on a category.

### D-089 · Builds on GitHub that keep passing
- **Date:** 2026-11-18 · **Approved by:** project owner (asked for the failing builds to be fixed for good)
- **What failed:** the Linux build couldn't keep its packages (the account's artifact storage was full: every push kept about 120 MB for 90 days), and the Windows build couldn't download FFmpeg (BtbN had removed the pinned autobuild).
- **Artifacts:** every push to main builds and runs the core's tests (Linux and Windows); the installers are kept as artifacts only when the workflow is run by hand or for a version tag (`v0.3.0`…), and only for 7 days. `npm run installer:linux` downloads from such a run.
- **Helper engines:** `fetch-deps.ps1` tries the pinned FFmpeg build (exact SHA-256) first; when it's gone it takes the newest build of the same 9.0 branch from BtbN's permanent "latest" link, checked against the SHA-256 list BtbN publishes beside it. The Windows job also keeps the downloads in the Actions cache, so a download that disappears can't break a build that already has it.

### D-088 · Every place in Ctrl+K
- **Date:** 2026-11-18 · **Approved by:** project owner
- With nothing typed, the command palette lists every place to go (it showed only the first six): Home, each category, Arcade, Favorites, Later, Tags, Smart lists, Discs, Settings and Big Picture; each smart list shows when its name is typed.

### D-087 · Big Picture's cursor above its pop-ups
- **Date:** 2026-11-18 · **Approved by:** project owner
- The round cursor is drawn in the window's top layer (outside Big Picture's page), so menus, dialogs and panels that open in their own layer no longer cover it.

### D-086 · Home's tiles centered
- **Date:** 2026-11-18 · **Approved by:** project owner
- Home's section tiles keep equal widths in balanced rows, and a shorter last row sits centered under the others (with Everything off there's one tile fewer).

### D-085 · Hold the X to quit
- **Date:** 2026-11-18 · **Approved by:** project owner
- With Digitify kept in the tray, holding the window's X for about a second quits it outright; a red ring fills around the X while it's held, and letting go early is a plain click (to the tray). Settings › Window and startup › Hold the X to quit (on by default).

### D-084 · The tray on by default (changes D-059)
- **Date:** 2026-11-18 · **Approved by:** project owner
- "Keep running in the tray when closed" is now on by default, so closing the window keeps Digitify quietly by the clock (D-076). A setting already saved as off stays off.

### D-083 · Games started outside Digitify
- **Date:** 2026-11-18 · **Approved by:** project owner
- Every 8 seconds, when no game is being played, the core looks for a program running from one of Arcade's PC games' folders (its program path; on Linux also its command line, for Proton), leaving out crash reporters and anti-cheat helpers. A game started from its own launcher, a shortcut or before Digitify opened is then shown playing and its time counted until no program from its folder is left, as if started from Arcade (time before Digitify noticed it isn't counted). A launch from Arcade that's still waiting for its game keeps the watch out of the way. Emulator games started outside aren't seen.

### D-082 · Settings in order
- **Date:** 2026-11-18 · **Approved by:** project owner (chose one page, well grouped)
- One page, each panel with what belongs together: Appearance (style, palette, theme, accent, colors per section, animations, light mode); Library (the folder, its categories, then Views: Everything, same view everywhere, cover size and shapes, shelves; then Importing: when importing, watched folders); Window and startup (start with the computer, open maximized, keep in the tray, ask before closing, offer to continue, what's new after updates); Reading (night filter); Sound; Arcade; Online services; Keyboard; Backups and maintenance; About (version, What's new, notices). New icons replace the sparkle one everywhere (Smart lists: a filtered list; Big Picture's startup switch: a clapperboard; Your year: a calendar).

### D-081 · What's new after an update
- **Date:** 2026-11-18 · **Approved by:** project owner (version 0.2.0)
- Digitify's version is now 0.2.0 (0.x until a first public release; bigger updates raise the middle number, small fixes the last). After an update, a clean window says what's new and what was fixed, in plain words, with the version and its date, once; "Don't show these after updates" turns it off (Settings › Window and startup turns it back on) and Settings › About shows it any time. A new library doesn't get it. The notes live in `src/lib/releaseNotes.ts`, one entry per version.

### D-080 · Ask before closing
- **Date:** 2026-11-18 · **Approved by:** project owner
- With "Keep running in the tray" off, the window's X (and Alt+F4) asks "Close Digitify?" before quitting, with "Don't ask again"; on by default, and switched in Settings › Window and startup. With the tray on it never asks, since closing only hides the window.

### D-079 · Epic's new launcher
- **Date:** 2026-11-18 · **Approved by:** project owner
- The new Epic Games launcher keeps its installs in `%LOCALAPPDATA%\com.epicgames.eglv2\installations.jsonl` (and titles, kinds and art in its `cache\prod\catalog-cache.json`) instead of the classic launcher's manifests in ProgramData. Arcade reads both, each game once, leaving out parts of another install, unfinished installs and anything that isn't a game; games start through the same `com.epicgames.launcher://` link, which the new launcher answers.

### D-078 · Now playing page
- **Date:** 2026-11-18 · **Approved by:** project owner (chose a full page)
- The music player gets a page of its own (`/now-playing`), like Big Picture's Now playing in the app's own look: the cover big over its blurred colors, title, artist and album, the favorite heart, the timeline, big controls, the volume and the sleep timer, and the queue: jump to a track, move it up or down, remove it, or stop and clear. The mini player's cover and title open it (it replaces the small Now playing panel); Back returns to where you were.

### D-077 · One Digitify at a time
- **Date:** 2026-11-18 · **Approved by:** project owner
- Opening Digitify while it's already running brings back the window that's open (from the tray too) instead of starting a second copy, through `tauri-plugin-single-instance` (MIT or Apache-2.0; a named mutex on Windows, D-Bus on Linux). A copy started with its own config folder (`DIGITIFY_CONFIG_DIR`, for trying things out) still runs on its own unless `DIGITIFY_SINGLE_INSTANCE` is set.

### D-076 · Quiet in the tray (changes D-059)
- **Date:** 2026-11-18 · **Approved by:** project owner
- With "Keep running in the tray when closed" on, closing the window now pauses the music and any video and holds the menu music, so nothing plays while the window is away; opening Digitify again (the icon, its menu or opening it again) plays the music on from where it stopped. The icon's Play / Pause still works for whoever wants music with the window away. Started hidden with the computer, it stays quiet until opened.

### D-075 · Library remembers its section
- **Date:** 2026-11-18 · **Approved by:** project owner
- As Arcade does, Library opens on the section used last (a category, Favorites or Later), from the title bar's Library button and in Big Picture; the first category when that one is gone. Kept with the preferences, so it holds after a restart.

### D-074 · Everything off by default
- **Date:** 2026-11-18 · **Approved by:** project owner (chose everywhere)
- Library's Everything view no longer shows by default: every item is in its own category. Settings › Library › Show Everything brings it back in Library's sections, on Home's tiles, in Big Picture's Library and in the command palette. Links that showed the whole library (Home's "Recently added › More") still open it.

### D-073 · Photos at one height
- **Date:** 2026-11-18 · **Approved by:** project owner (chose justified rows)
- Every photo card carries its own proportions (width / height, upright, kept between 0.4 and 2.6), from the core (`aspect` on the card, `library_query_aspects` for a whole view). In Grid a view of photos is laid out in justified rows: each full row fills the width and its photos share one height, none cropped; the last row keeps the usual height. On shelves photos stand at the same height as the collections beside them and each shelf holds as many as fit; Detailed, Carousel, Home's rows and Big Picture's tiles draw each photo whole at their one height.

### D-072 · Now playing in Big Picture
- **Date:** 2026-11-18 · **Approved by:** project owner
- A full-screen Big Picture screen for the music: the cover big over its own blurred colors, title and artist, the timeline, big controls (shuffle, previous, play/pause, next, repeat) and Up next, whose tracks can be picked. It opens from the music in the top bar and when an album or song is played from Big Picture. LB/RB skip tracks, LT/RT move 10 seconds, X plays or pauses.

### D-071 · Players driven like a console in Big Picture
- **Date:** 2026-11-18 · **Approved by:** project owner (chose buttons with the D-pad over the cursor)
- The video player, the readers and the photo viewer opened from Big Picture wear its look: dark glass bars sized for the TV, big round buttons, the clock, the button hints, and its bright ring on what's selected. With the bars away the controller's quick buttons act at once (X plays or pauses, the bumpers skip or zoom, the D-pad turns pages or seeks). A (or Menu) brings the bars and selects the main button; the D-pad moves from button to button, A presses, left and right move a slider (the timeline too) or change a list, B closes an open menu or puts the bars away, and B with the bars away goes back. Moving and pressing tick softly with the interface sounds. In Big Picture's cursor mode they work as before, with the cursor.

### D-070 · Big Picture's startup
- **Date:** 2026-11-18 · **Approved by:** project owner (chose the logo with light and a chord)
- Entering Big Picture plays a short startup: the Digitify logo draws itself in the accent color with a glow, a sweep of light crosses it, "Digitify · Big Picture" comes in, and an original sound made by the app (a rising whoosh opening into a soft chord with a sparkle, Web Audio, nothing recorded or licensed) plays with it; about three seconds, then Home arrives with its own animation. Any button, key or click skips it; without animations it's a brief still. Big Picture's menu › Startup animation turns it off (on by default). Screens in Big Picture also arrive softly, and moving the selection ticks.

### D-069 · Night reading filter
- **Date:** 2026-11-18 · **Approved by:** project owner (chose a button plus an optional schedule)
- The readers (books, comics, manga, PDFs) have a moon-and-sun button that lays a warm tone over the pages, under the bars. Settings › Appearance › Night reading filter sets how warm (10–80%) and an optional schedule ("On by itself from 21:00 to 07:00", off by default; it can run past midnight). The button wins over the schedule until the app closes.

### D-068 · Continue where you left off
- **Date:** 2026-11-18 · **Approved by:** project owner
- When the app opens, a small notice offers the book, comic, film or series left halfway in the last week, or the game played last, whichever is newer: "Keep reading · 75%", "Keep watching", "Keep playing". It goes away after 15 seconds or when you open something else; once per launch. Settings › Appearance › Offer to continue when opening (on by default).

### D-067 · Activity calendar
- **Date:** 2026-11-18 · **Approved by:** project owner
- Statistics show the year as a calendar of days, darker the more time had reading, watching, listening or playing (levels from the year's own busiest days, one hue), with each day's time on hover and arrows to earlier years.

### D-066 · Achievements
- **Date:** 2026-11-18 · **Approved by:** project owner (chose a small notice plus a list in Statistics)
- Medals reached by themselves, in levels: Finisher, Bookworm, Cinephile, Audiophile, Player, Collector, Arcade regular, Critic and On a roll (days in a row). The library remembers when each was reached (`achievements` table, v22), so each is announced once, by a small notice at the bottom right (several at once say how many). Statistics list each family with its level, the next step and how far along it is. Nothing is sent anywhere.

### D-065 · Your year in Digitify
- **Date:** 2026-11-18 · **Approved by:** project owner
- "Your 2026" beside the calendar opens a big summary of the chosen year: time reading, watching, listening and playing, things finished and added, days active, the longest streak, the busiest month and day, and what took the most time (items, games, artists). From the library's own records only.

### D-064 · Because you liked
- **Date:** 2026-11-18 · **Approved by:** project owner
- A Home row (Library and Big Picture) from an item you rated 4 stars or more or marked favorite lately: others of yours in the same category that share its series, people, tags, genre or collection, unfinished, best match first. Nothing is looked up online. It can be moved or hidden in Customize Home.

### D-063 · Video bookmarks
- **Date:** 2026-11-18 · **Approved by:** project owner
- The video player's Bookmarks menu adds a bookmark at the current moment, jumps to one, renames or removes it; each episode has its own. Stored with the books' bookmarks (`{"time": seconds, "part": episode}`).

### D-062 · Later
- **Date:** 2026-11-18 · **Approved by:** project owner
- "Later" on an item's page keeps it in a list of things to watch, read or listen to soon (`later` table, v21): a Library section beside Favorites (newest added first), a Home row, and the command palette.

### D-061 · Sleep timer
- **Date:** 2026-11-18 · **Approved by:** project owner
- A moon button in the mini player and the video player stops music and video after 15–90 minutes, or at the end of the track or episode, fading out over the last 20 seconds and giving the volume back. The button shows the minutes left.

### D-060 · Watched folders
- **Date:** 2026-11-18 · **Approved by:** project owner (chose a category per folder)
- Settings › Library › Watched folders: folders Digitify looks in now and then (a little after start, then every 2 minutes, or "Look now"); new files are imported, kept where they are, into the category chosen for that folder. Files still being written (changed in the last minute) wait for the next look; files that can't be imported aren't tried again until the app restarts. Nothing is ever deleted or moved.

### D-059 · Tray icon
- **Date:** 2026-11-18 · **Approved by:** project owner (chose: closing works as before, keeping it in the tray is a setting, off)
- An icon by the clock (Windows' notification area; Linux's AppIndicator, where the desktop shows one) with Show Digitify, Play/Pause, Next and Quit; its tooltip says what's playing. Settings › Appearance › Keep running in the tray when closed (off by default): then closing hides the window and the music goes on; started with the computer, it starts there. Linux needs `libayatana-appindicator` (the .deb asks for it, the AppImage carries it, the Arch script installs it).

### D-058 · Media keys and system media controls
- **Date:** 2026-11-18 · **Approved by:** project owner
- The keyboard's play/pause, next, previous and stop keys, and the system's media controls (Windows' media overlay, Linux's MPRIS), control the video playing or else the music, and show its title and artist. Through `souvlaki` (MIT).

### D-057 · Library check
- **Date:** 2026-11-09 · **Approved by:** project owner (asked for this set of features)
- Settings › Backups and maintenance › Check the library opens one page with the files that aren't at their saved place (with Find moved files) and the same file content in more than one item (by quick hash and size), each linking to its item.

### D-056 · Automatic backups
- **Date:** 2026-11-09 · **Approved by:** project owner
- Off until switched on: every day, week or month, kept in the library's backups folder (the last 3–30) and, when a folder is chosen, copied to `Digitify backups` inside it (another drive is best). The folder is never created out of nothing: when it can't be reached (a drive not connected), the backup is still made in the library and Home and Settings say so. The core checks a little after start and then every half hour; "Back up now" runs one at once.

### D-055 · Big Picture: favorites from the controller
- **Date:** 2026-11-09 · **Approved by:** project owner
- View (Xbox) / Create (PlayStation) marks the selected item or game as a favorite, or stops it being one; tiles show a heart. LB/RB already switch categories and consoles, X already plays and pauses the music. Big Picture's Home also has Up next.

### D-054 · Colors per section
- **Date:** 2026-11-09 · **Approved by:** project owner (chose off by default)
- Settings › Appearance › Colors per section (Breeze): each section's own color stands in for the accent while you're in it (Pictures, Music, Videos, Movies & Series, Books, Comics, Manga, Arcade), each changeable, with "Default colors". Off, everything uses the accent as before.

### D-053 · Video in the corner
- **Date:** 2026-11-09 · **Approved by:** project owner (chose the video in a corner, music stays in the title bar)
- The player's "Keep watching in a corner" hands its running mpv session to a small frame at the bottom right that stays while you browse: play/pause, back to the full player (it takes the same session back, no restart) and close; progress keeps being saved; the menu music stays held. On Windows the picture is under the window, so the page gets a hole there (a CSS mask); on Linux it sits above the page in the frame. Not for disc titles.

### D-052 · Goals and streak
- **Date:** 2026-11-09 · **Approved by:** project owner (chose goals you set plus a streak)
- Statistics show the days in a row with any reading, watching, listening or playing (and the best run), and this month's goals you set (things finished, hours of each activity), with how far along each is. Goals live in the preferences; the streak comes from the activity days.

### D-051 · Smart lists
- **Date:** 2026-11-09 · **Approved by:** project owner (chose Library only)
- Library › Smart lists: saved rules that fill a list by themselves (a section, progress, your rating, years, how recently added, a tag, favorites, with files), with the count while you set them; each opens as a Library view, can be edited or deleted (its items stay put). Migration 19 adds `smart_lists`; the library query takes the new rules.

### D-050 · Up next
- **Date:** 2026-11-09 · **Approved by:** project owner
- A Home section (and in Big Picture) mixing what comes next: the film or series being watched, the book being read, the next volume of a series just finished, and the games played lately, taken in turns.

### D-049 · Your rating and notes
- **Date:** 2026-11-09 · **Approved by:** project owner
- 1–5 stars and a personal note on every item (its page) and game (its panel); choosing the same star again clears it, the note saves when you leave the box. "Your rating" sorts in the Library and Arcade. Migration 18 adds the note (items already had a rating column) and both to games.

### D-048 · Command palette
- **Date:** 2026-11-09 · **Approved by:** project owner
- Ctrl+K (changeable in Settings › Keyboard) opens a box to find anything: Library's sections, smart lists, Arcade, Discs, Settings, Big Picture, actions (import, link, theme, menu music), items in the library and games, with the keyboard (↑ ↓ Enter, Esc). The app's own shortcut handler opens it (a first version let that handler swallow the key).

### D-047 · Start with the computer; sliding highlight in button groups; Linux checked against Windows
- **Date:** 2026-11-08 · **Approved by:** project owner (asked for each of these)
- **Start with your computer** (Settings › Appearance, off by default): Windows adds a value under the user's own `HKCU\…\CurrentVersion\Run` key (no admin rights), Linux writes `~/.config/autostart/digitify.desktop` (the freedesktop autostart entry; the AppImage's own path when run from one). The entry itself is the setting, so Settings always shows what the system will do. `DIGITIFY_AUTOSTART_NAME` gives tests another entry name.
- **Sliding highlight:** every button group (Library's sections, Arcade's views, layouts, filters, Music's tabs, Settings' choices) has one highlight that slides to the chosen button, with a little spring, instead of jumping; a group drawn again in a new view (changing category) slides from where its highlight was. Off with reduced or no animations and in light mode.
- **Linux against Windows:** the core's tests pass on Linux too (75; two episode tests used Windows-only paths and were made portable); a sweep of Home, Library, Arcade, Settings and Big Picture on Arch matched Windows with a clean log. Settings' Animations said "follow Windows" on Linux: it now says "follow the system" there, and its box is wide enough for either.

### D-046 · Opens maximized; Music's tabs and Tags hold their place
- **Date:** 2026-11-08 · **Approved by:** project owner (asked for each of these)
- **Opens maximized** by default; Settings › Appearance › Open maximized (on by default) turned off opens it at its regular size. The core reads the saved preference when the window is made, so it's maximized before it shows.
- **Music's tabs** sit on the title's own line, so the count under it ("1,234 items · 3 collections") can't push them: they're in the same place in every tab.
- **Tags** uses the same frame as the other Library views: the header and section buttons no longer fade in again or shift a few pixels when going to Tags or between tags; only the list arrives.

### D-045 · Library animates what arrives, not what stays
- **Date:** 2026-11-08 · **Approved by:** project owner (asked for Library to arrive like Arcade, and for what stays in place not to animate)
- **Library's header and section buttons** fade up when Library is opened (from Home, Arcade or anywhere else), as Arcade's page does, and hold still when the category, Music tab or a setting changes.
- **A view's title** slides in when it changes (Pictures to Books) and holds still when it's the same (Music's tabs), with its tabs; changing the layout, filter or sort animates only the items.
- **How:** changing view rebuilds it, and the new view draws while the old one is still there; a part still on screen, or gone a moment ago, is a redraw, not an arrival (`lib/arrival.ts`).

### D-044 · Library's header and buttons hold still; one Size; Select after Size; Music's tabs beside its title
- **Date:** 2026-11-07 · **Approved by:** project owner (asked for each of these)
- **No replay on a category change:** D-043's pop-in of Library's title, description and section buttons is gone: they stay as they are from one view to the next, as Arcade's do.
- **One Size:** Arcade uses the Library's cover size (Arcade's own Size from D-037 is dropped), so the same Size gives covers of the same height in both (1.5 × the size).
- **Tools:** Find, Size, Select, Sort in that order in Arcade and the Library, as one group with a fixed place: the rest of the line, or a line of its own when the buttons before it are wide. On Music's other tabs the group is there empty, so Library's header, buttons and the view's title stay at the same height in every view.
- **Music's tabs** (Tracks, Artists, Playlists, Recently played, Favorites) sit beside the Music title instead of under it.

### D-043 · Arcade at one height, play time added by hand; Library's tools beside its sections, centered rows, collections on "All"
- **Date:** 2026-11-07 · **Approved by:** project owner (asked for each of these)
- **Arcade's covers at one height:** every console's covers are as tall as a GameCube box at the chosen size, each as wide as its shape (Nintendo 64 boxes are wider, not shorter); rows are centered. The line under a game is one line, so it never lifts the cover out of line.
- **Play time added by hand:** a game's panel can add time played outside Digitify (hours and minutes), kept apart from what Digitify counts (migration 17: `extra_seconds`) and shown as part of the total ("… added by you"). The statistics' days keep only what Digitify counted. The line under a game shows its console or store and then its play time, so play time no longer takes the console's place (Arcade, Home's rows, Big Picture).
- **Home:** "(Library)" and "(Arcade)" sit beside the golden Featured today and Game of the day banners, not inside them.
- **Library:** the view's Find, Select, Size and Sort sit in one toolbar with the section buttons, like Arcade's (they wrap to a second line when the window is narrow); layouts, filters, shelf options and Arrange stay above the items. Library's title, description and section buttons arrived with a pop-in (dropped in D-044).
- **Grid rows centered:** each row of the grid is centered on its own, so rows of different widths (mixed shapes, the last row) don't leave one edge further out than another.
- **Collections open on "All":** inside a collection the filter (All, Digital, Collections…) starts at All every time and isn't carried from the view before or remembered.

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
- **Downloads from YouTube and Spotify:** asked for and declined (YouTube's terms forbid it and its files sit behind technical protection; Spotify's are DRM-protected, D-007). The owner then kept links as online items (D-028) and turned down the lawful alternatives offered (replacing an online item with an owned file, Internet Archive, Vimeo downloads the author allows, Google Takeout). The owner later decided YouTube downloads go in (D-133).
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
  - **YouTube and YouTube Music:** saved as online items and played in YouTube's embedded player (youtube-nocookie, with the app's origin, since YouTube refuses embeds that don't say where they are; "Open on YouTube" is always there for videos whose owners block embedding). Never downloaded: YouTube's terms don't allow it (changed by D-133: downloaded with yt-dlp). Without a key a link is looked up through YouTube's public oEmbed (title, channel, thumbnail) and a playlist stays one link; with a YouTube Data API v3 key, playlists are listed video by video with lengths and availability (up to 500).
  - **Spotify:** saved as online items and played in Spotify's embedded player (previews unless signed in to Spotify there). Never downloaded. With the owner's client ID and secret, a track's artists and length and an album's songs are listed; since February 2026 Spotify lists a playlist's songs only to its owner or collaborators, so other playlists are saved as one link. Spotify also requires the developer app's owner to have Premium.
  - **SoundCloud:** with the owner's client ID and secret (client-credentials flow), tracks and sets are resolved and a set's tracks listed; a track whose uploader made it downloadable is downloaded; everything else is an online item played in SoundCloud's widget. Without keys a link is saved as one online item.
  - **Direct links to audio or video files:** downloaded.
- **Three kinds of items:** local files; downloaded media (a normal managed file in the library folder, under `<Category>\Downloads`, available offline, with where it came from recorded); online items (no files, marked with a cloud on their cover and "Online, needs a connection" on their page, played at `/online/<id>`). They're all ordinary items (favorites, tags, shelves, sorting, search, covers, selection, Big Picture). An online song isn't a playable track, so "Add to playlist" isn't offered for a selection that includes one, and the library's music player skips nothing it can't play.
- **Duplicates:** the same thing from the same service (YouTube and YouTube Music count as one), or the same downloaded file (by its fingerprint), is skipped and pointed at the existing item; nothing is replaced, except that downloading something kept as an online item replaces that online item, carrying over its favorite mark, tags and shelves.
- **The queue:** two workers in the background; per-item progress, cancel (no half-downloaded files left) and retry; one failure doesn't stop the rest; requests to a service are spaced and a "slow down" answer is waited out once; errors are explained (removed, private or region-locked, no connection, keys refused, rate-limited, not a media file).
- **Playlists:** importing a music playlist can make a Digitify playlist of its songs that are available offline, in the original order.
- **Keys:** entered in Settings › Online services, stored encrypted for the Windows account (DPAPI) in the config folder, never sent back to the interface or written to logs.
- **Not done, on purpose:** no downloading from YouTube (changed by D-133) or Spotify, no stream capture, no scraping of web pages, no signing in to the services.

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
- The title bar has Home and Library, as Big Picture does (the labels give way to icons in narrow windows); the search box sits next to them. (Its back and forward arrows went in D-138: each page has its own Back.)
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

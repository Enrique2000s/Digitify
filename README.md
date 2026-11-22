# Digitify

> Your whole media collection and all your games, in one place.

Digitify is an offline-first desktop app for **Windows and Linux** with two purposes (D-110):

- **Library**, a home for all your media: your books, comics and manga, music, videos, movies and series in one library that lives on your own computer, with built-in readers and players.
- **Arcade**, a universal launcher for your games: the games of your PC stores (Steam, Epic Games, Xbox, GOG, Ubisoft Connect, the EA app, Battle.net, Amazon Games, itch.io, Heroic, Lutris, and Minecraft), of your emulators, and any program you add, each started the way it always starts.
 No accounts, no cloud, no telemetry: it goes online only when you import from a link (D-008, D-028). See [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) for the original brief.

## What it does
- **One library** for Pictures, Books, Comics, Manga, Music, Videos and Movies & Series, in fixed categories you can reorder or hide. Each file is its own item (a series keeps its episodes together).
- **Music from videos:** a video added to Music becomes an MP3 track (its sound; the video stays as it is).
- **Import** files and folders (kept where they are, or copied into the library folder), with their metadata and artwork; duplicates are recognized by content.
- **From a link:** Music and Videos each have their own menu, saying which sites they take. Videos, songs, playlists and channels from YouTube, YouTube Music, SoundCloud, Bandcamp, Twitch, Dailymotion and the other sites yt-dlp knows are downloaded into the library (as sound in Music, as video in Videos, in the quality and format you pick) and look like any other file, or are saved as online items that play in the services' own players. Spotify links are online items (its music is DRM-protected). Items saved online can be downloaded later. A playlist or channel comes in 25 at a time, into a collection (videos) or a playlist (songs) that its next sections join. yt-dlp comes with Digitify and can be updated from Settings › Online services.
- **Downloads and imports:** the title bar's download button shows what's coming in from links and files, with progress and cancel, and the history of what came in (kept until you clear it), with retry for what failed.
- **Moving around:** each page has its own Back (no back or forward in the title bar), an item's page steps to the previous and next item of the list it was opened from (going round at the ends), Play on music opens the music player, and the video player's Back keeps the video playing in a corner while you browse (or closes it, in Settings); drag the corner video to any corner.
- **Videos into Movies & Series:** Movies & Series › Add › From Videos turns videos you have into movies, or into a series' episodes.
- **Views:** Grid, Shelf (with wood, glass or metal shelves), List, Detailed and a 3D Carousel; sort by title, date, year, creator, duration or your own order (drag covers into place); filter by All, Digital, Online (Music and Videos) and Collections.
- **Organize:** each category's Media, Collections (folders that open in a window; Music uses playlists) and Favorites, as tabs, and multi-select edits that offer only what fits every selected item (cover image and shape, add to playlist, move…).
- **Pictures:** photos with their albums (from folders), shown whole at one height (justified rows in the grid), EXIF details and an image viewer with zoom, slideshow, photo info, turn and mirror; a photo can be an album's cover or Home's background.
- **Arcade:** a launcher for your installed PC games (Steam, Epic Games (the classic and the new launcher), Xbox and GOG on Windows; Ubisoft Connect, the EA app, Battle.net, the Rockstar Games Launcher, the Riot Client and Amazon Games on Windows; Steam and itch.io on both; Heroic and Lutris on Linux; Minecraft: Java Edition through its launcher, Bedrock on Windows, and each Prism Launcher or MultiMC instance, on both), for any game you add by its program (in its own Other PC view), with their launchers' covers, which it keeps up to date as you install and remove them, and for the games of Dolphin (GameCube, Wii), Project64 (Windows) and RMG (Nintendo 64), DuckStation (PlayStation), PCSX2 (PlayStation 2), RPCS3 (PlayStation 3), melonDS and DeSmuME (Nintendo DS), Mesen (NES, Super Nintendo, Game Boy, Game Boy Advance, PC Engine, Master System, Game Gear), FCEUX and Nestopia (NES), Snes9x and ZSNES (Super Nintendo), mGBA (Game Boy, Game Boy Advance), Kega Fusion (Mega Drive, Sega CD, Master System, Game Gear), Flycast and nullDC (Dreamcast), PPSSPP (PSP), Azahar / Lime3DS (3DS), Cemu (Wii U), Ryujinx (Switch), xemu (Xbox), Xenia (Xbox 360, Windows), ares (many consoles), and RetroArch's playlists (each console in its own view, started with its core): it finds the games in their folders, shows their covers, and starts each in its emulator with the emulator's own settings, counting play time. A store or console shows only once it has a game, and the views scroll in one row however many there are. Emulators & folders sorts it all in tabs (launchers, emulators by maker, which emulator plays each console, folders and covers), with each store's and console's symbol; an emulator found but not wanted can be set aside. Find covers shows every cover found to choose from: also LaunchBox's database (downloaded once when you ask), Nintendo's store and the Microsoft Store, and SteamGridDB with your own key, by the game's name, the other names LaunchBox knows it by, or any words you type (it needn't be exact). Collections, as in Steam, on their own screen: Favorites, Completed, your own, and dynamic ones that fill themselves by words in the name, consoles and launchers, play state and completed; games can be marked as completed and sorted by console under headings, and given keywords of your own (one game or many at once) that the search and dynamic collections find them by. Surprise me, in Arcade and the Library, picks something you haven't finished; Steam's own play time can be brought into Arcade; Home sums up your week and saves it as a picture. Each game can play in its own emulator, and its badge shows the logo and name, the logo alone or nothing (Settings › Arcade). The search in the title bar opens its own screen with your media and Arcade's games, one or both. While a game runs Digitify stays open with its music silenced (you can turn it back on), or hides until the game ends, or closes, as set in Settings › Arcade. Its views (All games, first and shown when it opens unless switched off, All PC games, All ROM games, each store, each maker's consoles in one menu) can be reordered or hidden in Settings › Arcade. Game folders can be set per emulator; games can be selected, removed or put in your own order by dragging. Covers come from Dolphin, RetroArch, GameTDB, libretro-thumbnails or the stores; Find missing covers looks for all the missing ones at once. No games, BIOS or emulators are included.
- **Readers:** ebooks (EPUB and more), PDFs, comics and manga (CBZ, CBR, CB7, CBT, image folders) with right-to-left reading, page-turn effects and bookmarks.
- **Players:** video through mpv (subtitles, audio tracks, chapters, resume for films and series), music with a queue, playlists, a mini-player and a Now playing page, and the menu music (Digitify's own theme or your music).
- **Discs:** play and rip audio CDs (verified), play and import home-made DVDs and Blu-rays. Copy-protected discs are recognized and never worked around (D-007).
- **Big Picture:** a full-screen TV interface for Xbox and PlayStation controllers (or the mouse), with a startup animation and sound, its own Home, library, search with an on-screen keyboard, a Now playing screen for music, and players and readers in its own look, driven button by button like a console.
- **Find and keep track:** a command palette (Ctrl+K) to find anything, your own star ratings and notes, an Up next row, monthly goals and a streak in the statistics, a video that keeps playing in a corner while you browse, video bookmarks, "Because you liked" from your own library, your year in Digitify, achievements and an activity calendar.
- **Safe:** automatic backups (daily, weekly or monthly) to another drive, and a library check for missing files and duplicates.
- **Around the desktop:** media keys and the system's media controls, an icon by the clock (and keeping it running there, quietly, when closed, if you like), only one Digitify open at a time, watched folders that import new files by themselves, a sleep timer, "continue where you left off" when it opens, and a night filter for reading.
- **Your profile:** your picture (framed and adjusted as you like), banner, name and a line about you, with what your library says about you (items, games and hours played, games completed, this year's time, achievements), shared as a picture made on your computer; in Big Picture too.
- **The manual:** Digitify Manual, a designed PDF in Books explaining every feature; it updates itself, and Books › Add brings it back if deleted.
- **Make it yours:** four styles (Breeze, Cinematic, Frutiger Aero and Minimal) in light and dark, palettes, accent colors, colors per section, a customizable Home with Arcade's games and statistics of what you read, watch, listen to and play, keyboard shortcuts, animations you can turn off, opening maximized or at a regular size, starting with your computer, an Everything view you can turn on, and a performance mode for slower computers.

Progress, test results and known limits are in [docs/STATUS.md](docs/STATUS.md); every decision is in [docs/DECISIONS.md](docs/DECISIONS.md).

## Documentation
| Document | Contents |
|---|---|
| [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) | The original project brief, verbatim |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Every approved product and architecture decision (D-001…) |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Phases, milestones and open decisions |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How the app is put together |
| [docs/STATUS.md](docs/STATUS.md) | Feature status, test results and known limitations |
| [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) | Licenses of the helper programs and libraries |

## Installing

### Windows 11 (x64)
Run `Digitify_0.6.0_x64-setup.exe`. It installs for the current user in `%LOCALAPPDATA%\Digitify` without admin rights, and adds Start menu and desktop shortcuts. Uninstall it from Settings › Apps; that removes the program, never your library folder, settings or logs.

### Linux (x64)
Built by GitHub Actions:
- **`.deb`** (Ubuntu, Debian, Linux Mint, Pop!_OS…): `sudo apt install ./Digitify_0.6.0_amd64.deb`. It brings in `mpv`, `ffmpeg`, `udisks2` and GStreamer (the web view's sound, and the decoders YouTube's player needs) from the distribution. Digitify then appears in the applications menu. Uninstall with `sudo apt remove digitify`.
- **Arch Linux and Arch-based** (Manjaro, EndeavourOS, CachyOS…): put `install-arch.sh` next to the `.deb` and run `bash install-arch.sh` as your normal user. It installs only the missing packages Digitify needs, YouTube's video decoders included (never `pacman -Syu`), turns the `.deb` into a pacman package and installs it. Uninstall with `sudo pacman -R digitify`. If pacman reports missing files (404), your package lists are out of date: update your system as you normally do, then run it again.
- **AppImage** (any distribution; it carries its own GStreamer for the app's sounds, without an H.264 decoder, so YouTube videos don't play in it: on Ubuntu-like and Arch-based systems use the `.deb` or `install-arch.sh` for that): install `mpv` and `ffmpeg` with your package manager first, then `chmod +x Digitify_0.6.0_amd64.AppImage` and run it. Nothing is installed; delete the file to remove it.

On Wayland desktops Digitify runs through XWayland (needed to show video inside its window). Disc drives appear as `sr0`, `sr1`…; your user needs read access to them (usually the `cdrom` or `optical` group).

### Giving Digitify to someone
Send the file itself (a USB stick, Google Drive, WeTransfer, a chat app): the Windows installer, or for Linux the `.deb` (simplest on Ubuntu-like systems; on Arch, together with `install-arch.sh`) or the AppImage (any distribution). The GitHub repository is private, so they can't download it from there themselves.

## Getting the installers
| Platform | How | Where it ends up |
|---|---|---|
| Windows | `npm run installer` on this PC | `installer\Digitify_0.6.0_x64-setup.exe` |
| Linux | GitHub builds and tests every push to `main`, and keeps the packages for a week when you run Actions › **Build installers** › **Run workflow** (or push a version tag such as `v0.6.0`); then `npm run installer:linux` downloads them (needs the [GitHub CLI](https://cli.github.com), signed in with `gh auth login`) | `installer\linux\*.deb`, `*.AppImage` and `install-arch.sh` |

Without the GitHub CLI: open the repository's **Actions** tab, the latest **Build installers** run started by hand, and download **digitify-linux** (and **digitify-windows**) under **Artifacts**. The `installer` folder isn't committed.

## Building from source

### Windows 11 x64
- [Node.js](https://nodejs.org) LTS, [Rust](https://rustup.rs) stable (MSVC toolchain)
- Visual Studio 2022 or newer with the **Desktop development with C++** workload
- Microsoft Edge WebView2 Runtime (preinstalled on Windows 11)

```powershell
npm install
powershell -ExecutionPolicy Bypass -File scripts\fetch-deps.ps1    # pinned mpv, FFmpeg and PDFium, hash- and DRM-checked
powershell -ExecutionPolicy Bypass -File scripts\make-samples.ps1  # synthetic test media in samples\
npm run tauri dev                                                  # development build with hot reload
npm run installer                                                  # optimized build + installer, copied to installer\
```

### Linux x64 (Ubuntu 22.04 or newer)
```bash
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev \
  libxdo-dev libssl-dev libdbus-1-dev libx11-dev pkg-config patchelf file mpv ffmpeg \n  gstreamer1.0-plugins-base gstreamer1.0-plugins-good
npm install
bash scripts/fetch-deps.sh     # pinned PDFium, hash- and DRM-checked
npm run tauri dev              # development build
npm run tauri build            # .deb and AppImage in src-tauri/target/release/bundle/
```

The workflow in [.github/workflows/build.yml](.github/workflows/build.yml) does the same on GitHub for both platforms. Every change is made for Windows and Linux together (D-031).

## Trying it
1. On first launch, choose a library folder. The suggestion is `Digitify Library` in your user folder.
2. Use **Add** › **Import a folder…** and pick `samples\import-test` (or drag it onto the window): an EPUB, a PDF, page photos, a manga and a comic, music and videos, all synthetic.
3. Browse with the Grid, Shelf, List, Detailed and Carousel views, open an item, play or read it.
4. Try **Add** › **From a link…** in Music or Videos with a YouTube or SoundCloud link, and **Big Picture** from the controller button in the title bar.

| | Windows | Linux |
|---|---|---|
| Settings and library location | `%LOCALAPPDATA%\com.digitify.desktop\config.json` | `~/.local/share/com.digitify.desktop/config.json` |
| Logs | `%LOCALAPPDATA%\com.digitify.desktop\logs\` | `~/.local/share/com.digitify.desktop/logs/` |
| Online-service keys | encrypted with DPAPI in the config folder | the desktop keyring |

Set `DIGITIFY_CONFIG_DIR` to use another config folder, for example for a throwaway test library.

## Tests
```powershell
cd src-tauri; cargo test --release
```
GitHub Actions runs them on Windows with every build.

## Project layout
```
src/                  React + TypeScript UI
src-tauri/src/        Rust core (database, import, readers, players, discs, online import…)
src-tauri/migrations/ SQLite schema migrations
scripts/              Dependency fetching, sample generation, installer helpers
.github/workflows/    Installer builds for Windows and Linux
docs/                 Requirements, decisions, roadmap, architecture, status
```

## Licensing
Digitify's own license isn't decided yet (D-003). The helper engines run as separate programs: mpv (GPLv2+) and FFmpeg (LGPL build); PDFium (BSD) is loaded as a library. Their notices ship with the app ([THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)). No copyrighted media is included; test media is generated by `scripts\make-samples.ps1`.


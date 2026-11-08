# Digitify

> Your whole media collection, in one place.

Digitify is an offline-first desktop app for **Windows and Linux**. It brings your books, comics and manga, music, videos, movies and series into one library that lives on your own computer, with built-in readers and players. No accounts, no cloud, no telemetry: it goes online only when you import from a link (D-008, D-028). See [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) for the original brief.

## What it does
- **One library** for Pictures, Books, Comics, Manga, Music, Videos and Movies & Series, in fixed categories you can reorder or hide. Each file is its own item (a series keeps its episodes together).
- **Import** files and folders (kept where they are, or copied into the library folder), with their metadata and artwork; duplicates are recognized by content.
- **Import from URL:** YouTube, YouTube Music, Spotify and SoundCloud links are saved as online items that play in the services' own players; files are downloaded only where the service allows it (direct file links, SoundCloud tracks their uploader made downloadable). An import queue shows progress, with cancel and retry.
- **Views:** Grid, Shelf (with wood, glass or metal shelves), List, Detailed and a 3D Carousel; sort by title, date, year, creator, duration or your own order (drag covers into place); filter by All, Digital, Online (Music and Videos) and Collections.
- **Organize:** nested collections, tags, favorites, and multi-select edits that offer only what fits every selected item (cover image and shape, add to playlist, tags, move…).
- **Pictures:** photos with their albums (from folders), EXIF details and an image viewer with zoom, slideshow, photo info, turn and mirror; a photo can be an album's cover or Home's background.
- **Arcade:** a launcher for your installed PC games (Steam, Epic Games and Xbox on Windows; Steam and Heroic on Linux), with their launchers' covers, which it keeps up to date as you install and remove them, and for the games of Dolphin (GameCube, Wii), Project64 (Windows) and RMG (Nintendo 64): it finds the games in their folders, shows their covers (Dolphin's or GameTDB's), and starts each in its emulator with the emulator's own settings, counting play time. While a game runs Digitify stays open with its music silenced (you can turn it back on), or hides until the game ends, or closes, as set in Settings › Arcade. Its views (All PC games, All ROM games, each store, each console, Favorites) can be reordered, hidden or have the two All views combined in Settings › Arcade. Game folders can be set per emulator; games can be selected, removed or put in your own order by dragging. Covers come from Dolphin, GameTDB or libretro-thumbnails. No games, BIOS or emulators are included.
- **Readers:** ebooks (EPUB and more), PDFs, comics and manga (CBZ, CBR, CB7, CBT, image folders) with right-to-left reading, page-turn effects and bookmarks.
- **Players:** video through mpv (subtitles, audio tracks, chapters, resume for films and series), music with a queue, playlists and a mini-player, and the menu music (Digitify's own theme or your music).
- **Discs:** play and rip audio CDs (verified), play and import home-made DVDs and Blu-rays. Copy-protected discs are recognized and never worked around (D-007).
- **Big Picture:** a full-screen TV interface for Xbox and PlayStation controllers (or the mouse), with its own Home, library, search with an on-screen keyboard, and players.
- **Make it yours:** Breeze and Cinematic looks, palettes, accent colors, a customizable Home with Arcade's games and statistics of what you read, watch, listen to and play, keyboard shortcuts, animations you can turn off, opening maximized or at a regular size, and a light mode for slower computers.

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
Run `Digitify_0.1.0_x64-setup.exe`. It installs for the current user in `%LOCALAPPDATA%\Digitify` without admin rights, and adds Start menu and desktop shortcuts. Uninstall it from Settings › Apps; that removes the program, never your library folder, settings or logs.

### Linux (x64)
Built by GitHub Actions:
- **`.deb`** (Ubuntu, Debian, Linux Mint, Pop!_OS…): `sudo apt install ./Digitify_0.1.0_amd64.deb`. It brings in `mpv`, `ffmpeg`, `udisks2` and GStreamer (the web view's sound, and the decoders YouTube's player needs) from the distribution. Digitify then appears in the applications menu. Uninstall with `sudo apt remove digitify`.
- **Arch Linux and Arch-based** (Manjaro, EndeavourOS, CachyOS…): put `install-arch.sh` next to the `.deb` and run `bash install-arch.sh` as your normal user. It installs only the missing packages Digitify needs, YouTube's video decoders included (never `pacman -Syu`), turns the `.deb` into a pacman package and installs it. Uninstall with `sudo pacman -R digitify`. If pacman reports missing files (404), your package lists are out of date: update your system as you normally do, then run it again.
- **AppImage** (any distribution; it carries its own GStreamer for the app's sounds, without an H.264 decoder, so YouTube videos don't play in it: on Ubuntu-like and Arch-based systems use the `.deb` or `install-arch.sh` for that): install `mpv` and `ffmpeg` with your package manager first, then `chmod +x Digitify_0.1.0_amd64.AppImage` and run it. Nothing is installed; delete the file to remove it.

On Wayland desktops Digitify runs through XWayland (needed to show video inside its window). Disc drives appear as `sr0`, `sr1`…; your user needs read access to them (usually the `cdrom` or `optical` group).

### Giving Digitify to someone
Send the file itself (a USB stick, Google Drive, WeTransfer, a chat app): the Windows installer, or for Linux the `.deb` (simplest on Ubuntu-like systems; on Arch, together with `install-arch.sh`) or the AppImage (any distribution). The GitHub repository is private, so they can't download it from there themselves.

## Getting the installers
| Platform | How | Where it ends up |
|---|---|---|
| Windows | `npm run installer` on this PC | `installer\Digitify_0.1.0_x64-setup.exe` |
| Linux | GitHub builds it on every push to `main` (or Actions › **Build installers** › **Run workflow**); then `npm run installer:linux` downloads the latest one (needs the [GitHub CLI](https://cli.github.com), signed in with `gh auth login`) | `installer\linux\*.deb`, `*.AppImage` and `install-arch.sh` |

Without the GitHub CLI: open the repository's **Actions** tab, the latest **Build installers** run, and download **digitify-linux** (and **digitify-windows**) under **Artifacts**. The `installer` folder isn't committed.

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
4. Try **Add** › **Import from URL…** with a YouTube or SoundCloud link, and **Big Picture** from the controller button in the title bar.

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


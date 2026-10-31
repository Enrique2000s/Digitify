# Third-party notices

Digitify ships the following third-party software. Licenses for Digitify's own code are not decided yet (decision D-003).

## Helper programs (separate executables, not linked into Digitify)

### mpv 0.41.0
- **Used for:** video playback.
- **Files:** `mpv.exe`
- **License:** GNU General Public License v2 or later (mpv's default build configuration). The official Windows build includes FFmpeg, libplacebo, libass and their dependencies under their own licenses.
- **Source code:** the complete corresponding source for this release is published by the mpv project at <https://github.com/mpv-player/mpv/releases/tag/v0.41.0>.
- **Binary:** official release `mpv-v0.41.0-x86_64-pc-windows-msvc.zip`, SHA-256 `4e197f72…80ff` (see `scripts/fetch-deps.ps1`).
- **No decryption code:** the build was checked for DVD/Blu-ray decryption libraries (none present, decision D-007).

### Vulkan loader
- **Files:** `vulkan-1.dll`, shipped with mpv
- **License:** Apache License 2.0 · <https://github.com/KhronosGroup/Vulkan-Loader>

### FFmpeg 9.0.2
- **Used for:** media probing, artwork frames and, later, encoding and remuxing.
- **Files:** `ffmpeg\` (`ffmpeg.exe`, `ffprobe.exe` and DLLs)
- **License:** GNU Lesser General Public License v2.1 or later (LGPL build). The full license text is in `ffmpeg\LICENSE.txt`.
- **Build:** BtbN FFmpeg-Builds `ffmpeg-n9.0.2-39-g7adfbe40dc-win64-lgpl-shared-9.0`. Build scripts: <https://github.com/BtbN/FFmpeg-Builds>. Source: <https://git.ffmpeg.org/ffmpeg.git> (branch `release/9.0`).

## Fonts (bundled; never loaded from the internet)
- **Nunito:** SIL Open Font License 1.1, Copyright 2014 The Nunito Project Authors · <https://github.com/googlefonts/nunito>

## Libraries compiled into Digitify
| Component | License |
|---|---|
| Tauri, tauri-plugin-dialog, tauri-plugin-log | MIT or Apache-2.0 |
| React, React DOM | MIT |
| TanStack Query, Router, Virtual | MIT |
| Radix UI | MIT |
| Lucide icons | ISC |
| SQLite (via rusqlite) | Public domain (rusqlite: MIT) |
| image, lofty, roxmltree, rayon, serde, thiserror, log, windows-sys | MIT or Apache-2.0 |
| zip, trash, tokio | MIT |
| blake3 | CC0-1.0 or Apache-2.0 |
| walkdir | Unlicense or MIT |

These are the direct dependencies. A complete, machine-generated list covering every transitive dependency (Rust crates and npm packages), plus a written offer for GPL source code with a contact address, will be produced before the first public release.

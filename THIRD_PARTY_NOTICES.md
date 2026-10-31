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

### PDFium (chromium/7881)
- **Used for:** showing PDF pages, and reading PDF titles, authors and covers.
- **Files:** `pdfium.dll`, a library Digitify loads at runtime (not compiled into Digitify).
- **License:** BSD 3-Clause (PDFium). It includes components under their own permissive licenses: FreeType (FreeType License), ICU (Unicode License), libjpeg-turbo (IJG and BSD), OpenJPEG (BSD 2-Clause), libpng, libtiff, Little CMS (MIT), zlib, Abseil and LLVM libc (Apache 2.0), AGG, fast_float and simdutf. The full texts are in `licenses\pdfium\`.
- **Binary:** `pdfium-win-x64.tgz` from <https://github.com/bblanchon/pdfium-binaries> (MIT build scripts), release `chromium/7881`, SHA-256 `73cc0de6…ac08` (see `scripts/fetch-deps.ps1`). Source: <https://pdfium.googlesource.com/pdfium/>.
- **No decryption code:** checked the same way as mpv and FFmpeg (decision D-007).

## Code compiled into Digitify with its own license

### UnRAR (RARLAB), through the `unrar` crate
- **Used for:** reading CBR (RAR) comic archives (decision D-017). Only reading: Digitify never creates RAR archives.
- **Source:** RARLAB's UnRAR source as vendored by `unrar_sys` 0.5.8, unmodified.
- **License:** the UnRAR license, reproduced in full:

```
The source code of UnRAR utility is freeware. This means:

1. All copyrights to RAR and the utility UnRAR are exclusively
   owned by the author - Alexander Roshal.

2. UnRAR source code may be used in any software to handle
   RAR archives without limitations free of charge, but cannot be
   used to develop RAR (WinRAR) compatible archiver and to
   re-create RAR compression algorithm, which is proprietary.
   Distribution of modified UnRAR source code in separate form
   or as a part of other software is permitted, provided that
   full text of this paragraph, starting from "UnRAR source code"
   words, is included in license, or in documentation if license
   is not available, and in source code comments of resulting package.

3. The UnRAR utility may be freely distributed. It is allowed
   to distribute UnRAR inside of other software packages.

4. THE RAR ARCHIVER AND THE UnRAR UTILITY ARE DISTRIBUTED "AS IS".
   NO WARRANTY OF ANY KIND IS EXPRESSED OR IMPLIED.  YOU USE AT
   YOUR OWN RISK. THE AUTHOR WILL NOT BE LIABLE FOR DATA LOSS,
   DAMAGES, LOSS OF PROFITS OR ANY OTHER KIND OF LOSS WHILE USING
   OR MISUSING THIS SOFTWARE.

5. Installing and using the UnRAR utility signifies acceptance of
   these terms and conditions of the license.

6. If you don't agree with terms of the license you must remove
   UnRAR files from your storage devices and cease to use the
   utility.

Alexander L. Roshal
```

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
| image, lofty, roxmltree, rayon, serde, thiserror, log, windows-sys, pdfium-render | MIT or Apache-2.0 |
| imagesize | MIT |
| unrar, unrar_sys (Rust bindings; the UnRAR code itself is above) | MIT or Apache-2.0 |
| sevenz-rust2 (7z, read-only) | Apache-2.0 |
| tar | MIT or Apache-2.0 |
| zip, trash, tokio | MIT |
| blake3 | CC0-1.0 or Apache-2.0 |
| walkdir | Unlicense or MIT |

These are the direct dependencies. A complete, machine-generated list covering every transitive dependency (Rust crates and npm packages), plus a written offer for GPL source code with a contact address, will be produced before the first public release.

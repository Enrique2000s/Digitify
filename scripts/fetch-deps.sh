#!/usr/bin/env bash
# Fetches Digitify's helper engines for Linux at pinned versions (D-031), like fetch-deps.ps1 does
# for Windows. The download is checked against a pinned SHA-256 hash, and the library is scanned for
# DVD/Blu-ray decryption code, which Digitify must never ship (decision D-007).
#
#   PDFium chromium/7881 -> src-tauri/binaries/libpdfium.so   bundled with the app; renders PDF pages (D-013)
#   yt-dlp 2026.10.26    -> tools/yt-dlp/yt-dlp                bundled with the app; downloads from links (D-133)
#   Deno 2.9.8           -> tools/yt-dlp/deno                  bundled with the app; the JavaScript yt-dlp needs for YouTube
#
# mpv and FFmpeg come from the distribution (the .deb depends on them; the AppImage asks for them).
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cache="$root/.cache/deps"
mkdir -p "$cache" "$root/src-tauri/binaries/licenses/pdfium"

url="https://github.com/bblanchon/pdfium-binaries/releases/download/chromium/7881/pdfium-linux-x64.tgz"
sha256="1470e21b8b4a3b4ad7f85684e2da11d94f3b69a86d81dee11b9b6709d927ac1d"
archive="$cache/pdfium-linux-x64.tgz"

fetch_pdfium() {
if [[ ! -f "$archive" ]] || ! echo "$sha256  $archive" | sha256sum -c --status; then
  echo "... downloading PDFium chromium/7881"
  curl -fsSL "$url" -o "$archive"
fi
if ! echo "$sha256  $archive" | sha256sum -c --status; then
  rm -f "$archive"
  echo "SHA-256 mismatch for PDFium" >&2
  exit 1
fi

staging="$(mktemp -d)"
tar -xzf "$archive" -C "$staging"
for marker in DVDCSS_CACHE KEYDB.cfg; do
  if grep -aqi "$marker" "$staging/lib/libpdfium.so"; then
    echo "libpdfium.so contains '$marker', a sign of DVD/Blu-ray decryption code. Digitify must not ship it (decision D-007)." >&2
    exit 1
  fi
done
cp "$staging/lib/libpdfium.so" "$root/src-tauri/binaries/libpdfium.so"
cp "$staging/LICENSE" "$root/src-tauri/binaries/licenses/pdfium/"
cp "$staging"/licenses/* "$root/src-tauri/binaries/licenses/pdfium/"
rm -rf "$staging"
echo "OK  PDFium installed and verified"
}

if [[ -f "$root/src-tauri/binaries/libpdfium.so" && "${1:-}" != "--force" ]]; then
  echo "OK  PDFium is already installed"
else
  fetch_pdfium
fi

# Downloads $1 to $2 (in the cache) unless it's there with the SHA-256 $3, then checks it.
fetch() {
  if [[ ! -f "$2" ]] || ! echo "$3  $2" | sha256sum -c --status; then
    echo "... downloading $(basename "$2")"
    curl -fsSL "$1" -o "$2"
  fi
  if ! echo "$3  $2" | sha256sum -c --status; then
    rm -f "$2"
    echo "SHA-256 mismatch for $(basename "$2")" >&2
    exit 1
  fi
}

# yt-dlp's official build (it carries the JavaScript it runs for YouTube) and Deno, which runs it.
# Settings can update yt-dlp later into the config folder (D-133); this is the version the app ships.
ytdlp_version="2026.10.26"
deno_version="2.9.8"
mkdir -p "$root/tools/yt-dlp/licenses"
if [[ -x "$root/tools/yt-dlp/yt-dlp" && "${1:-}" != "--force" ]]; then
  echo "OK  yt-dlp is already installed"
else
  fetch "https://github.com/yt-dlp/yt-dlp/releases/download/$ytdlp_version/yt-dlp_linux" "$cache/yt-dlp_linux-$ytdlp_version" \
    767ba9dce7052aa196f8b12652f433d76de128ba168966fa84b6394d5e6c6795
  install -m 755 "$cache/yt-dlp_linux-$ytdlp_version" "$root/tools/yt-dlp/yt-dlp"
  printf '%s' "$ytdlp_version" > "$root/tools/yt-dlp/yt-dlp.version"
  curl -fsSL "https://raw.githubusercontent.com/yt-dlp/yt-dlp/$ytdlp_version/LICENSE" -o "$root/tools/yt-dlp/licenses/yt-dlp-LICENSE.txt"
  curl -fsSL "https://raw.githubusercontent.com/yt-dlp/yt-dlp/$ytdlp_version/THIRD_PARTY_LICENSES.txt" -o "$root/tools/yt-dlp/licenses/yt-dlp-THIRD_PARTY_LICENSES.txt"
  echo "OK  yt-dlp $ytdlp_version installed and verified"
fi
if [[ -x "$root/tools/yt-dlp/deno" && "${1:-}" != "--force" ]]; then
  echo "OK  Deno is already installed"
else
  fetch "https://github.com/denoland/deno/releases/download/v$deno_version/deno-x86_64-unknown-linux-gnu.zip" "$cache/deno-$deno_version-linux.zip" \
    e890975bc2549807bbcc0b584ffafda72cc7c93349dd99c80483dd784f6c4609
  staging="$(mktemp -d)"
  python3 -c "import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])" "$cache/deno-$deno_version-linux.zip" "$staging"
  install -m 755 "$staging/deno" "$root/tools/yt-dlp/deno"
  rm -rf "$staging"
  curl -fsSL "https://raw.githubusercontent.com/denoland/deno/v$deno_version/LICENSE.md" -o "$root/tools/yt-dlp/licenses/deno-LICENSE.md"
  echo "OK  Deno $deno_version installed and verified"
fi

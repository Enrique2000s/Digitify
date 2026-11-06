#!/usr/bin/env bash
# Fetches Digitify's helper engines for Linux at pinned versions (D-031), like fetch-deps.ps1 does
# for Windows. The download is checked against a pinned SHA-256 hash, and the library is scanned for
# DVD/Blu-ray decryption code, which Digitify must never ship (decision D-007).
#
#   PDFium chromium/7881 -> src-tauri/binaries/libpdfium.so   bundled with the app; renders PDF pages (D-013)
#
# mpv and FFmpeg come from the distribution (the .deb depends on them; the AppImage asks for them).
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cache="$root/.cache/deps"
mkdir -p "$cache" "$root/src-tauri/binaries/licenses/pdfium"

url="https://github.com/bblanchon/pdfium-binaries/releases/download/chromium/7881/pdfium-linux-x64.tgz"
sha256="1470e21b8b4a3b4ad7f85684e2da11d94f3b69a86d81dee11b9b6709d927ac1d"
archive="$cache/pdfium-linux-x64.tgz"

if [[ -f "$root/src-tauri/binaries/libpdfium.so" && "${1:-}" != "--force" ]]; then
  echo "OK  PDFium is already installed"
  exit 0
fi

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

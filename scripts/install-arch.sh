#!/usr/bin/env bash
# Installs Digitify on Arch Linux and Arch-based distributions (Manjaro, EndeavourOS, CachyOS, Garuda…)
# from the .deb package that GitHub Actions builds.
#
# It turns the .deb into a real pacman package, so pacman knows every file Digitify installs and
# `sudo pacman -R digitify` removes it cleanly. It never runs `pacman -Syu` (or `-Sy`): it installs
# only the packages Digitify needs, at the versions your system already knows about, and leaves
# updating your system to you.
#
# Usage (as your normal user, not root; it asks for sudo when needed):
# (A release names it Digitify-Arch-install.sh.)
#   bash install-arch.sh                      the .deb next to this script or in the current folder
#   bash install-arch.sh path/to/Digitify.deb a specific .deb
#   bash install-arch.sh --uninstall          remove Digitify (your library and settings stay)
set -euo pipefail

say()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m==> Warning:\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m==> Error:\033[0m %s\n' "$*" >&2; exit 1; }

# What Digitify needs at run time, by Arch package name.
RUNTIME_DEPS=(
  webkit2gtk-4.1 gtk3 libx11 openssl dbus   # the window and the web view
  glib-networking                           # HTTPS inside the web view (online players)
  gst-plugins-base gst-plugins-good         # sound inside the web view
  gst-plugins-bad gst-libav                 # YouTube's video (H.264) in its embedded player
  mpv ffmpeg                                # the video and music engines
  udisks2                                   # mounting data discs
  xdg-utils hicolor-icon-theme              # opening links and folders, the menu icon
  libayatana-appindicator                   # the icon by the clock (D-059)
)
# What turning the .deb into a pacman package needs (makepkg comes with pacman; bsdtar with libarchive).
BUILD_DEPS=(fakeroot libarchive)

command -v pacman >/dev/null 2>&1 || die "pacman wasn't found. This script is for Arch-based distributions; on Ubuntu or Debian use: sudo apt install ./Digitify-Linux-amd64.deb"
[[ $EUID -ne 0 ]] || die "Run this as your normal user, not with sudo or as root. It asks for your password when it needs it."
command -v sudo >/dev/null 2>&1 || die "sudo isn't installed. Install it, or ask whoever manages this computer."
[[ $(uname -m) == x86_64 ]] || die "Digitify is built for 64-bit Intel/AMD computers (x86_64); this one is $(uname -m)."

if [[ ${1:-} == --uninstall ]]; then
  if pacman -Q digitify >/dev/null 2>&1; then
    say "Removing Digitify…"
    sudo pacman -R digitify
    say "Digitify was removed. Your library folder, settings (~/.local/share/com.digitify.desktop) and media were left alone."
  else
    say "Digitify isn't installed."
  fi
  exit 0
fi

# Find the .deb.
deb=${1:-}
if [[ -z $deb ]]; then
  here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
  shopt -s nullglob
  found=("$here"/Digitify-Linux-amd64.deb "$here"/Digitify_*_amd64.deb "$here"/*.deb ./Digitify-Linux-amd64.deb ./Digitify_*_amd64.deb ./*.deb)
  shopt -u nullglob
  [[ ${#found[@]} -gt 0 ]] || die "No Digitify .deb found next to this script or in the current folder. Put Digitify-Linux-amd64.deb here, or pass its path: bash $(basename "$0") path/to/file.deb"
  deb=${found[0]}
fi
[[ -f $deb ]] || die "File not found: $deb"
deb=$(cd "$(dirname "$deb")" && pwd)/$(basename "$deb")
say "Installing Digitify from $(basename "$deb")"

# Dependencies: only what's missing, from your current package lists. No -y, no -u.
missing=()
for pkg in "${RUNTIME_DEPS[@]}" "${BUILD_DEPS[@]}"; do
  pacman -T "$pkg" >/dev/null 2>&1 || missing+=("$pkg")
done
if [[ ${#missing[@]} -gt 0 ]]; then
  say "Installing what Digitify needs: ${missing[*]}"
  if ! sudo pacman -S --needed "${missing[@]}"; then
    die "pacman couldn't install those packages. If it said a file wasn't found (404) or a package couldn't be found, your package lists are older than the mirrors; update your system the way you normally do (for example sudo pacman -Syu), then run this script again. It won't update your system for you."
  fi
else
  say "Everything Digitify needs is already installed."
fi

# The version: from the package's own control file (a release's .deb is named Digitify-Linux-amd64.deb,
# without it), else from a name like Digitify_0.9.3_amd64.deb.
version=$( (bsdtar -xOf "$deb" 'control.tar.*' | bsdtar -xOf - ./control control) 2>/dev/null | sed -n 's/^Version: *//p' | head -n1 || true)
[[ -n $version ]] || version=$(basename "$deb" | sed -nE 's/^[^_]+_([0-9][0-9A-Za-z.+~-]*)_.*\.deb$/\1/p')
version=${version//-/.}
version=${version:-0.1.0}
say "Digitify $version"

# Build a pacman package from the .deb in a scratch folder.
work=$(mktemp -d -t digitify-pkg.XXXXXX)
trap 'rm -rf "$work"' EXIT
cp "$deb" "$work/digitify.deb"
deps_quoted=$(printf "'%s' " "${RUNTIME_DEPS[@]}")
cat > "$work/PKGBUILD" <<EOF
pkgname=digitify
pkgver=$version
pkgrel=1
pkgdesc='Your whole media collection, in one place: an offline media library with readers and players'
arch=('x86_64')
license=('custom')
depends=($deps_quoted)
optdepends=('gnome-keyring: keep online-service keys in the desktop keyring (or KWallet with its Secret Service)')
options=('!strip' '!debug')
source=('digitify.deb')
noextract=('digitify.deb')
sha256sums=('SKIP')

package() {
  cd "\$srcdir"
  bsdtar -xf digitify.deb
  data=\$(ls data.tar.* | head -n1)
  bsdtar -xf "\$data" -C "\$pkgdir"
  chmod 755 "\$pkgdir"
  find "\$pkgdir" -type d -exec chmod 755 {} +
}
EOF

say "Making the pacman package…"
(cd "$work" && PKGDEST="$work" makepkg --force --nodeps --noconfirm >"$work/makepkg.log" 2>&1) || {
  cat "$work/makepkg.log" >&2
  die "Making the package failed (the log is above)."
}
pkgfile=$(ls "$work"/digitify-*.pkg.tar.* 2>/dev/null | head -n1)
[[ -n $pkgfile ]] || die "makepkg finished but no package was made."

say "Installing Digitify…"
sudo pacman -U "$pkgfile"

# A last check that every library the program uses is on this system.
bin=$(pacman -Qlq digitify | grep -E '/usr/bin/[^/]+$' | head -n1 || true)
if [[ -n $bin ]] && command -v ldd >/dev/null 2>&1; then
  if ldd "$bin" | grep -q 'not found'; then
    warn "Some libraries Digitify uses weren't found:"
    ldd "$bin" | grep 'not found' >&2
    warn "Install the packages that provide them (pacman -F <library> tells you which), then start Digitify."
  fi
fi

# Disc drives: most desktops give the logged-in user access already; say how if this one doesn't.
groups_needed=""
if [[ -e /dev/sr0 && ! -r /dev/sr0 ]]; then
  groups_needed=$(stat -c %G /dev/sr0 2>/dev/null || echo optical)
fi

say "Done. Open Digitify from your applications menu, or run: ${bin:-digitify}"
say "Remove it any time with: sudo pacman -R digitify   (or: bash $(basename "$0") --uninstall)"
if [[ -n $groups_needed ]]; then
  say "To use CDs, DVDs and Blu-rays, add yourself to the '$groups_needed' group and log in again: sudo usermod -aG $groups_needed \$USER"
fi

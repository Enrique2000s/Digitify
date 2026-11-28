<#
.SYNOPSIS
  Fetches Digitify's helper engines at pinned versions.

.DESCRIPTION
  Every download is checked against a pinned SHA-256 hash, and every executable or DLL is
  scanned for DVD/Blu-ray decryption code, which Digitify must never ship (decision D-007).

    mpv 0.41.0 (official build)  -> src-tauri\binaries\  bundled with the app as a helper program
    FFmpeg 9.1 (LGPL build)      -> tools\ffmpeg\         development tools (test media, probing)
    PDFium chromium/7881         -> src-tauri\binaries\  bundled with the app; renders PDF pages (D-013)
    yt-dlp 2026.10.26            -> tools\yt-dlp\        bundled with the app; downloads from links (D-133)
    Deno 2.9.8                   -> tools\yt-dlp\        bundled with the app; the JavaScript yt-dlp needs for YouTube

  BtbN removes old FFmpeg autobuilds after a while. When the pinned build is gone, the script
  falls back to the newest build of the same release branch (BtbN's permanent "latest" link for
  it), checked against the SHA-256 list BtbN publishes with it, so a build never fails for that.
  To pin again, pick a newer "autobuild-*" release and update both its URL and hash below.

.PARAMETER Force
  Download and install again even when the files are already present.
#>
[CmdletBinding()]
param([switch]$Force)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$root = Split-Path -Parent $PSScriptRoot
$cache = Join-Path $root '.cache\deps'

$deps = @(
    @{
        Name       = 'mpv 0.41.0 (official x86_64 MSVC build)'
        Url        = 'https://github.com/mpv-player/mpv/releases/download/v0.41.0/mpv-v0.41.0-x86_64-pc-windows-msvc.zip'
        Sha256     = '4e197f729f5071c6772f35fffd96e0f36e3e8a044bd9479b136bb09b7c6a80ff'
        Marker     = 'src-tauri\binaries\mpv-x86_64-pc-windows-msvc.exe'
        LicenseDir = 'src-tauri\binaries\licenses\mpv'
        Files      = [ordered]@{
            'mpv.exe'      = 'src-tauri\binaries\mpv-x86_64-pc-windows-msvc.exe'
            'vulkan-1.dll' = 'src-tauri\binaries\vulkan-1.dll'
        }
    },
    @{
        Name       = 'FFmpeg 9.1 (BtbN LGPL shared build)'
        Url        = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-11-28-13-45/ffmpeg-n9.1-6-gb2efecda3d-win64-lgpl-shared-9.1.zip'
        Sha256     = '6f49b60e721ad45d90c850c38319a57b1ba3559472074bf95278a35b18ed688a'
        # BtbN removes its dated builds after a few weeks, and old branches too (9.0 went in
        # November 2026). When the pinned build is gone: the newest 9.x build its own list names,
        # checked against the hash that list gives.
        FallbackBase      = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/'
        FallbackPattern   = '^ffmpeg-n9\.(\d+)-latest-win64-lgpl-shared-9\.\d+\.zip$'
        FallbackChecksums = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/checksums.sha256'
        Marker     = 'tools\ffmpeg\ffmpeg.exe'
        LicenseDir = 'tools\ffmpeg'
        Files      = [ordered]@{
            'bin\*.dll'       = 'tools\ffmpeg\'
            'bin\ffmpeg.exe'  = 'tools\ffmpeg\ffmpeg.exe'
            'bin\ffprobe.exe' = 'tools\ffmpeg\ffprobe.exe'
        }
    },
    @{
        # The PDFium API version must match pdfium-render's `pdfium_latest` feature (see Cargo.toml).
        Name       = 'PDFium chromium/7881 (bblanchon/pdfium-binaries)'
        Url        = 'https://github.com/bblanchon/pdfium-binaries/releases/download/chromium/7881/pdfium-win-x64.tgz'
        Sha256     = '73cc0de638ac2095e7445bf56a38200a5b7c7ca0e9f4ba144598f2457377ac08'
        Marker     = 'src-tauri\binaries\pdfium.dll'
        LicenseDir = 'src-tauri\binaries\licenses\pdfium'
        Files      = [ordered]@{
            'bin\pdfium.dll' = 'src-tauri\binaries\pdfium.dll'
            'licenses\*'     = 'src-tauri\binaries\licenses\pdfium\'
        }
    },
    @{
        # The official build, which carries the JavaScript yt-dlp runs for YouTube (EJS). Settings
        # can update it later into the config folder (D-133); this is the version the app ships.
        Name       = 'yt-dlp 2026.10.26 (official Windows build)'
        Url        = 'https://github.com/yt-dlp/yt-dlp/releases/download/2026.10.26/yt-dlp.exe'
        Sha256     = 'f5389d3698ecde4ef06f4e6b1ce0294fe9ac1396228c8990b8d3416d6d177a7d'
        Raw        = $true
        Version    = @{ 'tools\yt-dlp\yt-dlp.version' = '2026.10.26' }
        Marker     = 'tools\yt-dlp\yt-dlp.exe'
        Files      = [ordered]@{ 'yt-dlp.exe' = 'tools\yt-dlp\yt-dlp.exe' }
        Licenses   = [ordered]@{
            'https://raw.githubusercontent.com/yt-dlp/yt-dlp/2026.10.26/LICENSE'                  = 'tools\yt-dlp\licenses\yt-dlp-LICENSE.txt'
            'https://raw.githubusercontent.com/yt-dlp/yt-dlp/2026.10.26/THIRD_PARTY_LICENSES.txt' = 'tools\yt-dlp\licenses\yt-dlp-THIRD_PARTY_LICENSES.txt'
        }
    },
    @{
        Name       = 'Deno 2.9.8 (official x86_64 Windows build)'
        Url        = 'https://github.com/denoland/deno/releases/download/v2.9.8/deno-x86_64-pc-windows-msvc.zip'
        Sha256     = 'cba84b26e0df5ae7f74fc66b86a95b866872a86292ebd84fa1e959927edd93bf'
        Marker     = 'tools\yt-dlp\deno.exe'
        Files      = [ordered]@{ 'deno.exe' = 'tools\yt-dlp\deno.exe' }
        Licenses   = [ordered]@{
            'https://raw.githubusercontent.com/denoland/deno/v2.9.8/LICENSE.md' = 'tools\yt-dlp\licenses\deno-LICENSE.md'
        }
    }
)

# Strings that only appear inside libdvdcss (CSS) and libaacs (AACS) themselves.
$decryptionMarkers = 'DVDCSS_CACHE', 'KEYDB.cfg'

function Assert-NoDecryptionCode([string]$file) {
    $text = [Text.Encoding]::ASCII.GetString([IO.File]::ReadAllBytes($file))
    foreach ($marker in $decryptionMarkers) {
        if ($text.IndexOf($marker, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
            throw "$file contains '$marker', a sign of DVD/Blu-ray decryption code. Digitify must not ship it (decision D-007)."
        }
    }
}

# Archives usually wrap everything in one top-level folder; return the folder that holds the files.
function Get-PackageRoot([string]$dir) {
    $entries = @(Get-ChildItem -LiteralPath $dir)
    if ($entries.Count -eq 1 -and $entries[0].PSIsContainer) { return $entries[0].FullName }
    return $dir
}

New-Item -ItemType Directory -Force $cache | Out-Null

foreach ($dep in $deps) {
    if ((Test-Path (Join-Path $root $dep.Marker)) -and -not $Force) {
        Write-Host "OK  $($dep.Name) is already installed"
        continue
    }

    $archive = Join-Path $cache (Split-Path $dep.Url -Leaf)
    $expected = $dep.Sha256
    if (-not (Test-Path $archive) -or (Get-FileHash $archive -Algorithm SHA256).Hash -ne $expected) {
        Write-Host "... downloading $($dep.Name)"
        try {
            Invoke-WebRequest -Uri $dep.Url -OutFile $archive -UseBasicParsing
        } catch {
            if (-not $dep.FallbackPattern) { throw }
            # The pinned build was removed: the newest build its publisher lists that fits the
            # pattern, with the hash the list gives for it.
            Write-Host "    the pinned build is no longer there ($($_.Exception.Message)); using the newest listed build"
            $list = (Invoke-WebRequest -Uri $dep.FallbackChecksums -UseBasicParsing).Content
            if ($list -is [byte[]]) { $list = [Text.Encoding]::UTF8.GetString($list) }
            $found = foreach ($line in ($list -split "`n")) {
                $parts = $line.Trim() -split '\s+\*?'
                if ($parts.Count -ge 2 -and $parts[1] -match $dep.FallbackPattern) {
                    [pscustomobject]@{ Hash = $parts[0].ToLowerInvariant(); Name = $parts[1]; Minor = [int]$Matches[1] }
                }
            }
            $pick = $found | Sort-Object Minor -Descending | Select-Object -First 1
            if (-not $pick) { throw "BtbN's checksum list names no build like $($dep.FallbackPattern)" }
            Write-Host "    $($pick.Name)"
            $archive = Join-Path $cache $pick.Name
            $expected = $pick.Hash
            if (-not (Test-Path $archive) -or (Get-FileHash $archive -Algorithm SHA256).Hash -ne $expected) {
                Invoke-WebRequest -Uri ($dep.FallbackBase + $pick.Name) -OutFile $archive -UseBasicParsing
            }
        }
    }
    $actual = (Get-FileHash $archive -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $expected) {
        Remove-Item -LiteralPath $archive
        throw "SHA-256 mismatch for $($dep.Name): expected $expected, got $actual"
    }

    $staging = Join-Path $cache ('extract-' + [IO.Path]::GetFileNameWithoutExtension($archive))
    if (Test-Path $staging) { Remove-Item -LiteralPath $staging -Recurse -Force }
    New-Item -ItemType Directory $staging | Out-Null
    if ($dep.Raw) {
        # The download is the program itself, not an archive.
        Copy-Item -LiteralPath $archive -Destination (Join-Path $staging (Split-Path $dep.Url -Leaf))
    } else {
        # Windows' own tar (bsdtar) reads zip files too; another tar earlier in PATH may not.
        $tar = Join-Path $env:SystemRoot 'System32\tar.exe'
        if (-not (Test-Path $tar)) { $tar = 'tar' }
        & $tar -xf $archive -C $staging
        if ($LASTEXITCODE -ne 0) { throw "Could not extract $archive" }
    }
    $package = Get-PackageRoot $staging

    foreach ($entry in $dep.Files.GetEnumerator()) {
        if ($entry.Key.Contains('*')) {
            $sources = Get-ChildItem -Path (Join-Path $package (Split-Path $entry.Key)) -Filter (Split-Path $entry.Key -Leaf) -File
        } else {
            $sources = @(Get-Item -LiteralPath (Join-Path $package $entry.Key))
        }
        foreach ($source in $sources) {
            if ($source.Extension -in '.exe', '.dll') { Assert-NoDecryptionCode $source.FullName }
            $dest = Join-Path $root $entry.Value
            if ($entry.Value.EndsWith('\')) {
                New-Item -ItemType Directory -Force $dest | Out-Null
                $dest = Join-Path $dest $source.Name
            } else {
                New-Item -ItemType Directory -Force (Split-Path $dest) | Out-Null
            }
            Copy-Item -LiteralPath $source.FullName -Destination $dest -Force
        }
    }

    if ($dep.Licenses) {
        foreach ($license in $dep.Licenses.GetEnumerator()) {
            $dest = Join-Path $root $license.Value
            New-Item -ItemType Directory -Force (Split-Path $dest) | Out-Null
            Invoke-WebRequest -Uri $license.Key -OutFile $dest -UseBasicParsing
        }
    }
    if ($dep.Version) {
        foreach ($version in $dep.Version.GetEnumerator()) {
            [IO.File]::WriteAllText((Join-Path $root $version.Key), $version.Value)
        }
    }

    $licenses = @(Get-ChildItem -LiteralPath $package -File | Where-Object { $_.Name -match '^(LICENSE|COPYING)' })
    if ($licenses.Count -gt 0 -and $dep.LicenseDir) {
        $licenseDir = Join-Path $root $dep.LicenseDir
        New-Item -ItemType Directory -Force $licenseDir | Out-Null
        $licenses | Copy-Item -Destination $licenseDir -Force
    }

    Remove-Item -LiteralPath $staging -Recurse -Force
    Write-Host "OK  $($dep.Name) installed and verified"
}

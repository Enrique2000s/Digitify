<#
.SYNOPSIS
  Fetches Digitify's helper engines at pinned versions.

.DESCRIPTION
  Every download is checked against a pinned SHA-256 hash, and every executable or DLL is
  scanned for DVD/Blu-ray decryption code, which Digitify must never ship (decision D-007).

    mpv 0.41.0 (official build)  -> src-tauri\binaries\  bundled with the app as a helper program
    FFmpeg 9.0.2 (LGPL build)    -> tools\ffmpeg\         development tools (test media, probing)
    PDFium chromium/7881         -> src-tauri\binaries\  bundled with the app; renders PDF pages (D-013)

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
        Name       = 'FFmpeg 9.0.2 (BtbN LGPL shared build)'
        Url        = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-10-30-13-01/ffmpeg-n9.0.2-39-g7adfbe40dc-win64-lgpl-shared-9.0.zip'
        Sha256     = '8aeb11be252902a772ff04ac89b705f7a7b24815f0a21da2ab100b192a5c16e4'
        # When the pinned build is gone: the newest 9.0 build, checked against BtbN's own list.
        FallbackUrl       = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-n9.0-latest-win64-lgpl-shared-9.0.zip'
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
            if (-not $dep.FallbackUrl) { throw }
            # The pinned build was removed: the newest build of the same branch, with the hash its
            # publisher lists for it.
            Write-Host "    the pinned build is no longer there ($($_.Exception.Message)); using the newest build of the same branch"
            $archive = Join-Path $cache (Split-Path $dep.FallbackUrl -Leaf)
            $list = (Invoke-WebRequest -Uri $dep.FallbackChecksums -UseBasicParsing).Content
            if ($list -is [byte[]]) { $list = [Text.Encoding]::UTF8.GetString($list) }
            $name = Split-Path $dep.FallbackUrl -Leaf
            $line = ($list -split "`n") | Where-Object { $_ -match ("\s\*?" + [regex]::Escape($name) + "\s*$") } | Select-Object -First 1
            if (-not $line) { throw "BtbN's checksum list doesn't name $name" }
            $expected = ($line -split '\s+')[0].ToLowerInvariant()
            if (-not (Test-Path $archive) -or (Get-FileHash $archive -Algorithm SHA256).Hash -ne $expected) {
                Invoke-WebRequest -Uri $dep.FallbackUrl -OutFile $archive -UseBasicParsing
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
    tar -xf $archive -C $staging
    if ($LASTEXITCODE -ne 0) { throw "Could not extract $archive" }
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

    $licenses = @(Get-ChildItem -LiteralPath $package -File | Where-Object { $_.Name -match '^(LICENSE|COPYING)' })
    if ($licenses.Count -gt 0) {
        $licenseDir = Join-Path $root $dep.LicenseDir
        New-Item -ItemType Directory -Force $licenseDir | Out-Null
        $licenses | Copy-Item -Destination $licenseDir -Force
    }

    Remove-Item -LiteralPath $staging -Recurse -Force
    Write-Host "OK  $($dep.Name) installed and verified"
}

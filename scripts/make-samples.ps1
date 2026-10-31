<#
.SYNOPSIS
  Generates test media for development. Everything is synthetic; no copyrighted content.

.DESCRIPTION
  samples\sample-1080p.mkv   60 s 1080p test pattern, two audio tracks (English and Spanish test
                             tones), English SRT subtitles and three chapters.
  samples\import-test\       A small library to import: an EPUB with cover, description and chapters, a PDF,
                             a folder of "photographed" pages, a manga CBZ with ComicInfo.xml, a
                             plain comic CBZ, a three-track FLAC album with cover art, and the video.
  samples\attach-test\       A PDF "scan" for testing "add files to an existing item".

  Requires FFmpeg from scripts\fetch-deps.ps1.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem

$root = Split-Path -Parent $PSScriptRoot
$ffmpeg = Join-Path $root 'tools\ffmpeg\ffmpeg.exe'
if (-not (Test-Path $ffmpeg)) { throw "FFmpeg not found. Run scripts\fetch-deps.ps1 first." }
$samples = Join-Path $root 'samples'
$work = Join-Path $samples '.work'
New-Item -ItemType Directory -Force $work | Out-Null

function Invoke-FFmpeg([string[]]$Arguments) {
    & $ffmpeg -y -hide_banner -loglevel error @Arguments
    if ($LASTEXITCODE -ne 0) { throw "FFmpeg failed: $($Arguments -join ' ')" }
}

function Add-ZipEntry($Zip, [string]$Name, [byte[]]$Bytes, [switch]$Store) {
    $level = if ($Store) { [IO.Compression.CompressionLevel]::NoCompression } else { [IO.Compression.CompressionLevel]::Optimal }
    $stream = $Zip.CreateEntry($Name, $level).Open()
    $stream.Write($Bytes, 0, $Bytes.Length)
    $stream.Dispose()
}

function Get-Utf8([string]$Text) { [Text.Encoding]::UTF8.GetBytes($Text) }

# ---------------------------------------------------------------- video

$video = Join-Path $samples 'sample-1080p.mkv'
if (-not (Test-Path $video)) {
    $subtitles = Join-Path $work 'sample.srt'
    @'
1
00:00:01,000 --> 00:00:05,000
Digitify sample video: a generated test pattern.

2
00:00:20,000 --> 00:00:24,000
Chapter 2 starts here.

3
00:00:40,000 --> 00:00:44,000
Chapter 3: almost done.
'@ | Set-Content -LiteralPath $subtitles -Encoding ASCII

    $chapters = Join-Path $work 'chapters.txt'
    @'
;FFMETADATA1
title=Digitify sample (1080p test pattern)
[CHAPTER]
TIMEBASE=1/1000
START=0
END=20000
title=Opening
[CHAPTER]
TIMEBASE=1/1000
START=20000
END=40000
title=Middle
[CHAPTER]
TIMEBASE=1/1000
START=40000
END=60000
title=Ending
'@ | Set-Content -LiteralPath $chapters -Encoding ASCII

    # The LGPL FFmpeg build has no x264, so prefer OpenH264 or Windows' Media Foundation encoder.
    $encoders = (& $ffmpeg -hide_banner -loglevel error -encoders) -join "`n"
    if ($encoders -match '\blibopenh264\b') { $codec = @('-c:v', 'libopenh264', '-b:v', '6M') }
    elseif ($encoders -match '\bh264_mf\b') { $codec = @('-c:v', 'h264_mf', '-b:v', '6M') }
    else { $codec = @('-c:v', 'mpeg4', '-q:v', '4') }

    Invoke-FFmpeg (@(
        '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=60',
        '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=60',
        '-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=48000:duration=60',
        '-i', $subtitles, '-i', $chapters,
        '-map', '0:v', '-map', '1:a', '-map', '2:a', '-map', '3:s', '-map_metadata', '4', '-map_chapters', '4'
    ) + $codec + @(
        '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-c:s', 'srt',
        '-metadata:s:a:0', 'language=eng', '-metadata:s:a:0', 'title=Tone 440 Hz',
        '-metadata:s:a:1', 'language=spa', '-metadata:s:a:1', 'title=Tono 660 Hz',
        '-metadata:s:s:0', 'language=eng',
        $video
    ))
    Write-Host ("OK  {0} ({1:N1} MB)" -f $video, ((Get-Item $video).Length / 1MB))
}

# ---------------------------------------------------------------- import test set

$set = Join-Path $samples 'import-test'
if (Test-Path $set) { Remove-Item -LiteralPath $set -Recurse -Force }
$books = Join-Path $set 'Books'
$comics = Join-Path $set 'Comics'
$album = Join-Path $set 'Music\Test Tones'
$movies = Join-Path $set 'Movies'
$pages = Join-Path $books 'Sample Scanned Book'
foreach ($dir in $books, $comics, $album, $movies, $pages) { New-Item -ItemType Directory -Force $dir | Out-Null }

# Artwork and pages from FFmpeg's built-in test sources.
$bookCover = Join-Path $work 'book-cover.jpg'
Invoke-FFmpeg @('-f', 'lavfi', '-i', 'mandelbrot=size=600x900:rate=1', '-frames:v', '1', $bookCover)
Invoke-FFmpeg @('-f', 'lavfi', '-i', 'smptehdbars=size=800x800:rate=1', '-frames:v', '1', (Join-Path $album 'cover.jpg'))
Invoke-FFmpeg @('-f', 'lavfi', '-i', 'testsrc2=size=1200x1600:rate=1:duration=4', '-q:v', '3', (Join-Path $pages 'page-%02d.jpg'))
$comicPages = Join-Path $work 'comic'
New-Item -ItemType Directory -Force $comicPages | Out-Null
Invoke-FFmpeg @('-f', 'lavfi', '-i', 'testsrc=size=800x1200:rate=1:duration=6', '-q:v', '4', (Join-Path $comicPages 'p%02d.jpg'))

# Filler paragraphs for the ebooks, as <p> elements: four sentences each, shuffled by a seed.
function Get-Paragraphs([string[]]$Sentences, [int]$Count, [int]$Seed) {
    foreach ($i in 1..$Count) {
        '<p>' + ((0..3 | ForEach-Object { $Sentences[($i + $_ * 3 + $Seed) % $Sentences.Count] }) -join ' ') + '</p>'
    }
}

# EPUB 3 with metadata, a description, a cover image and three chapters long enough to turn pages.
# Chapter 1 carries a script and an inline handler that must never run (the reader blocks book
# scripts); chapter 2 links to a website, which the reader shows instead of opening.
$lighthouse = @(
    'The keeper climbed the spiral stairs before dawn and wiped the salt from the great lens.',
    'Every ship that passed went into the ledger: its name, its flag, the hour and the weather.',
    'Some nights the fog was so thick that the beam seemed to stop an arm''s length from the glass.',
    'Gulls argued on the railing while the kettle hissed in the little room below the lamp.',
    'In winter the storms came in from the west, and the whole tower hummed like a struck bell.',
    'The ledger grew to a shelf of volumes, each one bound in blue cloth and labeled by year.',
    'Children from the village asked to see the lamp, and the keeper let them count the steps.'
)
function New-Chapter([int]$Number, [string]$Title, [string]$Extra) {
    return Get-Utf8 (@"
<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>$Title</title></head>
<body><h1>$Title</h1>
$Extra
"@ + ((Get-Paragraphs $lighthouse 16 $Number) -join "`n") + "`n</body></html>`n")
}

$epub = Join-Path $books 'Digitify Sample Book.epub'
$zip = [IO.Compression.ZipFile]::Open($epub, 'Create')
Add-ZipEntry $zip 'mimetype' (Get-Utf8 'application/epub+zip') -Store
Add-ZipEntry $zip 'META-INF/container.xml' (Get-Utf8 @'
<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
'@)
Add-ZipEntry $zip 'OEBPS/content.opf' (Get-Utf8 @'
<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:uuid:5b7c2f1e-6d1a-4c55-9a52-0f3d2b9e7a11</dc:identifier>
    <dc:title>The Lighthouse at Brightwater</dc:title>
    <dc:creator>Digitify Test Suite</dc:creator>
    <dc:publisher>Digitify Test Press</dc:publisher>
    <dc:date>2026-10-30</dc:date>
    <dc:language>en</dc:language>
    <dc:description>&lt;p&gt;A short book generated for &lt;i&gt;testing&lt;/i&gt; Digitify: a lighthouse, a storm, and a keeper who catalogs every ship that passes.&lt;/p&gt;</dc:description>
    <meta name="cover" content="cover-img"/>
    <meta property="dcterms:modified">2026-10-30T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ch1" href="text/chapter1.xhtml" media-type="application/xhtml+xml" properties="scripted"/>
    <item id="ch2" href="text/chapter2.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch3" href="text/chapter3.xhtml" media-type="application/xhtml+xml"/>
    <item id="cover-img" href="images/cover.jpg" media-type="image/jpeg" properties="cover-image"/>
  </manifest>
  <spine><itemref idref="ch1"/><itemref idref="ch2"/><itemref idref="ch3"/></spine>
</package>
'@)
Add-ZipEntry $zip 'OEBPS/nav.xhtml' (Get-Utf8 @'
<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head>
<body><nav epub:type="toc"><ol>
<li><a href="text/chapter1.xhtml">Chapter 1: The Lamp</a></li>
<li><a href="text/chapter2.xhtml">Chapter 2: The Ledger</a></li>
<li><a href="text/chapter3.xhtml">Chapter 3: The Storm</a></li>
</ol></nav></body></html>
'@)
Add-ZipEntry $zip 'OEBPS/text/chapter1.xhtml' (New-Chapter 1 'Chapter 1: The Lamp' @'
<script>document.documentElement.setAttribute('data-book-script', 'ran');</script>
<p>This book exists only to test Digitify.<img src="missing.png" alt="" onerror="this.setAttribute('data-book-handler', 'ran')"/></p>
'@)
Add-ZipEntry $zip 'OEBPS/text/chapter2.xhtml' (New-Chapter 2 'Chapter 2: The Ledger' @'
<p>The keeper kept a copy of <a href="https://example.com/brightwater">the harbor records</a>, and a note to read <a href="chapter3.xhtml">about the storm</a>.</p>
'@)
Add-ZipEntry $zip 'OEBPS/text/chapter3.xhtml' (New-Chapter 3 'Chapter 3: The Storm' '')
Add-ZipEntry $zip 'OEBPS/images/cover.jpg' ([IO.File]::ReadAllBytes($bookCover))
$zip.Dispose()

# A MOBI (Mobipocket 6) book written by hand: a Palm database whose first record holds the PalmDOC
# and MOBI headers, followed by the book's HTML, uncompressed, in records of up to 4096 bytes.
function Get-BigEndian([uint64]$Value, [int]$Size) {
    $bytes = [BitConverter]::GetBytes($Value)[0..($Size - 1)]
    [Array]::Reverse($bytes)
    return , ([byte[]]$bytes)
}

function New-SimpleMobi([string]$Path, [string]$Title, [string]$Html) {
    $text = [byte[]](Get-Utf8 $Html)
    $records = [Collections.Generic.List[byte[]]]::new()
    for ($at = 0; $at -lt $text.Length; $at += 4096) {
        $records.Add([byte[]]$text[$at..([Math]::Min($at + 4096, $text.Length) - 1)])
    }
    $count = $records.Count
    $titleBytes = [byte[]](Get-Utf8 $Title)
    $first = [byte[]]::new(248 + $titleBytes.Length + 4)
    $fields = @{
        0   = Get-BigEndian 1 2              # compression: none
        4   = Get-BigEndian $text.Length 4
        8   = Get-BigEndian $count 2         # text records
        10  = Get-BigEndian 4096 2
        16  = [Text.Encoding]::ASCII.GetBytes('MOBI')
        20  = Get-BigEndian 232 4            # MOBI header length
        24  = Get-BigEndian 2 4              # a book
        28  = Get-BigEndian 65001 4          # UTF-8
        32  = Get-BigEndian 20261031 4       # unique id
        36  = Get-BigEndian 6 4              # format version
        80  = Get-BigEndian ($count + 1) 4   # first record after the text
        84  = Get-BigEndian 248 4            # title offset
        88  = Get-BigEndian $titleBytes.Length 4
        92  = Get-BigEndian 9 4              # locale: English
        104 = Get-BigEndian 6 4
        108 = Get-BigEndian ($count + 1) 4   # first image: there are none
        168 = Get-BigEndian ([uint32]::MaxValue) 4     # no DRM
        244 = Get-BigEndian ([uint32]::MaxValue) 4     # no index
    }
    for ($offset = 40; $offset -lt 80; $offset += 4) { $fields[$offset] = Get-BigEndian ([uint32]::MaxValue) 4 } # no dictionary indexes
    foreach ($field in $fields.GetEnumerator()) { [Array]::Copy($field.Value, 0, $first, [int]$field.Key, $field.Value.Length) }
    [Array]::Copy($titleBytes, 0, $first, 248, $titleBytes.Length)
    $records.Insert(0, $first)

    $pdb = [IO.MemoryStream]::new()
    $name = [byte[]]::new(32)
    $nameBytes = [Text.Encoding]::ASCII.GetBytes(($Title -replace '[^A-Za-z0-9]', '_'))
    [Array]::Copy($nameBytes, 0, $name, 0, [Math]::Min(31, $nameBytes.Length))
    $pdb.Write($name, 0, 32)
    $pdb.Write([byte[]]::new(28), 0, 28)                                  # attributes, dates, app info
    foreach ($part in @([Text.Encoding]::ASCII.GetBytes('BOOKMOBI'), (Get-BigEndian 0 4), (Get-BigEndian 0 4), (Get-BigEndian $records.Count 2))) {
        $pdb.Write($part, 0, $part.Length)
    }
    $offset = 78 + 8 * $records.Count + 2
    for ($i = 0; $i -lt $records.Count; $i++) {
        $entry = [byte[]]((Get-BigEndian $offset 4) + (Get-BigEndian (2 * $i) 4))   # offset, then attributes and id
        $pdb.Write($entry, 0, 8)
        $offset += $records[$i].Length
    }
    $pdb.Write([byte[]]::new(2), 0, 2)
    foreach ($record in $records) { $pdb.Write($record, 0, $record.Length) }
    [IO.File]::WriteAllBytes($Path, $pdb.ToArray())
}

# MOBI links are byte offsets ("filepos") into the text; placeholders of the same width are filled in
# once the offsets are known.
$ferry = @(
    'The ferry left the north pier at midnight with its lamps swinging over the black water.',
    'Passengers dozed on the benches while the engine thumped somewhere far below the deck.',
    'A boy counted the buoys aloud until the mist swallowed the last of them.',
    'The captain kept a thermos of tea and a radio that only ever played old waltzes.',
    'Halfway across, the lights of the town behind them blinked out one window at a time.',
    'Rope creaked against the rails, and the gulls followed the wake as if it were a road.'
)
$mobiHtml = '<html><head><guide><reference type="toc" title="Contents" filepos="@@@@TOC@@@"/></guide></head><body>' +
    '<h1>The Night Ferry</h1><p>A short book generated to test Digitify''s MOBI support.</p>' +
    '<mbp:pagebreak/><h2>Contents</h2><p><a filepos="@@@@CH1@@@">Chapter 1: Departure</a></p><p><a filepos="@@@@CH2@@@">Chapter 2: Crossing</a></p>' +
    '<mbp:pagebreak/><h2>Chapter 1: Departure</h2>' + ((Get-Paragraphs $ferry 12 1) -join '') +
    '<mbp:pagebreak/><h2>Chapter 2: Crossing</h2>' + ((Get-Paragraphs $ferry 12 2) -join '') + '</body></html>'
foreach ($target in @(@('@@@@TOC@@@', '<h2>Contents'), @('@@@@CH1@@@', '<h2>Chapter 1'), @('@@@@CH2@@@', '<h2>Chapter 2'))) {
    $mobiHtml = $mobiHtml.Replace($target[0], ('{0:D10}' -f $mobiHtml.IndexOf($target[1])))
}
New-SimpleMobi (Join-Path $books 'The Night Ferry.mobi') 'The Night Ferry' $mobiHtml

# FictionBook 2: one XML file with its own description block and sections.
$garden = @(
    'Every clock in the shop was wound on Sundays, and the garden behind it was watered on Mondays.',
    'The clockmaker grew roses between the brass gears she could not bear to throw away.',
    'Bees found the oiled springs as interesting as the flowers, which annoyed nobody.',
    'At noon the whole shop chimed at once and the cat left the room in protest.',
    'Customers came for repairs and left with cuttings wrapped in yesterday''s newspaper.'
)
[IO.File]::WriteAllBytes((Join-Path $books 'The Clockmaker''s Garden.fb2'), (Get-Utf8 (@"
<?xml version="1.0" encoding="UTF-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
<description><title-info><genre>prose</genre><author><first-name>Digitify</first-name><last-name>Test Suite</last-name></author>
<book-title>The Clockmaker's Garden</book-title><lang>en</lang></title-info>
<document-info><author><nickname>digitify</nickname></author><date>2026-10-31</date><id>digitify-sample-fb2</id><version>1.0</version></document-info></description>
<body><title><p>The Clockmaker's Garden</p></title>
<section><title><p>Chapter 1: The Gears</p></title>
"@ + ((Get-Paragraphs $garden 10 1) -join "`n") + @"

</section>
<section><title><p>Chapter 2: The Roses</p></title>
"@ + ((Get-Paragraphs $garden 10 2) -join "`n") + @"

</section></body></FictionBook>
"@)))

# A one-page PDF with an info dictionary, written by hand (offsets computed for the xref table).
# A minimal PDF: one heading and one line of text per page, plus a title and author.
# With -Outline, each page also gets an outline (bookmark) entry, "Section n", which Digitify reads
# as the PDF's chapters.
function New-SimplePdf([string]$Path, [string]$Title, [string]$Body, [int]$Pages = 1, [switch]$Outline) {
    $objects = [System.Collections.Generic.List[string]]::new()
    $outlineRoot = 4 + 2 * $Pages
    $objects.Add($(if ($Outline) { "<< /Type /Catalog /Pages 2 0 R /Outlines $outlineRoot 0 R /PageMode /UseOutlines >>" } else { '<< /Type /Catalog /Pages 2 0 R >>' }))
    $kids = (0..($Pages - 1) | ForEach-Object { "$(4 + $_ * 2) 0 R" }) -join ' '
    $objects.Add("<< /Type /Pages /Kids [$kids] /Count $Pages >>")
    $objects.Add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
    for ($n = 1; $n -le $Pages; $n++) {
        $heading = if ($n -eq 1) { $Title } else { "$Title, page $n" }
        $content = "BT /F1 26 Tf 72 760 Td ($heading) Tj ET BT /F1 12 Tf 72 720 Td ($Body) Tj ET"
        $objects.Add("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents $(5 + ($n - 1) * 2) 0 R /Resources << /Font << /F1 3 0 R >> >> >>")
        $objects.Add("<< /Length $($content.Length) >>`nstream`n$content`nendstream")
    }
    if ($Outline) {
        $objects.Add("<< /Type /Outlines /First $($outlineRoot + 1) 0 R /Last $($outlineRoot + $Pages) 0 R /Count $Pages >>")
        for ($n = 1; $n -le $Pages; $n++) {
            $entry = $outlineRoot + $n
            $siblings = $(if ($n -gt 1) { " /Prev $($entry - 1) 0 R" }) + $(if ($n -lt $Pages) { " /Next $($entry + 1) 0 R" })
            $objects.Add("<< /Title (Section $n) /Parent $outlineRoot 0 R$siblings /Dest [$(4 + ($n - 1) * 2) 0 R /Fit] >>")
        }
    }
    $objects.Add("<< /Title ($Title) /Author (Digitify Test Suite) >>")
    $pdf = New-Object System.Text.StringBuilder
    [void]$pdf.Append("%PDF-1.4`n")
    $offsets = @()
    for ($i = 0; $i -lt $objects.Count; $i++) {
        $offsets += $pdf.Length
        [void]$pdf.Append("$($i + 1) 0 obj`n$($objects[$i])`nendobj`n")
    }
    $xref = $pdf.Length
    [void]$pdf.Append("xref`n0 $($objects.Count + 1)`n0000000000 65535 f `n")
    # Each cross-reference entry is exactly 20 bytes: offset, generation, "n", space, newline.
    foreach ($offset in $offsets) { [void]$pdf.Append(("{0:D10} 00000 n `n" -f $offset)) }
    [void]$pdf.Append("trailer`n<< /Size $($objects.Count + 1) /Root 1 0 R /Info $($objects.Count) 0 R >>`nstartxref`n$xref`n%%EOF`n")
    [IO.File]::WriteAllText($Path, $pdf.ToString(), [Text.Encoding]::ASCII)
}
New-SimplePdf (Join-Path $books 'The Cartographer''s Notebook (1998).pdf') "The Cartographer's Notebook" 'A sample PDF generated for testing Digitify.' -Pages 3 -Outline

# Comic archives: a manga volume with ComicInfo.xml (right-to-left), and a plain comic without metadata.
# With -Chapters, the pages are split evenly into one folder per chapter inside the archive, the way
# many manga volumes are packed (D-019 detects chapters from them).
function New-Cbz([string]$Path, [string]$ComicInfo, [string[]]$Chapters = @()) {
    $zip = [IO.Compression.ZipFile]::Open($Path, 'Create')
    $pages = @(Get-ChildItem $comicPages -Filter *.jpg | Sort-Object Name)
    for ($i = 0; $i -lt $pages.Count; $i++) {
        $folder = if ($Chapters.Count) { $Chapters[[Math]::Floor($i * $Chapters.Count / $pages.Count)] + '/' } else { '' }
        Add-ZipEntry $zip ($folder + $pages[$i].Name) ([IO.File]::ReadAllBytes($pages[$i].FullName))
    }
    if ($ComicInfo) { Add-ZipEntry $zip 'ComicInfo.xml' (Get-Utf8 $ComicInfo) }
    $zip.Dispose()
}
New-Cbz (Join-Path $comics 'Starfall Academy v03.cbz') @'
<?xml version="1.0" encoding="utf-8"?>
<ComicInfo>
  <Series>Starfall Academy</Series>
  <Volume>3</Volume>
  <Title>The Night of Falling Stars</Title>
  <Writer>Digitify Test Suite</Writer>
  <Penciller>Test Pattern Studio</Penciller>
  <Year>2025</Year>
  <Summary>Sample manga volume generated for testing right-to-left detection.</Summary>
  <Manga>YesAndRightToLeft</Manga>
</ComicInfo>
'@
New-Cbz (Join-Path $comics 'Night Market Tales 01.cbz') $null
New-Cbz (Join-Path $comics 'Night Market Tales 02.cbz') $null -Chapters @('Chapter 1 - Lanterns', 'Chapter 2 - Noodles', 'Chapter 3 - Rain')

# The same pages as the other comic archive formats (D-017). No free tool creates RAR files, so the
# CBR is written here as a RAR 4 archive of stored (uncompressed) files, which the format allows.
Add-Type -TypeDefinition @'
public static class SampleCrc32 {
    public static uint Of(byte[] data) {
        uint crc = 0xFFFFFFFF;
        foreach (byte b in data) {
            crc ^= b;
            for (int k = 0; k < 8; k++) crc = (crc & 1) != 0 ? (crc >> 1) ^ 0xEDB88320u : crc >> 1;
        }
        return ~crc;
    }
}
'@

function New-RarBlock([byte]$Type, [uint16]$Flags, [byte[]]$Body) {
    $header = [IO.MemoryStream]::new()
    $header.WriteByte($Type)
    $header.Write([BitConverter]::GetBytes($Flags), 0, 2)
    $header.Write([BitConverter]::GetBytes([uint16]($Body.Length + 7)), 0, 2)
    $header.Write($Body, 0, $Body.Length)
    $bytes = $header.ToArray()
    $crc = [uint16]([SampleCrc32]::Of($bytes) -band 0xFFFF)
    return [byte[]]([BitConverter]::GetBytes($crc) + $bytes)
}

function New-StoredRar([string]$Path, [string[]]$Files) {
    $rar = [IO.MemoryStream]::new()
    $marker = [byte[]](0x52, 0x61, 0x72, 0x21, 0x1A, 0x07, 0x00)
    $rar.Write($marker, 0, $marker.Length)
    $main = New-RarBlock 0x73 0 ([byte[]]::new(6))
    $rar.Write($main, 0, $main.Length)
    foreach ($file in $Files) {
        $data = [IO.File]::ReadAllBytes($file)
        $name = [Text.Encoding]::ASCII.GetBytes((Split-Path $file -Leaf))
        $body = [IO.MemoryStream]::new()
        foreach ($field in @(
                [BitConverter]::GetBytes([uint32]$data.Length),          # packed size
                [BitConverter]::GetBytes([uint32]$data.Length),          # unpacked size
                [byte[]](2),                                             # host: Windows
                [BitConverter]::GetBytes([SampleCrc32]::Of($data)),
                [BitConverter]::GetBytes([uint32]1545666560),            # 2026-01-01 as a DOS date
                [byte[]](20, 0x30),                                      # version 2.0, method: store
                [BitConverter]::GetBytes([uint16]$name.Length),
                [BitConverter]::GetBytes([uint32]0x20),                  # archive attribute
                $name)) {
            $body.Write($field, 0, $field.Length)
        }
        $block = New-RarBlock 0x74 32768 $body.ToArray()
        $rar.Write($block, 0, $block.Length)
        $rar.Write($data, 0, $data.Length)
    }
    $end = New-RarBlock 0x7B 16384 ([byte[]]::new(0))
    $rar.Write($end, 0, $end.Length)
    [IO.File]::WriteAllBytes($Path, $rar.ToArray())
}

$archivePages = Join-Path $work 'archive-pages'
New-Item -ItemType Directory -Force $archivePages | Out-Null
Get-ChildItem $comicPages -Filter *.jpg | Copy-Item -Destination $archivePages
[IO.File]::WriteAllBytes((Join-Path $archivePages 'ComicInfo.xml'), (Get-Utf8 @'
<?xml version="1.0" encoding="utf-8"?>
<ComicInfo>
  <Series>Harbor Lights</Series>
  <Number>2</Number>
  <Title>The Lighthouse Keeper's Cat</Title>
  <Writer>Digitify Test Suite</Writer>
  <Year>2024</Year>
</ComicInfo>
'@))
$pageNames = @(Get-ChildItem $archivePages -Filter *.jpg | Sort-Object Name | ForEach-Object Name)
New-StoredRar (Join-Path $comics 'Harbor Lights 02.cbr') @(($pageNames + 'ComicInfo.xml') | ForEach-Object { Join-Path $archivePages $_ })
# Windows' own tar (bsdtar) writes 7z and TAR.
tar --format 7zip -cf (Join-Path $comics 'Sky Garden 01.cb7') -C $archivePages @pageNames
if ($LASTEXITCODE -ne 0) { throw 'Could not create the CB7 sample' }
tar --format ustar -cf (Join-Path $comics 'Paper Lanterns 01.cbt') -C $archivePages @pageNames
if ($LASTEXITCODE -ne 0) { throw 'Could not create the CBT sample' }

# A three-track FLAC album with tags; its cover sits next to the tracks as cover.jpg.
$tracks = @(@{ n = 1; f = 330; t = 'Low Tone' }, @{ n = 2; f = 440; t = 'Middle Tone' }, @{ n = 3; f = 550; t = 'High Tone' })
foreach ($track in $tracks) {
    Invoke-FFmpeg @(
        '-f', 'lavfi', '-i', "sine=frequency=$($track.f):sample_rate=44100:duration=12",
        '-metadata', "title=$($track.t)", '-metadata', 'artist=Digitify Test Ensemble',
        '-metadata', 'album_artist=Digitify Test Ensemble', '-metadata', 'album=Test Tones',
        '-metadata', "track=$($track.n)/3", '-metadata', 'date=2026', '-metadata', 'genre=Test signals',
        (Join-Path $album ("{0:D2} - {1}.flac" -f $track.n, $track.t))
    )
}

Copy-Item -LiteralPath $video -Destination (Join-Path $movies 'Digitify Sample Film (2026).mkv')

# A tiny TV series (D-018): two seasons of 12-second episodes, named the ways downloads usually are.
$show = Join-Path $set 'TV\Harbor Watch'
foreach ($episode in @(
        @{ File = 'Season 1\Harbor Watch S01E01 - Lights On.mkv'; Hue = 0; Tone = 330 },
        @{ File = 'Season 1\Harbor Watch S01E02 - The Fog.mkv'; Hue = 90; Tone = 392 },
        @{ File = 'Season 1\Harbor Watch S01E03 - Night Ferry.mkv'; Hue = 180; Tone = 440 },
        @{ File = 'Season 2\harbor.watch.s02e01.mkv'; Hue = 270; Tone = 494 })) {
    $path = Join-Path $show $episode.File
    New-Item -ItemType Directory -Force (Split-Path $path) | Out-Null
    Invoke-FFmpeg @(
        '-f', 'lavfi', '-i', "testsrc2=size=640x360:rate=25:duration=12,hue=h=$($episode.Hue)",
        '-f', 'lavfi', '-i', "sine=frequency=$($episode.Tone):sample_rate=48000:duration=12",
        '-c:v', 'mpeg4', '-q:v', '5', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k', $path
    )
}

# A separate "scan" to attach to an existing item.
$attach = Join-Path $samples 'attach-test'
if (Test-Path $attach) { Remove-Item -LiteralPath $attach -Recurse -Force }
New-Item -ItemType Directory -Force $attach | Out-Null
New-SimplePdf (Join-Path $attach 'Scan of my hardcover.pdf') 'Scan of my hardcover' 'A sample scan generated for testing Digitify.'

# Ambient-music test set (D-016): two tagged songs and a deliberately broken file, for checking
# playback of the user's own music, skipping, and recovery from unplayable files.
$musicTest = Join-Path $samples 'music-test'
if (Test-Path $musicTest) { Remove-Item -LiteralPath $musicTest -Recurse -Force }
New-Item -ItemType Directory -Force $musicTest | Out-Null
$songs = @(
    @{ file = '01 Breeze Test Song.flac'; title = 'Breeze Test Song'; low = 523.25; high = 659.25; codec = @() },
    @{ file = '02 Second Test Song.opus'; title = 'Second Test Song'; low = 392; high = 493.88; codec = @('-c:a', 'libopus', '-b:a', '64k') }
)
foreach ($song in $songs) {
    Invoke-FFmpeg (@(
        '-f', 'lavfi', '-i', "sine=frequency=$($song.low):duration=6",
        '-f', 'lavfi', '-i', "sine=frequency=$($song.high):duration=6",
        '-filter_complex', '[0][1]amix=inputs=2,volume=0.5,afade=t=in:d=0.5,afade=t=out:st=5:d=1'
    ) + $song.codec + @('-metadata', "title=$($song.title)", '-metadata', 'artist=Digitify Test Tones', (Join-Path $musicTest $song.file)))
}
[IO.File]::WriteAllBytes((Join-Path $musicTest '03 Broken File.mp3'), [byte[]](1..4096 | ForEach-Object { Get-Random -Maximum 256 }))
Write-Host "OK  $musicTest (3 files, one deliberately unplayable)"

Remove-Item -LiteralPath $work -Recurse -Force
$count = (Get-ChildItem $set -Recurse -File).Count
Write-Host "OK  $set ($count files)"

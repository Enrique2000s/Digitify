//! Audio CDs (D-022): the table of contents, CD-Text, and reading audio with verification.
//! Ripping reads each track once into a WAV file, then reads it all again and compares block
//! by block; blocks that differ are re-read until two reads agree (or reported if they never do).

use std::fs::File;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::Path;

use serde::{Deserialize, Serialize};

use super::drive_io::SECTOR;

/// Sectors read per request (about 61 KB), within what drives accept.
pub const BLOCK: u32 = 24;
const MAX_REREADS: u32 = 8;
/// The CD's own start: track addresses count 2 seconds (150 sectors) of lead-in.
const LEAD_IN: u32 = 150;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub number: u32,
    /// First sector, counted from the start of the disc's audio.
    pub start: u32,
    pub sectors: u32,
    /// Data tracks (on enhanced CDs) can't be played or ripped as audio.
    pub audio: bool,
}

impl Track {
    pub fn seconds(&self) -> f64 {
        self.sectors as f64 / 75.0
    }
}

/// Tracks from a raw CDROM_TOC: a 4-byte header, then 8-byte entries ending with the lead-out (0xAA).
pub fn parse_toc(raw: &[u8]) -> Vec<Track> {
    if raw.len() < 4 {
        return Vec::new();
    }
    let (first, last) = (raw[2] as usize, raw[3] as usize);
    let count = last.saturating_sub(first) + 2; // tracks plus the lead-out
    let mut entries: Vec<(u32, u32, bool)> = Vec::new();
    for index in 0..count {
        let at = 4 + index * 8;
        let Some(entry) = raw.get(at..at + 8) else { break };
        let control = entry[1] & 0x0F;
        let address = (entry[5] as u32 * 60 + entry[6] as u32) * 75 + entry[7] as u32;
        entries.push((entry[2] as u32, address.saturating_sub(LEAD_IN), control & 0x04 == 0));
    }
    entries
        .windows(2)
        .filter(|pair| pair[0].0 != 0xAA)
        .map(|pair| Track { number: pair[0].0, start: pair[0].1, sectors: pair[1].1.saturating_sub(pair[0].1), audio: pair[0].2 })
        .collect()
}

/// Album and track titles and performers from CD-Text.
#[derive(Debug, Default, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CdText {
    pub album: Option<String>,
    pub artist: Option<String>,
    /// Track titles and performers by track number.
    pub titles: Vec<(u32, String)>,
    pub performers: Vec<(u32, String)>,
}

/// CD-Text from a raw CDROM_TOC_CD_TEXT_DATA: a 4-byte header, then 18-byte packs. Only the first
/// block (usually English) is read; pack 0x80 holds titles and 0x81 performers, as NUL-separated
/// text running across packs, with a tab meaning "same as the previous one".
pub fn parse_cd_text(raw: &[u8]) -> CdText {
    let packs: Vec<&[u8]> = raw.get(4..).unwrap_or_default().chunks_exact(18).filter(|pack| (pack[3] >> 4) & 0x07 == 0).collect();
    let strings = |kind: u8| -> Vec<(u32, String)> {
        let mut list = Vec::new();
        let mut text: Vec<u8> = Vec::new();
        let mut track: Option<u32> = None;
        for pack in packs.iter().filter(|pack| pack[0] == kind) {
            if track.is_none() {
                track = Some((pack[1] & 0x7F) as u32);
            }
            for &byte in &pack[4..16] {
                if byte == 0 {
                    let value: String = text.iter().map(|&b| b as char).collect();
                    let value = if value == "\t" { list.last().map(|(_, v): &(u32, String)| v.clone()).unwrap_or_default() } else { value };
                    let number = track.unwrap_or(0);
                    list.push((number, value.trim().to_string()));
                    track = Some(number + 1);
                    text.clear();
                } else {
                    text.push(byte);
                }
            }
        }
        list.into_iter().filter(|(_, v)| !v.is_empty()).collect()
    };
    let titles = strings(0x80);
    let performers = strings(0x81);
    let of = |list: &[(u32, String)], track: u32| list.iter().find(|(n, _)| *n == track).map(|(_, v)| v.clone());
    CdText {
        album: of(&titles, 0),
        artist: of(&performers, 0),
        titles: titles.iter().filter(|(n, _)| *n > 0).cloned().collect(),
        performers: performers.iter().filter(|(n, _)| *n > 0).cloned().collect(),
    }
}

/// Where audio sectors come from: a drive, or (for tests and the fake drives) a file.
pub trait SectorSource: Send {
    fn read(&mut self, lba: u32, count: u32) -> std::io::Result<Vec<u8>>;
}

impl SectorSource for super::drive_io::Device {
    fn read(&mut self, lba: u32, count: u32) -> std::io::Result<Vec<u8>> {
        self.read_audio(lba, count)
    }
}

/// Raw CD audio in a file, 2,352 bytes a sector: a simulated disc.
pub struct ImageSource(pub File);

impl SectorSource for ImageSource {
    fn read(&mut self, lba: u32, count: u32) -> std::io::Result<Vec<u8>> {
        let mut bytes = vec![0u8; SECTOR * count as usize];
        self.0.seek(SeekFrom::Start(lba as u64 * SECTOR as u64))?;
        self.0.read_exact(&mut bytes)?;
        Ok(bytes)
    }
}

pub fn wav_header(data_bytes: u32) -> [u8; 44] {
    let mut header = [0u8; 44];
    let mut put = |at: usize, bytes: &[u8]| header[at..at + bytes.len()].copy_from_slice(bytes);
    put(0, b"RIFF");
    put(4, &(36 + data_bytes).to_le_bytes());
    put(8, b"WAVEfmt ");
    put(16, &16u32.to_le_bytes());
    put(20, &1u16.to_le_bytes()); // PCM
    put(22, &2u16.to_le_bytes()); // stereo
    put(24, &44_100u32.to_le_bytes());
    put(28, &(44_100u32 * 4).to_le_bytes());
    put(32, &4u16.to_le_bytes());
    put(34, &16u16.to_le_bytes());
    put(36, b"data");
    put(40, &data_bytes.to_le_bytes());
    header
}

#[derive(Debug, Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Verification {
    /// Blocks whose two reads differed and were read again.
    pub rereads: u32,
    /// Blocks that never read the same twice: their audio may contain errors.
    pub unverified: u32,
}

/// Rips a track to a WAV file: a copy pass, then a test pass comparing every block, re-reading
/// blocks that differ until two reads agree. `progress` gets the fraction done (0–1) and returns
/// false to cancel.
pub fn rip_track(source: &mut dyn SectorSource, track: &Track, out: &Path, mut progress: impl FnMut(f64) -> bool) -> std::io::Result<Verification> {
    let blocks: Vec<(u32, u32)> = (0..track.sectors.div_ceil(BLOCK))
        .map(|i| (track.start + i * BLOCK, BLOCK.min(track.sectors - i * BLOCK)))
        .collect();
    let mut file = File::create(out)?;
    file.write_all(&wav_header(track.sectors * SECTOR as u32))?;
    let mut hashes = Vec::with_capacity(blocks.len());
    let total = blocks.len() as f64 * 2.0;
    for (index, &(lba, count)) in blocks.iter().enumerate() {
        let bytes = source.read(lba, count)?;
        hashes.push(blake3::hash(&bytes));
        file.write_all(&bytes)?;
        if !progress(index as f64 / total) {
            return Err(std::io::Error::new(std::io::ErrorKind::Interrupted, "cancelled"));
        }
    }
    let mut verification = Verification::default();
    for (index, &(lba, count)) in blocks.iter().enumerate() {
        let mut previous = source.read(lba, count)?;
        if blake3::hash(&previous) != hashes[index] {
            verification.rereads += 1;
            let mut agreed = false;
            for _ in 0..MAX_REREADS {
                let again = source.read(lba, count)?;
                if again == previous {
                    agreed = true;
                    break;
                }
                previous = again;
            }
            if !agreed {
                verification.unverified += 1;
            }
            // The agreeing (or latest) read replaces what the copy pass wrote.
            file.seek(SeekFrom::Start(44 + (lba - track.start) as u64 * SECTOR as u64))?;
            file.write_all(&previous)?;
        }
        if !progress((blocks.len() + index) as f64 / total) {
            return Err(std::io::Error::new(std::io::ErrorKind::Interrupted, "cancelled"));
        }
    }
    file.flush()?;
    Ok(verification)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A TOC as Windows returns it: tracks 1 (audio, 2 s in), 2 (audio), 3 (data), lead-out.
    fn toc() -> Vec<u8> {
        let mut raw = vec![0, 34, 1, 3];
        for (control, number, msf) in [(0x00u8, 1u8, (0u8, 2u8, 0u8)), (0x00, 2, (3, 0, 0)), (0x04, 3, (5, 0, 0)), (0x04, 0xAA, (9, 0, 0))] {
            raw.extend_from_slice(&[0, control | 0x10, number, 0, 0, msf.0, msf.1, msf.2]);
        }
        raw
    }

    #[test]
    fn toc_tracks() {
        let tracks = parse_toc(&toc());
        assert_eq!(tracks.len(), 3);
        assert_eq!(tracks[0], Track { number: 1, start: 0, sectors: 13_350, audio: true });
        assert_eq!(tracks[1].start, 3 * 60 * 75 - 150);
        assert_eq!(tracks[1].seconds(), 120.0);
        assert!(!tracks[2].audio);
    }

    fn pack(kind: u8, track: u8, sequence: u8, text: &[u8]) -> Vec<u8> {
        let mut pack = vec![kind, track, sequence, 0];
        let mut body = text.to_vec();
        body.resize(12, 0);
        pack.extend_from_slice(&body);
        pack.extend_from_slice(&[0, 0]);
        pack
    }

    #[test]
    fn cd_text() {
        let mut raw = vec![0, 0, 0, 0];
        // Titles: album "Night Songs", track 1 "Intro", track 2 "Harbor Lights" (crossing packs).
        raw.extend(pack(0x80, 0, 0, b"Night Songs\0"));
        raw.extend(pack(0x80, 1, 1, b"Intro\0Harbor"));
        raw.extend(pack(0x80, 2, 2, b" Lights\0"));
        raw.extend(pack(0x81, 0, 3, b"The Keepers\0"));
        raw.extend(pack(0x81, 1, 4, b"\t\0\t\0"));
        let text = parse_cd_text(&raw);
        assert_eq!(text.album.as_deref(), Some("Night Songs"));
        assert_eq!(text.artist.as_deref(), Some("The Keepers"));
        assert_eq!(text.titles, vec![(1, "Intro".to_string()), (2, "Harbor Lights".to_string())]);
        assert_eq!(text.performers, vec![(1, "The Keepers".to_string()), (2, "The Keepers".to_string())]);
    }

    /// A disc whose block at `flaky` reads wrong the first `bad` times (after the copy pass).
    struct Flaky {
        reads: std::collections::HashMap<u32, u32>,
        flaky: u32,
        bad: u32,
        noisy: bool,
    }

    impl SectorSource for Flaky {
        fn read(&mut self, lba: u32, count: u32) -> std::io::Result<Vec<u8>> {
            let seen = self.reads.entry(lba).or_insert(0);
            *seen += 1;
            let mut bytes: Vec<u8> = (0..SECTOR * count as usize).map(|i| ((lba as usize * 7 + i) % 251) as u8).collect();
            if lba == self.flaky && (self.noisy || (*seen > 1 && *seen <= 1 + self.bad)) {
                bytes[0] = bytes[0].wrapping_add(*seen as u8);
            }
            Ok(bytes)
        }
    }

    #[test]
    fn rips_are_verified() {
        let dir = std::env::temp_dir().join(format!("digitify-cd-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let track = Track { number: 1, start: 0, sectors: 100, audio: true };
        // One block reads differently once in the test pass, then settles.
        let mut source = Flaky { reads: Default::default(), flaky: BLOCK, bad: 1, noisy: false };
        let out = dir.join("t1.wav");
        let verification = rip_track(&mut source, &track, &out, |_| true).unwrap();
        assert_eq!((verification.rereads, verification.unverified), (1, 0));
        let wav = std::fs::read(&out).unwrap();
        assert_eq!(wav.len(), 44 + 100 * SECTOR);
        assert_eq!(&wav[0..4], b"RIFF");
        // A block that never reads the same twice is reported.
        let mut noisy = Flaky { reads: Default::default(), flaky: 0, bad: 0, noisy: true };
        let verification = rip_track(&mut noisy, &track, &dir.join("t2.wav"), |_| true).unwrap();
        assert_eq!(verification.unverified, 1);
        // Cancelling stops the rip.
        let mut clean = Flaky { reads: Default::default(), flaky: u32::MAX, bad: 0, noisy: false };
        assert!(rip_track(&mut clean, &track, &dir.join("t3.wav"), |f| f < 0.2).is_err());
    }
}

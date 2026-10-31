//! DVD-Video structure (D-022): titles, chapters and languages from the IFO files in VIDEO_TS,
//! and a check for CSS-scrambled sectors. Nothing here decrypts anything (D-007); a scrambled
//! disc is refused.

use std::io::Read;
use std::path::{Path, PathBuf};

use serde::Serialize;

const IFO_SECTOR: usize = 2048;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DvdTitle {
    pub number: u32,
    pub seconds: f64,
    /// Where each chapter starts, in seconds.
    pub chapters: Vec<f64>,
    /// Audio and subtitle languages (ISO 639-1 codes, empty when the disc doesn't say).
    pub audio: Vec<String>,
    pub subtitles: Vec<String>,
    #[serde(skip)]
    pub vobs: Vec<PathBuf>,
}

fn be16(bytes: &[u8], at: usize) -> Option<usize> {
    Some(u16::from_be_bytes(bytes.get(at..at + 2)?.try_into().ok()?) as usize)
}

fn be32(bytes: &[u8], at: usize) -> Option<usize> {
    Some(u32::from_be_bytes(bytes.get(at..at + 4)?.try_into().ok()?) as usize)
}

fn bcd(byte: u8) -> f64 {
    ((byte >> 4) * 10 + (byte & 0x0F)) as f64
}

/// A DVD playback time: hours, minutes, seconds and frames in BCD; the top bits of the frames
/// byte give the frame rate.
fn time(bytes: &[u8], at: usize) -> f64 {
    let Some(t) = bytes.get(at..at + 4) else { return 0.0 };
    let fps = if t[3] >> 6 == 1 { 25.0 } else { 29.97 };
    bcd(t[0]) * 3600.0 + bcd(t[1]) * 60.0 + bcd(t[2]) + bcd(t[3] & 0x3F) / fps
}

fn language(bytes: &[u8], at: usize) -> String {
    match bytes.get(at..at + 2) {
        Some(code) if code.iter().all(u8::is_ascii_alphabetic) => String::from_utf8_lossy(code).to_lowercase(),
        _ => String::new(),
    }
}

fn read_ifo(dir: &Path, name: &str) -> Option<Vec<u8>> {
    std::fs::read(dir.join(format!("{name}.IFO"))).or_else(|_| std::fs::read(dir.join(format!("{name}.BUP")))).ok()
}

struct Pgc {
    seconds: f64,
    /// Start time of each program (chapter point) within the PGC.
    program_starts: Vec<f64>,
}

fn pgc(vts: &[u8], pgcn: usize) -> Option<Pgc> {
    let pgci = be32(vts, 0xCC)? * IFO_SECTOR;
    let at = pgci + be32(vts, pgci + 8 + (pgcn - 1) * 8 + 4)?;
    let programs = *vts.get(at + 2)? as usize;
    let cells = *vts.get(at + 3)? as usize;
    let map = at + be16(vts, at + 0xE6)?;
    let cell_table = at + be16(vts, at + 0xE8)?;
    let cell_times: Vec<f64> = (0..cells).map(|c| time(vts, cell_table + c * 24 + 4)).collect();
    let program_starts = (0..programs)
        .map(|p| {
            let entry = vts.get(map + p).copied().unwrap_or(1).max(1) as usize;
            cell_times.iter().take(entry - 1).sum()
        })
        .collect();
    Some(Pgc { seconds: time(vts, at + 4), program_starts })
}

/// The titles of a VIDEO_TS folder, in disc order.
pub fn titles(video_ts: &Path) -> Option<Vec<DvdTitle>> {
    let vmg = read_ifo(video_ts, "VIDEO_TS")?;
    if !vmg.starts_with(b"DVDVIDEO-VMG") {
        return None;
    }
    let table = be32(&vmg, 0xC4)? * IFO_SECTOR;
    let count = be16(&vmg, table)?;
    let mut titles = Vec::new();
    for index in 0..count {
        let entry = table + 8 + index * 12;
        let (Some(&vtsn), Some(&ttn)) = (vmg.get(entry + 6), vmg.get(entry + 7)) else { continue };
        let Some(vts) = read_ifo(video_ts, &format!("VTS_{vtsn:02}_0")) else { continue };
        let ptt = be32(&vts, 0xC8)? * IFO_SECTOR;
        let units = be16(&vts, ptt)?;
        let ttn = ttn as usize;
        if ttn == 0 || ttn > units {
            continue;
        }
        let start = ptt + be32(&vts, ptt + 8 + (ttn - 1) * 4)?;
        let end = if ttn < units { ptt + be32(&vts, ptt + 8 + ttn * 4)? } else { ptt + be32(&vts, ptt + 4)? + 1 };
        let parts: Vec<(usize, usize)> = (start..end).step_by(4).filter_map(|at| Some((be16(&vts, at)?, be16(&vts, at + 2)?))).collect();
        let Some(&(first_pgc, _)) = parts.first() else { continue };
        let Some(chain) = pgc(&vts, first_pgc) else { continue };
        let chapters = parts
            .iter()
            .filter(|(pgcn, _)| *pgcn == first_pgc)
            .map(|(_, pgn)| chain.program_starts.get(pgn.saturating_sub(1)).copied().unwrap_or(0.0))
            .collect();
        let audio = (0..be16(&vts, 0x202).unwrap_or(0).min(8)).map(|i| language(&vts, 0x204 + i * 8 + 2)).collect();
        let subtitles = (0..be16(&vts, 0x254).unwrap_or(0).min(32)).map(|i| language(&vts, 0x256 + i * 6 + 2)).collect();
        let vobs = (1..=9).map(|n| video_ts.join(format!("VTS_{vtsn:02}_{n}.VOB"))).filter(|p| p.exists()).collect();
        titles.push(DvdTitle { number: index as u32 + 1, seconds: chain.seconds, chapters, audio, subtitles, vobs });
    }
    Some(titles)
}

/// Whether a VOB's first packs are CSS-scrambled (the PES scrambling bits are set). Detection
/// only: such a disc is refused, never decrypted (D-007).
pub fn scrambled(vob: &Path) -> bool {
    let mut bytes = Vec::new();
    if std::fs::File::open(vob).and_then(|f| f.take(2 * 1024 * 1024).read_to_end(&mut bytes)).is_err() {
        return false;
    }
    bytes.chunks(IFO_SECTOR).any(|pack| {
        if !pack.starts_with(&[0, 0, 1, 0xBA]) || pack.len() < 24 {
            return false;
        }
        let pes = 14 + (pack[13] & 0x07) as usize;
        let Some(header) = pack.get(pes..pes + 7) else { return false };
        let stream = header[3];
        let is_av = matches!(stream, 0xBD | 0xC0..=0xEF);
        is_av && header[..3] == [0, 0, 1] && header[6] & 0xC0 == 0x80 && header[6] & 0x30 != 0
    })
}

/// Writes the IFO files of a simple DVD: one title set per title, one cell per chapter. Used by
/// the tests and the sample discs (no free tool in the project authors DVDs).
pub mod sample {
    use std::path::Path;

    pub struct Title {
        /// Each chapter's length in seconds.
        pub chapters: Vec<u32>,
        pub audio: Vec<&'static str>,
        pub subtitles: Vec<&'static str>,
    }

    fn bcd_time(seconds: u32) -> [u8; 4] {
        let to = |v: u32| (((v / 10) << 4) | (v % 10)) as u8;
        [to(seconds / 3600), to(seconds / 60 % 60), to(seconds % 60), 1 << 6]
    }

    fn put(bytes: &mut Vec<u8>, at: usize, data: &[u8]) {
        if bytes.len() < at + data.len() {
            bytes.resize(at + data.len(), 0);
        }
        bytes[at..at + data.len()].copy_from_slice(data);
    }

    fn sectors(mut bytes: Vec<u8>) -> Vec<u8> {
        bytes.resize(bytes.len().div_ceil(2048) * 2048, 0);
        bytes
    }

    pub fn write(video_ts: &Path, titles: &[Title]) -> std::io::Result<()> {
        std::fs::create_dir_all(video_ts)?;
        let mut vmg = Vec::new();
        put(&mut vmg, 0, b"DVDVIDEO-VMG");
        put(&mut vmg, 0xC4, &1u32.to_be_bytes());
        let table = 2048;
        put(&mut vmg, table, &(titles.len() as u16).to_be_bytes());
        put(&mut vmg, table + 4, &((8 + titles.len() * 12 - 1) as u32).to_be_bytes());
        for (i, title) in titles.iter().enumerate() {
            let entry = table + 8 + i * 12;
            put(&mut vmg, entry, &[0x3C, 1]);
            put(&mut vmg, entry + 2, &(title.chapters.len() as u16).to_be_bytes());
            put(&mut vmg, entry + 6, &[(i + 1) as u8, 1]);
        }
        std::fs::write(video_ts.join("VIDEO_TS.IFO"), sectors(vmg))?;

        for (i, title) in titles.iter().enumerate() {
            let chapters = title.chapters.len();
            let mut vts = Vec::new();
            put(&mut vts, 0, b"DVDVIDEO-VTS");
            put(&mut vts, 0xC8, &1u32.to_be_bytes());
            put(&mut vts, 0xCC, &2u32.to_be_bytes());
            put(&mut vts, 0x202, &(title.audio.len() as u16).to_be_bytes());
            for (a, lang) in title.audio.iter().enumerate() {
                put(&mut vts, 0x204 + a * 8 + 2, lang.as_bytes());
            }
            put(&mut vts, 0x254, &(title.subtitles.len() as u16).to_be_bytes());
            for (s, lang) in title.subtitles.iter().enumerate() {
                put(&mut vts, 0x256 + s * 6 + 2, lang.as_bytes());
            }
            // VTS_PTT_SRPT: one title unit whose chapters are programs 1..n of PGC 1.
            let ptt = 2048;
            put(&mut vts, ptt, &1u16.to_be_bytes());
            put(&mut vts, ptt + 4, &((12 + chapters * 4 - 1) as u32).to_be_bytes());
            put(&mut vts, ptt + 8, &12u32.to_be_bytes());
            for c in 0..chapters {
                put(&mut vts, ptt + 12 + c * 4, &1u16.to_be_bytes());
                put(&mut vts, ptt + 14 + c * 4, &((c + 1) as u16).to_be_bytes());
            }
            // VTS_PGCI with one PGC: one program and one cell per chapter.
            let pgci = 4096;
            let pgc = pgci + 16;
            put(&mut vts, pgci, &1u16.to_be_bytes());
            put(&mut vts, pgci + 8, &0x8100_0000u32.to_be_bytes());
            put(&mut vts, pgci + 12, &16u32.to_be_bytes());
            put(&mut vts, pgc + 2, &[chapters as u8, chapters as u8]);
            put(&mut vts, pgc + 4, &bcd_time(title.chapters.iter().sum()));
            let map = 0xEC;
            let cells = map + chapters.div_ceil(2) * 2;
            put(&mut vts, pgc + 0xE6, &(map as u16).to_be_bytes());
            put(&mut vts, pgc + 0xE8, &(cells as u16).to_be_bytes());
            for c in 0..chapters {
                put(&mut vts, pgc + map + c, &[(c + 1) as u8]);
                put(&mut vts, pgc + cells + c * 24 + 4, &bcd_time(title.chapters[c]));
            }
            let end = (vts.len() - pgci - 1) as u32;
            put(&mut vts, pgci + 4, &end.to_be_bytes());
            std::fs::write(video_ts.join(format!("VTS_{:02}_0.IFO", i + 1)), sectors(vts))?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn titles_chapters_and_languages() {
        let dir = std::env::temp_dir().join(format!("digitify-dvd-{}", std::process::id())).join("VIDEO_TS");
        sample::write(
            &dir,
            &[
                sample::Title { chapters: vec![600, 900, 300], audio: vec!["en", "es"], subtitles: vec!["en"] },
                sample::Title { chapters: vec![95], audio: vec!["en"], subtitles: vec![] },
            ],
        )
        .unwrap();
        std::fs::write(dir.join("VTS_01_1.VOB"), b"").unwrap();
        let found = titles(&dir).unwrap();
        assert_eq!(found.len(), 2);
        assert_eq!(found[0].seconds, 1800.0);
        assert_eq!(found[0].chapters, vec![0.0, 600.0, 1500.0]);
        assert_eq!(found[0].audio, vec!["en", "es"]);
        assert_eq!(found[0].subtitles, vec!["en"]);
        assert_eq!(found[0].vobs.len(), 1);
        assert_eq!(found[1].seconds, 95.0);
        assert!(titles(dir.parent().unwrap()).is_none());
    }

    #[test]
    fn scrambled_packs_are_detected() {
        let dir = std::env::temp_dir().join(format!("digitify-vob-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let pack = |scrambling: u8| {
            let mut pack = vec![0u8; 2048];
            pack[..4].copy_from_slice(&[0, 0, 1, 0xBA]);
            pack[13] = 0xF8; // no stuffing
            pack[14..21].copy_from_slice(&[0, 0, 1, 0xE0, 0x07, 0xEC, 0x80 | (scrambling << 4)]);
            pack
        };
        let clear = dir.join("clear.VOB");
        let css = dir.join("css.VOB");
        std::fs::write(&clear, [pack(0), pack(0)].concat()).unwrap();
        std::fs::write(&css, [pack(0), pack(1)].concat()).unwrap();
        assert!(!scrambled(&clear));
        assert!(scrambled(&css));
    }
}

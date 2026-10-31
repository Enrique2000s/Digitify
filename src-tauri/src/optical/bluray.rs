//! Blu-ray structure (D-022): titles from the playlists in BDMV/PLAYLIST (their clips, length,
//! chapter marks and languages), and protection detection. Discs with AACS or BD+ are refused,
//! never decrypted (D-007).

use std::path::{Path, PathBuf};

use serde::Serialize;

/// Blu-ray clock ticks per second.
const TICKS: f64 = 45_000.0;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlurayTitle {
    /// The playlist's number, e.g. 800 for 00800.mpls.
    pub number: u32,
    pub seconds: f64,
    pub chapters: Vec<f64>,
    pub audio: Vec<String>,
    pub subtitles: Vec<String>,
    #[serde(skip)]
    pub clips: Vec<PathBuf>,
}

/// Which protection a Blu-ray's folders show: AACS (an `AACS` folder) or BD+ (`BDSVM`).
pub fn protection(root: &Path) -> Option<&'static str> {
    if root.join("BDSVM").is_dir() || root.join("BDMV").join("BDSVM").is_dir() {
        Some("BD+")
    } else if root.join("AACS").is_dir() {
        Some("AACS")
    } else {
        None
    }
}

fn be16(b: &[u8], at: usize) -> Option<usize> {
    Some(u16::from_be_bytes(b.get(at..at + 2)?.try_into().ok()?) as usize)
}

fn be32(b: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_be_bytes(b.get(at..at + 4)?.try_into().ok()?))
}

/// Audio and subtitle languages from a play item's stream number table.
fn languages(b: &[u8], stn: usize) -> (Vec<String>, Vec<String>) {
    let (mut audio, mut subtitles) = (Vec::new(), Vec::new());
    let counts = match b.get(stn + 4..stn + 11) {
        Some(c) => [c[0], c[1], c[2], c[3], c[4], c[5], c[6]],
        None => return (audio, subtitles),
    };
    let mut at = stn + 16;
    for (kind, &count) in counts.iter().enumerate() {
        for _ in 0..count {
            let Some(&entry_len) = b.get(at) else { return (audio, subtitles) };
            at += 1 + entry_len as usize;
            let Some(&attr_len) = b.get(at) else { return (audio, subtitles) };
            let attributes = b.get(at + 1..at + 1 + attr_len as usize).unwrap_or_default();
            let code = |offset: usize| attributes.get(offset..offset + 3).map(|c| String::from_utf8_lossy(c).to_string()).unwrap_or_default();
            match kind {
                1 => audio.push(code(2)),
                2 => subtitles.push(if attributes.first() == Some(&0x92) { code(2) } else { code(1) }),
                _ => {}
            }
            at += 1 + attr_len as usize;
        }
    }
    (audio, subtitles)
}

/// One playlist file.
pub fn playlist(path: &Path, stream_dir: &Path) -> Option<BlurayTitle> {
    let b = std::fs::read(path).ok()?;
    if !b.starts_with(b"MPLS") {
        return None;
    }
    let list = be32(&b, 8)? as usize;
    let marks = be32(&b, 12)? as usize;
    let items = be16(&b, list + 6)?;
    let mut at = list + 10;
    let mut clips = Vec::new();
    let mut spans = Vec::new(); // (in, out) per play item
    let mut langs = (Vec::new(), Vec::new());
    for index in 0..items {
        let length = be16(&b, at)?;
        let name = String::from_utf8_lossy(b.get(at + 2..at + 7)?).to_string();
        let multi_angle = b.get(at + 12)? & 0x10 != 0;
        let (start, end) = (be32(&b, at + 14)?, be32(&b, at + 18)?);
        clips.push(stream_dir.join(format!("{name}.m2ts")));
        spans.push((start, end));
        if index == 0 {
            let mut stn = at + 34;
            if multi_angle {
                let angles = *b.get(stn)? as usize;
                stn += 2 + (angles.saturating_sub(1)) * 10;
            }
            langs = languages(&b, stn);
        }
        at += 2 + length;
    }
    let seconds = spans.iter().map(|(s, e)| e.saturating_sub(*s) as f64 / TICKS).sum();
    // Chapter marks: entry marks, timed within their play item.
    let offsets: Vec<f64> = spans.iter().scan(0.0, |sum, (s, e)| {
        let start = *sum;
        *sum += e.saturating_sub(*s) as f64 / TICKS;
        Some(start)
    }).collect();
    let mut chapters: Vec<f64> = (0..be16(&b, marks + 4).unwrap_or(0))
        .filter_map(|m| {
            let mark = marks + 6 + m * 14;
            (*b.get(mark + 1)? == 1).then_some(())?;
            let item = be16(&b, mark + 2)?;
            let stamp = be32(&b, mark + 4)?;
            Some(offsets.get(item)? + stamp.saturating_sub(spans.get(item)?.0) as f64 / TICKS)
        })
        .collect();
    chapters.dedup_by(|a, b| (*a - *b).abs() < 0.5);
    let number = path.file_stem()?.to_str()?.parse().ok()?;
    Some(BlurayTitle { number, seconds, chapters, audio: langs.0, subtitles: langs.1, clips })
}

/// The titles of a disc: playlists of at least 20 seconds whose clips exist, longest first, with
/// playlists repeating the same clips left out.
pub fn titles(root: &Path) -> Option<Vec<BlurayTitle>> {
    let bdmv = root.join("BDMV");
    let mut titles: Vec<BlurayTitle> = std::fs::read_dir(bdmv.join("PLAYLIST"))
        .ok()?
        .filter_map(Result::ok)
        .filter(|e| e.path().extension().is_some_and(|x| x.eq_ignore_ascii_case("mpls")))
        .filter_map(|e| playlist(&e.path(), &bdmv.join("STREAM")))
        .filter(|t| t.seconds >= 20.0 && t.clips.iter().all(|c| c.exists()))
        .collect();
    titles.sort_by(|a, b| b.seconds.total_cmp(&a.seconds).then(a.number.cmp(&b.number)));
    let mut seen = std::collections::HashSet::new();
    titles.retain(|t| seen.insert(t.clips.clone()));
    Some(titles)
}

/// Writes a minimal playlist (tests and the sample discs): play items over clips, chapter marks
/// at the given seconds of the whole title, and audio/subtitle languages on the first item.
pub mod sample {
    use std::path::Path;

    pub fn write(path: &Path, clips: &[(&str, u32)], chapters: &[u32], audio: &[&str], subtitles: &[&str]) -> std::io::Result<()> {
        let ticks = |s: u32| s * 45_000;
        let mut items = Vec::new();
        for (index, (name, seconds)) in clips.iter().enumerate() {
            let mut item = Vec::new();
            item.extend_from_slice(name.as_bytes());
            item.extend_from_slice(b"M2TS");
            item.extend_from_slice(&[0, 1, 0]); // flags, connection condition, STC id
            item.extend_from_slice(&ticks(0).to_be_bytes());
            item.extend_from_slice(&ticks(*seconds).to_be_bytes());
            item.extend_from_slice(&[0; 8]); // user operation mask
            item.extend_from_slice(&[0, 0, 0, 0]); // random access, still mode and time
            let mut stn = vec![0, 0, 1, audio.len() as u8, subtitles.len() as u8, 0, 0, 0, 0, 0, 0, 0, 0, 0];
            if index == 0 {
                stn.extend_from_slice(&[9, 1, 0x10, 0x11, 0, 0, 0, 0, 0, 0, 5, 0x1B, 0x61, 0, 0, 0]);
                for (i, lang) in audio.iter().enumerate() {
                    stn.extend_from_slice(&[9, 1, 0x11, 0x00 + i as u8, 0, 0, 0, 0, 0, 0, 5, 0x81, 0x31]);
                    stn.extend_from_slice(lang.as_bytes());
                }
                for (i, lang) in subtitles.iter().enumerate() {
                    stn.extend_from_slice(&[9, 1, 0x12, i as u8, 0, 0, 0, 0, 0, 0, 4, 0x90]);
                    stn.extend_from_slice(lang.as_bytes());
                }
            } else {
                stn[3] = 0;
                stn[4] = 0;
                stn[2] = 0;
            }
            let mut table = (stn.len() as u16).to_be_bytes().to_vec();
            table.extend(stn);
            item.extend(table);
            let mut entry = (item.len() as u16).to_be_bytes().to_vec();
            entry.extend(item);
            items.extend(entry);
        }
        let mut list = vec![0u8; 2];
        list.extend_from_slice(&(clips.len() as u16).to_be_bytes());
        list.extend_from_slice(&0u16.to_be_bytes());
        list.extend(items);
        let mut list_block = (list.len() as u32).to_be_bytes().to_vec();
        list_block.extend(list);

        let mut marks = (chapters.len() as u16).to_be_bytes().to_vec();
        let mut offsets = Vec::new();
        let mut sum = 0;
        for (_, seconds) in clips {
            offsets.push(sum);
            sum += seconds;
        }
        for &at in chapters {
            let item = offsets.iter().rposition(|&o| o <= at).unwrap_or(0);
            marks.extend_from_slice(&[0, 1]);
            marks.extend_from_slice(&(item as u16).to_be_bytes());
            marks.extend_from_slice(&ticks(at - offsets[item]).to_be_bytes());
            marks.extend_from_slice(&[0xFF, 0xFF, 0, 0, 0, 0]);
        }
        let mut marks_block = (marks.len() as u32).to_be_bytes().to_vec();
        marks_block.extend(marks);

        let mut file = b"MPLS0200".to_vec();
        let list_start = 40u32;
        let marks_start = list_start + list_block.len() as u32;
        file.extend_from_slice(&list_start.to_be_bytes());
        file.extend_from_slice(&marks_start.to_be_bytes());
        file.resize(list_start as usize, 0);
        file.extend(list_block);
        file.extend(marks_block);
        std::fs::write(path, file)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn playlists_become_titles() {
        let root = std::env::temp_dir().join(format!("digitify-bd-{}", std::process::id()));
        let bdmv = root.join("BDMV");
        std::fs::create_dir_all(bdmv.join("PLAYLIST")).unwrap();
        std::fs::create_dir_all(bdmv.join("STREAM")).unwrap();
        for clip in ["00001", "00002", "00003"] {
            std::fs::write(bdmv.join("STREAM").join(format!("{clip}.m2ts")), b"").unwrap();
        }
        sample::write(&bdmv.join("PLAYLIST").join("00800.mpls"), &[("00001", 600), ("00002", 300)], &[0, 300, 600, 750], &["eng", "spa"], &["eng"]).unwrap();
        sample::write(&bdmv.join("PLAYLIST").join("00001.mpls"), &[("00003", 45)], &[0], &["eng"], &[]).unwrap();
        sample::write(&bdmv.join("PLAYLIST").join("00002.mpls"), &[("00003", 5)], &[0], &["eng"], &[]).unwrap();
        let titles = titles(&root).unwrap();
        assert_eq!(titles.iter().map(|t| t.number).collect::<Vec<_>>(), vec![800, 1]);
        assert_eq!(titles[0].seconds, 900.0);
        assert_eq!(titles[0].chapters, vec![0.0, 300.0, 600.0, 750.0]);
        assert_eq!(titles[0].audio, vec!["eng", "spa"]);
        assert_eq!(titles[0].subtitles, vec!["eng"]);
        assert_eq!(titles[0].clips.len(), 2);
        assert_eq!(protection(&root), None);
        std::fs::create_dir_all(root.join("AACS")).unwrap();
        assert_eq!(protection(&root), Some("AACS"));
    }
}

//! TV series (D-018): recognizing episodes from file names and folders at import. A series becomes
//! one item whose episodes are parts; see watch.rs for playing them.

use std::path::Path;

#[derive(Debug, Clone, PartialEq)]
pub struct EpisodeName {
    pub series: String,
    pub season: i64,
    pub episode: f64,
    /// What follows the episode number in the name, if anything.
    pub title: Option<String>,
}

const SEPARATORS: &[char] = &[' ', '-', '_', '.', '–', '—', ':', ',', '[', ']', '(', ')'];

fn clean(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ").trim_matches(SEPARATORS).trim().to_string()
}

/// Digits starting at `at`, at most `max` of them: their value and where they end.
fn digits(chars: &[char], at: usize, max: usize) -> Option<(i64, usize)> {
    let end = (at..chars.len().min(at + max)).take_while(|&i| chars[i].is_ascii_digit()).last()? + 1;
    let value = chars[at..end].iter().collect::<String>().parse().ok()?;
    Some((value, end))
}

/// The episode marker in a name: "S01E02", "s1e2", "S01 E02", "S01.E02" or "1x02". Returns the
/// season, the episode, and where the marker starts and ends.
fn marker(chars: &[char]) -> Option<(i64, i64, usize, usize)> {
    let boundary = |i: usize| i == 0 || !chars[i - 1].is_alphanumeric();
    for start in 0..chars.len() {
        if !boundary(start) {
            continue;
        }
        if chars[start].eq_ignore_ascii_case(&'s') {
            if let Some((season, mut at)) = digits(chars, start + 1, 2) {
                if at < chars.len() && matches!(chars[at], ' ' | '.' | '-') {
                    at += 1;
                }
                if at < chars.len() && chars[at].eq_ignore_ascii_case(&'e') {
                    if let Some((episode, end)) = digits(chars, at + 1, 3) {
                        if end == chars.len() || !chars[end].is_ascii_digit() {
                            return Some((season, episode, start, end));
                        }
                    }
                }
            }
        }
        if let Some((season, at)) = digits(chars, start, 2) {
            if at < chars.len() && chars[at].eq_ignore_ascii_case(&'x') {
                if let Some((episode, end)) = digits(chars, at + 1, 3) {
                    if end - at > 2 && (end == chars.len() || !chars[end].is_alphanumeric()) {
                        return Some((season, episode, start, end));
                    }
                }
            }
        }
    }
    None
}

/// A folder named for a season ("Season 1", "S01", "Temporada 2", "Specials").
fn is_season_folder(name: &str) -> bool {
    let lower = name.trim().to_lowercase();
    let rest = ["season", "temporada", "saison", "staffel", "series", "s"]
        .iter()
        .find_map(|word| lower.strip_prefix(word))
        .map(str::trim);
    matches!(rest, Some(rest) if !rest.is_empty() && rest.chars().all(|c| c.is_ascii_digit())) || lower == "specials"
}

/// The series, season and episode a video file belongs to, when its name marks one.
pub fn parse(path: &Path) -> Option<EpisodeName> {
    let stem = path.file_stem()?.to_string_lossy();
    let text = if stem.contains(' ') { stem.to_string() } else { stem.replace(['.', '_'], " ") };
    let chars: Vec<char> = text.chars().collect();
    let (season, episode, start, end) = marker(&chars)?;
    let before = clean(&chars[..start].iter().collect::<String>());
    let after = clean(&chars[end..].iter().collect::<String>());
    let series = if before.is_empty() {
        let parent = path.parent()?;
        let folder = parent.file_name()?.to_string_lossy().to_string();
        if is_season_folder(&folder) {
            parent.parent()?.file_name()?.to_string_lossy().to_string()
        } else {
            folder
        }
    } else {
        before
    };
    let series = clean(&series);
    if series.is_empty() {
        return None;
    }
    Some(EpisodeName { series, season, episode: episode as f64, title: after.chars().any(char::is_alphabetic).then_some(after) })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parsed(path: &str) -> Option<(String, i64, f64, Option<String>)> {
        parse(Path::new(path)).map(|e| (e.series, e.season, e.episode, e.title))
    }

    #[test]
    fn episode_names() {
        assert_eq!(parsed(r"C:\TV\Harbor Watch S01E02 - The Fog.mkv"), Some(("Harbor Watch".into(), 1, 2.0, Some("The Fog".into()))));
        assert_eq!(parsed(r"C:\TV\harbor.watch.s02e10.mkv"), Some(("harbor watch".into(), 2, 10.0, None)));
        assert_eq!(parsed(r"C:\TV\Harbor Watch 1x03 Lights.mp4"), Some(("Harbor Watch".into(), 1, 3.0, Some("Lights".into()))));
        assert_eq!(parsed(r"C:\TV\Show S01 E04.mkv").map(|e| e.2), Some(4.0));
    }

    #[test]
    fn series_from_folders() {
        assert_eq!(parsed(r"C:\TV\Harbor Watch\Season 1\S01E05.mkv").map(|e| e.0), Some("Harbor Watch".into()));
        assert_eq!(parsed(r"C:\TV\Harbor Watch\S01E06 Storm.mkv").map(|e| e.0), Some("Harbor Watch".into()));
    }

    #[test]
    fn films_are_not_episodes() {
        assert_eq!(parsed(r"C:\Movies\Blade Runner 2049 (2017).mkv"), None);
        assert_eq!(parsed(r"C:\Movies\1917.mkv"), None);
        assert_eq!(parsed(r"C:\Movies\Mission 2x4.mkv"), None);
        assert_eq!(parsed(r"C:\Movies\Sample 1080p.mkv"), None);
        assert!(is_season_folder("Season 02") && is_season_folder("S1") && !is_season_folder("Specs"));
    }
}

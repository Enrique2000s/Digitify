//! Recognizing a pasted link (D-028): which service it belongs to, whether it's one item or a
//! collection, and its id there. Nothing is fetched here.

use url::Url;

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Provider {
    /// YouTube and YouTube Music (they share video and playlist ids).
    YouTube,
    Spotify,
    SoundCloud,
    /// A direct link to an audio or video file.
    Web,
    /// Another site yt-dlp knows (Vimeo, Twitch, Bandcamp…), D-133.
    Site,
}

impl Provider {
    pub fn key(self) -> &'static str {
        match self {
            Provider::YouTube => "youtube",
            Provider::Spotify => "spotify",
            Provider::SoundCloud => "soundcloud",
            Provider::Web => "web",
            Provider::Site => "site",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LinkKind {
    Video,
    Track,
    Playlist,
    Album,
    File,
}

impl LinkKind {
    pub fn key(self) -> &'static str {
        match self {
            LinkKind::Video => "video",
            LinkKind::Track => "track",
            LinkKind::Playlist => "playlist",
            LinkKind::Album => "album",
            LinkKind::File => "file",
        }
    }

    pub fn is_collection(self) -> bool {
        matches!(self, LinkKind::Playlist | LinkKind::Album)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Link {
    pub provider: Provider,
    /// "YouTube", "YouTube Music", "Spotify", "SoundCloud" or "Web".
    pub service: &'static str,
    pub kind: LinkKind,
    pub id: String,
    /// The link in a canonical form, without tracking parameters.
    pub url: String,
}

const AUDIO: &[&str] = &["mp3", "flac", "m4a", "aac", "ogg", "oga", "opus", "wav", "wma", "aiff", "aif"];
const VIDEO: &[&str] = &["mp4", "m4v", "mkv", "mov", "webm", "avi", "wmv", "mpg", "mpeg", "ogv"];

/// Whether a file extension is audio (`Some(true)`), video (`Some(false)`) or neither.
pub fn media_of_extension(extension: &str) -> Option<bool> {
    let extension = extension.to_ascii_lowercase();
    if AUDIO.contains(&extension.as_str()) {
        Some(true)
    } else if VIDEO.contains(&extension.as_str()) {
        Some(false)
    } else {
        None
    }
}

fn unsupported() -> AppError {
    AppError::msg("That isn't a link Digitify can import. It takes links to videos, songs and playlists (YouTube, YouTube Music, Spotify, SoundCloud and the other sites yt-dlp knows), and direct links to audio or video files.")
}

fn valid_id(id: &str, max: usize) -> bool {
    !id.is_empty() && id.len() <= max && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

pub fn detect(raw: &str) -> AppResult<Link> {
    let text = raw.trim();
    if let Some(rest) = text.strip_prefix("spotify:") {
        let mut parts = rest.split(':');
        return match (parts.next(), parts.next()) {
            (Some(kind), Some(id)) => spotify(kind, id),
            _ => Err(unsupported()),
        };
    }
    let with_scheme = if text.contains("://") { text.to_string() } else { format!("https://{text}") };
    let url = Url::parse(&with_scheme).map_err(|_| unsupported())?;
    if url.scheme() != "https" && url.scheme() != "http" {
        return Err(unsupported());
    }
    let host = url.host_str().unwrap_or_default().trim_start_matches("www.").trim_start_matches("m.").to_ascii_lowercase();
    let segments: Vec<&str> = url.path_segments().map(|s| s.filter(|p| !p.is_empty()).collect()).unwrap_or_default();
    let query = |name: &str| url.query_pairs().find(|(k, _)| k == name).map(|(_, v)| v.into_owned());

    match host.as_str() {
        "youtube.com" | "music.youtube.com" | "youtu.be" | "youtube-nocookie.com" => {
            let service = if host == "music.youtube.com" { "YouTube Music" } else { "YouTube" };
            let base = if host == "music.youtube.com" { "https://music.youtube.com" } else { "https://www.youtube.com" };
            let video = match (host.as_str(), segments.as_slice()) {
                ("youtu.be", [id, ..]) => Some(id.to_string()),
                (_, ["watch"]) => query("v"),
                (_, ["shorts" | "embed" | "live" | "v", id, ..]) => Some(id.to_string()),
                _ => None,
            };
            if let Some(id) = video.filter(|id| valid_id(id, 11) && id.len() == 11) {
                return Ok(Link { provider: Provider::YouTube, service, kind: LinkKind::Video, url: format!("{base}/watch?v={id}"), id });
            }
            if let Some(list) = query("list").filter(|l| valid_id(l, 64)) {
                return Ok(Link { provider: Provider::YouTube, service, kind: LinkKind::Playlist, url: format!("{base}/playlist?list={list}"), id: list });
            }
            // A channel (D-133): its videos, listed through yt-dlp; or the tab the link names.
            let handle = |s: &str| s.len() > 1 && s.len() <= 100 && s[1..].chars().all(|c| c.is_alphanumeric() || matches!(c, '_' | '-' | '.' | '·'));
            let (channel, tab) = match segments.as_slice() {
                [name, rest @ ..] if name.starts_with('@') && handle(name) => (Some(name.to_string()), rest.first().copied()),
                [kind @ ("channel" | "c" | "user"), name, rest @ ..] if valid_id(name, 100) => (Some(format!("{kind}/{name}")), rest.first().copied()),
                _ => (None, None),
            };
            if let Some(channel) = channel {
                let tab = tab.filter(|t| ["videos", "shorts", "streams", "podcasts"].contains(t)).unwrap_or("videos");
                return Ok(Link { provider: Provider::YouTube, service, kind: LinkKind::Playlist, url: format!("https://www.youtube.com/{channel}/{tab}"), id: format!("{channel}/{tab}") });
            }
            Err(unsupported())
        }
        "open.spotify.com" | "play.spotify.com" => {
            // "/intl-es/track/…" carries a language first.
            let rest: Vec<&str> = segments.iter().copied().skip_while(|s| s.starts_with("intl-")).collect();
            match rest.as_slice() {
                [kind, id, ..] => spotify(kind, id),
                _ => Err(unsupported()),
            }
        }
        "soundcloud.com" | "on.soundcloud.com" => {
            if host == "on.soundcloud.com" {
                // A short link: resolved through the API later.
                return match segments.as_slice() {
                    [code] if valid_id(code, 40) => Ok(Link { provider: Provider::SoundCloud, service: "SoundCloud", kind: LinkKind::Track, id: format!("on/{code}"), url: format!("https://on.soundcloud.com/{code}") }),
                    _ => Err(unsupported()),
                };
            }
            let clean = |s: &&str| valid_id(s, 120);
            match segments.as_slice() {
                [user, "sets", set, ..] if clean(user) && clean(set) => {
                    Ok(Link { provider: Provider::SoundCloud, service: "SoundCloud", kind: LinkKind::Playlist, id: format!("{user}/sets/{set}"), url: format!("https://soundcloud.com/{user}/sets/{set}") })
                }
                [user, track] if clean(user) && clean(track) && !["sets", "likes", "tracks", "albums", "reposts", "followers", "following"].contains(track) => {
                    Ok(Link { provider: Provider::SoundCloud, service: "SoundCloud", kind: LinkKind::Track, id: format!("{user}/{track}"), url: format!("https://soundcloud.com/{user}/{track}") })
                }
                _ => Err(AppError::msg("That SoundCloud link isn't a track or a set. Open the track or set itself and copy its link.")),
            }
        }
        _ => {
            // A direct link to a media file, recognized by its extension.
            let name = segments.last().copied().unwrap_or_default();
            let extension = name.rsplit_once('.').map(|(_, e)| e).unwrap_or_default();
            let mut clean = url.clone();
            clean.set_fragment(None);
            if media_of_extension(extension).is_some() && url.host_str().is_some() {
                return Ok(Link { provider: Provider::Web, service: "Web", kind: LinkKind::File, id: clean.to_string(), url: clean.to_string() });
            }
            // Any other page: yt-dlp is asked whether it knows the site (D-133).
            if host.contains('.') {
                return Ok(Link { provider: Provider::Site, service: "Web", kind: LinkKind::Video, id: clean.to_string(), url: clean.to_string() });
            }
            Err(unsupported())
        }
    }
}

fn spotify(kind: &str, id: &str) -> AppResult<Link> {
    let id = id.split('?').next().unwrap_or_default();
    if !valid_id(id, 40) {
        return Err(unsupported());
    }
    let kind = match kind {
        "track" => LinkKind::Track,
        "playlist" => LinkKind::Playlist,
        "album" => LinkKind::Album,
        _ => return Err(AppError::msg("Digitify imports Spotify tracks, albums and playlists; podcasts and artists aren't supported.")),
    };
    Ok(Link { provider: Provider::Spotify, service: "Spotify", kind, url: format!("https://open.spotify.com/{}/{id}", kind.key()), id: id.to_string() })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(url: &str) -> (Provider, &'static str, LinkKind, String) {
        let link = detect(url).unwrap();
        (link.provider, link.service, link.kind, link.id)
    }

    #[test]
    fn links_are_recognized() {
        use LinkKind::*;
        use Provider::*;
        assert_eq!(d("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s&si=abc"), (YouTube, "YouTube", Video, "dQw4w9WgXcQ".into()));
        assert_eq!(d("youtu.be/dQw4w9WgXcQ?si=x"), (YouTube, "YouTube", Video, "dQw4w9WgXcQ".into()));
        assert_eq!(d("https://youtube.com/shorts/dQw4w9WgXcQ"), (YouTube, "YouTube", Video, "dQw4w9WgXcQ".into()));
        assert_eq!(d("https://www.youtube.com/playlist?list=PLabc_DEF-123"), (YouTube, "YouTube", Playlist, "PLabc_DEF-123".into()));
        assert_eq!(d("https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=RDAMVM"), (YouTube, "YouTube Music", Video, "dQw4w9WgXcQ".into()));
        assert_eq!(d("https://music.youtube.com/playlist?list=OLAK5uy_abc"), (YouTube, "YouTube Music", Playlist, "OLAK5uy_abc".into()));
        assert_eq!(d("https://open.spotify.com/intl-es/track/4uLU6hMCjMI75M1A2tKUQC?si=1"), (Spotify, "Spotify", Track, "4uLU6hMCjMI75M1A2tKUQC".into()));
        assert_eq!(d("spotify:playlist:37i9dQZF1DXcBWIGoYBM5M"), (Spotify, "Spotify", Playlist, "37i9dQZF1DXcBWIGoYBM5M".into()));
        assert_eq!(d("https://soundcloud.com/artist-name/a-track?in=x"), (SoundCloud, "SoundCloud", Track, "artist-name/a-track".into()));
        assert_eq!(d("https://soundcloud.com/artist-name/sets/my-set"), (SoundCloud, "SoundCloud", Playlist, "artist-name/sets/my-set".into()));
        assert_eq!(d("https://example.com/media/Song%20One.mp3#t=3").2, File);
        assert_eq!(d("https://www.youtube.com/@SomeChannel"), (YouTube, "YouTube", Playlist, "@SomeChannel/videos".into()));
        assert_eq!(d("https://www.youtube.com/@SomeChannel/shorts").3, "@SomeChannel/shorts");
        assert_eq!(detect("https://youtube.com/channel/UCabc_DEF-123/featured").unwrap().url, "https://www.youtube.com/channel/UCabc_DEF-123/videos");
        assert_eq!(d("https://vimeo.com/76979871#t=1").0, Site);
        assert_eq!(d("https://example.com/page.html").0, Site);
    }

    #[test]
    fn other_links_are_refused() {
        for bad in ["", "hello", "ftp://example.com/a.mp3", "file:///C:/a.mp3", "https://localhost/page", "https://www.youtube.com/feed/history", "https://open.spotify.com/artist/abc", "https://soundcloud.com/artist-name"] {
            assert!(detect(bad).is_err(), "{bad}");
        }
    }
}

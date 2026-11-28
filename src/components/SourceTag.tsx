import { BookOpen, BookOpenText, Clapperboard, Image, ImagePlay, Music, PanelsTopLeft, Tv, Video } from "lucide-react";

/** The service an item was added from by link (D-029): its key for the colored border, and a tag. */
export function sourceKey(service: string | null | undefined): "youtube" | "youtube-music" | "spotify" | "soundcloud" | undefined {
  switch (service) {
    case "YouTube":
      return "youtube";
    case "YouTube Music":
      return "youtube-music";
    case "Spotify":
      return "spotify";
    case "SoundCloud":
      return "soundcloud";
    default:
      return undefined;
  }
}

/** Props for a cover's box: its source, so it gets the service's colored border. */
export const sourceProps = (service: string | null | undefined) => {
  const key = sourceKey(service);
  return key ? { "data-source": key } : {};
};

/**
 * A file's kind on its cover, top left: a picture's (D-178: GIF, JPG, PNG, WEBP…) and a video's in
 * Videos (D-179: MP4, MKV, WEBM, MOV…), from its file.
 */
export function FormatTag({ item }: { item: { handler?: string; category?: string | null; formats?: string[]; versions?: { format: string | null }[]; collection?: unknown } }) {
  const format = (item.formats?.[0] ?? item.versions?.find((v) => v.format)?.format ?? "").toLowerCase();
  // Music: a note and its format (MP3, FLAC…), as videos have theirs (D-183, D-184).
  if (item.handler === "audio" && !item.collection) {
    return (
      <span className="film-tag format-tag music-tag" data-kind="music" title="Music" aria-label={format ? `Music, ${format.toUpperCase()}` : "Music"}>
        <Music size={12} strokeWidth={2.8} aria-hidden />
        {format && format.toUpperCase()}
      </span>
    );
  }
  const picture = item.handler === "image";
  if ((!picture && item.category !== "videos") || item.collection) return null;
  if (!format) return null;
  const label = format === "jpeg" ? "JPG" : format === "tiff" ? "TIF" : format.toUpperCase();
  // One symbol per kind whatever the format, only the letters changing (D-184): a video's, a
  // picture's, and a GIF's own (it moves).
  const Icon = format === "gif" ? ImagePlay : picture ? Image : Video;
  return (
    <span className="film-tag format-tag" data-kind={format === "gif" ? "gif" : picture ? "picture" : "video"}>
      <Icon size={12} strokeWidth={2.6} aria-hidden />
      {label}
    </span>
  );
}

/** Movie or Series on a cover in Movies & Series (D-174); Book, Comic or Manga in Books (D-183). */
export function FilmTag({ item }: { item: { category?: string | null; kind?: string | null; collection?: unknown; metadata?: Record<string, unknown> | null } }) {
  if (item.category === "books" && !item.collection) {
    const kind = (item.kind ?? (item.metadata?.kind as string | undefined) ?? "book") as string;
    const label = kind === "comic" ? "Comic" : kind === "manga" ? "Manga" : "Book";
    // Each with its symbol (D-184), the same as in Books' filter row.
    const Icon = kind === "comic" ? PanelsTopLeft : kind === "manga" ? BookOpenText : BookOpen;
    return (
      <span className="film-tag" data-kind={kind === "comic" || kind === "manga" ? kind : "book"}>
        <Icon size={12} strokeWidth={2.6} aria-hidden />
        {label}
      </span>
    );
  }
  if (item.category !== "video" || item.collection) return null;
  const series = item.kind === "series";
  return (
    <span className="film-tag" data-kind={series ? "series" : "movie"}>
      {series ? <Tv size={12} strokeWidth={2.6} aria-hidden /> : <Clapperboard size={12} strokeWidth={2.6} aria-hidden />}
      {series ? "Series" : "Movie"}
    </span>
  );
}

/** The service's name on a cover, in its color. */
export function SourceTag({ service }: { service: string | null | undefined }) {
  const key = sourceKey(service);
  if (!key) return null;
  return (
    <span className="source-tag" data-source={key}>
      {service}
    </span>
  );
}

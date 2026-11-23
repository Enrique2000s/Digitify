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
  const picture = item.handler === "image";
  if ((!picture && item.category !== "videos") || item.collection) return null;
  const format = (item.formats?.[0] ?? item.versions?.find((v) => v.format)?.format ?? "").toLowerCase();
  if (!format) return null;
  const label = format === "jpeg" ? "JPG" : format === "tiff" ? "TIF" : format.toUpperCase();
  return (
    <span className="film-tag format-tag" data-kind={format === "gif" ? "gif" : picture ? "picture" : "video"}>
      {label}
    </span>
  );
}

/** Movie or Series on a cover in Movies & Series (D-174). */
export function FilmTag({ item }: { item: { category?: string | null; kind?: string | null; collection?: unknown } }) {
  if (item.category !== "video" || item.collection) return null;
  const series = item.kind === "series";
  return (
    <span className="film-tag" data-kind={series ? "series" : "movie"}>
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

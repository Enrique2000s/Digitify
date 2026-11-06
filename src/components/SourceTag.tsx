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

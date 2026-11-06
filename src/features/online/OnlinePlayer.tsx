import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { ArrowLeft, Cloud, ExternalLink } from "lucide-react";
import { api, errorText, type ItemDetail, type OnlineSource } from "../../lib/api";
import { useItem } from "../../lib/queries";
import { useAmbientHold } from "../../lib/ambient/AmbientProvider";
import { useMusic } from "../../lib/music/MusicProvider";

/** The service's own embedded player for an online item, or none when it has no embed. */
export function embedUrl(source: OnlineSource, origin: string): string | null {
  const id = encodeURIComponent(source.externalId);
  switch (source.provider) {
    case "youtube":
      // youtube-nocookie and an explicit origin: YouTube refuses embeds that don't say where they are.
      return source.kind === "playlist"
        ? `https://www.youtube-nocookie.com/embed/videoseries?list=${id}&autoplay=1&rel=0&enablejsapi=1&origin=${encodeURIComponent(origin)}`
        : `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&enablejsapi=1&origin=${encodeURIComponent(origin)}`;
    case "spotify":
      return `https://open.spotify.com/embed/${source.kind}/${id}`;
    case "soundcloud":
      return `https://w.soundcloud.com/player/?url=${encodeURIComponent(source.url)}&auto_play=true&visual=true`;
    default:
      return null;
  }
}

function Player({ item, source }: { item: ItemDetail; source: OnlineSource }) {
  const [error, setError] = useState<string | null>(null);
  const embed = embedUrl(source, window.location.origin);
  const tall = source.provider === "spotify" ? (source.kind === "track" ? 352 : 480) : undefined;
  const open = () => void api.onlineOpen(item.id).catch((reason) => setError(errorText(reason)));
  return (
    <>
      <div className={`online-stage${item.handler === "audio" && source.provider !== "youtube" ? " audio" : ""}`} style={tall ? { height: tall } : undefined}>
        {embed ? (
          <iframe
            key={embed}
            src={embed}
            title={`${item.title} on ${source.service}`}
            allow="autoplay; encrypted-media; fullscreen; picture-in-picture; clipboard-write"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        ) : item.handler === "audio" ? (
          <audio src={source.url} controls autoPlay />
        ) : (
          <video src={source.url} controls autoPlay />
        )}
      </div>
      <div className="online-actions">
        <p className="hint">
          <Cloud size={14} aria-hidden /> Plays in {source.service}'s own player and needs an internet connection; it isn't available offline. If it won't play here, open it on {source.service}.
        </p>
        <button type="button" className="btn" onClick={open}>
          <ExternalLink size={16} /> Open on {source.service}
        </button>
      </div>
      {error && <div className="dialog-error">{error}</div>}
    </>
  );
}

/** An online item (D-028) played in its service's player, inside Digitify's window. */
export function OnlinePlayerPage() {
  const { id } = useParams({ from: "/online/$id" });
  const navigate = useNavigate();
  const item = useItem(Number(id));
  // Like any media: ambient music waits, library music pauses.
  useAmbientHold("media", true);
  const music = useMusic();
  useEffect(() => {
    if (music.active && !music.paused) music.pause();
  }, []);
  const data = item.data;
  const source = data?.online;
  useEffect(() => {
    // Downloaded items play from the library like any file.
    if (data && (!source || source.downloaded)) void navigate({ to: "/item/$id", params: { id }, replace: true });
  }, [data, source, navigate, id]);
  return (
    <div className="page online-page">
      <div className="online-head">
        <Link to="/item/$id" params={{ id }} className="round-btn" aria-label="Back to the item">
          <ArrowLeft size={18} strokeWidth={2.6} />
        </Link>
        <div>
          <h1 className="display">{data?.title ?? " "}</h1>
          {source && (
            <span className="chip online-chip">
              <Cloud size={12} /> {source.service} · Online
            </span>
          )}
        </div>
      </div>
      {data && source && !source.downloaded && <Player item={data} source={source} />}
    </div>
  );
}

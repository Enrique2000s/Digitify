import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { Cloud, ExternalLink } from "lucide-react";
import { api, errorText, onLinux, type ItemDetail, type OnlineSource } from "../../lib/api";
import { useItem } from "../../lib/queries";
import { BackButton } from "../../components/BackButton";
import { useAmbientHold } from "../../lib/ambient/AmbientProvider";
import { useMusic } from "../../lib/music/MusicProvider";

/**
 * Where YouTube's player is hosted from: on Linux a local http page (D-032), since the interface's
 * `tauri://` page sends no Referer and YouTube refuses to play without one; null on Windows (the
 * player goes straight into the page); undefined while it is being asked.
 */
export function useEmbedHost(): string | null | undefined {
  const host = useQuery({ queryKey: ["online-embed-host"], queryFn: api.onlineEmbedHost, staleTime: Infinity, enabled: onLinux });
  if (!onLinux) return null;
  return host.isPending ? undefined : (host.data ?? null);
}

/** The service's own embedded player for an online item, or none when it has no embed. */
export function embedUrl(source: OnlineSource, origin: string, host: string | null = null): string | null {
  const id = encodeURIComponent(source.externalId);
  switch (source.provider) {
    case "youtube": {
      // youtube-nocookie and an explicit origin: YouTube refuses embeds that don't say where they are.
      const from = encodeURIComponent(host ?? origin);
      const player =
        source.kind === "playlist"
          ? `https://www.youtube-nocookie.com/embed/videoseries?list=${id}&autoplay=1&rel=0&enablejsapi=1&origin=${from}`
          : `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&enablejsapi=1&origin=${from}`;
      return host ? `${host}/youtube?src=${encodeURIComponent(player)}` : player;
    }
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
  const host = useEmbedHost();
  const embed = host === undefined ? null : embedUrl(source, window.location.origin, host);
  const tall = source.provider === "spotify" ? (source.kind === "track" ? 352 : 480) : undefined;
  const open = () => void api.onlineOpen(item.id).catch((reason) => setError(errorText(reason)));
  return (
    <>
      <div className={`online-stage${item.handler === "audio" && source.provider !== "youtube" ? " audio" : ""}`} style={tall ? { height: tall } : undefined}>
        {host === undefined ? null : embed ? (
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
        {/* The same Back as every page (D-143): to where it was opened from, so the item's page
            doesn't send you back here. */}
        <BackButton fallback={() => void navigate({ to: "/item/$id", params: { id } })} />
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

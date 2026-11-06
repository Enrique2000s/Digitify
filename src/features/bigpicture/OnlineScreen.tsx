import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Cloud, ExternalLink, Pause, Play, RotateCcw, RotateCw } from "lucide-react";
import { api, errorText } from "../../lib/api";
import { useAmbientHold } from "../../lib/ambient/AmbientProvider";
import { useMusic } from "../../lib/music/MusicProvider";
import { usePad } from "../../lib/gamepad";
import { SourceTag } from "../../components/SourceTag";
import { embedUrl } from "../online/OnlinePlayer";
import { useEmbedControl } from "../online/embedControl";

function clock(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds)) return "";
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${rest}` : `${m}:${rest}`;
}

/**
 * An online item (D-028) in Big Picture: the service's official player inside Big Picture's own
 * screen, with big buttons a controller reaches (X plays or pauses, LB/RB go back or ahead 10 s),
 * instead of the regular app's page.
 */
export function OnlineScreen({ id }: { id: number }) {
  const item = useQuery({ queryKey: ["item", id], queryFn: () => api.item(id) });
  const frame = useRef<HTMLIFrameElement>(null);
  const [error, setError] = useState<string | null>(null);
  useAmbientHold("media", true);
  const music = useMusic();
  useEffect(() => {
    if (music.active && !music.paused) music.pause();
  }, []);
  const source = item.data?.online ?? null;
  const control = useEmbedControl(frame, source?.provider ?? "");
  const canSeek = source?.provider === "youtube" || source?.provider === "soundcloud" || source?.provider === "spotify";
  usePad((action) => {
    if (!source) return;
    if (action === "x") control.toggle();
    else if (action === "lb") control.seek(-10);
    else if (action === "rb") control.seek(10);
    else return;
    return true;
  });
  const data = item.data;
  if (!data) return null;
  if (!source || source.downloaded) return <p className="bp-empty">This item plays from your library.</p>;
  const embed = embedUrl(source, window.location.origin);
  const audio = data.handler === "audio" && source.provider !== "youtube";
  const open = () => void api.onlineOpen(id).catch((reason) => setError(errorText(reason)));
  const { playing, time, duration } = control.state;
  return (
    <div className="bp-online">
      <div className="bp-online-head">
        <h1>{data.title}</h1>
        <span className="bp-online-source" data-source={source.provider === "youtube" ? (source.service === "YouTube Music" ? "youtube-music" : "youtube") : source.provider}>
          <SourceTag service={source.service} />
          <span>
            <Cloud size={20} /> Online, needs a connection
          </span>
        </span>
      </div>
      <div className={`bp-online-stage${audio ? " audio" : ""}`} data-source={source.provider === "youtube" ? (source.service === "YouTube Music" ? "youtube-music" : "youtube") : source.provider}>
        {embed ? (
          <iframe
            ref={frame}
            src={embed}
            title={`${data.title} on ${source.service}`}
            allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            onLoad={control.onLoad}
          />
        ) : data.handler === "audio" ? (
          <audio src={source.url} controls autoPlay />
        ) : (
          <video src={source.url} controls autoPlay />
        )}
      </div>
      {embed && (
        <div className="bp-actions bp-online-controls">
          {canSeek && (
            <button type="button" className="bp-button" data-bp-focus onClick={() => control.seek(-10)}>
              <RotateCcw size={26} /> 10 s
            </button>
          )}
          <button type="button" className="bp-button primary" data-bp-focus data-bp-autofocus onClick={control.toggle}>
            {playing ? <Pause size={26} /> : <Play size={26} />} {playing ? "Pause" : "Play"}
          </button>
          {canSeek && (
            <button type="button" className="bp-button" data-bp-focus onClick={() => control.seek(10)}>
              10 s <RotateCw size={26} />
            </button>
          )}
          {time != null && (
            <span className="bp-online-time">
              {clock(time)}
              {duration ? ` / ${clock(duration)}` : ""}
            </span>
          )}
          <button type="button" className="bp-button" data-bp-focus onClick={open}>
            <ExternalLink size={24} /> Open on {source.service}
          </button>
        </div>
      )}
      {error && <p className="bp-empty">{error}</p>}
    </div>
  );
}

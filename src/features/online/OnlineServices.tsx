import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, LoaderCircle, RefreshCw } from "lucide-react";
import { api, errorText, type OnlineKeysStatus } from "../../lib/api";

type Service = keyof OnlineKeysStatus;

const SERVICES: { key: Service; name: string; fields: [string, string?]; what: string; where: string }[] = [
  {
    key: "youtube",
    name: "YouTube",
    fields: ["API key"],
    what: "Lists a playlist's videos through YouTube's own API, with lengths and availability. Without it, yt-dlp lists them.",
    where: "Google Cloud Console › APIs & Services: enable “YouTube Data API v3” and create an API key.",
  },
  {
    key: "spotify",
    name: "Spotify",
    fields: ["Client ID", "Client secret"],
    what: "Lists an album's songs, with lengths and artists. Spotify lists a playlist's songs only to its owner, so other playlists stay one link.",
    where: "developer.spotify.com › Dashboard › Create app (Spotify requires the app's owner to have Premium).",
  },
  {
    key: "soundcloud",
    name: "SoundCloud",
    fields: ["Client ID", "Client secret"],
    what: "Lists a set's tracks through SoundCloud's own API, and downloads the original files of the tracks their uploaders made downloadable. Without keys, yt-dlp lists and downloads them.",
    where: "soundcloud.com › Settings › Your apps (or the SoundCloud API CLI).",
  },
];

function ServiceKeys({ service, saved, onSaved }: { service: (typeof SERVICES)[number]; saved: boolean; onSaved: (status: OnlineKeysStatus) => void }) {
  const [first, setFirst] = useState("");
  const [second, setSecond] = useState("");
  const [error, setError] = useState<string | null>(null);
  const two = service.fields.length === 2;
  const save = async (remove: boolean) => {
    setError(null);
    try {
      onSaved(await api.onlineKeysSet(service.key, remove ? null : first, remove ? null : two ? second : null));
      setFirst("");
      setSecond("");
    } catch (reason) {
      setError(errorText(reason));
    }
  };
  return (
    <div className="setting online-service">
      <div className="setting-text">
        <strong>{service.name}</strong>
        <p>{service.what}</p>
        <p>Where: {service.where}</p>
        {error && <div className="dialog-error">{error}</div>}
      </div>
      <div className="online-key-fields">
        {saved ? (
          <>
            <span className="chip accent">
              <KeyRound size={12} /> Saved, encrypted
            </span>
            <button type="button" className="btn btn-sm" onClick={() => void save(true)}>
              Remove
            </button>
          </>
        ) : (
          <>
            <input className="input" type="password" autoComplete="off" placeholder={service.fields[0]} aria-label={`${service.name} ${service.fields[0]}`} value={first} onChange={(event) => setFirst(event.target.value)} />
            {two && (
              <input className="input" type="password" autoComplete="off" placeholder={service.fields[1]} aria-label={`${service.name} ${service.fields[1]}`} value={second} onChange={(event) => setSecond(event.target.value)} />
            )}
            <button type="button" className="btn btn-sm" disabled={!first.trim() || (two && !second.trim())} onClick={() => void save(false)}>
              Save
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** yt-dlp, which downloads from YouTube and other sites (D-133): its version, and updating it. */
function YtDlpRow() {
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: ["ytdlp"], queryFn: api.ytdlpStatus });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const update = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    const before = status.data?.version;
    try {
      const next = await api.ytdlpUpdate();
      queryClient.setQueryData(["ytdlp"], next);
      setMessage(next.version === before ? "It's the newest already." : `Updated to ${next.version}.`);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };
  const data = status.data;
  return (
    <div className="setting online-service">
      <div className="setting-text">
        <strong>Downloads (yt-dlp)</strong>
        <p>
          Downloads videos and songs from YouTube, YouTube Music, SoundCloud and the many other sites yt-dlp knows, as video or as sound, in the quality you pick in Import from URL. It never signs in,
          and nothing protected with DRM (Spotify, streaming services' films) is downloaded.
        </p>
        <p>
          {data?.available
            ? `yt-dlp ${data.version ?? ""}${data.updated ? " (updated here)" : " (shipped with Digitify)"}${data.deno ? ", with Deno" : ", without Deno (some YouTube formats may be missing)"}${data.ffmpeg ? "" : ", without FFmpeg"}.`
            : "yt-dlp is missing from this installation."}{" "}
          Sites change often: if downloads start failing, update it. Digitify never checks by itself.
        </p>
        {message && <p className="muted">{message}</p>}
        {error && <div className="dialog-error">{error}</div>}
      </div>
      <div className="online-key-fields">
        <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void update()}>
          {busy ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />} Update yt-dlp
        </button>
      </div>
    </div>
  );
}

/** Settings › Online services (D-028, D-133): yt-dlp, and optional keys for Import from URL. */
export function OnlineServicesPanel() {
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: ["online-keys"], queryFn: api.onlineKeysStatus });
  return (
    <section className="panel" id="online-services">
      <h2>Online services</h2>
      <p className="hint">
        For Import from URL. The keys are optional, from your own developer accounts; they're stored encrypted for your account and used only when you look up a link. Spotify's songs are
        always saved as online items: they're protected with DRM.
      </p>
      <YtDlpRow />
      {SERVICES.map((service) => (
        <ServiceKeys key={service.key} service={service} saved={!!status.data?.[service.key]} onSaved={(next) => queryClient.setQueryData(["online-keys"], next)} />
      ))}
    </section>
  );
}

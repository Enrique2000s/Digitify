import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";
import { api, errorText, type OnlineKeysStatus } from "../../lib/api";

type Service = keyof OnlineKeysStatus;

const SERVICES: { key: Service; name: string; fields: [string, string?]; what: string; where: string }[] = [
  {
    key: "youtube",
    name: "YouTube",
    fields: ["API key"],
    what: "Lists each video of a playlist, with lengths and availability. Without it, YouTube and YouTube Music links are saved one by one.",
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
    what: "Lists each track of a set, and downloads the tracks their uploaders made downloadable.",
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

/** Settings › Online services (D-028): optional keys for Import from URL. */
export function OnlineServicesPanel() {
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: ["online-keys"], queryFn: api.onlineKeysStatus });
  return (
    <section className="panel" id="online-services">
      <h2>Online services</h2>
      <p className="hint">
        Optional keys for Import from URL, from your own developer accounts. They're stored encrypted for your Windows account and used only when you look up a link.
        Without them, links still work one at a time. Digitify never downloads from YouTube or Spotify; SoundCloud tracks are downloaded only when their uploader allows it.
      </p>
      {SERVICES.map((service) => (
        <ServiceKeys key={service.key} service={service} saved={!!status.data?.[service.key]} onSaved={(next) => queryClient.setQueryData(["online-keys"], next)} />
      ))}
    </section>
  );
}

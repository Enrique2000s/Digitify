import { useState } from "react";
import { Download } from "lucide-react";
import { api, errorText, type DownloadQuality } from "../../lib/api";
import { usePreferences } from "../../lib/preferences";
import { Dialog, Field } from "../../components/common";

const VIDEO_QUALITIES: [DownloadQuality["video"], string][] = [
  ["best", "Best"],
  ["2160", "4K"],
  ["1440", "1440p"],
  ["1080", "1080p"],
  ["720", "720p"],
  ["480", "480p"],
];

const AUDIO_FORMATS: [DownloadQuality["audio"], string, string][] = [
  ["mp3", "MP3", "Plays everywhere (about 245 kbps)"],
  ["m4a", "M4A", "AAC, kept as the site sends it when it can"],
  ["original", "Original", "The site's own sound, untouched (usually Opus)"],
];

/** The download choices (D-133), remembered for next time. */
export function useDownloadQuality(): [DownloadQuality, (change: Partial<DownloadQuality>) => void] {
  const { preferences, update } = usePreferences();
  return [preferences.downloads, (change) => update((current) => ({ downloads: { ...current.downloads, ...change } }))];
}

/** Picture quality and format for videos, the format for sound: what yt-dlp downloads (D-133). */
export function DownloadOptions({ video, audio }: { video: boolean; audio: boolean }) {
  const [quality, setQuality] = useDownloadQuality();
  return (
    <>
      {video && (
        <>
          <Field label="Video quality" hint="The tallest picture up to this one; a smaller one when that's all there is.">
            <div className="segmented" role="group" aria-label="Video quality">
              {VIDEO_QUALITIES.map(([value, label]) => (
                <button key={value} type="button" aria-pressed={quality.video === value} onClick={() => setQuality({ video: value })}>
                  {label}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Video format" hint={quality.container === "mp4" ? "MP4 plays on more devices; it may top out lower than MKV." : "MKV keeps the best picture and sound there is."}>
            <div className="segmented" role="group" aria-label="Video format">
              {(["mkv", "mp4"] as const).map((value) => (
                <button key={value} type="button" aria-pressed={quality.container === value} onClick={() => setQuality({ container: value })}>
                  {value.toUpperCase()}
                </button>
              ))}
            </div>
          </Field>
        </>
      )}
      {audio && (
        <Field label="Sound format" hint={AUDIO_FORMATS.find(([value]) => value === quality.audio)?.[2]}>
          <div className="segmented" role="group" aria-label="Sound format">
            {AUDIO_FORMATS.map(([value, label]) => (
              <button key={value} type="button" aria-pressed={quality.audio === value} onClick={() => setQuality({ audio: value })}>
                {label}
              </button>
            ))}
          </div>
        </Field>
      )}
    </>
  );
}

/**
 * Downloads items saved as online items (D-133): each replaces its online item in the library,
 * keeping its favorite mark, tags and collection. Progress shows in the import queue.
 */
export function DownloadDialog({ ids, music, open, onOpenChange, onQueued }: { ids: number[]; music: boolean; open: boolean; onOpenChange: (open: boolean) => void; onQueued?: () => void }) {
  const [quality] = useDownloadQuality();
  const [soundOnly, setSoundOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.onlineDownloadItems(ids, quality, soundOnly ? true : null);
      onOpenChange(false);
      onQueued?.();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={ids.length > 1 ? `Download ${ids.length} items` : "Download"}
      description="A copy goes into your library folder and plays offline; it takes the online item's place, with its favorite mark, tags and collection."
      footer={
        <>
          <button type="button" className="btn" onClick={() => onOpenChange(false)}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={busy || ids.length === 0} onClick={() => void start()}>
            <Download size={15} /> Download
          </button>
        </>
      }
    >
      {!music && (
        <Field label="Download as">
          <div className="segmented" role="group" aria-label="Download as">
            <button type="button" aria-pressed={!soundOnly} onClick={() => setSoundOnly(false)}>
              {ids.length > 1 ? "As they are" : "Video"}
            </button>
            <button type="button" aria-pressed={soundOnly} onClick={() => setSoundOnly(true)}>
              Sound only, to Music
            </button>
          </div>
        </Field>
      )}
      <DownloadOptions video={!music && !soundOnly} audio={music || soundOnly || ids.length > 1} />
      {error && <div className="dialog-error">{error}</div>}
    </Dialog>
  );
}

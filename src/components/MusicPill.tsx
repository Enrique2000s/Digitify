import type { CSSProperties } from "react";
import { Pause, Play, SkipForward, Volume1, Volume2, VolumeX } from "lucide-react";
import { useAmbient } from "../lib/ambient/AmbientProvider";
import { Marquee } from "./Marquee";

/** The ambient music capsule in the title bar: play/pause, what's playing, mute and volume. */
export function MusicPill() {
  const ambient = useAmbient();
  const { music, updateMusic } = ambient;
  const silent = music.muted || music.volume === 0;
  const VolumeIcon = silent ? VolumeX : music.volume < 50 ? Volume1 : Volume2;
  return (
    <div className="music-pill" role="group" aria-label="Ambient music">
      <button
        type="button"
        className={`music-play${ambient.playing ? " on" : ""}`}
        aria-label={music.enabled ? "Pause ambient music" : "Play ambient music"}
        title={music.enabled ? "Pause ambient music" : "Play ambient music"}
        onClick={() => updateMusic({ enabled: !music.enabled })}
      >
        {music.enabled ? <Pause size={18} fill="currentColor" strokeWidth={0} /> : <Play size={18} fill="currentColor" strokeWidth={0} />}
      </button>
      <div className="music-text" aria-live="polite">
        <Marquee className="music-title" text={ambient.title} />
        <Marquee className="music-status" text={ambient.status} />
      </div>
      {ambient.canSkip && (
        <button type="button" className="icon-btn" aria-label="Next track" title="Next track" onClick={ambient.skip}>
          <SkipForward size={17} />
        </button>
      )}
      <button
        type="button"
        className="icon-btn"
        aria-label={music.muted ? "Unmute music" : "Mute music"}
        aria-pressed={music.muted}
        title={music.muted ? "Unmute music" : "Mute music"}
        onClick={() => updateMusic({ muted: !music.muted })}
      >
        <VolumeIcon size={18} />
      </button>
      <input
        type="range"
        className="music-volume"
        aria-label="Music volume"
        min={0}
        max={100}
        value={music.volume}
        style={{ "--fill": `${music.volume}%` } as CSSProperties}
        onChange={(event) => updateMusic({ volume: Number(event.target.value), muted: false })}
      />
      <span className="volume-value">{music.volume}%</span>
    </div>
  );
}

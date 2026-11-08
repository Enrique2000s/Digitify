import type { CSSProperties } from "react";
import { Music, SkipForward, Volume1, Volume2, VolumeX } from "lucide-react";
import { useAmbient } from "../lib/ambient/AmbientProvider";
import { Marquee } from "./Marquee";

/**
 * The music capsule in the title bar while no library music plays: the menu music, what's playing,
 * mute and volume. The menu music isn't played or paused here; it's switched on or off on Home or
 * in Settings, and with it off the capsule says nothing is playing.
 */
export function MusicPill() {
  const ambient = useAmbient();
  const { music, updateMusic } = ambient;
  // While a game runs (D-041), the mute button silences or brings back the music for the game.
  const silent = music.muted || music.volume === 0 || ambient.gameSilenced;
  const VolumeIcon = silent ? VolumeX : music.volume < 50 ? Volume1 : Volume2;
  if (!music.enabled) {
    return (
      <div className="music-pill idle" role="group" aria-label="Music">
        <span className="music-play" aria-hidden>
          <Music size={18} />
        </span>
        <div className="music-text" aria-live="polite">
          <span className="music-title">No music playing</span>
          <span className="music-status">Menu music is off</span>
        </div>
      </div>
    );
  }
  return (
    <div className="music-pill" role="group" aria-label="Menu music">
      <span className={`music-play${ambient.playing ? " on" : ""}`} aria-hidden>
        <Music size={18} />
      </span>
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
        aria-label={music.muted || ambient.gameSilenced ? "Unmute music" : "Mute music"}
        aria-pressed={music.muted || ambient.gameSilenced}
        title={ambient.gameSilenced ? "Silent while you play (click to bring the music back)" : music.muted ? "Unmute music" : "Mute music"}
        onClick={() => {
          if (ambient.inGame && (ambient.gameSilenced || !music.muted)) {
            ambient.setGameSilenced(!ambient.gameSilenced);
            if (ambient.gameSilenced && music.muted) updateMusic({ muted: false });
          } else updateMusic({ muted: !music.muted });
        }}
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

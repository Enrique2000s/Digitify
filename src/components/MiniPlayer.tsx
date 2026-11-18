import type { CSSProperties } from "react";
import { Link } from "@tanstack/react-router";
import { Pause, Play, SkipForward, Volume2, VolumeX } from "lucide-react";
import { useMusic } from "../lib/music/MusicProvider";
import { Cover } from "./common";
import { Marquee } from "./Marquee";

/** The title-bar capsule while library music plays (D-020): the track, pause and next; opens "Now playing". */
export function MiniPlayer() {
  const music = useMusic();
  const track = music.current;
  return (
    <div className="music-pill mini-player" role="group" aria-label="Music player">
      <button type="button" className={`music-play${music.paused ? "" : " on"}`} aria-label={music.paused ? "Play" : "Pause"} onClick={music.toggle}>
        {music.paused ? <Play size={18} fill="currentColor" strokeWidth={0} /> : <Pause size={18} fill="currentColor" strokeWidth={0} />}
      </button>
      {/* The cover and title open the Now playing page (D-078). */}
      <Link to="/now-playing" className="mini-player-open" aria-label="Now playing" title="Now playing">
        <span className="mini-cover">{track && <Cover item={{ title: track.title, coverKey: track.coverKey, handler: "audio" }} />}</span>
        <span className="music-text">
          <Marquee className="music-title" text={track?.title ?? "Loading…"} />
          <Marquee className="music-status" text={track ? (track.artist ?? track.album ?? "") : ""} />
        </span>
      </Link>
      <button type="button" className="icon-btn" aria-label="Next track" title="Next track" onClick={music.next}>
        <SkipForward size={17} />
      </button>
      <button type="button" className="icon-btn" aria-label={music.muted ? "Unmute music" : "Mute music"} aria-pressed={music.muted} onClick={music.toggleMute}>
        {music.muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
      </button>
      <input
        type="range"
        className="music-volume"
        aria-label="Music volume"
        min={0}
        max={100}
        value={Math.min(100, music.volume)}
        style={{ "--fill": `${Math.min(100, music.volume)}%` } as CSSProperties}
        onChange={(event) => music.setVolume(Number(event.target.value))}
      />
      <span className="volume-value">{Math.round(Math.min(100, music.volume))}%</span>
    </div>
  );
}

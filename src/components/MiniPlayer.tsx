import type { CSSProperties } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Popover } from "radix-ui";
import { Heart, Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward, Square, Volume2, VolumeX, X } from "lucide-react";
import { api } from "../lib/api";
import { useMusic } from "../lib/music/MusicProvider";
import { Cover } from "./common";
import { Marquee } from "./Marquee";
import { SeekBar } from "./SeekBar";
import { SleepTimerButton } from "../lib/sleepTimer";

function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** "Now playing": the track, its controls, and the queue. */
function NowPlaying() {
  const music = useMusic();
  const queryClient = useQueryClient();
  const track = music.current;
  if (!track) return null;
  const favorite = async () => {
    await api.musicSetFavorite(track.id, !track.favorite);
    music.updateTrack({ ...track, favorite: !track.favorite });
    void queryClient.invalidateQueries({ queryKey: ["tracks"] });
  };
  return (
    <div className="now-playing">
      <div className="now-head">
        <div className="now-cover">
          <Cover item={{ title: track.title, coverKey: track.coverKey, handler: "audio" }} />
        </div>
        <div className="now-meta">
          <strong title={track.title}>{track.title}</strong>
          <span>{[track.artist, track.album].filter(Boolean).join(" · ")}</span>
          <button type="button" className="icon-btn" aria-pressed={track.favorite} aria-label={track.favorite ? "Remove from favorites" : "Add to favorites"} onClick={() => void favorite()}>
            <Heart size={17} fill={track.favorite ? "currentColor" : "none"} />
          </button>
        </div>
      </div>
      <div className="now-seek">
        <SeekBar time={music.time} duration={music.duration} clock={clock} onSeek={(seconds) => music.seek(seconds)} />
      </div>
      <div className="now-controls">
        <button type="button" className="icon-btn" aria-pressed={music.shuffled} aria-label="Shuffle" title="Shuffle" onClick={music.toggleShuffle}>
          <Shuffle size={17} />
        </button>
        <button type="button" className="round-btn" aria-label="Previous track" onClick={music.previous}>
          <SkipBack size={17} />
        </button>
        <button type="button" className="round-btn now-play" aria-label={music.paused ? "Play" : "Pause"} onClick={music.toggle}>
          {music.paused ? <Play size={20} fill="currentColor" strokeWidth={0} /> : <Pause size={20} fill="currentColor" strokeWidth={0} />}
        </button>
        <button type="button" className="round-btn" aria-label="Next track" onClick={music.next}>
          <SkipForward size={17} />
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-pressed={music.repeat !== "off"}
          aria-label={`Repeat: ${music.repeat}`}
          title={music.repeat === "one" ? "Repeat this track" : music.repeat === "all" ? "Repeat the queue" : "Repeat off"}
          onClick={music.cycleRepeat}
        >
          {music.repeat === "one" ? <Repeat1 size={17} /> : <Repeat size={17} />}
        </button>
        <SleepTimerButton />
      </div>
      <div className="now-volume">
        <button type="button" className="icon-btn" aria-label={music.muted ? "Unmute" : "Mute"} onClick={music.toggleMute}>
          {music.muted ? <VolumeX size={17} /> : <Volume2 size={17} />}
        </button>
        <input
          type="range"
          aria-label="Volume"
          min={0}
          max={100}
          value={Math.min(100, music.volume)}
          style={{ "--fill": `${Math.min(100, music.volume)}%` } as CSSProperties}
          onChange={(event) => music.setVolume(Number(event.target.value))}
        />
        <span className="volume-value">{Math.round(Math.min(100, music.volume))}%</span>
      </div>
      <div className="now-queue-head">
        <h3>Queue</h3>
        <button type="button" className="btn btn-sm btn-ghost" onClick={music.stop}>
          <Square size={13} /> Stop and clear
        </button>
      </div>
      <ol className="now-queue">
        {music.queue.map((queued, index) => (
          <li key={`${index}:${queued.id}`} aria-current={index === music.index ? "true" : undefined}>
            <button type="button" className="now-queue-go" onClick={() => music.jump(index)}>
              <strong>{queued.title}</strong>
              <span>{queued.artist ?? queued.album}</span>
            </button>
            <button type="button" className="icon-btn" aria-label={`Remove ${queued.title} from the queue`} onClick={() => music.remove(index)}>
              <X size={15} />
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** The title-bar capsule while library music plays (D-020): the track, pause and next; opens "Now playing". */
export function MiniPlayer() {
  const music = useMusic();
  const track = music.current;
  return (
    <div className="music-pill mini-player" role="group" aria-label="Music player">
      <button type="button" className={`music-play${music.paused ? "" : " on"}`} aria-label={music.paused ? "Play" : "Pause"} onClick={music.toggle}>
        {music.paused ? <Play size={18} fill="currentColor" strokeWidth={0} /> : <Pause size={18} fill="currentColor" strokeWidth={0} />}
      </button>
      <Popover.Root>
        <Popover.Trigger asChild>
          <button type="button" className="mini-player-open" aria-label="Now playing" title="Now playing">
            <span className="mini-cover">{track && <Cover item={{ title: track.title, coverKey: track.coverKey, handler: "audio" }} />}</span>
            <span className="music-text">
              <Marquee className="music-title" text={track?.title ?? "Loading…"} />
              <Marquee className="music-status" text={track ? (track.artist ?? track.album ?? "") : ""} />
            </span>
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content className="menu now-playing-panel" align="end" sideOffset={12} collisionPadding={16}>
            <NowPlaying />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
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

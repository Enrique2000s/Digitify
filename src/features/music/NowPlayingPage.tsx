import type { CSSProperties } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, Heart, Music, Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward, Square, Volume2, VolumeX, X } from "lucide-react";
import { BackButton } from "../../components/BackButton";
import { Marquee } from "../../components/Marquee";
import { api, artworkUrl } from "../../lib/api";
import { useMusic } from "../../lib/music/MusicProvider";
import { SleepTimerButton } from "../../lib/sleepTimer";
import { Cover } from "../../components/common";
import { SeekBar } from "../../components/SeekBar";

const clock = (seconds: number) => {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * `/now-playing` (D-078): the music player as a page of its own, like Big Picture's Now playing in
 * the app's own look. The cover big over its colors, the track, the timeline, the controls, the
 * volume and the sleep timer, and the queue to jump in, reorder or trim. Opened from the mini player.
 */
export function NowPlayingPage() {
  const music = useMusic();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const track = music.current;

  if (!track) {
    return (
      <div className="page now-page">
        <BackButton className="now-back" />
        <div className="empty now-empty">
          <Music size={44} />
          <p>Nothing is playing. Play a song or a playlist from Music, and it shows here.</p>
          <button type="button" className="btn btn-primary" onClick={() => void navigate({ to: "/library/$scope", params: { scope: "music" } })}>
            Open Music
          </button>
        </div>
      </div>
    );
  }
  const favorite = async () => {
    await api.musicSetFavorite(track.id, !track.favorite);
    music.updateTrack({ ...track, favorite: !track.favorite });
    void queryClient.invalidateQueries({ queryKey: ["tracks"] });
  };
  const cover = track.coverKey ? artworkUrl(track.coverKey, "cover") : null;
  const last = music.queue.length - 1;
  return (
    <div className="page now-page">
      {cover && <div className="now-backdrop" style={{ backgroundImage: `url("${cover}")` }} aria-hidden />}
      <BackButton className="now-back" />
      <div className="now-stage">
        <div className={`now-art${music.paused ? "" : " playing"}`}>
          <Cover item={{ title: track.title, coverKey: track.coverKey, handler: "audio" }} size="cover" />
        </div>
        <div className="now-main">
          <span className="now-kicker">{music.paused ? "Paused" : "Now playing"}</span>
          <h1 className="display now-title">
            <Marquee text={track.title} />
          </h1>
          <div className="now-sub">
            <Marquee text={[track.artist, track.album].filter(Boolean).join(" · ") || "Unknown artist"} />
            <button type="button" className="icon-btn" aria-pressed={track.favorite} aria-label={track.favorite ? "Remove from favorites" : "Add to favorites"} onClick={() => void favorite()}>
              <Heart size={19} fill={track.favorite ? "currentColor" : "none"} />
            </button>
          </div>
          <div className="now-page-seek">
            <SeekBar time={music.time} duration={music.duration} clock={clock} timeClassName="now-time" onSeek={(s) => music.seek(s)} />
          </div>
          <div className="now-page-controls">
            <button type="button" className="icon-btn" aria-pressed={music.shuffled} aria-label="Shuffle" title="Shuffle" onClick={music.toggleShuffle}>
              <Shuffle size={20} />
            </button>
            <button type="button" className="round-btn lg" aria-label="Previous track" onClick={music.previous}>
              <SkipBack size={20} />
            </button>
            <button type="button" className="round-btn now-page-play" aria-label={music.paused ? "Play" : "Pause"} onClick={music.toggle}>
              {music.paused ? <Play size={30} fill="currentColor" strokeWidth={0} /> : <Pause size={30} fill="currentColor" strokeWidth={0} />}
            </button>
            <button type="button" className="round-btn lg" aria-label="Next track" onClick={music.next}>
              <SkipForward size={20} />
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-pressed={music.repeat !== "off"}
              aria-label={`Repeat: ${music.repeat}`}
              title={music.repeat === "one" ? "Repeat this track" : music.repeat === "all" ? "Repeat the queue" : "Repeat off"}
              onClick={music.cycleRepeat}
            >
              {music.repeat === "one" ? <Repeat1 size={20} /> : <Repeat size={20} />}
            </button>
          </div>
          <div className="now-page-volume">
            <button type="button" className="icon-btn" aria-label={music.muted ? "Unmute" : "Mute"} onClick={music.toggleMute}>
              {music.muted ? <VolumeX size={19} /> : <Volume2 size={19} />}
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
            <SleepTimerButton />
          </div>
        </div>
        <section className="panel now-page-queue" aria-label="Queue">
          <div className="now-queue-head">
            <h2>Queue</h2>
            <span className="now-queue-count">{music.queue.length === 1 ? "1 track" : `${music.queue.length} tracks`}</span>
            <button type="button" className="btn btn-sm btn-ghost" onClick={music.stop}>
              <Square size={13} /> Stop and clear
            </button>
          </div>
          <ol className="now-page-list">
            {music.queue.map((queued, index) => (
              <li key={`${index}:${queued.id}`} aria-current={index === music.index ? "true" : undefined} className={index < music.index ? "played" : undefined}>
                <button type="button" className="now-page-go" onClick={() => music.jump(index)}>
                  <span className="now-page-thumb">
                    {/* No cover: the same sound waves as the title bar's player (D-169). */}
                    <Cover item={{ title: queued.title, coverKey: queued.coverKey, handler: "audio" }} iconOnly />
                  </span>
                  <span className="now-page-text">
                    <strong>{queued.title}</strong>
                    <span>{queued.artist ?? queued.album ?? ""}</span>
                  </span>
                  {queued.durationMs != null && <span className="now-page-length">{clock(queued.durationMs / 1000)}</span>}
                </button>
                <span className="now-page-tools">
                  <button type="button" className="icon-btn" aria-label={`Move ${queued.title} up`} disabled={index === 0} onClick={() => music.move(index, index - 1)}>
                    <ArrowUp size={15} />
                  </button>
                  <button type="button" className="icon-btn" aria-label={`Move ${queued.title} down`} disabled={index === last} onClick={() => music.move(index, index + 1)}>
                    <ArrowDown size={15} />
                  </button>
                  <button type="button" className="icon-btn" aria-label={`Remove ${queued.title} from the queue`} onClick={() => music.remove(index)}>
                    <X size={15} />
                  </button>
                </span>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}

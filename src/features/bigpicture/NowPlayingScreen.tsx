import { useEffect, useRef } from "react";
import { Music, Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward } from "lucide-react";
import { artworkUrl } from "../../lib/api";
import { usePad } from "../../lib/gamepad";
import { useMusic } from "../../lib/music/MusicProvider";
import { Cover } from "../../components/common";
import { SeekBar } from "../../components/SeekBar";
import { Marquee } from "../../components/Marquee";

const clock = (seconds: number) => {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * Big Picture's Now playing (D-072): the track's cover big over its own colors, the title, the
 * timeline, big controls and what comes next. LB/RB skip tracks, LT/RT move 10 seconds, X plays or
 * pauses (as everywhere in Big Picture).
 */
export function NowPlayingScreen() {
  const music = useMusic();
  const track = music.current;
  const upNext = music.queue.slice(music.index + 1, music.index + 9);
  const list = useRef<HTMLDivElement>(null);

  usePad((action) => {
    if (!music.active) return;
    switch (action) {
      case "lb":
        music.previous();
        return true;
      case "rb":
        music.next();
        return true;
      case "lt":
        music.seek(Math.max(0, music.time - 10));
        return true;
      case "rt":
        music.seek(Math.min(music.duration, music.time + 10));
        return true;
      default:
        return;
    }
  });
  // The queue keeps the playing track's neighbours in view. (In braces: scrollTo returns a promise
  // in newer WebView2, and an effect may only return its clean-up, D-143.)
  useEffect(() => {
    list.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [music.index]);

  if (!track) {
    return (
      <div className="bp-np-empty">
        <Music size={64} />
        <p>Nothing is playing. Pick a song or a playlist in Music and press Play.</p>
      </div>
    );
  }
  const cover = track.coverKey ? artworkUrl(track.coverKey, "cover") : null;
  return (
    <div className="bp-np">
      {cover && <div className="bp-np-backdrop" style={{ backgroundImage: `url("${cover}")` }} aria-hidden />}
      <div className={`bp-np-art${music.paused ? "" : " playing"}`}>
        <Cover item={{ title: track.title, coverKey: track.coverKey, handler: "audio" }} size="cover" />
      </div>
      <div className="bp-np-main">
        <span className="bp-np-kicker">{music.paused ? "Paused" : "Now playing"}</span>
        <h1 className="bp-np-title">
          <Marquee text={track.title} />
        </h1>
        <p className="bp-np-sub">
          <Marquee text={[track.artist, track.album].filter(Boolean).join(" · ") || "Unknown artist"} />
        </p>
        <div className="bp-np-seek">
          <SeekBar time={music.time} duration={music.duration} clock={clock} timeClassName="bp-np-time" onSeek={(s) => music.seek(s)} />
        </div>
        <div className="bp-np-controls">
          <button type="button" className="bp-round" data-bp-focus aria-label="Shuffle" aria-pressed={music.shuffled} onClick={music.toggleShuffle}>
            <Shuffle size={24} />
          </button>
          <button type="button" className="bp-round lg" data-bp-focus aria-label="Previous track" onClick={music.previous}>
            <SkipBack size={30} />
          </button>
          <button type="button" className="bp-round xl primary" data-bp-focus data-bp-autofocus aria-label={music.paused ? "Play" : "Pause"} onClick={music.toggle}>
            {music.paused ? <Play size={40} fill="currentColor" /> : <Pause size={40} fill="currentColor" />}
          </button>
          <button type="button" className="bp-round lg" data-bp-focus aria-label="Next track" onClick={music.next}>
            <SkipForward size={30} />
          </button>
          <button type="button" className="bp-round" data-bp-focus aria-label={`Repeat: ${music.repeat}`} aria-pressed={music.repeat !== "off"} onClick={music.cycleRepeat}>
            {music.repeat === "one" ? <Repeat1 size={24} /> : <Repeat size={24} />}
          </button>
        </div>
      </div>
      <section className="bp-np-queue">
        <h2>Up next</h2>
        {upNext.length === 0 ? (
          <p className="bp-np-none">{music.repeat === "all" ? "The queue starts over after this one." : "This is the last track."}</p>
        ) : (
          <div ref={list} className="bp-np-list">
            {upNext.map((t, i) => (
              <button key={`${t.id}-${i}`} type="button" className="bp-np-entry" data-bp-focus onClick={() => music.jump(music.index + 1 + i)}>
                <span className="bp-np-entry-art">
                  <Cover item={{ title: t.title, coverKey: t.coverKey, handler: "audio" }} />
                </span>
                <span className="bp-np-entry-text">
                  <strong>{t.title}</strong>
                  <span>{t.artist ?? ""}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

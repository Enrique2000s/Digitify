import { useEffect, useRef, useState } from "react";
import { api, previewUrl } from "../lib/api";

/** Each video's clip once asked for: the address to play it from, or null when it has none. */
const clips = new Map<number, Promise<string | null>>();

/** The preview playing now, to quiet when another starts: one plays at a time. */
let playingNow: (() => void) | null = null;

function clipOf(id: number): Promise<string | null> {
  let clip = clips.get(id);
  if (!clip) {
    clip = api.videoPreview(id).then(
      (key) => (key ? previewUrl(id, key) : null),
      () => null,
    );
    clips.set(id, clip);
  }
  return clip;
}

/**
 * A video's hover preview (D-179), as on video sites: while its cover is hovered (or selected, in
 * Big Picture) for a moment, a short silent clip plays over it. The clip is made by the core the
 * first time (the cover shows meanwhile) and kept, so later hovers play at once. Only for Videos
 * with their file here, and never in performance mode.
 *
 * It listens to the link or button the cover is in (or the cover's box, on an item's page), so it
 * drops into any cover without the cover having to pass anything down.
 */
export function CoverPreview({ item, delay = 400 }: { item: { id: number; category?: string | null; online?: boolean | unknown }; delay?: number }) {
  const wanted = item.category === "videos" && !(item.online === true) && item.id > 0;
  const ref = useRef<HTMLSpanElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const id = item.id;

  useEffect(() => {
    const box = ref.current?.parentElement;
    if (!wanted || !box) return;
    const host = (box.closest("a, button") as HTMLElement | null) ?? box;
    // What Big Picture can select goes by its selection, which the mouse and its cursor move too (a
    // mouse left resting on a tile mustn't play it); the rest by the mouse, a focused card not being
    // looked at outside Big Picture.
    const followFocus = !!host.closest(".bp") && host.matches("[data-bp-focus]");
    let hovered = false;
    let focused = false;
    let on = false;
    let timer = 0;
    const quiet = () => {
      hovered = false;
      focused = false;
      update();
    };
    const update = () => {
      const want = (hovered || focused) && document.documentElement.dataset.perf !== "light";
      if (want === on) return;
      on = want;
      window.clearTimeout(timer);
      if (on) {
        if (playingNow && playingNow !== quiet) playingNow();
        playingNow = quiet;
        timer = window.setTimeout(() => {
          void clipOf(id).then((url) => {
            if (on && url) setSrc(url);
          });
        }, delay);
      } else {
        if (playingNow === quiet) playingNow = null;
        setSrc(null);
        setPlaying(false);
      }
    };
    const enter = () => {
      hovered = !followFocus;
      update();
    };
    const leave = () => {
      hovered = false;
      update();
    };
    const focusIn = () => {
      focused = followFocus;
      update();
    };
    const focusOut = () => {
      focused = false;
      update();
    };
    host.addEventListener("mouseenter", enter);
    host.addEventListener("mouseleave", leave);
    host.addEventListener("focusin", focusIn);
    host.addEventListener("focusout", focusOut);
    // Already under the mouse, or selected, when it appears (a page drawn again, Big Picture's first tile).
    if (host.matches(":hover")) enter();
    if (followFocus && host.contains(document.activeElement)) focusIn();
    return () => {
      window.clearTimeout(timer);
      if (playingNow === quiet) playingNow = null;
      host.removeEventListener("mouseenter", enter);
      host.removeEventListener("mouseleave", leave);
      host.removeEventListener("focusin", focusIn);
      host.removeEventListener("focusout", focusOut);
    };
  }, [wanted, id, delay]);

  if (!wanted) return null;
  return (
    <span className="cover-preview" ref={ref} aria-hidden>
      {src && (
        <video
          src={src}
          className={playing ? "on" : undefined}
          muted
          autoPlay
          loop
          playsInline
          disablePictureInPicture
          onPlaying={() => setPlaying(true)}
          onError={() => {
            // A clip this computer can't play: the cover stays, and it isn't tried again.
            clips.set(id, Promise.resolve(null));
            setSrc(null);
          }}
        />
      )}
    </span>
  );
}

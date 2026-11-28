import { useNavigate } from "@tanstack/react-router";
import { enterBigPicture, useBigPicture } from "../../lib/bigpicture";
import { usePreferences } from "../../lib/preferences";
import { Cursor } from "./Cursor";
import { simulatePad, usePad, type PadAction } from "../../lib/gamepad";
import type { ShortcutId } from "../../lib/shortcuts";

// Lets automated tests press controller buttons without a controller.
(window as unknown as { __digitifyPad?: (action: PadAction) => void }).__digitifyPad = simulatePad;

/**
 * Opens Big Picture with the Xbox / PS button (or Start + Select) from anywhere in the app, when
 * turned on in Settings › Controller (D-184; off at first).
 */
export function BigPictureLauncher() {
  const navigate = useNavigate();
  const active = useBigPicture();
  const { preferences } = usePreferences();
  usePad((action) => {
    if (action !== "guide") return;
    void enterBigPicture(() => void navigate({ to: "/bp" }));
    return true;
  }, !active && preferences.controller.homeOpensBigPicture);
  return null;
}

/** In a reader the cursor does the pointing (left stick, A); the D-pad and bumpers turn pages. */
export const READER_PAD: Partial<Record<PadAction, ShortcutId>> = {
  left: "readers.left",
  right: "readers.right",
  up: "readers.previous",
  down: "readers.next",
  lb: "readers.previous",
  rb: "readers.next",
  lt: "readers.zoomOut",
  rt: "readers.zoomIn",
  y: "readers.bookmark",
  back: "readers.close",
};

/** In the player A clicks with the cursor; X plays or pauses, the D-pad seeks and changes the volume. */
export const VIDEO_PAD: Partial<Record<PadAction, ShortcutId>> = {
  x: "video.playPause",
  left: "video.back",
  right: "video.forward",
  lb: "video.backLong",
  rb: "video.forwardLong",
  up: "video.volumeUp",
  down: "video.volumeDown",
  y: "video.subtitles",
  select: "video.mute",
  rt: "video.nextEpisode",
  back: "video.close",
};

/** Big Picture's round cursor over a reader or the player opened from it. */
export function BigPictureCursor() {
  const active = useBigPicture();
  const { preferences } = usePreferences();
  // With selection (the console way, D-071) the controller moves through the controls and the round
  // cursor is the mouse's alone.
  return active ? <Cursor speed={preferences.bigPicture.cursorSpeed} autoHide mouseOnly={preferences.bigPicture.navigation === "focus"} /> : null;
}

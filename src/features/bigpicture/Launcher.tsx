import { useNavigate } from "@tanstack/react-router";
import { enterBigPicture, useBigPicture } from "../../lib/bigpicture";
import { pressShortcut, simulatePad, usePad, type PadAction } from "../../lib/gamepad";
import type { ShortcutId } from "../../lib/shortcuts";

// Lets automated tests press controller buttons without a controller.
(window as unknown as { __digitifyPad?: (action: PadAction) => void }).__digitifyPad = simulatePad;

/** Opens Big Picture with the Xbox / PS button (or Start + Select) from anywhere in the app. */
export function BigPictureLauncher() {
  const navigate = useNavigate();
  const active = useBigPicture();
  usePad((action) => {
    if (action !== "guide") return;
    void enterBigPicture(() => void navigate({ to: "/bp" }));
    return true;
  }, !active);
  return null;
}

/**
 * In Big Picture, the controller drives a reader or the player through their keyboard shortcuts
 * (so changed keys keep working). Each button maps to a shortcut, or to a function.
 */
export function useControllerShortcuts(map: Partial<Record<PadAction, ShortcutId | (() => void)>>) {
  const active = useBigPicture();
  usePad((action) => {
    const target = map[action];
    if (!target) return;
    if (typeof target === "function") target();
    else pressShortcut(target);
    return true;
  }, active);
}

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

export const VIDEO_PAD: Partial<Record<PadAction, ShortcutId>> = {
  accept: "video.playPause",
  left: "video.back",
  right: "video.forward",
  lb: "video.backLong",
  rb: "video.forwardLong",
  up: "video.volumeUp",
  down: "video.volumeDown",
  x: "video.subtitles",
  y: "video.mute",
  rt: "video.nextEpisode",
  back: "video.close",
};

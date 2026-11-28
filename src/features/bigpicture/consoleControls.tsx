import { useEffect, useRef, useState, type RefObject } from "react";
import { moveFocus, useBigPicture } from "../../lib/bigpicture";
import { controllerKind, onControllerChange, pressShortcut, usePad, type PadAction, buttonNames } from "../../lib/gamepad";
import { usePreferences } from "../../lib/preferences";
import { ambientEngine } from "../../lib/ambient/engine";
import type { ShortcutId } from "../../lib/shortcuts";

/** The controls a player's bars (and its open menus) offer to the controller. */
const CONTROLS = [".reader-bar", ".menu", "[data-radix-popper-content-wrapper]"]
  .flatMap((box) => ["button", "input", "select", "a[href]", "[role=slider]"].map((el) => `${box} ${el}:not([disabled])`))
  .join(", ");
const MENU = ".menu, [data-radix-popper-content-wrapper]";

type Quick = Partial<Record<PadAction, ShortcutId | (() => void)>>;

/** Steps a slider or a list box by one notch from the controller, as the arrow keys would. */
function nudge(element: HTMLElement, direction: 1 | -1) {
  if (!(element instanceof HTMLInputElement) && !(element instanceof HTMLSelectElement)) {
    // A drawn slider (the timeline) takes the arrow keys itself.
    element.dispatchEvent(new KeyboardEvent("keydown", { key: direction > 0 ? "ArrowRight" : "ArrowLeft", bubbles: true, cancelable: true }));
    return;
  }
  if (element instanceof HTMLSelectElement) {
    const next = Math.min(element.options.length - 1, Math.max(0, element.selectedIndex + direction));
    if (next === element.selectedIndex) return;
    element.selectedIndex = next;
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }
  const min = Number(element.min || 0);
  const max = Number(element.max || 100);
  const step = Number(element.step) || 1;
  // Long sliders (a film's timeline) move by a hundredth at a time, short ones by their step.
  const by = Math.max(step, (max - min) / 100);
  const value = Math.min(max, Math.max(min, Number(element.value) + direction * by));
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, String(value));
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

/**
 * The players and readers driven like a console in Big Picture (D-071). With the bars away, the
 * controller's quick buttons act at once (X plays or pauses, the bumpers skip, the D-pad turns
 * pages or seeks). A (or Menu) brings the bars and selects their main button; then the D-pad moves
 * from button to button with Big Picture's ring, A presses, left and right move a slider, and B
 * puts the bars away (or closes an open menu). B with the bars away goes back.
 *
 * Returns whether the controller is on the bars, so the player keeps them shown meanwhile. In the
 * cursor mode of Big Picture the quick buttons work as before and the cursor does the pointing.
 */
export function usePlayerController(root: RefObject<HTMLElement | null>, quick: Quick, poke: () => void): boolean {
  const active = useBigPicture();
  const { preferences } = usePreferences();
  const consoleMode = active && preferences.bigPicture.navigation === "focus";
  const [driving, setDriving] = useState(false);
  const drivingRef = useRef(false);
  drivingRef.current = driving;
  const tone = (kind: "hover" | "press") => preferences.interfaceSounds && ambientEngine.uiSound(kind);

  // The selected control wears Big Picture's ring (a class, so it stays when the window blurs).
  useEffect(() => {
    if (!consoleMode) return;
    let last: HTMLElement | null = null;
    const onIn = (event: FocusEvent) => {
      const target = event.target as HTMLElement;
      if (!root.current?.contains(target) && !target.closest(MENU)) return;
      last?.classList.remove("bp-selected");
      if (drivingRef.current && target.matches(CONTROLS)) {
        target.classList.add("bp-selected");
        last = target;
      }
    };
    document.addEventListener("focusin", onIn);
    return () => {
      document.removeEventListener("focusin", onIn);
      last?.classList.remove("bp-selected");
    };
  }, [consoleMode, root]);

  const stop = () => {
    setDriving(false);
    document.querySelectorAll(".bp-selected").forEach((e) => e.classList.remove("bp-selected"));
    (document.activeElement as HTMLElement | null)?.blur?.();
    poke();
  };
  const start = () => {
    poke();
    setDriving(true);
    // Once the bars are drawn, select their main button.
    window.setTimeout(() => {
      if (root.current) moveFocus(root.current, "down", CONTROLS);
      const focused = document.activeElement as HTMLElement | null;
      if (focused?.matches(CONTROLS)) focused.classList.add("bp-selected");
    }, 60);
  };
  const run = (target: ShortcutId | (() => void) | undefined) => {
    if (!target) return false;
    if (typeof target === "function") target();
    else pressShortcut(target);
    return true;
  };

  usePad((action) => {
    if (!active) return;
    if (!consoleMode) return run(quick[action]) || undefined;
    poke();
    const focused = document.activeElement as HTMLElement | null;
    const openMenu = document.querySelector<HTMLElement>(MENU);
    if (!drivingRef.current) {
      if (action === "accept" || action === "start") {
        tone("press");
        start();
        return true;
      }
      return run(quick[action]) || undefined;
    }
    switch (action) {
      case "up":
      case "down":
      case "left":
      case "right": {
        const slides = focused && ((focused instanceof HTMLInputElement && focused.type === "range") || focused instanceof HTMLSelectElement || focused.getAttribute("role") === "slider");
        if ((action === "left" || action === "right") && focused && slides) {
          nudge(focused, action === "right" ? 1 : -1);
          return true;
        }
        const area = openMenu ?? root.current;
        if (area && moveFocus(area, action, CONTROLS)) tone("hover");
        return true;
      }
      case "accept":
        if (focused?.matches(CONTROLS) && !(focused instanceof HTMLInputElement && focused.type === "range") && focused.getAttribute("role") !== "slider") {
          tone("press");
          focused.click();
          // A menu that opened gets its first choice selected.
          window.setTimeout(() => {
            const menu = document.querySelector<HTMLElement>(MENU);
            if (menu && !menu.contains(document.activeElement)) moveFocus(menu, "down", CONTROLS);
          }, 80);
        }
        return true;
      case "back":
        tone("press");
        if (openMenu) {
          (focused ?? document.body).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
          window.setTimeout(() => root.current && moveFocus(root.current, "down", CONTROLS), 80);
        } else stop();
        return true;
      case "start":
        stop();
        return true;
      default:
        return run(quick[action]) || undefined;
    }
  }, active);

  // Leaving Big Picture or its focus mode lets go of the bars.
  useEffect(() => {
    if (!consoleMode) setDriving(false);
  }, [consoleMode]);
  return consoleMode && driving;
}

/** Button names as printed on the controller in use. */
export function useButtonNames() {
  const [kind, setKind] = useState(controllerKind);
  useEffect(() => onControllerChange(() => setKind(controllerKind())), []);
  // As set up in Settings › Controller (D-183).
  const { preferences } = usePreferences();
  return { ...buttonNames(preferences.controller), kind };
}

export interface Hint {
  keys: string[];
  label: string;
}

/** Big Picture's button hints at the bottom right of a player, shown with its bars. */
export function PlayerHints({ shown, hints }: { shown: boolean; hints: Hint[] }) {
  const active = useBigPicture();
  if (!active) return null;
  return (
    <div className={`bp-player-hints${shown ? "" : " hidden"}`} aria-hidden>
      {hints.map((hint) => (
        <span key={hint.label}>
          {hint.keys.map((k) => (
            <b key={k}>{k}</b>
          ))}{" "}
          {hint.label}
        </span>
      ))}
    </div>
  );
}

/** The hints most players share, for the controller in use. */
export function usePlayerHints(driving: boolean, extra: Hint[]): Hint[] {
  const b = useButtonNames();
  return driving
    ? [
        { keys: [b.a], label: "Select" },
        { keys: [b.b], label: "Hide controls" },
        ...extra.filter((h) => h.keys.includes(b.x)),
      ]
    : [{ keys: [b.a], label: "Controls" }, ...extra, { keys: [b.b], label: "Back" }];
}

/** The time of day, as in Big Picture's top bar. */
export function BpClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(timer);
  }, []);
  return <span className="bp-clock">{now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</span>;
}

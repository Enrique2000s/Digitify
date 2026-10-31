import { useEffect, useRef } from "react";
import { keysFor, type ShortcutId } from "./shortcuts";

/**
 * Game controllers (Big Picture, D-025): Xbox and PlayStation controllers, wired or Bluetooth, read
 * through the browser's Gamepad API in its "standard" layout. Buttons and the left stick become
 * actions; held directions repeat like a keyboard. The left stick's position is also offered for
 * cursor mode, and the right stick's for scrolling.
 */
export type PadAction =
  | "up"
  | "down"
  | "left"
  | "right"
  | "accept" // A / Cross
  | "back" // B / Circle
  | "x" // X / Square
  | "y" // Y / Triangle
  | "lb"
  | "rb"
  | "lt"
  | "rt"
  | "select" // View / Share
  | "start" // Menu / Options
  | "guide"; // Xbox / PS (also Start + Select together)

/** Standard-layout button index → action. */
const BUTTONS: Record<number, PadAction> = {
  0: "accept",
  1: "back",
  2: "x",
  3: "y",
  4: "lb",
  5: "rb",
  6: "lt",
  7: "rt",
  8: "select",
  9: "start",
  12: "up",
  13: "down",
  14: "left",
  15: "right",
  16: "guide",
};
const REPEATS = new Set<PadAction>(["up", "down", "left", "right", "lb", "rb"]);
const REPEAT_DELAY = 380;
const REPEAT_EVERY = 110;
const DEAD_ZONE = 0.22;

export interface Sticks {
  lx: number;
  ly: number;
  rx: number;
  ry: number;
}

type Listener = (action: PadAction) => boolean | void;
type StickListener = (sticks: Sticks, dt: number) => void;

const listeners = new Set<Listener>();
const stickListeners = new Set<StickListener>();
const connected = new Set<string>();
const connectionListeners = new Set<() => void>();
let frame = 0;
let last = 0;
const held = new Map<PadAction, number>();
/** Start and Select act when let go, unless they were pressed together (the guide stand-in). */
let comboUsed = false;

function deadZone(v: number): number {
  return Math.abs(v) < DEAD_ZONE ? 0 : (v - Math.sign(v) * DEAD_ZONE) / (1 - DEAD_ZONE);
}

function emit(action: PadAction) {
  // Newest listener first, so a dialog or menu on top gets the controller before the page.
  for (const listener of [...listeners].reverse()) {
    if (listener(action) === true) return;
  }
}

function poll(now: number) {
  const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
  last = now;
  const pressed = new Set<PadAction>();
  const sticks: Sticks = { lx: 0, ly: 0, rx: 0, ry: 0 };
  for (const pad of navigator.getGamepads?.() ?? []) {
    if (!pad || !pad.connected) continue;
    pad.buttons.forEach((button, index) => {
      const action = BUTTONS[index];
      if (action && (button.pressed || button.value > 0.6)) pressed.add(action);
    });
    const [lx = 0, ly = 0, rx = 0, ry = 0] = pad.axes;
    sticks.lx += deadZone(lx);
    sticks.ly += deadZone(ly);
    sticks.rx += deadZone(rx);
    sticks.ry += deadZone(ry);
  }
  // The left stick also moves the selection, like the D-pad.
  if (sticks.lx < -0.6) pressed.add("left");
  if (sticks.lx > 0.6) pressed.add("right");
  if (sticks.ly < -0.6) pressed.add("up");
  if (sticks.ly > 0.6) pressed.add("down");
  // Start + Select together stand in for the Xbox button, which Windows may keep for its Game Bar.
  if (pressed.has("start") && pressed.has("select")) {
    if (!comboUsed) emit("guide");
    comboUsed = true;
  }
  for (const action of ["start", "select"] as const) {
    if (held.has(action) && !pressed.has(action) && !comboUsed) emit(action);
  }
  if (!pressed.has("start") && !pressed.has("select")) comboUsed = false;
  for (const action of [...held.keys()]) {
    if (!pressed.has(action)) held.delete(action);
  }
  for (const action of pressed) {
    const next = held.get(action);
    if (next === undefined) {
      held.set(action, now + REPEAT_DELAY);
      if (action !== "start" && action !== "select") emit(action);
    } else if (REPEATS.has(action) && now >= next) {
      held.set(action, now + REPEAT_EVERY);
      emit(action);
    }
  }
  for (const listener of stickListeners) listener(sticks, dt);
  frame = requestAnimationFrame(poll);
}

function start() {
  if (!frame && connected.size) frame = requestAnimationFrame(poll);
}
function stop() {
  if (frame && !connected.size) {
    cancelAnimationFrame(frame);
    frame = 0;
    held.clear();
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("gamepadconnected", (event) => {
    connected.add(event.gamepad.id + event.gamepad.index);
    connectionListeners.forEach((l) => l());
    start();
  });
  window.addEventListener("gamepaddisconnected", (event) => {
    connected.delete(event.gamepad.id + event.gamepad.index);
    connectionListeners.forEach((l) => l());
    stop();
  });
}

/** Acts as if a controller button was pressed (for automated tests). */
export function simulatePad(action: PadAction) {
  emit(action);
}

/** Whether a controller is connected, and which kind ("xbox", "playstation" or "other"). */
export function controllerKind(): "xbox" | "playstation" | "other" | null {
  const pad = [...(navigator.getGamepads?.() ?? [])].find((p) => p?.connected);
  if (!pad) return null;
  const id = pad.id.toLowerCase();
  if (/054c|playstation|dualsense|dualshock|wireless controller/.test(id)) return "playstation";
  if (/045e|xbox|xinput/.test(id)) return "xbox";
  return "other";
}

export function onControllerChange(listener: () => void): () => void {
  connectionListeners.add(listener);
  return () => connectionListeners.delete(listener);
}

/**
 * Calls `handler` for each controller action while mounted. Return `true` from the handler to stop
 * the action reaching listeners mounted earlier (pages under a dialog).
 */
export function usePad(handler: (action: PadAction) => boolean | void, enabled = true) {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    if (!enabled) return;
    const listener: Listener = (action) => latest.current(action);
    listeners.add(listener);
    return () => void listeners.delete(listener);
  }, [enabled]);
}

/** Calls `handler` every frame with the sticks' positions (for the cursor and scrolling). */
export function useSticks(handler: StickListener, enabled = true) {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    if (!enabled) return;
    const listener: StickListener = (sticks, dt) => latest.current(sticks, dt);
    stickListeners.add(listener);
    return () => void stickListeners.delete(listener);
  }, [enabled]);
}

/**
 * Presses the key an action is bound to (Settings › Keyboard), so the controller drives the readers
 * and the player through the same shortcuts as the keyboard.
 */
export function pressShortcut(id: ShortcutId) {
  const combo = keysFor(id)[0];
  if (!combo) return;
  const parts = combo.split(/\+(?!$)/);
  const key = parts[parts.length - 1];
  const init: KeyboardEventInit = {
    key: key === "Space" ? " " : key.length === 1 ? key.toLowerCase() : key,
    ctrlKey: parts.includes("Ctrl"),
    altKey: parts.includes("Alt"),
    shiftKey: parts.includes("Shift"),
    metaKey: parts.includes("Win"),
    bubbles: true,
    cancelable: true,
  };
  if (init.shiftKey && key.length === 1) init.key = key.toUpperCase();
  window.dispatchEvent(new KeyboardEvent("keydown", init));
}


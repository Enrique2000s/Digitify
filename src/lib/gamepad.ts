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

/** Standard-layout button index → action, before Settings › Controller changes it (D-183). */
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

/**
 * Settings › Controller (D-183): confirm and back swapped (Nintendo-style or Japanese layouts), the
 * button names shown, any action on another button, the sticks' dead zone (drift), how fast and which
 * way the right stick scrolls, whether the left stick moves the selection, and which controller is
 * listened to when several are connected.
 */
export interface ControllerSettings {
  swapConfirm: boolean;
  glyphs: "auto" | "xbox" | "playstation";
  remap: Partial<Record<PadAction, number>>;
  deadZone: number;
  scrollSpeed: number;
  invertScroll: boolean;
  stickMoves: boolean;
  /** A controller's id to listen to alone; null for any. */
  pad: string | null;
  /** The Xbox / PS button (or Start + Select) opens Big Picture from anywhere (D-184); off at first. */
  homeOpensBigPicture: boolean;
}
export const DEFAULT_CONTROLLER: ControllerSettings = { swapConfirm: false, glyphs: "auto", remap: {}, deadZone: 0.22, scrollSpeed: 1, invertScroll: false, stickMoves: true, pad: null, homeOpensBigPicture: false };
let settings: ControllerSettings = DEFAULT_CONTROLLER;
export function setControllerSettings(next: ControllerSettings) {
  settings = next;
}

/** The button an action is on now: its own choice, else the usual one (confirm and back swapped if asked). */
export function buttonFor(action: PadAction, s: ControllerSettings = settings): number | undefined {
  const own = s.remap[action];
  if (own != null) return own;
  if (s.swapConfirm && action === "accept") return 1;
  if (s.swapConfirm && action === "back") return 0;
  const found = Object.entries(BUTTONS).find(([, a]) => a === action);
  return found ? Number(found[0]) : undefined;
}

/** Index → action as set up now: the actions moved to other buttons take those, the rest stay. */
function mapping(): Map<number, PadAction> {
  const out = new Map<number, PadAction>();
  for (const action of new Set(Object.values(BUTTONS))) {
    const index = buttonFor(action);
    if (index != null) out.set(index, action);
  }
  return out;
}

const XBOX_NAMES = ["A", "B", "X", "Y", "LB", "RB", "LT", "RT", "View", "Menu", "LS", "RS", "Up", "Down", "Left", "Right", "Xbox"];
const PS_NAMES = ["✕", "○", "□", "△", "L1", "R1", "L2", "R2", "Create", "Options", "L3", "R3", "Up", "Down", "Left", "Right", "PS"];

/** The names printed on the controller: the one in use, or the ones chosen in Settings › Controller. */
export function glyphKind(s: ControllerSettings = settings): "xbox" | "playstation" | "other" | null {
  return s.glyphs === "auto" ? controllerKind() : s.glyphs;
}

/** A button's name on the controller, by its index. */
export function buttonName(index: number | undefined, kind = glyphKind()): string {
  if (index == null) return "—";
  return (kind === "playstation" ? PS_NAMES : XBOX_NAMES)[index] ?? `Button ${index + 1}`;
}

/** The names of the buttons Big Picture's hints name, as set up now. */
export function buttonNames(s: ControllerSettings = settings) {
  const kind = glyphKind(s);
  const name = (action: PadAction) => buttonName(buttonFor(action, s), kind);
  return { kind, a: name("accept"), b: name("back"), x: name("x"), y: name("y"), start: name("start"), view: name("select") };
}

/** While a button is being chosen for an action, the controller does nothing else (D-183). */
const rawListeners = new Set<(index: number) => void>();
export function onRawButton(listener: (index: number) => void): () => void {
  rawListeners.add(listener);
  return () => void rawListeners.delete(listener);
}
let rawHeld = new Set<number>();

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
  const dead = settings.deadZone;
  return Math.abs(v) < dead ? 0 : (v - Math.sign(v) * dead) / (1 - dead);
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
  const pads = [...(navigator.getGamepads?.() ?? [])].filter((p): p is Gamepad => !!p && p.connected);
  // One controller listened to, when chosen and connected; otherwise all of them.
  const chosen = settings.pad ? pads.filter((p) => p.id === settings.pad) : [];
  const map = mapping();
  const raw = new Set<number>();
  // Actions whose button was already down last frame: when a press changes which action a button
  // has (swapping confirm and back), the button still held mustn't do the new one too (D-184).
  const stale = new Set<PadAction>();
  for (const pad of chosen.length ? chosen : pads) {
    pad.buttons.forEach((button, index) => {
      if (button.pressed || button.value > 0.6) raw.add(index);
      const action = map.get(index);
      if (action && (button.pressed || button.value > 0.6)) {
        pressed.add(action);
        if (rawHeld.has(index)) stale.add(action);
      }
    });
    const [lx = 0, ly = 0, rx = 0, ry = 0] = pad.axes;
    sticks.lx += deadZone(lx);
    sticks.ly += deadZone(ly);
    sticks.rx += deadZone(rx);
    sticks.ry += deadZone(ry);
  }
  // A button being chosen for an action (Settings › Controller): only that, nothing else happens.
  if (rawListeners.size) {
    for (const index of raw) if (!rawHeld.has(index)) rawListeners.forEach((l) => l(index));
    rawHeld = raw;
    held.clear();
    frame = requestAnimationFrame(poll);
    return;
  }
  rawHeld = raw;
  // The right stick scrolls at the speed and in the direction chosen.
  const scroll = settings.scrollSpeed * (settings.invertScroll ? -1 : 1);
  sticks.rx *= scroll;
  sticks.ry *= scroll;
  // The left stick also moves the selection, like the D-pad, unless it's moving a cursor (or turned off).
  if (!cursorClaims && settings.stickMoves) {
    if (sticks.lx < -0.6) pressed.add("left");
    if (sticks.lx > 0.6) pressed.add("right");
    if (sticks.ly < -0.6) pressed.add("up");
    if (sticks.ly > 0.6) pressed.add("down");
  }
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
      if (action !== "start" && action !== "select" && !stale.has(action)) emit(action);
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

let cursorClaims = 0;
/** While a cursor is shown, the left stick moves only the cursor. Returns the release. */
export function claimSticksForCursor(): () => void {
  cursorClaims++;
  return () => void cursorClaims--;
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


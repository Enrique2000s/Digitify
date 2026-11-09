/**
 * Keyboard shortcuts (Phase 5): every action Digitify has a key for, its default keys, and the
 * keys the user chose in Settings › Keyboard. Handlers ask `actionFor(event, scope)` instead of
 * comparing keys themselves, so a changed shortcut takes effect everywhere at once.
 *
 * A key is written as a combination such as "Ctrl+F", "Shift+ArrowRight", "Space" or "+".
 */

export type ShortcutScope = "app" | "library" | "readers" | "video";

export const SCOPE_NAMES: Record<ShortcutScope, string> = {
  app: "Everywhere",
  library: "Library views",
  readers: "Readers (pages and ebooks)",
  video: "Video player",
};

export const SHORTCUTS = [
  { id: "app.search", scope: "app", label: "Search the library", keys: ["Ctrl+F"] },
  { id: "app.palette", scope: "app", label: "Find anything (command palette)", keys: ["Ctrl+K"] },
  { id: "app.home", scope: "app", label: "Go to Home", keys: ["Alt+Home"] },
  { id: "app.settings", scope: "app", label: "Open Settings", keys: ["Ctrl+,"] },
  { id: "app.musicPause", scope: "app", label: "Play or pause library music", keys: ["Ctrl+P"] },
  { id: "app.musicNext", scope: "app", label: "Next track", keys: ["Ctrl+Shift+ArrowRight"] },
  { id: "app.musicPrevious", scope: "app", label: "Previous track", keys: ["Ctrl+Shift+ArrowLeft"] },

  { id: "library.selectAll", scope: "library", label: "Select everything (while selecting)", keys: ["Ctrl+A"] },
  { id: "library.stopSelecting", scope: "library", label: "Stop selecting", keys: ["Escape"] },
  { id: "library.carouselPrevious", scope: "library", label: "Carousel: previous cover", keys: ["ArrowLeft"] },
  { id: "library.carouselNext", scope: "library", label: "Carousel: next cover", keys: ["ArrowRight"] },
  { id: "library.carouselOpen", scope: "library", label: "Carousel: open the cover in front", keys: ["Enter"] },

  { id: "readers.right", scope: "readers", label: "Page to the right (back, in right-to-left manga)", keys: ["ArrowRight"] },
  { id: "readers.left", scope: "readers", label: "Page to the left (forward, in right-to-left manga)", keys: ["ArrowLeft"] },
  { id: "readers.next", scope: "readers", label: "Next page", keys: ["ArrowDown", "PageDown", "Space"] },
  { id: "readers.previous", scope: "readers", label: "Previous page", keys: ["ArrowUp", "PageUp", "Shift+Space"] },
  { id: "readers.first", scope: "readers", label: "First page", keys: ["Home"] },
  { id: "readers.last", scope: "readers", label: "Last page", keys: ["End"] },
  { id: "readers.zoomIn", scope: "readers", label: "Zoom in (larger text in ebooks)", keys: ["+", "="] },
  { id: "readers.zoomOut", scope: "readers", label: "Zoom out (smaller text in ebooks)", keys: ["-"] },
  { id: "readers.zoomReset", scope: "readers", label: "Actual size", keys: ["0"] },
  { id: "readers.bookmark", scope: "readers", label: "Add or remove a bookmark", keys: ["B"] },
  { id: "readers.fullscreen", scope: "readers", label: "Full screen", keys: ["F", "F11"] },
  { id: "readers.close", scope: "readers", label: "Close a panel, full screen, then the reader", keys: ["Escape"] },

  { id: "video.playPause", scope: "video", label: "Play or pause", keys: ["Space", "K"] },
  { id: "video.back", scope: "video", label: "Back 5 seconds", keys: ["ArrowLeft"] },
  { id: "video.forward", scope: "video", label: "Forward 5 seconds", keys: ["ArrowRight"] },
  { id: "video.backLong", scope: "video", label: "Back 30 seconds", keys: ["Shift+ArrowLeft"] },
  { id: "video.forwardLong", scope: "video", label: "Forward 30 seconds", keys: ["Shift+ArrowRight"] },
  { id: "video.volumeUp", scope: "video", label: "Volume up", keys: ["ArrowUp"] },
  { id: "video.volumeDown", scope: "video", label: "Volume down", keys: ["ArrowDown"] },
  { id: "video.mute", scope: "video", label: "Mute", keys: ["M"] },
  { id: "video.subtitles", scope: "video", label: "Next subtitles", keys: ["C"] },
  { id: "video.nextEpisode", scope: "video", label: "Next episode", keys: ["Shift+N"] },
  { id: "video.fullscreen", scope: "video", label: "Full screen", keys: ["F", "F11"] },
  { id: "video.close", scope: "video", label: "Close a menu, full screen, then the player", keys: ["Escape"] },
] as const satisfies readonly { id: string; scope: ShortcutScope; label: string; keys: readonly string[] }[];

export type ShortcutId = (typeof SHORTCUTS)[number]["id"];
export type ShortcutMap = Partial<Record<ShortcutId, string[]>>;

const DEFAULTS = new Map<string, readonly string[]>(SHORTCUTS.map((s) => [s.id, s.keys]));
export const isShortcutId = (id: string): id is ShortcutId => DEFAULTS.has(id);

/** The keys the user changed; set by the preferences provider. */
let custom: ShortcutMap = {};
export function setCustomShortcuts(map: ShortcutMap) {
  custom = map;
}

export function keysFor(id: ShortcutId, map: ShortcutMap = custom): readonly string[] {
  return map[id] ?? DEFAULTS.get(id) ?? [];
}

const MODIFIERS = new Set(["Control", "Shift", "Alt", "Meta", "AltGraph", "CapsLock", "NumLock", "OS"]);

/** The combination a key press makes, e.g. "Ctrl+Shift+ArrowRight"; null for a lone modifier. */
export function comboOf(event: KeyboardEvent): string | null {
  if (MODIFIERS.has(event.key) || event.key === "Unidentified" || event.key === "Dead") return null;
  let key = event.key;
  if (key === " " || key === "Spacebar") key = "Space";
  else if (key === "Esc") key = "Escape";
  else if (key.length === 1) key = key.toUpperCase();
  const parts: string[] = [];
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  // Shift is already part of a symbol ("+" is Shift and "="), but not of a letter or a named key.
  const symbol = key.length === 1 && !/[A-Z0-9]/.test(key);
  if (event.shiftKey && !symbol) parts.push("Shift");
  if (event.metaKey) parts.push("Win");
  parts.push(key);
  return parts.join("+");
}

/** While Settings › Keyboard records a new key, no shortcut acts on it. */
let recording = false;
export function setRecordingShortcut(on: boolean) {
  recording = on;
}

/** The action in `scope` this key press triggers, if any. */
export function actionFor(event: KeyboardEvent, scope: ShortcutScope): ShortcutId | null {
  const combo = recording ? null : comboOf(event);
  if (!combo) return null;
  for (const shortcut of SHORTCUTS) {
    if (shortcut.scope === scope && keysFor(shortcut.id).includes(combo)) return shortcut.id;
  }
  return null;
}

/** Typing in a field: single keys belong to the field, not to shortcuts. */
export function isTyping(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null;
  if (!target) return false;
  if (target instanceof HTMLInputElement) return !["range", "checkbox", "radio", "button", "color"].includes(target.type);
  return target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target.isContentEditable;
}

/** Combinations that edit text, which a field always keeps. */
const EDITING = /^(Ctrl\+)?(Shift\+)?(Arrow\w+|Home|End|Backspace|Delete)$|^Ctrl\+(Shift\+)?[ACVXYZ]$/;
/** Whether an "Everywhere" shortcut may act while typing (only Ctrl/Alt combinations that don't edit text). */
export function allowedWhileTyping(event: KeyboardEvent): boolean {
  const combo = comboOf(event);
  return !!combo && (event.ctrlKey || event.altKey) && !EDITING.test(combo);
}

const NAMES: Record<string, string> = {
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  ArrowDown: "↓",
  Escape: "Esc",
  PageUp: "Page Up",
  PageDown: "Page Down",
  Delete: "Del",
  Win: "Win",
};

/** How a combination is shown, e.g. "Ctrl + Shift + →". */
export function comboLabel(combo: string): string {
  return combo
    .split(/\+(?!$)/)
    .map((part) => NAMES[part] ?? part)
    .join(" + ");
}

/** The first key of an action, for button tooltips: "Close (Esc)". */
export function hint(id: ShortcutId): string {
  const first = keysFor(id)[0];
  return first ? ` (${comboLabel(first)})` : "";
}

/** The other actions that a combination would also trigger, in scopes that are active together. */
export function conflicts(id: ShortcutId, combo: string, map: ShortcutMap): ShortcutId[] {
  const scope = SHORTCUTS.find((s) => s.id === id)?.scope;
  return SHORTCUTS.filter(
    (s) => s.id !== id && (s.scope === scope || s.scope === "app" || scope === "app") && keysFor(s.id, map).includes(combo),
  ).map((s) => s.id);
}

export function sanitizeShortcuts(raw: unknown): ShortcutMap {
  const map: ShortcutMap = {};
  if (!raw || typeof raw !== "object") return map;
  for (const [id, keys] of Object.entries(raw)) {
    if (isShortcutId(id) && Array.isArray(keys) && keys.length <= 6 && keys.every((k) => typeof k === "string" && k.length <= 40)) {
      map[id] = keys;
    }
  }
  return map;
}

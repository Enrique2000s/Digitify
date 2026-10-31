import { useEffect, useState } from "react";
import { Keyboard, Plus, RotateCcw, X } from "lucide-react";
import { usePreferences } from "../../lib/preferences";
import {
  SCOPE_NAMES,
  SHORTCUTS,
  comboLabel,
  comboOf,
  conflicts,
  keysFor,
  setRecordingShortcut,
  type ShortcutId,
  type ShortcutMap,
  type ShortcutScope,
} from "../../lib/shortcuts";

const label = (id: ShortcutId) => SHORTCUTS.find((s) => s.id === id)?.label ?? id;
const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((k, i) => k === b[i]);

/** Settings › Keyboard: every shortcut, grouped by where it works; keys can be added, removed and reset. */
export function KeyboardSettings() {
  const { preferences, update } = usePreferences();
  const map = preferences.shortcuts;
  const [scope, setScope] = useState<ShortcutScope>("app");
  const [recording, setRecording] = useState<ShortcutId | null>(null);
  const [pending, setPending] = useState<{ id: ShortcutId; combo: string; others: ShortcutId[] } | null>(null);

  const save = (changes: [ShortcutId, string[]][]) => {
    const next: ShortcutMap = { ...map };
    for (const [id, keys] of changes) {
      // Only keys that differ from the defaults are kept.
      if (same(keys, keysFor(id, {}))) delete next[id];
      else next[id] = keys;
    }
    update({ shortcuts: next });
  };
  const assign = (id: ShortcutId, combo: string, others: ShortcutId[]) => {
    save([[id, [...keysFor(id, map), combo]], ...others.map((other): [ShortcutId, string[]] => [other, keysFor(other, map).filter((k) => k !== combo)])]);
    setPending(null);
  };

  // While recording, the next key press is the new shortcut and nothing else reacts to it.
  useEffect(() => {
    if (!recording) return;
    setRecordingShortcut(true);
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.key === "Escape" && !event.ctrlKey && !event.altKey && !event.shiftKey) {
        setRecording(null);
        return;
      }
      const combo = comboOf(event);
      if (!combo || event.key === "Tab") return;
      setRecording(null);
      if (keysFor(recording, map).includes(combo)) return;
      const others = conflicts(recording, combo, map);
      if (others.length) setPending({ id: recording, combo, others });
      else assign(recording, combo, []);
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      // After this key press has reached every other listener.
      window.setTimeout(() => setRecordingShortcut(false), 0);
    };
  }, [recording, map]);

  const changed = Object.keys(map).length > 0;
  return (
    <section className="panel">
      <h2>Keyboard</h2>
      <div className="shortcut-head">
        <div className="segmented" role="group" aria-label="Where shortcuts work">
          {(Object.keys(SCOPE_NAMES) as ShortcutScope[]).map((value) => (
            <button key={value} type="button" aria-pressed={scope === value} onClick={() => setScope(value)}>
              {SCOPE_NAMES[value]}
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-sm" disabled={!changed} onClick={() => update({ shortcuts: {} })}>
          <RotateCcw size={14} /> Reset all
        </button>
      </div>
      <p className="shortcut-intro">
        <Keyboard size={15} aria-hidden /> Add a key with <strong>+</strong>, then press the keys you want (Esc cancels). An action can have several keys.
      </p>
      <div className="shortcut-list">
        {SHORTCUTS.filter((s) => s.scope === scope).map((shortcut) => {
          const keys = keysFor(shortcut.id, map);
          const custom = shortcut.id in map;
          return (
            <div key={shortcut.id} className="shortcut-row" data-custom={custom || undefined}>
              <span className="shortcut-label">{shortcut.label}</span>
              <div className="shortcut-keys">
                {keys.length === 0 && <span className="shortcut-none">No key</span>}
                {keys.map((combo) => (
                  <span key={combo} className="kbd-chip">
                    <kbd>{comboLabel(combo)}</kbd>
                    <button
                      type="button"
                      aria-label={`Remove ${comboLabel(combo)} from “${shortcut.label}”`}
                      onClick={() => save([[shortcut.id, keys.filter((k) => k !== combo)]])}
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))}
                {recording === shortcut.id ? (
                  <span className="kbd-chip recording" role="status">
                    Press keys…
                  </span>
                ) : (
                  <button type="button" className="icon-btn shortcut-add" aria-label={`Add a key to “${shortcut.label}”`} title="Add a key" onClick={() => setRecording(shortcut.id)}>
                    <Plus size={15} />
                  </button>
                )}
                {custom && (
                  <button type="button" className="icon-btn" aria-label={`Reset “${shortcut.label}”`} title="Back to the default keys" onClick={() => save([[shortcut.id, [...keysFor(shortcut.id, {})]]])}>
                    <RotateCcw size={14} />
                  </button>
                )}
              </div>
              {pending?.id === shortcut.id && (
                <div className="notice warning shortcut-conflict">
                  <span>
                    <kbd>{comboLabel(pending.combo)}</kbd> already does {pending.others.map((other) => `“${label(other)}”`).join(" and ")}. Use it here instead?
                  </span>
                  <span className="shortcut-conflict-actions">
                    <button type="button" className="btn btn-sm btn-primary" onClick={() => assign(pending.id, pending.combo, pending.others)}>
                      Use it here
                    </button>
                    <button type="button" className="btn btn-sm" onClick={() => setPending(null)}>
                      Cancel
                    </button>
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

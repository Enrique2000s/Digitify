import { useEffect, useState, type CSSProperties } from "react";
import { Gamepad2, RotateCcw } from "lucide-react";
import { Switch } from "../../components/common";
import { usePreferences } from "../../lib/preferences";
import { buttonFor, buttonName, DEFAULT_CONTROLLER, onControllerChange, onRawButton, setControllerSettings, type PadAction } from "../../lib/gamepad";
import { Setting } from "./Setting";

/** Keeps the controller module working as Settings › Controller says (D-183); mounted once. */
export function ControllerSync() {
  const { preferences } = usePreferences();
  useEffect(() => setControllerSettings(preferences.controller), [preferences.controller]);
  return null;
}

/** The actions a button can be chosen for, as Big Picture names them. */
export const CONTROLLER_ACTIONS: [PadAction, string][] = [
  ["accept", "Select"],
  ["back", "Back"],
  ["y", "Search"],
  ["x", "Play / pause"],
  ["select", "Favorite"],
  ["start", "Menu"],
  ["lb", "Previous tab"],
  ["rb", "Next tab"],
];

/**
 * Settings › Controller (D-183), for Big Picture with an Xbox or PlayStation controller: its
 * buttons (confirm and back swapped, the names shown, any action on another button), its sticks
 * (dead zone, scrolling, the left stick moving the selection), and a live test of each controller.
 */
export function ControllerSettings() {
  const { preferences, update } = usePreferences();
  const c = preferences.controller;
  const set = (patch: Partial<typeof c>) => update((p) => ({ controller: { ...p.controller, ...patch } }));
  const [choosing, setChoosing] = useState<PadAction | null>(null);

  // Choosing a button: the next one pressed takes the action; Esc or Cancel keeps it as it was.
  useEffect(() => {
    if (!choosing) return;
    const off = onRawButton((index) => {
      set({ remap: { ...c.remap, [choosing]: index } });
      setChoosing(null);
    });
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setChoosing(null);
    window.addEventListener("keydown", onKey);
    return () => {
      off();
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choosing]);

  return (
    <>
      <section className="panel">
        <h2>Buttons</h2>
        <Setting title="Swap confirm and back" text="Select with B (or ○) and go back with A (or ✕), as on Nintendo-style controllers and in Japan.">
          <Switch checked={c.swapConfirm} label="Swap confirm and back" onChange={(swapConfirm) => set({ swapConfirm })} />
        </Setting>
        <Setting title="Home button opens Big Picture" text="The Xbox or PS button (or Start and Select together) opens Big Picture from anywhere in Digitify.">
          <Switch checked={c.homeOpensBigPicture} label="Home button opens Big Picture" onChange={(homeOpensBigPicture) => set({ homeOpensBigPicture })} />
        </Setting>
        <Setting title="Button names" text="The names Big Picture shows for the buttons: those of the controller in use, or always Xbox's or PlayStation's.">
          <div className="segmented" role="group" aria-label="Button names">
            {(
              [
                ["auto", "Controller in use"],
                ["xbox", "Xbox"],
                ["playstation", "PlayStation"],
              ] as const
            ).map(([value, label]) => (
              <button key={value} type="button" aria-pressed={c.glyphs === value} onClick={() => set({ glyphs: value })}>
                {label}
              </button>
            ))}
          </div>
        </Setting>
        <div className="setting">
          <div className="setting-text">
            <strong>Each action's button</strong>
            <p>Choose Change, then press the button you want for it on the controller (Esc cancels).</p>
          </div>
          <button type="button" className="btn btn-ghost" disabled={Object.keys(c.remap).length === 0} onClick={() => set({ remap: {} })}>
            <RotateCcw size={15} /> Usual buttons
          </button>
        </div>
        <ul className="controller-actions">
          {CONTROLLER_ACTIONS.map(([action, label]) => (
            <li key={action}>
              <span>{label}</span>
              <b className="controller-button-name">{choosing === action ? "Press a button…" : buttonName(buttonFor(action, c), c.glyphs === "auto" ? undefined : c.glyphs)}</b>
              <button type="button" className="btn btn-sm" onClick={() => setChoosing(choosing === action ? null : action)}>
                {choosing === action ? "Cancel" : "Change"}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <h2>Sticks</h2>
        <Setting title="Dead zone" text="How far a stick moves before it counts. Raise it if the selection or cursor drifts by itself.">
          <span className="controller-slider">
            <input
              type="range"
              min={0.05}
              max={0.5}
              step={0.01}
              value={c.deadZone}
              aria-label="Dead zone"
              style={{ "--fill": `${((c.deadZone - 0.05) / 0.45) * 100}%` } as CSSProperties}
              onChange={(e) => set({ deadZone: Number(e.target.value) })}
            />
            <span>{Math.round(c.deadZone * 100)}%</span>
          </span>
        </Setting>
        <Setting title="Scrolling speed" text="How fast the right stick scrolls lists and pages.">
          <span className="controller-slider">
            <input
              type="range"
              min={0.25}
              max={3}
              step={0.05}
              value={c.scrollSpeed}
              aria-label="Scrolling speed"
              style={{ "--fill": `${((c.scrollSpeed - 0.25) / 2.75) * 100}%` } as CSSProperties}
              onChange={(e) => set({ scrollSpeed: Number(e.target.value) })}
            />
            <span>{c.scrollSpeed.toFixed(2)}×</span>
          </span>
        </Setting>
        <Setting title="Invert scrolling" text="Pushing the right stick up scrolls down, and the other way around.">
          <Switch checked={c.invertScroll} label="Invert scrolling" onChange={(invertScroll) => set({ invertScroll })} />
        </Setting>
        <Setting title="Left stick moves the selection" text="As the D-pad does. Off, only the D-pad moves it (the left stick still moves the cursor, when there is one).">
          <Switch checked={c.stickMoves} label="Left stick moves the selection" onChange={(stickMoves) => set({ stickMoves })} />
        </Setting>
        <div className="setting">
          <div className="setting-text">
            <strong>Back to how they were</strong>
            <p>Every button and stick setting here as Digitify first had it.</p>
          </div>
          <button type="button" className="btn btn-ghost" onClick={() => set({ ...DEFAULT_CONTROLLER, pad: c.pad, homeOpensBigPicture: c.homeOpensBigPicture })}>
            <RotateCcw size={15} /> Reset
          </button>
        </div>
      </section>

      <ControllerTest chosen={c.pad} onChoose={(pad) => set({ pad })} />
    </>
  );
}

/**
 * A live look at each connected controller (D-183): which buttons are down, where the sticks are.
 * In Big Picture (D-184) the controller to listen to is chosen with buttons instead of a list.
 */
export function ControllerTest({ chosen, onChoose, bigPicture = false }: { chosen: string | null; onChoose: (pad: string | null) => void; bigPicture?: boolean }) {
  const [pads, setPads] = useState<Gamepad[]>([]);
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      setPads([...(navigator.getGamepads?.() ?? [])].filter((p): p is Gamepad => !!p && p.connected));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    const off = onControllerChange(() => undefined);
    return () => {
      cancelAnimationFrame(frame);
      off();
    };
  }, []);
  return (
    <section className={bigPicture ? "bp-controller-test-body" : "panel"}>
      <h2>Controller test</h2>
      <p className="muted">Press buttons and move the sticks: what each controller sends shows here, so a drifting stick or a button that doesn't answer is easy to find.</p>
      {pads.length === 0 ? (
        <p className="controller-none">
          <Gamepad2 size={20} /> No controller connected. Connect one (wired or Bluetooth) and press a button.
        </p>
      ) : (
        <>
          {pads.length > 1 && bigPicture && (
            <div className="bp-choice bp-controller-listen" role="group" aria-label="Controller Big Picture listens to">
              <button type="button" className="bp-button" data-bp-focus aria-pressed={!chosen} onClick={() => onChoose(null)}>
                Any controller
              </button>
              {pads.map((p) => (
                <button key={p.index} type="button" className="bp-button" data-bp-focus aria-pressed={chosen === p.id} onClick={() => onChoose(p.id)}>
                  {p.id.replace(/\s*\(.*$/, "")}
                </button>
              ))}
            </div>
          )}
          {pads.length > 1 && !bigPicture && (
            <Setting title="Listen to" text="With several controllers connected, Big Picture can answer just one.">
              <select className="select" value={chosen ?? ""} aria-label="Controller Big Picture listens to" onChange={(e) => onChoose(e.target.value || null)}>
                <option value="">Any controller</option>
                {pads.map((p) => (
                  <option key={p.index} value={p.id}>
                    {p.id}
                  </option>
                ))}
              </select>
            </Setting>
          )}
          {pads.map((pad) => {
            const kind = /054c|playstation|dualsense|dualshock|wireless controller/i.test(pad.id) ? "playstation" : "xbox";
            const [lx = 0, ly = 0, rx = 0, ry = 0] = pad.axes;
            return (
              <div key={pad.index} className={`controller-test${chosen && chosen !== pad.id ? " ignored" : ""}`}>
                <strong className="controller-test-name">{pad.id}</strong>
                <div className="controller-test-body">
                  {[
                    [lx, ly, "Left stick"],
                    [rx, ry, "Right stick"],
                  ].map(([x, y, label]) => (
                    <figure key={label as string} className="controller-stick">
                      <span className="controller-stick-pad">
                        <span className="controller-stick-dot" style={{ left: `${50 + (x as number) * 42}%`, top: `${50 + (y as number) * 42}%` }} />
                      </span>
                      <figcaption>
                        {label} · {(x as number).toFixed(2)}, {(y as number).toFixed(2)}
                      </figcaption>
                    </figure>
                  ))}
                  <div className="controller-triggers">
                    {[6, 7].map((i) => (
                      <span key={i} className="controller-trigger">
                        <b>{buttonName(i, kind)}</b>
                        <span className="controller-trigger-track">
                          <span style={{ width: `${Math.round((pad.buttons[i]?.value ?? 0) * 100)}%` }} />
                        </span>
                      </span>
                    ))}
                  </div>
                  <ul className="controller-buttons">
                    {pad.buttons.map((b, i) =>
                      i === 6 || i === 7 ? null : (
                        <li key={i} className={b.pressed ? "down" : undefined}>
                          {buttonName(i, kind)}
                        </li>
                      ),
                    )}
                  </ul>
                </div>
              </div>
            );
          })}
        </>
      )}
    </section>
  );
}

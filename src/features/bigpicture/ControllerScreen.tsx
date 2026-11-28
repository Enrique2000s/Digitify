import { useEffect, useState, type ReactNode } from "react";
import { ArrowLeftRight, Gamepad2, Minus, Plus, RotateCcw } from "lucide-react";
import { usePreferences } from "../../lib/preferences";
import { buttonFor, buttonName, DEFAULT_CONTROLLER, onRawButton, type PadAction } from "../../lib/gamepad";
import { CONTROLLER_ACTIONS, ControllerTest } from "../settings/ControllerSettings";

/** One setting in Big Picture: its name and what it does, its choices beside. */
function Row({ title, text, children }: { title: string; text: string; children: ReactNode }) {
  return (
    <div className="bp-setting">
      <div className="bp-setting-text">
        <strong>{title}</strong>
        <span>{text}</span>
      </div>
      <div className="bp-choice">{children}</div>
    </div>
  );
}

/** A value changed a step at a time with the D-pad: − and + around it. */
function Stepper({ label, value, shown, low, high, step, onChange }: { label: string; value: number; shown: string; low: number; high: number; step: number; onChange: (v: number) => void }) {
  const round = (v: number) => Math.round(v * 100) / 100;
  return (
    <>
      <button type="button" className="bp-button bp-round-button" data-bp-focus aria-label={`Less ${label}`} disabled={value <= low} onClick={() => onChange(round(Math.max(low, value - step)))}>
        <Minus size={22} />
      </button>
      <span className="bp-stepper-value">{shown}</span>
      <button type="button" className="bp-button bp-round-button" data-bp-focus aria-label={`More ${label}`} disabled={value >= high} onClick={() => onChange(round(Math.min(high, value + step)))}>
        <Plus size={22} />
      </button>
    </>
  );
}

/**
 * Settings › Controller inside Big Picture (D-184), made for the controller itself: every choice a
 * button, the sticks' values stepped with − and +, an action's button chosen by pressing it (left
 * as it was after a few seconds without a press), and the live test of each controller.
 */
export function ControllerScreen() {
  const { preferences, update } = usePreferences();
  const c = preferences.controller;
  const set = (patch: Partial<typeof c>) => update((p) => ({ controller: { ...p.controller, ...patch } }));
  const [choosing, setChoosing] = useState<PadAction | null>(null);
  const names = c.glyphs === "auto" ? undefined : c.glyphs;

  // The next button pressed takes the action; none within six seconds leaves it as it was.
  useEffect(() => {
    if (!choosing) return;
    const off = onRawButton((index) => {
      set({ remap: { ...c.remap, [choosing]: index } });
      setChoosing(null);
    });
    const timer = window.setTimeout(() => setChoosing(null), 6000);
    return () => {
      off();
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choosing]);

  return (
    <div className="bp-controller">
      <h1 className="bp-screen-title">
        <Gamepad2 size={36} /> Controller
      </h1>
      <section className="bp-settings-panel">
        <h2>Buttons</h2>
        <Row title="Swap confirm and back" text="Select with B (or ○) and go back with A (or ✕), as on Nintendo-style controllers.">
          <button type="button" className="bp-button" data-bp-focus data-bp-autofocus aria-pressed={c.swapConfirm} onClick={() => set({ swapConfirm: true })}>
            <ArrowLeftRight size={22} /> Swapped
          </button>
          <button type="button" className="bp-button" data-bp-focus aria-pressed={!c.swapConfirm} onClick={() => set({ swapConfirm: false })}>
            Usual
          </button>
        </Row>
        <Row title="Home button opens Big Picture" text="The Xbox or PS button (or Start and Select together) opens Big Picture from anywhere in Digitify.">
          <button type="button" className="bp-button" data-bp-focus aria-pressed={c.homeOpensBigPicture} onClick={() => set({ homeOpensBigPicture: true })}>
            On
          </button>
          <button type="button" className="bp-button" data-bp-focus aria-pressed={!c.homeOpensBigPicture} onClick={() => set({ homeOpensBigPicture: false })}>
            Off
          </button>
        </Row>
        <Row title="Button names" text="The names shown for the buttons: those of the controller in use, or always Xbox's or PlayStation's.">
          {(
            [
              ["auto", "Controller in use"],
              ["xbox", "Xbox"],
              ["playstation", "PlayStation"],
            ] as const
          ).map(([value, label]) => (
            <button key={value} type="button" className="bp-button" data-bp-focus aria-pressed={c.glyphs === value} onClick={() => set({ glyphs: value })}>
              {label}
            </button>
          ))}
        </Row>
        <h3>Each action's button</h3>
        <p className="bp-setting-note">Choose an action, then press the button you want for it (nothing for six seconds leaves it as it was).</p>
        <div className="bp-controller-actions">
          {CONTROLLER_ACTIONS.map(([action, label]) => (
            <button key={action} type="button" className={`bp-button bp-controller-action${choosing === action ? " choosing" : ""}`} data-bp-focus onClick={() => setChoosing(action)}>
              <span>{label}</span>
              <b>{choosing === action ? "Press a button…" : buttonName(buttonFor(action, c), names)}</b>
            </button>
          ))}
        </div>
        <button type="button" className="bp-button bp-more" data-bp-focus disabled={Object.keys(c.remap).length === 0} onClick={() => set({ remap: {} })}>
          <RotateCcw size={22} /> Usual buttons
        </button>
      </section>

      <section className="bp-settings-panel">
        <h2>Sticks</h2>
        <Row title="Dead zone" text="How far a stick moves before it counts. Raise it if the selection drifts by itself.">
          <Stepper label="dead zone" value={c.deadZone} shown={`${Math.round(c.deadZone * 100)}%`} low={0.05} high={0.5} step={0.01} onChange={(deadZone) => set({ deadZone })} />
        </Row>
        <Row title="Scrolling speed" text="How fast the right stick scrolls lists and pages.">
          <Stepper label="scrolling speed" value={c.scrollSpeed} shown={`${c.scrollSpeed.toFixed(2)}×`} low={0.25} high={3} step={0.25} onChange={(scrollSpeed) => set({ scrollSpeed })} />
        </Row>
        <Row title="Invert scrolling" text="Pushing the right stick up scrolls down, and the other way around.">
          <button type="button" className="bp-button" data-bp-focus aria-pressed={c.invertScroll} onClick={() => set({ invertScroll: true })}>
            On
          </button>
          <button type="button" className="bp-button" data-bp-focus aria-pressed={!c.invertScroll} onClick={() => set({ invertScroll: false })}>
            Off
          </button>
        </Row>
        <Row title="Left stick moves the selection" text="As the D-pad does. Off, only the D-pad moves it.">
          <button type="button" className="bp-button" data-bp-focus aria-pressed={c.stickMoves} onClick={() => set({ stickMoves: true })}>
            On
          </button>
          <button type="button" className="bp-button" data-bp-focus aria-pressed={!c.stickMoves} onClick={() => set({ stickMoves: false })}>
            Off
          </button>
        </Row>
        <button type="button" className="bp-button bp-more" data-bp-focus onClick={() => set({ ...DEFAULT_CONTROLLER, pad: c.pad, homeOpensBigPicture: c.homeOpensBigPicture })}>
          <RotateCcw size={22} /> Back to how they were
        </button>
      </section>

      <div className="bp-settings-panel bp-controller-test" data-bp-focus tabIndex={-1}>
        <ControllerTest chosen={c.pad} onChoose={(pad) => set({ pad })} bigPicture />
      </div>
    </div>
  );
}

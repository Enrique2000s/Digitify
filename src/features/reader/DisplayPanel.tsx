import type { CSSProperties } from "react";
import { Popover } from "radix-ui";
import { Sun } from "lucide-react";
import { Switch } from "../../components/common";
import type { ReaderPreferences } from "../../lib/preferences";

const BACKGROUNDS: Record<string, { label: string; css: string }> = {
  night: { label: "Night", css: "radial-gradient(ellipse at 50% 35%, #1b2533 0%, #0b1017 78%)" },
  black: { label: "Black", css: "#000000" },
  gray: { label: "Gray", css: "#3b4048" },
  paper: { label: "Paper", css: "#e8e2d4" },
};

/** The CSS background behind the pages for a background preference. */
export function backgroundCss(background: string): string {
  return BACKGROUNDS[background]?.css ?? background;
}

/** Pages dimmed by the brightness setting, and warmer in night mode. */
export function pageFilter(brightness: number, night: boolean): string {
  const level = (brightness / 100) * (night ? 0.82 : 1);
  return level >= 1 && !night ? "none" : `brightness(${level.toFixed(2)})${night ? " sepia(0.32)" : ""}`;
}

export function BrightnessRow({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  return (
    <div className="type-row">
      <span>Brightness</span>
      <input
        type="range"
        className="panel-slider"
        aria-label="Brightness"
        min={40}
        max={100}
        step={5}
        value={value}
        style={{ "--fill": `${((value - 40) / 60) * 100}%` } as CSSProperties}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  );
}

/** Brightness, night mode and the background behind the pages, for the page reader. */
export function DisplayPanel({ settings, onChange, container, open, onOpenChange }: {
  settings: ReaderPreferences;
  onChange: (change: Partial<ReaderPreferences>) => void;
  container: HTMLElement | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const custom = !BACKGROUNDS[settings.background];
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>
        <button type="button" className="round-btn" aria-label="Display" title="Brightness, night mode and background">
          <Sun size={17} />
        </button>
      </Popover.Trigger>
      <Popover.Portal container={container}>
        <Popover.Content className="menu reader-panel type-panel" align="end" sideOffset={12} collisionPadding={16}>
          <BrightnessRow value={settings.brightness} onChange={(brightness) => onChange({ brightness })} />
          <div className="type-row">
            <span>Night mode</span>
            <Switch checked={settings.night} label="Night mode" onChange={(night) => onChange({ night })} />
          </div>
          <div className="type-row">
            <span>Page turn</span>
            <select
              className="select"
              aria-label="Page turn"
              value={settings.transition}
              onChange={(event) => onChange({ transition: event.target.value as ReaderPreferences["transition"] })}
            >
              <option value="slide">Slide</option>
              <option value="fade">Fade</option>
              <option value="turn">3D turn</option>
              <option value="curl">Page curl (drag a corner too)</option>
              <option value="none">None</option>
            </select>
          </div>
          <div className="type-row">
            <span>Background</span>
            <div className="theme-swatches" role="group" aria-label="Background">
              {Object.entries(BACKGROUNDS).map(([key, background]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={settings.background === key}
                  style={{ background: background.css, color: key === "paper" ? "#2a2722" : "#e9eef3" }}
                  onClick={() => onChange({ background: key })}
                >
                  {background.label}
                </button>
              ))}
              <label className="color-swatch" aria-pressed={custom} title="Your own color">
                <input
                  type="color"
                  aria-label="Your own background color"
                  value={custom ? settings.background : "#2b3a4a"}
                  onChange={(event) => onChange({ background: event.target.value })}
                />
              </label>
            </div>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

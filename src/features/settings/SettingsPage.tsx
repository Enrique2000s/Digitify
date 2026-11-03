import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, Monitor, Moon, Settings, Sun } from "lucide-react";
import { api, errorText } from "../../lib/api";
import { ACCENT_PRESETS } from "../../lib/color";
import { LOOK_ACCENTS, PALETTE_ACCENTS, usePreferences, type Look, type MotionChoice, type Palette, type ThemeChoice } from "../../lib/preferences";
import { keys, libraryChanged, useAppStatus } from "../../lib/queries";
import { CardSizeSlider, Switch } from "../../components/common";
import { ShelfLookPicker } from "../../components/ShelfLookPicker";
import { CategoriesPanel } from "./CategoriesPanel";
import { KeyboardSettings } from "./KeyboardSettings";
import { BackupsPanel } from "./LibraryTools";
import { Setting } from "./Setting";
import { SoundSettings } from "./SoundSettings";
import { OnlineServicesPanel } from "../online/OnlineServices";

const LOOKS: { value: Look; name: string }[] = [
  { value: "breeze", name: "Breeze" },
  { value: "cinematic", name: "Cinematic" },
];
const PALETTES: { value: Palette; name: string }[] = [
  { value: "breeze", name: "Sky" },
  { value: "sunset", name: "Sunset" },
  { value: "midnight", name: "Midnight" },
  { value: "contrast", name: "High contrast" },
];

/** A small picture of a look or palette. */
function LookPreview({ variant }: { variant: string }) {
  return (
    <span className={`look-preview preview-${variant}`} aria-hidden>
      <i />
      <i />
      <i />
    </span>
  );
}

export function SettingsPage() {
  const { preferences, update } = usePreferences();
  const status = useAppStatus();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const custom = !ACCENT_PRESETS.some((preset) => preset.value === preferences.accent);
  const midnight = preferences.look === "breeze" && preferences.palette === "midnight";
  // A look brings its own accent, unless the accent was changed from the previous look's.
  const chooseLook = (look: Look) =>
    update((current) => ({ look, accent: current.accent === LOOK_ACCENTS[current.look] ? LOOK_ACCENTS[look] : current.accent }));
  const choosePalette = (palette: Palette) =>
    update((current) => ({ palette, accent: current.accent === PALETTE_ACCENTS[current.palette] ? PALETTE_ACCENTS[palette] : current.accent }));

  const switchLibrary = async () => {
    const folder = await open({ directory: true, multiple: false, title: "Open or create a library folder" });
    if (typeof folder !== "string") return;
    try {
      const next = await api.libraryChoose(folder);
      queryClient.setQueryData(keys.status, next);
      libraryChanged(queryClient);
    } catch (reason) {
      setError(errorText(reason));
    }
  };

  return (
    <div className="page settings-page">
      <div className="page-header">
        <div className="title-row">
          <span className="title-badge">
            <Settings size={26} strokeWidth={2.2} aria-hidden />
          </span>
          <h1 className="display">Settings</h1>
        </div>
      </div>
      <div className="settings">
        <section className="panel">
          <h2>Appearance</h2>
          <Setting title="Style" text="Breeze is Digitify's own bright, rounded style. Cinematic is darker and film-like, with glassy panels and amber highlights.">
            <div className="look-picker" role="group" aria-label="Style">
              {LOOKS.map((look) => (
                <button key={look.value} type="button" className="look-card" aria-pressed={preferences.look === look.value} onClick={() => chooseLook(look.value)}>
                  <LookPreview variant={look.value} />
                  {look.name}
                </button>
              ))}
            </div>
          </Setting>
          {preferences.look === "breeze" && (
            <Setting title="Palette" text="Breeze's colors. Midnight is always dark, with pure black that suits OLED screens; High contrast makes every edge and word stand out.">
              <div className="look-picker" role="group" aria-label="Palette">
                {PALETTES.map((palette) => (
                  <button key={palette.value} type="button" className="look-card" aria-pressed={preferences.palette === palette.value} onClick={() => choosePalette(palette.value)}>
                    <LookPreview variant={palette.value === "breeze" ? "sky" : palette.value} />
                    {palette.name}
                  </button>
                ))}
              </div>
            </Setting>
          )}
          {/* Midnight is only dark, so there's no theme to pick. */}
          {!midnight && (
          <Setting title="Theme" text="Light by default; night keeps the same layout in darker colors.">
            <div className="segmented" role="group" aria-label="Theme">
              {(
                [
                  ["light", "Light", Sun],
                  ["dark", "Night", Moon],
                  ["system", "System", Monitor],
                ] as const
              ).map(([value, label, Icon]) => (
                <button key={value} type="button" aria-pressed={preferences.theme === value} onClick={() => update({ theme: value as ThemeChoice })}>
                  <Icon size={14} aria-hidden /> {label}
                </button>
              ))}
            </div>
          </Setting>
          )}
          <Setting title="Accent color" text="Used for highlights, glows, buttons and progress. Text stays readable in both themes.">
            <div className="swatches" role="group" aria-label="Accent color">
              {ACCENT_PRESETS.map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  className="swatch"
                  style={{ background: preset.value }}
                  aria-label={preset.name}
                  title={preset.name}
                  aria-pressed={preferences.accent === preset.value}
                  onClick={() => update({ accent: preset.value })}
                />
              ))}
              <label
                className="swatch swatch-custom"
                aria-pressed={custom}
                title="Custom color"
                style={{ background: custom ? preferences.accent : "conic-gradient(red, yellow, lime, aqua, blue, magenta, red)" }}
              >
                <span className="sr-only">Custom color</span>
                <input type="color" value={preferences.accent} onChange={(event) => update({ accent: event.target.value })} />
              </label>
            </div>
          </Setting>
          <Setting title="Animations" text="System follows Windows' “Animation effects” setting.">
            <select className="select" style={{ width: 180 }} value={preferences.motion} onChange={(event) => update({ motion: event.target.value as MotionChoice })}>
              <option value="system">System</option>
              <option value="full">Full</option>
              <option value="reduced">Reduced</option>
              <option value="off">Off</option>
            </select>
          </Setting>
          <Setting
            title="Same view in every category"
            text="The layout (grid, shelf, list, detailed, carousel) and the All / On the shelf / Digital / Not digitized filter stay as you left them everywhere. Turn off to keep a different one per category."
          >
            <Switch checked={preferences.syncViews} label="Same view in every category" onChange={(syncViews) => update({ syncViews })} />
          </Setting>
          <Setting title="Music covers" text="Square covers, or round CDs. Each track can also be set on its own page.">
            <div className="segmented" role="group" aria-label="Music covers">
              {(
                [
                  ["square", "Square"],
                  ["disc", "CD"],
                ] as const
              ).map(([value, label]) => (
                <button key={value} type="button" aria-pressed={preferences.coverShapes.audio === value} onClick={() => update((c) => ({ coverShapes: { ...c.coverShapes, audio: value } }))}>
                  {label}
                </button>
              ))}
            </div>
          </Setting>
          <Setting title="Video covers" text="For Videos: horizontal frames, or vertical posters. Each video can also be set on its own page. Movies & Series always use vertical posters.">
            <div className="segmented" role="group" aria-label="Video covers">
              {(
                [
                  ["landscape", "Horizontal"],
                  ["poster", "Vertical"],
                ] as const
              ).map(([value, label]) => (
                <button key={value} type="button" aria-pressed={preferences.coverShapes.videos === value} onClick={() => update((c) => ({ coverShapes: { ...c.coverShapes, videos: value } }))}>
                  {label}
                </button>
              ))}
            </div>
          </Setting>
          <Setting title="Shelves" text="What the shelves in the shelf view are made of.">
            <ShelfLookPicker />
          </Setting>
          <Setting title="Cover size" text="Width of covers in the grid, shelf and detailed views.">
            <CardSizeSlider value={preferences.cardSize} onChange={(cardSize) => update({ cardSize })} style={{ width: 180 }} />
          </Setting>
        </section>

        <CategoriesPanel />

        <SoundSettings />

        <OnlineServicesPanel />

        <KeyboardSettings />

        <section className="panel">
          <h2>Library</h2>
          <Setting title="Library folder" text={status.data?.libraryPath ?? ""}>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" className="btn" onClick={() => api.libraryReveal().catch((e) => setError(errorText(e)))}>
                <FolderOpen size={16} /> Open
              </button>
              <button type="button" className="btn" onClick={() => void switchLibrary()}>
                Switch library…
              </button>
            </div>
          </Setting>
          {status.data?.cloudSync && (
            <div className="notice warning">
              This library is inside a {status.data.cloudSync} folder. Syncing a live database can corrupt it and uploads your
              library; consider moving the folder outside {status.data.cloudSync}.
            </div>
          )}
          <Setting title="When importing" text="Keep files where they are, or copy them into the library folder.">
            <select className="select" style={{ width: 230 }} value={preferences.importMode} onChange={(event) => update({ importMode: event.target.value as typeof preferences.importMode })}>
              <option value="ask">Ask every time</option>
              <option value="reference">Keep files where they are</option>
              <option value="copy">Copy into library folder</option>
            </select>
          </Setting>
          {error && <div className="dialog-error">{error}</div>}
        </section>

        <BackupsPanel />

        <section className="panel">
          <h2>About</h2>
          <Setting
            title={`Digitify ${status.data?.version ?? ""}`}
            text="Works fully offline. No accounts, no telemetry, and nothing is uploaded. Helper engines: mpv (GPL) and FFmpeg (LGPL), run as separate programs. The ambient theme “Digitify Main Menu Music” is original to Digitify."
          >
            <span />
          </Setting>
          <Setting title="Third-party notices" text="Licenses for the bundled helper engines, fonts and libraries.">
            <button type="button" className="btn" onClick={() => api.noticesReveal().catch((e) => setError(errorText(e)))}>
              Show file
            </button>
          </Setting>
          <Setting title="Developer" text="Phase 0 video lab: mpv playback under the web interface.">
            <Link to="/lab" className="btn">
              Open lab
            </Link>
          </Setting>
        </section>
        <p className="settings-credit">Digitify is free and open source.</p>
      </div>
    </div>
  );
}

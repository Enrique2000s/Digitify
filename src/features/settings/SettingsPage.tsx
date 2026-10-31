import { useState, type CSSProperties } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, Monitor, Moon, Settings, Sun } from "lucide-react";
import { api, errorText } from "../../lib/api";
import { ACCENT_PRESETS } from "../../lib/color";
import { usePreferences, type MotionChoice, type ThemeChoice } from "../../lib/preferences";
import { keys, libraryChanged, useAppStatus } from "../../lib/queries";
import { CategoriesPanel } from "./CategoriesPanel";
import { BackupsPanel } from "./LibraryTools";
import { Setting } from "./Setting";
import { SoundSettings } from "./SoundSettings";

export function SettingsPage() {
  const { preferences, update } = usePreferences();
  const status = useAppStatus();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const custom = !ACCENT_PRESETS.some((preset) => preset.value === preferences.accent);

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
    <div className="page">
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
          <Setting title="Theme" text="Breeze is bright by default; night mode keeps the same layout in darker colors.">
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
          <Setting title="Cover size" text="Width of covers in the grid and shelf views.">
            <input
              type="range"
              min={110}
              max={240}
              value={preferences.cardSize}
              aria-label="Cover size"
              style={{ width: 180, "--fill": `${((preferences.cardSize - 110) / 130) * 100}%` } as CSSProperties}
              onChange={(event) => update({ cardSize: Number(event.target.value) })}
            />
          </Setting>
        </section>

        <CategoriesPanel />

        <SoundSettings />

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
            text="Works fully offline. No accounts, no telemetry, and nothing is uploaded. Helper engines: mpv (GPL) and FFmpeg (LGPL), run as separate programs. The ambient theme “Morning Lounge” is original to Digitify."
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
      </div>
    </div>
  );
}

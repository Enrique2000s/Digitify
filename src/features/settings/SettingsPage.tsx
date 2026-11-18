import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, Monitor, Moon, Settings, Sun } from "lucide-react";
import { api, errorText, onLinux } from "../../lib/api";
import { ACCENT_PRESETS } from "../../lib/color";
import { LOOK_ACCENTS, PALETTE_ACCENTS, SECTION_COLOR_NAMES, SECTION_COLORS, usePreferences, type Look, type MotionChoice, type Palette, type ThemeChoice } from "../../lib/preferences";
import { keys, libraryChanged, useAppStatus } from "../../lib/queries";
import { CardSizeSlider, Switch } from "../../components/common";
import { ShelfLookPicker } from "../../components/ShelfLookPicker";
import { ArcadeSettings } from "./ArcadeSettings";
import { CategoriesPanel } from "./CategoriesPanel";
import { KeyboardSettings } from "./KeyboardSettings";
import { BackupsPanel, WatchedFolders } from "./LibraryTools";
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

/** Starting Digitify when the user signs in (D-047): the system's own startup entry is the setting. */
function StartWithComputer() {
  const queryClient = useQueryClient();
  const enabled = useQuery({ queryKey: ["autostart"], queryFn: api.autostartGet });
  const [error, setError] = useState<string | null>(null);
  return (
    <Setting
      title="Start with your computer"
      text={error ?? "Digitify opens by itself when you sign in to your computer. Off by default."}
    >
      <Switch
        checked={enabled.data ?? false}
        label="Start with your computer"
        onChange={(on) => {
          setError(null);
          api
            .autostartSet(on)
            .then((now) => queryClient.setQueryData(["autostart"], now))
            .catch((reason) => setError(errorText(reason)));
        }}
      />
    </Setting>
  );
}

/** The readers' night filter (D-069): how warm, and an optional schedule. */
function NightFilterSetting() {
  const { preferences, update } = usePreferences();
  const filter = preferences.nightFilter;
  const set = (patch: Partial<typeof filter>) => update({ nightFilter: { ...filter, ...patch } });
  return (
    <Setting
      title="Night reading filter"
      text="A warm tone over the pages of books and comics, easier on the eyes at night. Turn it on or off from the moon-and-sun button while reading, or let it come on by itself in these hours."
    >
      <div className="night-setting">
        <label className="night-row">
          <span>Warmth</span>
          <input type="range" min={10} max={80} step={5} value={filter.strength} aria-label="Warmth" onChange={(event) => set({ strength: Number(event.target.value) })} />
        </label>
        <div className="night-row">
          <Switch checked={filter.schedule} label="On by itself" onChange={(schedule) => set({ schedule })} />
          <span>On by itself from</span>
          <input className="input night-time" type="time" value={filter.from} disabled={!filter.schedule} aria-label="From" onChange={(event) => event.target.value && set({ from: event.target.value })} />
          <span>to</span>
          <input className="input night-time" type="time" value={filter.to} disabled={!filter.schedule} aria-label="To" onChange={(event) => event.target.value && set({ to: event.target.value })} />
        </div>
      </div>
    </Setting>
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
          {preferences.look === "breeze" && (
            <Setting title="Colors per section" text="Each section gets a color of its own, used for its highlights while you're in it: Arcade purple, Music green… Off, everything uses your accent color.">
              <Switch
                checked={preferences.sectionColors.enabled}
                label="Colors per section"
                onChange={(enabled) => update((c) => ({ sectionColors: { ...c.sectionColors, enabled } }))}
              />
            </Setting>
          )}
          {preferences.look === "breeze" && preferences.sectionColors.enabled && (
            <div className="section-colors">
              {Object.keys(SECTION_COLORS).map((key) => (
                <label key={key} className="section-color">
                  <input
                    type="color"
                    value={preferences.sectionColors.colors[key]}
                    aria-label={`${SECTION_COLOR_NAMES[key]} color`}
                    onChange={(event) => {
                      const color = event.target.value;
                      update((c) => ({ sectionColors: { ...c.sectionColors, colors: { ...c.sectionColors.colors, [key]: color } } }));
                    }}
                  />
                  <span>{SECTION_COLOR_NAMES[key]}</span>
                </label>
              ))}
              <button type="button" className="btn btn-sm" onClick={() => update((c) => ({ sectionColors: { ...c.sectionColors, colors: { ...SECTION_COLORS } } }))}>
                Default colors
              </button>
            </div>
          )}
          <Setting
            title="Animations"
            text={`Transitions when you change category, view, filter or sort, covers popping into place, sections fading in. ${onLinux ? "“Follow the system” uses your desktop's reduce-animations setting" : "“Follow Windows” uses its “Animation effects” setting"}; “Reduced” keeps only gentle fades.`}
          >
            <select className="select" style={{ width: 230 }} value={preferences.motion} onChange={(event) => update({ motion: event.target.value as MotionChoice })}>
              <option value="system">{onLinux ? "On (follow the system)" : "On (follow Windows)"}</option>
              <option value="full">On</option>
              <option value="reduced">Reduced</option>
              <option value="off">Off</option>
            </select>
          </Setting>
          <Setting
            title="Light mode for slower computers"
            text="Turns off blurred backgrounds, reflections, heavy shadows, glows and animations, and draws fewer covers ahead, so Digitify stays smooth on older or low-power PCs."
          >
            <Switch checked={preferences.lightMode} label="Light mode for slower computers" onChange={(lightMode) => update({ lightMode })} />
          </Setting>
          <Setting
            title="Same view in every category"
            text="The layout (grid, shelf, list, detailed, carousel) and the All / Digital / Online filter stay as you left them everywhere. Turn off to keep a different one per category."
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
          <Setting title="Shelf view" text="What the shelves in the shelf view are made of.">
            <ShelfLookPicker />
          </Setting>
          <StartWithComputer />
          <Setting
            title="Keep running in the tray when closed"
            text="Closing the window leaves Digitify by the clock, where its icon shows what's playing and plays, pauses or skips; the music keeps going. Quit it from the icon's menu. Started with your computer, it then starts there."
          >
            <Switch checked={preferences.closeToTray} label="Keep running in the tray when closed" onChange={(closeToTray) => update({ closeToTray })} />
          </Setting>
          <Setting title="Offer to continue when opening" text="When Digitify opens, a small notice offers the book, comic, film, series or game you left halfway lately.">
            <Switch checked={preferences.resumeOnOpen} label="Offer to continue when opening" onChange={(resumeOnOpen) => update({ resumeOnOpen })} />
          </Setting>
          <NightFilterSetting />
          <Setting title="Open maximized" text="Digitify fills the screen when it opens. Off, it opens at its regular size (it can still be maximized from the title bar).">
            <Switch checked={preferences.startMaximized} label="Open maximized" onChange={(startMaximized) => update({ startMaximized })} />
          </Setting>
          <Setting title="Cover size" text="Width of covers in the grid, shelf and detailed views.">
            <CardSizeSlider value={preferences.cardSize} onChange={(cardSize) => update({ cardSize })} style={{ width: 180 }} />
          </Setting>
        </section>

        <CategoriesPanel />

        <ArcadeSettings />

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
          <WatchedFolders />
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

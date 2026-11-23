import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { BackButton } from "../../components/BackButton";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, Monitor, Moon, ScrollText, Settings, Sun, RefreshCw } from "lucide-react";
import { openWhatsNew, checkForUpdate } from "../app/AppDialogs";
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
  { value: "aero", name: "Frutiger Aero" },
  { value: "minimal", name: "Minimal" },
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

/** Settings' tabs (D-121). */
export const SETTINGS_TABS = [
  ["general", "General"],
  ["library", "Library"],
  ["arcade", "Arcade"],
  ["sound", "Sound"],
  ["keyboard", "Keyboard"],
  ["about", "About"],
] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number][0];

export function SettingsPage() {
  const search = useSearch({ from: "/settings" });
  const navigate = useNavigate();
  const tab: SettingsTab = SETTINGS_TABS.some(([key]) => key === search.tab) ? (search.tab as SettingsTab) : "general";
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
      <BackButton />
      <div className="page-header">
        <div className="title-row">
          <span className="title-badge">
            <Settings size={26} strokeWidth={2.2} aria-hidden />
          </span>
          <h1 className="display">Settings</h1>
        </div>
      </div>
      {/* Settings in tabs (D-121), one subject each; the address says which, so links can open one. */}
      <div className="segmented settings-tabs" role="tablist" aria-label="Settings">
        {SETTINGS_TABS.map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} aria-pressed={tab === key} onClick={() => void navigate({ to: "/settings", search: { tab: key }, replace: true })}>
            {label}
          </button>
        ))}
      </div>
      <div className="settings">
        {tab === "general" && (
          <>
            <section className="panel">
              <h2>Appearance</h2>
              <Setting title="Style" text="Breeze is Digitify's own bright, rounded style. Cinematic is darker and film-like, with glassy panels and amber highlights. Frutiger Aero is sky, water and glass, with glossy aqua buttons. Minimal is calm and flat, like a game launcher.">
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
              <Setting title="Theme" text="Night by default; light keeps the same layout in brighter colors, or follow your system.">
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
                title="Performance mode for slower computers"
                text="Turns off blurred backgrounds, reflections, heavy shadows, glows and animations, and draws fewer covers ahead, so Digitify stays smooth on older or low-power PCs."
              >
                <Switch checked={preferences.lightMode} label="Performance mode for slower computers" onChange={(lightMode) => update(lightMode ? { lightMode } : { lightMode, autoLightMode: false })} />
              </Setting>
              <Setting
                title="Turn performance mode on by itself"
                text="When this computer struggles to keep up with Digitify's effects, performance mode turns on by itself and a notice says so. Turning performance mode off by hand stops this."
              >
                <Switch checked={preferences.autoLightMode} label="Turn performance mode on by itself" onChange={(autoLightMode) => update({ autoLightMode })} />
              </Setting>
            </section>

            <section className="panel">
              <h2>Window and startup</h2>
              <StartWithComputer />
              <Setting title="Open maximized" text="Digitify fills the screen when it opens. Off, it opens at its regular size (it can still be maximized from the title bar).">
                <Switch checked={preferences.startMaximized} label="Open maximized" onChange={(startMaximized) => update({ startMaximized })} />
              </Setting>
              <Setting
                title="Keep running in the tray when closed"
                text="Closing the window leaves Digitify by the clock, quiet: the music and videos pause until you open it again, and then the music goes on. Its icon can still play, pause or skip, and quits Digitify from its menu. Started with your computer, it then starts there."
              >
                <Switch checked={preferences.closeToTray} label="Keep running in the tray when closed" onChange={(closeToTray) => update({ closeToTray })} />
              </Setting>
              <Setting
                title="Hold the X to quit"
                text={preferences.closeToTray ? "With Digitify kept in the tray, holding the window's X for a moment quits it outright; a ring fills around the X while you hold it. A click still only hides the window." : "Only with “Keep running in the tray when closed” on: then holding the window's X quits Digitify outright."}
              >
                <Switch checked={preferences.holdToQuit} label="Hold the X to quit" onChange={(holdToQuit) => update({ holdToQuit })} />
              </Setting>
              <Setting
                title="Ask before closing"
                text={preferences.closeToTray ? "Not needed while Digitify keeps running in the tray: closing the window only hides it." : "Closing the window quits Digitify, so it asks first, in case the X was clicked by mistake."}
              >
                <Switch checked={preferences.confirmClose} label="Ask before closing" onChange={(confirmClose) => update({ confirmClose })} />
              </Setting>
              <Setting title="Offer to continue when opening" text="When Digitify opens, a small notice offers the book, comic, film, series or game you left halfway lately.">
                <Switch checked={preferences.resumeOnOpen} label="Offer to continue when opening" onChange={(resumeOnOpen) => update({ resumeOnOpen })} />
              </Setting>
              <Setting title="Show what's new after updates" text="After Digitify is updated, a short note says what's new and what was fixed. It can always be seen in About.">
                <Switch checked={preferences.whatsNew.show} label="Show what's new after updates" onChange={(show) => update((c) => ({ whatsNew: { ...c.whatsNew, show } }))} />
              </Setting>
            </section>
          </>
        )}
        {tab === "library" && (
          <>
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
              <CategoriesPanel embedded />
              <h3 className="settings-subhead">Views</h3>
              <Setting title="Show Everything" text="A view of the whole library at once in Library, on Home, in Big Picture and in the command palette. Off, everything stays in its own category.">
                <Switch checked={preferences.showEverything} label="Show Everything" onChange={(showEverything) => update({ showEverything })} />
              </Setting>
              <Setting
                title="Same view in every category"
                text="The layout (grid, shelf, list, detailed, carousel) and the All / Digital / Online filter stay as you left them everywhere. Turn off to keep a different one per category."
              >
                <Switch checked={preferences.syncViews} label="Same view in every category" onChange={(syncViews) => update({ syncViews })} />
              </Setting>
              <Setting title="Cover size" text="Width of covers in the grid, shelf and detailed views.">
                <CardSizeSlider value={preferences.cardSize} onChange={(cardSize) => update({ cardSize })} style={{ width: 180 }} />
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
              <Setting title="Video covers" text="For Videos: horizontal frames, or vertical posters. Each video can also be set on its own page.">
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
              <Setting title="Movies & Series covers" text="Horizontal, or vertical posters. Each movie or series can also be set on its own page; episodes are always horizontal.">
                <div className="segmented" role="group" aria-label="Movies & Series covers">
                  {(
                    [
                      ["landscape", "Horizontal"],
                      ["poster", "Vertical"],
                    ] as const
                  ).map(([value, label]) => (
                    <button key={value} type="button" aria-pressed={preferences.coverShapes.films === value} onClick={() => update((c) => ({ coverShapes: { ...c.coverShapes, films: value } }))}>
                      {label}
                    </button>
                  ))}
                </div>
              </Setting>
              <Setting title="Shelf view" text="What the shelves in the shelf view are made of.">
                <ShelfLookPicker />
              </Setting>
              <h3 className="settings-subhead">Importing</h3>
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

            <section className="panel">
              <h2>Watching</h2>
              <Setting
                title="Back keeps the video playing"
                text={
                  preferences.videoBackToCorner
                    ? "The player's Back leaves the video playing small in a corner while you browse; close it from there."
                    : "The player's Back closes the video; the button next to it keeps it playing in a corner while you browse."
                }
              >
                <Switch checked={preferences.videoBackToCorner} label="Back keeps the video playing" onChange={(videoBackToCorner) => update({ videoBackToCorner })} />
              </Setting>
            </section>

            <section className="panel">
              <h2>Reading</h2>
              <NightFilterSetting />
            </section>

            <OnlineServicesPanel />

            <BackupsPanel />
          </>
        )}
        {tab === "arcade" && (
          <>
            <ArcadeSettings />
          </>
        )}
        {tab === "sound" && (
          <>
            <SoundSettings />
          </>
        )}
        {tab === "keyboard" && (
          <>
            <KeyboardSettings />
          </>
        )}
        {tab === "about" && (
          <>
            <section className="panel">
              <h2>About</h2>
              <Setting
                title={`Digitify ${status.data?.version ?? ""}`}
                text="A home for all your media (Library) and a universal launcher for your games (Arcade). Works fully offline. No accounts, no telemetry, and nothing is uploaded; it goes online only for what you ask (links, covers) and, unless turned off below, to see on GitHub whether there's a newer version. Helper engines: mpv (GPL) and FFmpeg (LGPL), run as separate programs. The ambient theme “Digitify Main Menu Music” is original to Digitify."
              >
                <span />
              </Setting>
              <Setting title="Check for updates when Digitify starts" text="A moment after it opens, Digitify asks GitHub whether there's a newer version (nothing about you or your library is sent) and, if there is, offers to install it.">
                <Switch checked={preferences.updates.check} label="Check for updates when Digitify starts" onChange={(check) => update((c) => ({ updates: { ...c.updates, check } }))} />
              </Setting>
              <Setting title="Check now" text={preferences.updates.skipped ? `Looks for a newer version right away (${preferences.updates.skipped} was skipped; Check now offers it again).` : "Looks for a newer version right away."}>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    update((c) => ({ updates: { ...c.updates, skipped: null } }));
                    checkForUpdate();
                  }}
                >
                  <RefreshCw size={16} /> Check now
                </button>
              </Setting>
              <Setting title="What's new" text="What changed in this version and the ones before: new things and fixes.">
                <button type="button" className="btn" onClick={openWhatsNew}>
                  <ScrollText size={16} /> What's new
                </button>
              </Setting>
              <Setting title="Third-party notices" text="Licenses for the bundled helper engines, fonts and libraries.">
                <button type="button" className="btn" onClick={() => api.noticesReveal().catch((e) => setError(errorText(e)))}>
                  Show file
                </button>
              </Setting>
            </section>
            {/* Where Digitify lives (D-172): its page, its releases, its license (MIT). */}
            <p className="settings-credit">
              Digitify is free and open source (MIT).{" "}
              <button type="button" className="link-button" onClick={() => void api.repositoryOpen().catch((e) => setError(errorText(e)))}>
                Digitify on GitHub
              </button>
            </p>
          </>
        )}
      </div>
    </div>
  );
}

import { useEffect, useState, type ComponentType } from "react";
import { listen } from "@tauri-apps/api/event";
import { getVersion } from "@tauri-apps/api/app";
import { Dialog as RadixDialog } from "radix-ui";
import { BookmarkCheck, ChartColumn, Check, Download, Gamepad2, Image as ImageIcon, LibraryBig, MonitorSmartphone, Music, Power, Search, ShieldCheck, Wrench, X, type LucideProps } from "lucide-react";
import { api } from "../../lib/api";
import { usePreferences } from "../../lib/preferences";
import { notesSince, RELEASE_NOTES, type ReleaseNote } from "../../lib/releaseNotes";
import { Logo } from "../../components/common";
import { useDashboard } from "../../lib/queries";

/**
 * Closing the window quits Digitify when it isn't kept in the tray, so it asks first (D-080): a
 * stray click on the X doesn't close it. "Don't ask again" turns the question off (Settings ›
 * Window and startup turns it back on).
 */
export function CloseConfirm() {
  const { preferences } = usePreferences();
  const [open, setOpen] = useState(false);
  const [dontAsk, setDontAsk] = useState(false);
  useEffect(() => {
    const off = listen("close-asked", () => {
      setDontAsk(false);
      setOpen(true);
    });
    return () => void off.then((f) => f());
  }, []);
  const quit = async () => {
    if (dontAsk) await api.preferencesSet({ ...preferences, confirmClose: false }).catch(() => {});
    await api.appQuit();
  };
  return (
    <RadixDialog.Root open={open} onOpenChange={setOpen}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="dialog-overlay" />
        <RadixDialog.Content className="dialog close-confirm" aria-describedby={undefined}>
          <span className="close-confirm-icon" aria-hidden>
            <Power size={26} strokeWidth={2.4} />
          </span>
          <RadixDialog.Title className="dialog-title">Close Digitify?</RadixDialog.Title>
          <p className="close-confirm-text">Anything playing stops. To keep it running by the clock instead, turn on “Keep running in the tray when closed” in Settings.</p>
          <label className="checkbox close-confirm-check">
            <input type="checkbox" checked={dontAsk} onChange={(e) => setDontAsk(e.target.checked)} /> Don't ask again
          </label>
          <div className="close-confirm-actions">
            <button type="button" className="btn" data-autofocus onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="button" className="btn btn-danger solid" onClick={() => void quit()}>
              Close Digitify
            </button>
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

const ICONS: Record<string, ComponentType<LucideProps>> = {
  gamepad: Gamepad2,
  music: Music,
  image: ImageIcon,
  library: LibraryBig,
  search: Search,
  bookmark: BookmarkCheck,
  chart: ChartColumn,
  monitor: MonitorSmartphone,
  shield: ShieldCheck,
  download: Download,
};

const longDate = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });

/** Opens What's new from anywhere (Settings › About). */
export const openWhatsNew = () => window.dispatchEvent(new Event("digitify:whats-new"));

/**
 * What's new (D-081): after an update, the new version's notes once: what's new and what was fixed,
 * with its number and date. "Don't show these again" turns them off for later updates; Settings ›
 * About shows them any time.
 */
export function WhatsNew() {
  const { preferences, update } = usePreferences();
  const dashboard = useDashboard();
  const [version, setVersion] = useState<string | null>(null);
  const [notes, setNotes] = useState<ReleaseNote[] | null>(null);
  const [dontShow, setDontShow] = useState(false);

  useEffect(() => {
    void getVersion().then(setVersion).catch(() => {});
    const onOpen = () => {
      setDontShow(!preferences.whatsNew.show);
      setNotes(RELEASE_NOTES);
    };
    window.addEventListener("digitify:whats-new", onOpen);
    return () => window.removeEventListener("digitify:whats-new", onOpen);
  }, [preferences.whatsNew.show]);

  // Once per new version, a moment after the window opens.
  const totals = dashboard.data?.totals.items;
  useEffect(() => {
    if (!version || totals === undefined) return;
    const { seen, show } = preferences.whatsNew;
    if (seen === version) return;
    // A brand-new library (just installed) has nothing to catch up on: remember the version quietly.
    if (!show || (seen === null && totals === 0)) {
      update((c) => ({ whatsNew: { ...c.whatsNew, seen: version } }));
      return;
    }
    const since = notesSince(seen, version);
    const t = window.setTimeout(() => (since.length ? setNotes(since) : update((c) => ({ whatsNew: { ...c.whatsNew, seen: version } }))), 1500);
    return () => window.clearTimeout(t);
  }, [version, totals, preferences.whatsNew, update]);

  const close = () => {
    setNotes(null);
    update((c) => ({ whatsNew: { show: !dontShow, seen: version ?? c.whatsNew.seen } }));
  };
  if (!notes || notes.length === 0) return null;
  return (
    <RadixDialog.Root open onOpenChange={(o) => !o && close()}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="dialog-overlay" />
        <RadixDialog.Content className="dialog whats-new" aria-describedby={undefined}>
          <header className="whats-new-head">
            <Logo size={46} />
            <div>
              <RadixDialog.Title className="whats-new-title">What's new in Digitify</RadixDialog.Title>
              <span className="whats-new-version">
                Version {notes[0].version} · {longDate(notes[0].date)}
              </span>
            </div>
            <RadixDialog.Close className="icon-btn whats-new-close" aria-label="Close">
              <X size={18} />
            </RadixDialog.Close>
          </header>
          <div className="whats-new-body">
            {notes.map((note, i) => (
              <section key={note.version} className="whats-new-release">
                {i > 0 && (
                  <h3 className="whats-new-older">
                    Version {note.version} · {longDate(note.date)}
                  </h3>
                )}
                {note.added.length > 0 && (
                <ul className="whats-new-list">
                  {note.added.map((item) => {
                    const Icon = ICONS[item.icon] ?? Check;
                    return (
                      <li key={item.title}>
                        <span className="whats-new-icon" aria-hidden>
                          <Icon size={19} strokeWidth={2.3} />
                        </span>
                        <div>
                          <strong>{item.title}</strong>
                          <p>{item.text}</p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
                )}
                {note.fixed.length > 0 && (
                  <div className="whats-new-fixed">
                    <h4>
                      <Wrench size={15} aria-hidden /> Fixed
                    </h4>
                    <ul>
                      {note.fixed.map((fix) => (
                        <li key={fix}>
                          <Check size={14} aria-hidden /> {fix}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>
            ))}
          </div>
          <footer className="whats-new-foot">
            <label className="checkbox">
              <input type="checkbox" checked={dontShow} onChange={(e) => setDontShow(e.target.checked)} /> Don't show these after updates
            </label>
            <button type="button" className="btn btn-primary" onClick={close}>
              Got it
            </button>
          </footer>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

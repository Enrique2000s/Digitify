import { useEffect, useState, type ComponentType } from "react";
import { useRouterState } from "@tanstack/react-router";
import { listen } from "@tauri-apps/api/event";
import { getVersion } from "@tauri-apps/api/app";
import { Dialog as RadixDialog } from "radix-ui";
import { BookmarkCheck, ChartColumn, Check, Download, Gamepad2, Image as ImageIcon, LibraryBig, MonitorSmartphone, Music, Power, Search, ShieldCheck, Wrench, X, type LucideProps, Film } from "lucide-react";
import { api, errorText, type AppUpdate } from "../../lib/api";
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
  film: Film,
};

const longDate = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });

/** Asks for a newer version from anywhere (Settings › About › Check now); the popup answers. */
export const checkForUpdate = () => window.dispatchEvent(new Event("digitify:check-update"));

/** The quiet check runs once per start, even if the popup's place is drawn again (Big Picture and back). */
let checkedThisStart = false;

const megabytes = (bytes: number) => `${(bytes / 1e6).toFixed(bytes > 1e8 ? 0 : 1)} MB`;

/**
 * Updates (D-181). A while after Digitify opens, it asks GitHub quietly whether there's a newer
 * version (unless turned off in Settings › About); if there is, and it wasn't skipped, this asks,
 * but never over a book, a video, a picture or Big Picture: it waits until those are closed.
 * Update downloads and checks this computer's file, then installs it; Later asks again next time;
 * Skip this version stays quiet until a newer one. Check now (in About) asks at once and says so
 * when this is the newest.
 */
export function UpdateDialog() {
  const { preferences, update: setPreferences } = usePreferences();
  const busyScreen = useRouterState({ select: (s) => /^\/(read|watch|view|disc|bp)\b/.test(s.location.pathname) });
  const [offer, setOffer] = useState<AppUpdate | null>(null);
  const [state, setState] = useState<"ask" | "downloading" | "installing" | "error" | "latest">("ask");
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState<string | null>(null);

  // Once per start, quietly, a while after the window opens (after What's new, if it shows).
  useEffect(() => {
    if (checkedThisStart || !preferences.updates.check) return;
    checkedThisStart = true;
    const t = window.setTimeout(() => {
      void api
        .updateCheck(false)
        .then((found) => {
          if (found && found.version !== preferences.updates.skipped) {
            setState("ask");
            setOffer(found);
          }
        })
        .catch(() => {});
    }, 8000);
    return () => window.clearTimeout(t);
  }, [preferences.updates.check, preferences.updates.skipped]);

  // Check now: at once, and it says so either way.
  useEffect(() => {
    const onCheck = () => {
      void api
        .updateCheck(true)
        .then((found) => {
          setMessage(null);
          setState(found ? "ask" : "latest");
          setOffer(found ?? ({ version: "", current: "" } as AppUpdate));
        })
        .catch((e) => {
          setState("error");
          setMessage(errorText(e));
          setOffer({ version: "", current: "" } as AppUpdate);
        });
    };
    window.addEventListener("digitify:check-update", onCheck);
    return () => window.removeEventListener("digitify:check-update", onCheck);
  }, []);

  useEffect(() => {
    const off = listen<{ received: number; total: number }>("update-progress", (e) => setProgress(e.payload.total ? e.payload.received / e.payload.total : 0));
    return () => void off.then((f) => f());
  }, []);

  const install = async () => {
    if (!offer) return;
    setState("downloading");
    setProgress(0);
    setMessage(null);
    try {
      const path = await api.updateDownload(offer);
      setState("installing");
      await api.updateInstall(path);
      // Arch: the terminal does the rest; elsewhere Digitify has closed by now.
      if (offer.kind === "arch") setMessage("The installer is running in a terminal. When it's done, open Digitify again.");
    } catch (e) {
      setState("error");
      setMessage(errorText(e));
    }
  };
  const close = () => {
    if (state === "downloading" || state === "installing") return;
    setOffer(null);
  };
  const skip = () => {
    if (offer) setPreferences((c) => ({ updates: { ...c.updates, skipped: offer.version } }));
    setOffer(null);
  };

  if (!offer || (busyScreen && state === "ask")) return null;
  const working = state === "downloading" || state === "installing";
  return (
    <RadixDialog.Root open onOpenChange={(o) => !o && close()}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="dialog-overlay" />
        <RadixDialog.Content className="dialog whats-new update-dialog" aria-describedby={undefined} onEscapeKeyDown={(e) => working && e.preventDefault()} onInteractOutside={(e) => working && e.preventDefault()}>
          <header className="whats-new-head">
            <Logo size={46} />
            <div>
              <RadixDialog.Title className="whats-new-title">{offer.version ? `Digitify ${offer.version} is available` : state === "latest" ? "Digitify is up to date" : "Couldn't check for updates"}</RadixDialog.Title>
              {offer.version ? (
                <span className="whats-new-version">
                  You have {offer.current} · {megabytes(offer.size)} to download
                </span>
              ) : null}
            </div>
            {!working && (
              <RadixDialog.Close className="icon-btn whats-new-close" aria-label="Close">
                <X size={18} />
              </RadixDialog.Close>
            )}
          </header>
          <div className="whats-new-body update-body">
            {state === "latest" && <p>This is the newest version.</p>}
            {state === "ask" && (
              <p>
                {offer.kind === "windows"
                  ? "Digitify downloads it, closes, installs it and opens again by itself. Your library and settings stay as they are."
                  : offer.kind === "appImage"
                    ? "Digitify downloads the new AppImage, puts it in place of this one and opens again. Your library and settings stay as they are."
                    : offer.kind === "deb"
                      ? "Digitify downloads the new package and installs it; your system asks for your password. Your library and settings stay as they are."
                      : "Digitify downloads the new package and its installer, which runs in a terminal and asks for your password. Your library and settings stay as they are."}{" "}
                What's new shows once it's updated.
              </p>
            )}
            {working && (
              <div className="update-progress" role="status">
                <span>{state === "downloading" ? `Downloading… ${Math.round(progress * 100)}%` : "Checking and installing…"}</span>
                <div className="update-bar">
                  <span style={{ width: `${Math.round((state === "installing" ? 1 : progress) * 100)}%` }} />
                </div>
              </div>
            )}
            {message && <p className={state === "error" ? "update-error" : undefined}>{message}</p>}
          </div>
          <footer className="whats-new-foot">
            {offer.version && !working ? (
              <button type="button" className="link-button" onClick={() => void api.updatePageOpen(offer.page).catch(() => {})}>
                See its release page
              </button>
            ) : (
              <span />
            )}
            <div className="update-actions">
              {offer.version && state !== "installing" && state !== "downloading" && (
                <>
                  <button type="button" className="btn" onClick={skip}>
                    Skip this version
                  </button>
                  <button type="button" className="btn" onClick={close}>
                    Later
                  </button>
                  <button type="button" className="btn btn-primary" onClick={() => void install()}>
                    <Download size={16} /> {state === "error" ? "Try again" : "Update"}
                  </button>
                </>
              )}
              {!offer.version && (
                <button type="button" className="btn btn-primary" onClick={close}>
                  OK
                </button>
              )}
            </div>
          </footer>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

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

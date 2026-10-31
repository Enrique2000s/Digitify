import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ChevronLeft, ChevronRight, Disc3, Gamepad2, House, LibraryBig, Search, Settings } from "lucide-react";
import { enterBigPicture } from "../lib/bigpicture";
import { Logo } from "./common";
import { MiniPlayer } from "./MiniPlayer";
import { MusicPill } from "./MusicPill";
import { useMusic } from "../lib/music/MusicProvider";
import { useDiscs } from "../lib/discs";
import { usePreferences } from "../lib/preferences";
import { comboLabel, keysFor } from "../lib/shortcuts";

const appWindow = getCurrentWindow();

/** Minimize, maximize/restore and close, as round gel buttons (the window has no system frame). */
export function WindowButtons() {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    const update = () => void appWindow.isMaximized().then(setMaximized);
    update();
    const unlisten = appWindow.onResized(update);
    return () => {
      void unlisten.then((stop) => stop());
    };
  }, []);
  return (
    <div className="window-buttons">
      <button type="button" className="round-btn" aria-label="Minimize" title="Minimize" onClick={() => void appWindow.minimize()}>
        <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round">
          <path d="M6 12h12" />
        </svg>
      </button>
      <button
        type="button"
        className="round-btn"
        aria-label={maximized ? "Restore" : "Maximize"}
        title={maximized ? "Restore" : "Maximize"}
        onClick={() => void appWindow.toggleMaximize()}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="round">
          {maximized ? <path d="M9 4h11v11M4 9h11v11H4z" /> : <path d="M6 6h12v12H6z" />}
        </svg>
      </button>
      <button type="button" className="round-btn close" aria-label="Close" title="Close" onClick={() => void appWindow.close()}>
        <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round">
          <path d="M7 7l10 10M17 7 7 17" />
        </svg>
      </button>
    </div>
  );
}

/** The header capsule: brand (home), history, library search, ambient music, settings and window controls. */
export function TitleBar({ searchEnabled }: { searchEnabled: boolean }) {
  const navigate = useNavigate();
  const music = useMusic();
  const { preferences } = usePreferences();
  const searchKey = keysFor("app.search", preferences.shortcuts)[0];
  const { drives } = useDiscs();
  const discIn = drives.some((drive) => drive.media);
  const location = useRouterState({ select: (state) => state.location });
  const urlQuery = location.pathname === "/search" ? String((location.search as { q?: string }).q ?? "") : "";
  const [query, setQuery] = useState(urlQuery);
  const input = useRef<HTMLInputElement>(null);
  const timer = useRef(0);

  useEffect(() => setQuery(urlQuery), [urlQuery]);

  // The "Search the library" shortcut (Ctrl+F unless changed) focuses the search.
  useEffect(() => {
    const focus = () => {
      input.current?.focus();
      input.current?.select();
    };
    window.addEventListener("digitify:search", focus);
    return () => window.removeEventListener("digitify:search", focus);
  }, []);

  const search = (text: string, immediate = false) => {
    setQuery(text);
    window.clearTimeout(timer.current);
    const go = () => {
      const q = text.trim();
      if (q) void navigate({ to: "/search", search: { q }, replace: location.pathname === "/search" });
    };
    if (immediate) go();
    else timer.current = window.setTimeout(go, 250);
  };

  return (
    <header className="appbar" data-tauri-drag-region>
      <div className="appbar-pill" data-tauri-drag-region>
        <Link to="/" className="brand" aria-label="Home" title="Home">
          <Logo size={34} />
          <span aria-hidden>Digitify</span>
        </Link>
        <div className="history">
          <button type="button" className="round-btn" aria-label="Back" title="Back" onClick={() => window.history.back()}>
            <ChevronLeft size={19} strokeWidth={2.6} />
          </button>
          <button type="button" className="round-btn" aria-label="Forward" title="Forward" onClick={() => window.history.forward()}>
            <ChevronRight size={19} strokeWidth={2.6} />
          </button>
        </div>
        {searchEnabled && (
          // Home and Library, as in Big Picture (the search box is right next to them).
          <nav className="appbar-nav" aria-label="Go to">
            <Link to="/" className="appbar-nav-item" aria-current={location.pathname === "/" ? "page" : undefined}>
              <House size={16} strokeWidth={2.5} aria-hidden /> <span className="appbar-nav-label">Home</span>
            </Link>
            <Link
              to="/library/$scope"
              params={{ scope: "all" }}
              className="appbar-nav-item"
              aria-current={/^\/(library|shelves|shelf|tags|tag|item)\b/.test(location.pathname) ? "page" : undefined}
            >
              <LibraryBig size={16} strokeWidth={2.5} aria-hidden /> <span className="appbar-nav-label">Library</span>
            </Link>
          </nav>
        )}
        {searchEnabled && (
          <label className="search-pill">
            <Search size={17} strokeWidth={2.6} aria-hidden />
            <span className="sr-only">Search your library</span>
            <input
              ref={input}
              type="search"
              placeholder="Search your collection"
              value={query}
              onChange={(event) => search(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && search(query, true)}
            />
            {searchKey && <kbd>{comboLabel(searchKey).replace(/ \+ /g, " ")}</kbd>}
          </label>
        )}
        <div className="appbar-drag" data-tauri-drag-region />
        {music.active ? <MiniPlayer /> : <MusicPill />}
        {searchEnabled && (
          <button
            type="button"
            className="round-btn"
            aria-label="Big Picture"
            title="Big Picture (full screen, for a controller and the TV)"
            onClick={() => void enterBigPicture(() => void navigate({ to: "/bp" }))}
          >
            <Gamepad2 size={18} strokeWidth={2.4} />
          </button>
        )}
        {searchEnabled && drives.length > 0 && (
          <Link to="/discs" className={`round-btn disc-button${discIn ? " has-disc" : ""}`} aria-label={discIn ? "Discs (a disc is in)" : "Discs"} title="Discs">
            <Disc3 size={18} strokeWidth={2.4} />
          </Link>
        )}
        {searchEnabled && (
          <Link to="/settings" className="round-btn" aria-label="Settings" title="Settings">
            <Settings size={18} strokeWidth={2.4} />
          </Link>
        )}
        <WindowButtons />
      </div>
    </header>
  );
}

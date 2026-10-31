import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ChevronLeft, ChevronRight, Search, Settings } from "lucide-react";
import { Logo } from "./common";
import { MusicPill } from "./MusicPill";

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
  const location = useRouterState({ select: (state) => state.location });
  const urlQuery = location.pathname === "/search" ? String((location.search as { q?: string }).q ?? "") : "";
  const [query, setQuery] = useState(urlQuery);
  const input = useRef<HTMLInputElement>(null);
  const timer = useRef(0);

  useEffect(() => setQuery(urlQuery), [urlQuery]);

  // Ctrl+F focuses the library search.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
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
            <kbd>Ctrl F</kbd>
          </label>
        )}
        <div className="appbar-drag" data-tauri-drag-region />
        <MusicPill />
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

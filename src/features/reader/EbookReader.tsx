import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Popover } from "radix-ui";
import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, Columns2, Expand, Link2, List, LoaderCircle, Minus, Plus, RectangleVertical, Rows3, Shrink, Type, X } from "lucide-react";
import { api, bookUrl, type BookmarkLocator, type Ebook, type SeriesEntry } from "../../lib/api";
import { useAmbient, useAmbientHold } from "../../lib/ambient/AmbientProvider";
import { accentVariables } from "../../lib/color";
import { EBOOK_SIZES, EBOOK_SPACINGS, usePreferences, type EbookPreferences } from "../../lib/preferences";
import { libraryChanged } from "../../lib/queries";
import { useActivity } from "../../lib/activity";
import { READER_PAD, useControllerShortcuts } from "../bigpicture/Launcher";
import { actionFor, hint, isTyping } from "../../lib/shortcuts";
import { Switch } from "../../components/common";
import { WindowButtons } from "../../components/TitleBar";
import type { Location, TocItem, View } from "../../vendor/foliate-js/view.js";
import { BookmarksMenu, toggleBookmark, useBookmarks, type Place } from "./Bookmarks";
import { motionAllowed, useAutoHide, useFullscreen } from "./chrome";
import { BrightnessRow, pageFilter } from "./DisplayPanel";

const THEMES = {
  paper: { label: "Paper", background: "#fbf8f1", text: "#24211b", link: "#1d6aa8" },
  sepia: { label: "Sepia", background: "#f1e5cb", text: "#46371f", link: "#8b4a12" },
  night: { label: "Night", background: "#13181e", text: "#cdd5dd", link: "#80c3ee" },
} as const;
const FONTS = {
  serif: `Georgia, Cambria, "Times New Roman", serif`,
  sans: `"Segoe UI", system-ui, sans-serif`,
} as const;
const WIDTHS = { narrow: 560, medium: 720, wide: 920 } as const;
const SPACING_NAMES = ["Compact", "Normal", "Relaxed"];

/** The stylesheet added to every chapter: theme, fonts and spacing chosen in the reader. */
function bookStyles(settings: EbookPreferences): string {
  const theme = THEMES[settings.theme];
  const night = settings.theme === "night";
  const font =
    settings.font === "book"
      ? ""
      : `body { font-family: ${FONTS[settings.font]} !important; }
         body *:not(code, pre, kbd, samp, tt, code *, pre *) { font-family: inherit !important; }`;
  // Paper and sepia keep the colors a book chose; night repaints them so dark text stays readable.
  const colors = night
    ? `body, body * { color: inherit !important; background-color: transparent !important; }
       a:any-link, a:any-link * { color: ${theme.link} !important; }`
    : `a:any-link { color: ${theme.link}; }`;
  return `
    @namespace epub "http://www.idpf.org/2007/ops";
    html {
      color-scheme: ${night ? "dark" : "light"};
      font-size: ${settings.size}% !important;
      color: ${theme.text};
      background: ${theme.background} !important;
    }
    body { background: transparent !important; }
    p, li, blockquote, dd {
      line-height: ${settings.spacing};
      text-align: ${settings.justify ? "justify" : "start"};
      hyphens: manual;
      widows: 2;
      orphans: 2;
    }
    [align="left"] { text-align: left; }
    [align="right"] { text-align: right; }
    [align="center"] { text-align: center; }
    [align="justify"] { text-align: justify; }
    pre { white-space: pre-wrap !important; }
    img, svg, video { max-width: 100%; }
    aside[epub|type~="endnote"], aside[epub|type~="footnote"], aside[epub|type~="note"], aside[epub|type~="rearnote"] {
      display: none;
    }
    ${font}
    ${colors}
  `;
}

function applyLayout(view: View, settings: EbookPreferences) {
  if (view.isFixedLayout) return; // pages drawn by the publisher keep their own layout
  const renderer = view.renderer;
  renderer.setAttribute("flow", settings.layout === "scroll" ? "scrolled" : "paginated");
  renderer.setAttribute("max-column-count", settings.layout === "spread" ? "2" : "1");
  renderer.setAttribute("max-inline-size", `${WIDTHS[settings.width]}px`);
  renderer.setAttribute("gap", "6%");
  renderer.setAttribute("margin", "68px");
  renderer.toggleAttribute("animated", motionAllowed());
  renderer.setStyles?.(bookStyles(settings));
}

/** Why a book didn't open, in words for the reader screen. */
function openFailure(error: unknown): string {
  const name = error instanceof Error ? error.constructor.name : "";
  if (name === "UnsupportedTypeError") return "Digitify doesn't recognize this file as an EPUB, MOBI, AZW3 or FB2 book.";
  if (name === "NotFoundError") return "This file is empty.";
  const detail = error instanceof Error ? error.message : String(error);
  return `This book couldn't be read. The file may be damaged or use a variant of its format that isn't supported. (${detail})`;
}

function TocList({ items, current, depth, onPick }: { items: TocItem[]; current?: string; depth: number; onPick: (href: string) => void }) {
  return (
    <ul className="toc-list">
      {items.map((item, index) => (
        <li key={`${item.href}:${index}`}>
          <button
            type="button"
            className="toc-item"
            aria-current={item.href === current ? "location" : undefined}
            disabled={!item.href}
            style={{ paddingLeft: 12 + depth * 16 }}
            onClick={() => onPick(item.href)}
          >
            {item.label?.trim() || "Untitled"}
          </button>
          {item.subitems?.length ? <TocList items={item.subitems} current={current} depth={depth + 1} onPick={onPick} /> : null}
        </li>
      ))}
    </ul>
  );
}

/** Reflowable ebooks: EPUB, MOBI, AZW3 and FB2, laid out by foliate-js (Phase 2, D-014). */
export function EbookReader({ book, onClose, next: nextVolume, onNext }: {
  book: Ebook;
  onClose: () => void;
  /** The next volume of the series, offered at the end. */
  next?: SeriesEntry | null;
  onNext?: () => void;
}) {
  const queryClient = useQueryClient();
  const { preferences, update } = usePreferences();
  const settings = preferences.ebook;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const ambient = useAmbient();
  useAmbientHold("reading", ambient.music.pauseWhileReading);
  const { shown, setShown, poke, barProps } = useAutoHide();
  const [fullscreen, toggleFullscreen] = useFullscreen();

  const root = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<View | null>(null);
  // Page turns inside the book count as reading (its input doesn't reach the window).
  const nudgeRef = useRef(useActivity(book.itemId, "read", true));
  useControllerShortcuts(READER_PAD);
  const [state, setState] = useState<{ status: "opening" | "ready" } | { status: "failed"; message: string }>({ status: "opening" });
  const [toc, setToc] = useState<TocItem[]>([]);
  const [rtl, setRtl] = useState(false);
  const [location, setLocation] = useState<Location | null>(null);
  const [panel, setPanel] = useState<"toc" | "type" | "bookmarks" | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [atEnd, setAtEnd] = useState(false);
  const ready = state.status === "ready";
  const scroll = settings.layout === "scroll";
  const setEbook = useCallback(
    (change: Partial<EbookPreferences>) => update((current) => ({ ebook: { ...current.ebook, ...change } })),
    [update],
  );
  const resize = useCallback(
    (step: number) => {
      const index = EBOOK_SIZES.indexOf(settings.size);
      setEbook({ size: EBOOK_SIZES[Math.max(0, Math.min(EBOOK_SIZES.length - 1, index + step))] });
    },
    [settings.size, setEbook],
  );

  // ------------------------------------------------------------------ bookmarks

  const bookmarks = useBookmarks(book.itemId);
  const here: Place | null = location?.cfi
    ? {
        locator: { cfi: location.cfi, fraction: location.fraction, location: location.location?.current ?? null },
        label: location.tocItem?.label?.trim() || `${Math.round(location.fraction * 100)}%`,
      }
    : null;
  // Positions are counted in foliate-js "locations" (about 1,500 characters each), which don't
  // depend on the window size; a bookmark is on screen when its location is among those shown.
  const isHere = (locator: BookmarkLocator) => {
    if (!("cfi" in locator) || !location) return false;
    if (locator.cfi === location.cfi) return true;
    const shown = location.location;
    return locator.location != null && !!shown && locator.location >= shown.current && locator.location <= Math.max(shown.current, shown.next - 1);
  };
  const describe = (locator: BookmarkLocator) => ("fraction" in locator ? `${Math.round(locator.fraction * 100)}%` : "");

  // ------------------------------------------------------------------ progress

  // Saved once the reader moves; just opening a book doesn't change where it stopped.
  const opened = useRef(false);
  const pending = useRef<{ cfi: string; fraction: number; finished: boolean } | null>(null);
  const saveTimer = useRef(0);
  const flush = useCallback(() => {
    window.clearTimeout(saveTimer.current);
    const save = pending.current;
    pending.current = null;
    return save ? api.ebookProgressSave(book.itemId, save.cfi, save.fraction, save.finished).catch(() => {}) : Promise.resolve();
  }, [book.itemId]);
  useEffect(() => () => void flush().finally(() => libraryChanged(queryClient)), [flush, queryClient]);

  // ------------------------------------------------------------------ input, also from inside the book's pages

  const input = useRef({ key: (_event: KeyboardEvent) => {}, click: (_event: MouseEvent, _doc: Document) => {}, wheel: (_event: WheelEvent) => {} });
  const wheelAt = useRef(0);
  input.current.key = (event: KeyboardEvent) => {
    const view = viewRef.current;
    const target = event.target as HTMLElement | null;
    if (!view || !ready || isTyping(event)) return;
    const action = actionFor(event, "readers");
    if (target?.closest?.(".reader-panel") && action !== "readers.close") return;
    // In a scrolling book the arrows move a little; the other keys move a screen.
    const arrow = scroll && (event.key === "ArrowDown" || event.key === "ArrowUp") ? 80 : undefined;
    switch (action) {
      case "readers.right":
        void view.goRight();
        break;
      case "readers.left":
        void view.goLeft();
        break;
      case "readers.next":
        void view.next(arrow);
        break;
      case "readers.previous":
        void view.prev(arrow);
        break;
      case "readers.first":
        void view.goToFraction(0);
        break;
      case "readers.last":
        void view.goToFraction(1);
        break;
      case "readers.zoomIn":
        resize(1);
        break;
      case "readers.zoomOut":
        resize(-1);
        break;
      case "readers.zoomReset":
        setEbook({ size: 100 });
        break;
      case "readers.fullscreen":
        void toggleFullscreen();
        break;
      case "readers.bookmark":
        void toggleBookmark(bookmarks, here, isHere);
        break;
      case "readers.close":
        if (panel) setPanel(null);
        else if (fullscreen) void toggleFullscreen();
        else onClose();
        break;
      default:
        return;
    }
    event.preventDefault();
    poke();
  };
  input.current.click = (event: MouseEvent, doc: Document) => {
    if (panel) {
      setPanel(null);
      return;
    }
    if (event.defaultPrevented || (event.target as Element | null)?.closest?.("a[href]")) return;
    if (!doc.getSelection()?.isCollapsed) return;
    const frame = doc.defaultView?.frameElement?.getBoundingClientRect();
    const x = ((frame?.left ?? 0) + event.clientX) / window.innerWidth;
    const view = viewRef.current;
    if (view && !scroll && x < 0.3) void view.goLeft();
    else if (view && !scroll && x > 0.7) void view.goRight();
    else if (shown) setShown(false);
    else poke();
  };
  input.current.wheel = (event: WheelEvent) => {
    const view = viewRef.current;
    if (event.ctrlKey) {
      event.preventDefault(); // instead of zooming the whole window
      resize(event.deltaY < 0 ? 1 : -1);
      return;
    }
    if (!view || scroll) return;
    const now = performance.now();
    if (now - wheelAt.current < 350) return;
    wheelAt.current = now;
    void (event.deltaY > 0 ? view.next() : view.prev());
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => input.current.key(event);
    const onWheel = (event: WheelEvent) => input.current.wheel(event);
    const element = host.current;
    window.addEventListener("keydown", onKey);
    element?.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      window.removeEventListener("keydown", onKey);
      element?.removeEventListener("wheel", onWheel);
    };
  }, []);

  // ------------------------------------------------------------------ opening the book

  useEffect(() => {
    let cancelled = false;
    let view: View | null = null;
    const onRelocate = (event: Event) => {
      const detail = (event as CustomEvent<Location>).detail;
      nudgeRef.current();
      setLocation(detail);
      setAtEnd(detail.fraction >= 0.995 || !!view?.renderer.atEnd);
      if (!opened.current || !view) return;
      pending.current = { cfi: detail.cfi, fraction: detail.fraction, finished: detail.fraction >= 0.999 || !!view.renderer.atEnd };
      window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => void flush(), 800);
    };
    const onLoad = (event: Event) => {
      const { doc } = (event as CustomEvent<{ doc: Document }>).detail;
      doc.addEventListener("keydown", (e) => input.current.key(e));
      doc.addEventListener("click", (e) => input.current.click(e, doc));
      doc.addEventListener("wheel", (e) => input.current.wheel(e), { passive: false });
      doc.addEventListener("mousemove", () => poke());
      // Middle-clicking a link would ask for a new window.
      doc.addEventListener("auxclick", (e) => (e.target as Element | null)?.closest?.("a[href]") && e.preventDefault());
    };
    // Books can link to websites; Digitify doesn't open them (offline, no hidden traffic) but shows the address.
    const onExternalLink = (event: Event) => {
      event.preventDefault();
      const { href_ } = (event as CustomEvent<{ href_: string }>).detail;
      setLink(href_);
    };
    (async () => {
      try {
        await import("../../vendor/foliate-js/view.js");
        const response = await fetch(bookUrl(book.versionId));
        if (!response.ok) throw new Error(await response.text());
        const file = new File([await response.blob()], book.fileName, { type: response.headers.get("content-type") ?? "" });
        if (cancelled) return;
        view = document.createElement("foliate-view") as View;
        view.setAttribute("autohide-cursor", "");
        view.addEventListener("relocate", onRelocate);
        view.addEventListener("load", onLoad);
        view.addEventListener("external-link", onExternalLink);
        host.current?.append(view);
        await view.open(file);
        if (cancelled) return;
        viewRef.current = view;
        applyLayout(view, settingsRef.current);
        setToc(view.book.toc ?? []);
        setRtl(view.book.dir === "rtl");
        await view.init({ lastLocation: book.position ?? undefined });
        if (cancelled) return;
        opened.current = true;
        setState({ status: "ready" });
      } catch (error) {
        if (!cancelled) setState({ status: "failed", message: openFailure(error) });
      }
    })();
    return () => {
      cancelled = true;
      view?.close();
      view?.remove();
      viewRef.current = null;
    };
  }, [book.versionId, book.fileName, book.position, flush, poke]);

  useEffect(() => {
    if (ready && viewRef.current) applyLayout(viewRef.current, settings);
  }, [ready, settings]);

  // ------------------------------------------------------------------ view

  const theme = THEMES[settings.theme];
  const fraction = location?.fraction ?? 0;
  const percent = Math.round(fraction * 100);
  const chapter = location?.tocItem?.label?.trim();
  const showBars = shown || panel !== null;
  const goTo = (href: string) => {
    setPanel(null);
    void viewRef.current?.goTo(href);
  };

  return (
    <div
      ref={root}
      className={`reader ebook-reader${showBars ? "" : " calm"}`}
      style={{ ...accentVariables(preferences.accent, "dark"), "--book-bg": theme.background } as CSSProperties}
      onMouseMove={poke}
    >
      <div ref={host} className="ebook-stage" style={{ filter: pageFilter(settings.brightness, false) }} />

      {state.status !== "ready" && (
        <div className="reader-message">
          {state.status === "failed" ? (
            <>
              <h1 className="display">This book can't be opened</h1>
              <p>{state.message}</p>
              <button type="button" className="btn" onClick={onClose}>
                Back
              </button>
            </>
          ) : (
            <LoaderCircle size={34} className="spin" aria-label="Opening" />
          )}
        </div>
      )}

      <header className={`reader-bar top${showBars ? "" : " hidden"}`} data-tauri-drag-region {...barProps}>
        <button type="button" className="round-btn" aria-label="Close the reader" title={`Close${hint("readers.close")}`} onClick={onClose}>
          <ArrowLeft size={18} strokeWidth={2.6} />
        </button>
        <div className="reader-title" data-tauri-drag-region>
          <strong>{book.title}</strong>
          <span>{ready ? [chapter, `${percent}%`].filter(Boolean).join(" · ") : "Opening…"}</span>
        </div>
        <Popover.Root open={panel === "toc"} onOpenChange={(open) => setPanel(open ? "toc" : null)}>
          <Popover.Trigger asChild>
            <button type="button" className="btn btn-sm" disabled={!ready || toc.length === 0} title="Contents">
              <List size={15} /> <span className="label">Contents</span>
            </button>
          </Popover.Trigger>
          <Popover.Portal container={root.current}>
            <Popover.Content className="menu reader-panel toc-panel" align="start" sideOffset={12} collisionPadding={16}>
              <TocList items={toc} current={location?.tocItem?.href} depth={0} onPick={goTo} />
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
        <div className="segmented" role="group" aria-label="Layout">
          {(
            [
              ["single", "One page", RectangleVertical],
              ["spread", "Two pages", Columns2],
              ["scroll", "Scroll", Rows3],
            ] as const
          ).map(([value, text, Icon]) => (
            <button key={value} type="button" aria-pressed={settings.layout === value} onClick={() => setEbook({ layout: value })}>
              <Icon size={15} aria-hidden /> <span className="label">{text}</span>
            </button>
          ))}
        </div>
        <span className="appbar-drag" data-tauri-drag-region />
        <BookmarksMenu
          itemId={book.itemId}
          container={root.current}
          open={panel === "bookmarks"}
          onOpenChange={(open) => setPanel(open ? "bookmarks" : null)}
          here={ready ? here : null}
          isHere={isHere}
          describe={describe}
          onGo={(locator) => "cfi" in locator && void viewRef.current?.goTo(locator.cfi)}
        />
        <Popover.Root open={panel === "type"} onOpenChange={(open) => setPanel(open ? "type" : null)}>
          <Popover.Trigger asChild>
            <button type="button" className="round-btn" aria-label="Text and theme" title="Text and theme">
              <Type size={17} />
            </button>
          </Popover.Trigger>
          <Popover.Portal container={root.current}>
            <Popover.Content className="menu reader-panel type-panel" align="end" sideOffset={12} collisionPadding={16}>
              <div className="type-row">
                <span>Theme</span>
                <div className="theme-swatches" role="group" aria-label="Theme">
                  {(Object.keys(THEMES) as (keyof typeof THEMES)[]).map((key) => (
                    <button
                      key={key}
                      type="button"
                      aria-pressed={settings.theme === key}
                      style={{ background: THEMES[key].background, color: THEMES[key].text }}
                      onClick={() => setEbook({ theme: key })}
                    >
                      {THEMES[key].label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="type-row">
                <span>Text size</span>
                <div className="reader-zoom" role="group" aria-label="Text size">
                  <button type="button" className="icon-btn" aria-label="Smaller text" disabled={settings.size <= EBOOK_SIZES[0]} onClick={() => resize(-1)}>
                    <Minus size={16} />
                  </button>
                  <button type="button" className="reader-zoom-value" title="Back to 100%" onClick={() => setEbook({ size: 100 })}>
                    {settings.size}%
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="Larger text"
                    disabled={settings.size >= EBOOK_SIZES[EBOOK_SIZES.length - 1]}
                    onClick={() => resize(1)}
                  >
                    <Plus size={16} />
                  </button>
                </div>
              </div>
              <div className="type-row">
                <span>Font</span>
                <div className="segmented" role="group" aria-label="Font">
                  {(
                    [
                      ["book", "Book's own"],
                      ["serif", "Serif"],
                      ["sans", "Sans"],
                    ] as const
                  ).map(([value, text]) => (
                    <button key={value} type="button" aria-pressed={settings.font === value} onClick={() => setEbook({ font: value })}>
                      {text}
                    </button>
                  ))}
                </div>
              </div>
              <div className="type-row">
                <span>Line spacing</span>
                <div className="segmented" role="group" aria-label="Line spacing">
                  {EBOOK_SPACINGS.map((value, index) => (
                    <button key={value} type="button" aria-pressed={settings.spacing === value} onClick={() => setEbook({ spacing: value })}>
                      {SPACING_NAMES[index]}
                    </button>
                  ))}
                </div>
              </div>
              <div className="type-row">
                <span>Page width</span>
                <div className="segmented" role="group" aria-label="Page width">
                  {(
                    [
                      ["narrow", "Narrow"],
                      ["medium", "Medium"],
                      ["wide", "Wide"],
                    ] as const
                  ).map(([value, text]) => (
                    <button key={value} type="button" aria-pressed={settings.width === value} onClick={() => setEbook({ width: value })}>
                      {text}
                    </button>
                  ))}
                </div>
              </div>
              <BrightnessRow value={settings.brightness} onChange={(brightness) => setEbook({ brightness })} />
              <div className="type-row">
                <span>Justify text</span>
                <Switch checked={settings.justify} label="Justify text" onChange={(justify) => setEbook({ justify })} />
              </div>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
        <button type="button" className="round-btn" aria-label={fullscreen ? "Leave full screen" : "Full screen"} title={`Full screen${hint("readers.fullscreen")}`} onClick={() => void toggleFullscreen()}>
          {fullscreen ? <Shrink size={17} /> : <Expand size={17} />}
        </button>
        {!fullscreen && <WindowButtons />}
      </header>

      <footer className={`reader-bar bottom${showBars ? "" : " hidden"}`} {...barProps}>
        <button type="button" className="round-btn" aria-label={rtl ? "Next page" : "Previous page"} disabled={!ready} onClick={() => void viewRef.current?.goLeft()}>
          <ChevronLeft size={19} strokeWidth={2.6} />
        </button>
        <input
          type="range"
          className="reader-slider"
          aria-label="Position in the book"
          min={0}
          max={1000}
          value={Math.round(fraction * 1000)}
          dir={rtl ? "rtl" : "ltr"}
          disabled={!ready}
          style={{ "--fill": `${fraction * 100}%` } as CSSProperties}
          onChange={(event) => void viewRef.current?.goToFraction(Number(event.target.value) / 1000)}
        />
        <span className="ebook-percent">{percent}%</span>
        <button type="button" className="round-btn" aria-label={rtl ? "Previous page" : "Next page"} disabled={!ready} onClick={() => void viewRef.current?.goRight()}>
          <ChevronRight size={19} strokeWidth={2.6} />
        </button>
      </footer>

      {atEnd && nextVolume && onNext && (
        <button type="button" className="btn btn-primary next-volume" onClick={onNext}>
          Next: {nextVolume.label ? `${nextVolume.label} · ` : ""}
          {nextVolume.title} <ArrowRight size={16} />
        </button>
      )}
      {link && (
        <div className="ebook-link" role="status">
          <Link2 size={17} aria-hidden />
          <div>
            <strong>This link leads to a website</strong>
            <span>{link}</span>
          </div>
          <button type="button" className="btn btn-sm" onClick={() => void navigator.clipboard.writeText(link).then(() => setLink(null))}>
            Copy address
          </button>
          <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => setLink(null)}>
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

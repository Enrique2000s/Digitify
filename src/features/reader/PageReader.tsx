import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowLeft, ArrowLeftRight, ArrowRight, ChevronLeft, ChevronRight, Columns2, Expand, RectangleVertical, Rows3, Shrink, ZoomIn, ZoomOut } from "lucide-react";
import { api, pageUrl, type BookmarkLocator, type Chapter, type ReaderBook, type SeriesEntry } from "../../lib/api";
import { useAmbient, useAmbientHold } from "../../lib/ambient/AmbientProvider";
import { accentVariables } from "../../lib/color";
import { usePreferences, type ReaderPreferences } from "../../lib/preferences";
import { libraryChanged } from "../../lib/queries";
import { useActivity } from "../../lib/activity";
import { READER_PAD, useControllerShortcuts } from "../bigpicture/Launcher";
import { actionFor, hint, isTyping } from "../../lib/shortcuts";
import { WindowButtons } from "../../components/TitleBar";
import { useBigPicture } from "../../lib/bigpicture";
import { BookmarksMenu, toggleBookmark, useBookmarks } from "./Bookmarks";
import { chapterAt, ChaptersMenu } from "./Chapters";
import { motionAllowed, useAutoHide, useFullscreen } from "./chrome";
import { buildTurn, PageTurnLayer, type Turn, type TurnPage } from "./PageTurn";
import { backgroundCss, DisplayPanel, pageFilter } from "./DisplayPanel";
import { buildViews, stripWidth, viewHeight, viewOf, type Box } from "./layout";

const ZOOMS = [1, 1.25, 1.5, 2, 2.5, 3, 4];
const STRIP_GAP = 8;

function useBox(ref: React.RefObject<HTMLElement | null>): Box {
  const [box, setBox] = useState<Box>({ width: window.innerWidth, height: window.innerHeight });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setBox({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return box;
}

/** Drag to pan when pages are larger than the window; a drag never counts as a click. */
function usePan(ref: React.RefObject<HTMLElement | null>) {
  const drag = useRef<{ x: number; y: number; left: number; top: number; moved: boolean } | null>(null);
  const onPointerDown = (event: React.PointerEvent) => {
    const element = ref.current;
    if (!element || event.button !== 0) return;
    drag.current = { x: event.clientX, y: event.clientY, left: element.scrollLeft, top: element.scrollTop, moved: false };
  };
  const onPointerMove = (event: React.PointerEvent) => {
    const element = ref.current;
    const state = drag.current;
    if (!element || !state || !(event.buttons & 1)) return;
    const dx = event.clientX - state.x;
    const dy = event.clientY - state.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) state.moved = true;
    element.scrollLeft = state.left - dx;
    element.scrollTop = state.top - dy;
  };
  /** True when the pointer was dragged rather than clicked. */
  const wasDrag = () => {
    const moved = drag.current?.moved ?? false;
    drag.current = null;
    return moved;
  };
  return { onPointerDown, onPointerMove, wasDrag };
}

/** Page-based reading: comics, manga, scans and PDFs (Phase 2). */
export function PageReader({ book, startPage, onClose, next: nextVolume, onNext }: {
  book: ReaderBook;
  /** Open at this page instead of where reading stopped. */
  startPage?: number;
  onClose: () => void;
  /** The next volume of the series, offered at the end. */
  next?: SeriesEntry | null;
  onNext?: () => void;
}) {
  const queryClient = useQueryClient();
  const { preferences, update } = usePreferences();
  const settings = preferences.reader;
  const ambient = useAmbient();
  useAmbientHold("reading", ambient.music.pauseWhileReading);

  const pages = book.pages;
  const total = pages.length;
  const [page, setPage] = useState(Math.min(startPage ?? book.position, total - 1));
  const [chapters, setChapters] = useState<Chapter[]>(book.chapters);
  const [direction, setDirection] = useState(book.direction);
  const [zoom, setZoom] = useState(1);
  const { shown: chrome, setShown: setChrome, poke, barProps } = useAutoHide();
  const [fullscreen, toggleFullscreen] = useFullscreen();
  const [motion, setMotion] = useState<"next" | "prev" | null>(null);
  const [panel, setPanel] = useState<"display" | "bookmarks" | "contents" | null>(null);
  const [turn, setTurn] = useState<(Turn & { key: number }) | null>(null);
  const dragPoint = useRef<{ x: number; y: number } | null>(null);
  const curl = useRef<{ from: number; startX: number; width: number; corner: "top" | "bottom" } | null>(null);
  const suppressClick = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const box = useBox(stage);
  const dpr = window.devicePixelRatio || 1;
  const scroll = settings.mode === "scroll";
  const views = useMemo(() => buildViews(pages, settings.mode === "spread", settings.coverAlone), [pages, settings.mode, settings.coverAlone]);
  const viewIndex = viewOf(views, page);
  const view = views[viewIndex];
  const rtl = direction === "rtl";
  const setReader = (change: Partial<ReaderPreferences>) => update((current) => ({ reader: { ...current.reader, ...change } }));

  // ------------------------------------------------------------------ navigation

  const strip = useVirtualizer({
    count: scroll ? total : 0,
    getScrollElement: () => stage.current,
    estimateSize: (index) => (stripWidth(pages[index], box, settings.fit) * zoom * pages[index].height) / pages[index].width + STRIP_GAP,
    overscan: 2,
  });
  useEffect(() => strip.measure(), [strip, box.width, box.height, settings.fit, zoom]);

  const go = useCallback(
    (target: number, kind: "next" | "prev" | null = null) => {
      const next = Math.max(0, Math.min(total - 1, target));
      setMotion(kind);
      setPage(next);
      if (scroll) strip.scrollToIndex(next, { align: "start" });
      else stage.current?.scrollTo({ top: kind === "prev" && settings.fit === "width" ? stage.current.scrollHeight : 0, left: 0 });
    },
    [total, scroll, strip, settings.fit],
  );
  const next = useCallback(() => {
    if (scroll) go(page + 1, "next");
    else if (viewIndex < views.length - 1) go(views[viewIndex + 1][0], "next");
  }, [scroll, go, page, viewIndex, views]);
  const prev = useCallback(() => {
    if (scroll) go(page - 1, "prev");
    else if (viewIndex > 0) go(views[viewIndex - 1][0], "prev");
  }, [scroll, go, page, viewIndex, views]);

  // In the strip, the current page is the one a third of the way down the window.
  const onStripScroll = () => {
    const element = stage.current;
    if (!scroll || !element) return;
    const mark = element.scrollTop + element.clientHeight / 3;
    const current = strip.getVirtualItems().find((item) => item.start <= mark && item.end > mark);
    if (current && current.index !== page) setPage(current.index);
  };
  // Open the strip where reading stopped; only when switching to it, not on every page change.
  useLayoutEffect(() => {
    if (scroll) strip.scrollToIndex(page, { align: "start" });
  }, [scroll]);

  // ------------------------------------------------------------------ zoom, full screen, chrome

  const zoomBy = useCallback((step: number) => {
    setZoom((current) => {
      const index = ZOOMS.findIndex((z) => z >= current - 0.001);
      return ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, (index < 0 ? 0 : index) + step))];
    });
  }, []);

  // ------------------------------------------------------------------ bookmarks

  const bookmarks = useBookmarks(book.itemId);
  const shownPages = scroll ? [page] : view;
  const isHere = (locator: BookmarkLocator) => "page" in locator && shownPages.includes(locator.page);
  const here = { locator: { page: shownPages[0] }, label: `Page ${shownPages[0] + 1}` };
  const describe = (locator: BookmarkLocator) => ("page" in locator ? `Page ${locator.page + 1}` : "");

  const toggleDirection = () => {
    const next = rtl ? "ltr" : "rtl";
    setDirection(next);
    void api.itemsBulk([book.itemId], [{ op: "setDirection", direction: next }]).catch(() => {});
  };

  // ------------------------------------------------------------------ keyboard, wheel and clicks

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event)) return;
      const action = actionFor(event, "readers");
      if ((event.target as HTMLElement | null)?.closest?.(".reader-panel") && action !== "readers.close") return;
      const element = stage.current;
      const scrollable = !!element && element.scrollHeight > element.clientHeight + 2;
      switch (action) {
        case "readers.right":
          rtl ? prev() : next();
          break;
        case "readers.left":
          rtl ? next() : prev();
          break;
        case "readers.next":
        case "readers.previous": {
          const forward = action === "readers.next";
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            if (scroll || scrollable) return; // the page scrolls natively
            forward ? next() : prev();
          } else if (scroll) {
            element?.scrollBy({ top: (forward ? 0.9 : -0.9) * element.clientHeight, behavior: "smooth" });
          } else {
            forward ? next() : prev();
          }
          break;
        }
        case "readers.first":
          go(0);
          break;
        case "readers.last":
          go(total - 1);
          break;
        case "readers.zoomIn":
          zoomBy(1);
          break;
        case "readers.zoomOut":
          zoomBy(-1);
          break;
        case "readers.zoomReset":
          setZoom(1);
          break;
        case "readers.fullscreen":
          void toggleFullscreen();
          break;
        case "readers.bookmark":
          void toggleBookmark(bookmarks, here, isHere);
          break;
        case "readers.close":
          // Escape closes an open panel first, then full screen, then the reader.
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
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rtl, next, prev, go, total, zoomBy, toggleFullscreen, fullscreen, onClose, scroll, poke, bookmarks, here, isHere, panel]);

  const wheelAt = useRef(0);
  const onWheel = (event: React.WheelEvent) => {
    if (event.ctrlKey) {
      zoomBy(event.deltaY < 0 ? 1 : -1);
      return;
    }
    if (scroll) return;
    const element = stage.current;
    if (!element) return;
    const atTop = element.scrollTop <= 0;
    const atBottom = element.scrollTop + element.clientHeight >= element.scrollHeight - 2;
    if ((event.deltaY > 0 && !atBottom) || (event.deltaY < 0 && !atTop)) return; // still scrolling the page
    const now = performance.now();
    if (now - wheelAt.current < 350) return;
    wheelAt.current = now;
    event.deltaY > 0 ? next() : prev();
  };
  // Ctrl+wheel must not zoom the whole WebView.
  useEffect(() => {
    const element = stage.current;
    const block = (event: WheelEvent) => event.ctrlKey && event.preventDefault();
    element?.addEventListener("wheel", block, { passive: false });
    return () => element?.removeEventListener("wheel", block);
  }, []);

  const pan = usePan(stage);
  const onStageClick = (event: React.MouseEvent) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if (pan.wasDrag() || scroll) return;
    const x = event.clientX / window.innerWidth;
    if (x < 0.3) rtl ? next() : prev();
    else if (x > 0.7) rtl ? prev() : next();
    else if (chrome) setChrome(false);
    else poke();
  };

  // ------------------------------------------------------------------ progress

  // Progress is saved once the reader moves; just opening a book doesn't change where it stopped.
  const reached = scroll ? page : view[view.length - 1];
  const nudge = useActivity(book.itemId, "read", true);
  useControllerShortcuts(READER_PAD);
  const bigPicture = useBigPicture();
  useEffect(nudge, [reached, nudge]);
  const latest = useRef(reached);
  const moved = useRef(false);
  if (latest.current !== reached) moved.current = true;
  latest.current = reached;
  useEffect(() => {
    if (!moved.current) return;
    const timer = window.setTimeout(() => void api.progressSave(book.itemId, reached, total).catch(() => {}), 600);
    return () => window.clearTimeout(timer);
  }, [book.itemId, reached, total]);
  useEffect(
    () => () => {
      const save = moved.current ? api.progressSave(book.itemId, latest.current, total) : Promise.resolve();
      void save.catch(() => {}).finally(() => libraryChanged(queryClient));
    },
    [book.itemId, total, queryClient],
  );

  // ------------------------------------------------------------------ layout and preloading

  const height = viewHeight(view, pages, box, settings.fit) * zoom;
  const layout = view.map((index) => ({ index, width: Math.round((pages[index].width / pages[index].height) * height), height: Math.round(height) }));
  const shown = rtl ? [...layout].reverse() : layout;

  // ------------------------------------------------------------------ 3D turn and page curl (D-021)

  const effect = settings.transition === "turn" || settings.transition === "curl" ? settings.transition : null;
  const turnPages: TurnPage[] = shown.map((item) => ({ src: pageUrl(book.versionId, item.index, item.width * dpr), width: item.width, height: item.height }));
  const previous = useRef({ view: viewIndex, pages: turnPages });
  // A turn starts when the view changes by turning a page: it needs what was on screen before.
  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = { view: viewIndex, pages: turnPages };
    if (before.view === viewIndex) return;
    const dragged = curl.current;
    if (!effect || !motion || scroll || zoom !== 1 || !motionAllowed()) return;
    const built = buildTurn(before.pages, turnPages, motion === "next", rtl);
    if (built) setTurn({ ...built, dragged: dragged ? { corner: dragged.corner } : undefined, key: Date.now() });
  });
  const turnDone = (finished: boolean) => {
    const dragged = curl.current;
    curl.current = null;
    setTurn(null);
    if (!finished && dragged) go(dragged.from); // let go too early: back where it was, without a turn
  };

  // Grabbing a page's outer corner curls it by hand; single pages only turn forward this way.
  const onStagePointerDown = (event: React.PointerEvent) => {
    pan.onPointerDown(event);
    if (settings.transition !== "curl" || scroll || zoom !== 1 || turn || event.button !== 0 || !motionAllowed()) return;
    const rect = stage.current?.querySelector(".reader-view")?.getBoundingClientRect();
    if (!rect) return;
    const zoneX = Math.min(rect.width * 0.18, 150);
    const zoneY = Math.min(rect.height * 0.22, 170);
    const nearTop = event.clientY >= rect.top && event.clientY < rect.top + zoneY;
    const nearBottom = event.clientY <= rect.bottom && event.clientY > rect.bottom - zoneY;
    const onRight = event.clientX <= rect.right && event.clientX > rect.right - zoneX;
    const onLeft = event.clientX >= rect.left && event.clientX < rect.left + zoneX;
    if (!(nearTop || nearBottom) || !(onRight || onLeft)) return;
    const forward = onRight !== rtl;
    const target = views[viewIndex + (forward ? 1 : -1)];
    if (!target || (view.length === 1 && !forward)) return;
    curl.current = { from: page, startX: event.clientX, width: rect.width / view.length, corner: nearBottom ? "bottom" : "top" };
    dragPoint.current = { x: event.clientX, y: event.clientY };
    stage.current?.setPointerCapture(event.pointerId);
    suppressClick.current = true;
    go(target[0], forward ? "next" : "prev");
  };
  const onStagePointerMove = (event: React.PointerEvent) => {
    if (curl.current) dragPoint.current = { x: event.clientX, y: event.clientY };
    else pan.onPointerMove(event);
  };
  const onStagePointerUp = (event: React.PointerEvent) => {
    const dragged = curl.current;
    if (!dragged || !turn?.dragged || turn.release !== undefined) return;
    setTurn({ ...turn, release: Math.abs(event.clientX - dragged.startX) > dragged.width * 0.45 });
  };

  useEffect(() => {
    if (scroll) return;
    for (const neighbor of [views[viewIndex + 1], views[viewIndex - 1], views[viewIndex + 2]]) {
      if (!neighbor) continue;
      const h = viewHeight(neighbor, pages, box, settings.fit) * zoom;
      for (const index of neighbor) {
        const image = new Image();
        image.decoding = "async";
        image.src = pageUrl(book.versionId, index, ((pages[index].width / pages[index].height) * h) * dpr);
      }
    }
  }, [scroll, views, viewIndex, pages, box, settings.fit, zoom, book.versionId, dpr]);

  const showBars = chrome || panel !== null;
  const chapter = chapterAt(chapters, scroll ? page : view[0]);
  const pagesLabel =
    scroll || view.length === 1 ? `Page ${page + 1} of ${total}` : `Pages ${view[0] + 1}–${view[view.length - 1] + 1} of ${total}`;
  const label = chapter ? `${chapter.title} · ${pagesLabel}` : pagesLabel;
  const atEnd = scroll ? page >= total - 1 : viewIndex === views.length - 1;
  const saveChapters = (list: Chapter[]) => {
    setChapters(list);
    void api.chaptersSet(book.itemId, list).catch(() => {});
  };
  const transition =
    (settings.transition !== "slide" && settings.transition !== "fade") || !motion ? "" : ` enter-${settings.transition}-${(motion === "next") !== rtl ? "forward" : "back"}`;
  const sliderFill = total > 1 ? (page / (total - 1)) * 100 : 100;

  return (
    <div
      ref={root}
      className={`reader${showBars ? "" : " calm"}`}
      style={
        {
          ...accentVariables(preferences.accent, "dark"),
          background: backgroundCss(settings.background),
          "--page-filter": pageFilter(settings.brightness, settings.night),
        } as CSSProperties
      }
      onMouseMove={poke}
    >
      <div
        ref={stage}
        className={`reader-stage${scroll ? " strip" : ""}`}
        onClick={onStageClick}
        onWheel={onWheel}
        onScroll={onStripScroll}
        onPointerDown={onStagePointerDown}
        onPointerMove={onStagePointerMove}
        onPointerUp={onStagePointerUp}
      >
        {scroll ? (
          <div className="reader-strip" style={{ height: strip.getTotalSize() }}>
            {strip.getVirtualItems().map((item) => {
              const width = stripWidth(pages[item.index], box, settings.fit) * zoom;
              const pageHeight = (width * pages[item.index].height) / pages[item.index].width;
              return (
                <img
                  key={item.key}
                  className="reader-page"
                  src={pageUrl(book.versionId, item.index, width * dpr)}
                  alt={`Page ${item.index + 1}`}
                  draggable={false}
                  decoding="async"
                  style={{ top: item.start, width, height: pageHeight, marginLeft: -width / 2 }}
                />
              );
            })}
          </div>
        ) : (
          <div className={`reader-view${transition}`} key={`${viewIndex}:${settings.mode}`} style={turn ? { visibility: "hidden" } : undefined}>
            {shown.map((item) => (
              <img
                key={item.index}
                className="reader-page"
                src={pageUrl(book.versionId, item.index, item.width * dpr)}
                width={item.width}
                height={item.height}
                alt={`Page ${item.index + 1}`}
                draggable={false}
                decoding="async"
              />
            ))}
          </div>
        )}
        {turn && effect && (
          <PageTurnLayer key={turn.key} turn={turn} effect={effect} stage={stage.current} dragPoint={dragPoint} onDone={turnDone} />
        )}
      </div>

      <header className={`reader-bar top${showBars ? "" : " hidden"}`} data-tauri-drag-region {...barProps}>
        <button type="button" className="round-btn" aria-label="Close the reader" title={`Close${hint("readers.close")}`} onClick={onClose}>
          <ArrowLeft size={18} strokeWidth={2.6} />
        </button>
        <div className="reader-title" data-tauri-drag-region>
          <strong>{book.title}</strong>
          <span>{label}</span>
        </div>
        <ChaptersMenu
          chapters={chapters}
          page={scroll ? page : view[0]}
          container={root.current}
          open={panel === "contents"}
          onOpenChange={(open) => setPanel(open ? "contents" : null)}
          onGo={(target) => go(target)}
          onChange={saveChapters}
        />
        <div className="segmented" role="group" aria-label="Layout">
          {(
            [
              ["single", "One page", RectangleVertical],
              ["spread", "Two pages", Columns2],
              ["scroll", "Scroll", Rows3],
            ] as const
          ).map(([value, text, Icon]) => (
            <button key={value} type="button" aria-pressed={settings.mode === value} onClick={() => setReader({ mode: value })}>
              <Icon size={15} aria-hidden /> <span className="label">{text}</span>
            </button>
          ))}
        </div>
        <div className="segmented" role="group" aria-label="Fit">
          {(
            [
              ["page", "Fit page"],
              ["width", "Fit width"],
            ] as const
          ).map(([value, text]) => (
            <button key={value} type="button" aria-pressed={settings.fit === value} onClick={() => setReader({ fit: value })}>
              {text}
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-sm" aria-pressed={rtl} title="Reading direction" onClick={toggleDirection}>
          <ArrowLeftRight size={15} /> <span className="label">{rtl ? "Right to left" : "Left to right"}</span>
        </button>
        <div className="reader-zoom" role="group" aria-label="Zoom">
          <button type="button" className="icon-btn" aria-label="Zoom out" disabled={zoom <= ZOOMS[0]} onClick={() => zoomBy(-1)}>
            <ZoomOut size={17} />
          </button>
          <button type="button" className="reader-zoom-value" title="Back to 100%" onClick={() => setZoom(1)}>
            {Math.round(zoom * 100)}%
          </button>
          <button type="button" className="icon-btn" aria-label="Zoom in" disabled={zoom >= ZOOMS[ZOOMS.length - 1]} onClick={() => zoomBy(1)}>
            <ZoomIn size={17} />
          </button>
        </div>
        <span className="appbar-drag" data-tauri-drag-region />
        <BookmarksMenu
          itemId={book.itemId}
          container={root.current}
          open={panel === "bookmarks"}
          onOpenChange={(open) => setPanel(open ? "bookmarks" : null)}
          here={here}
          isHere={isHere}
          describe={describe}
          onGo={(locator) => "page" in locator && go(locator.page)}
        />
        <DisplayPanel
          settings={settings}
          onChange={setReader}
          container={root.current}
          open={panel === "display"}
          onOpenChange={(open) => setPanel(open ? "display" : null)}
        />
        {/* In Big Picture the whole app is full screen already: no full-screen or window buttons. */}
        {!bigPicture && <button type="button" className="round-btn" aria-label={fullscreen ? "Leave full screen" : "Full screen"} title={`Full screen${hint("readers.fullscreen")}`} onClick={() => void toggleFullscreen()}>
          {fullscreen ? <Shrink size={17} /> : <Expand size={17} />}
        </button>}
        {!fullscreen && !bigPicture && <WindowButtons />}
      </header>

      <footer className={`reader-bar bottom${showBars ? "" : " hidden"}`} {...barProps}>
        <button type="button" className="round-btn" aria-label={rtl ? "Next page" : "Previous page"} onClick={rtl ? next : prev}>
          <ChevronLeft size={19} strokeWidth={2.6} />
        </button>
        <input
          type="range"
          className="reader-slider"
          aria-label="Page"
          min={1}
          max={total}
          value={page + 1}
          dir={direction}
          style={{ "--fill": `${sliderFill}%` } as CSSProperties}
          onChange={(event) => go(Number(event.target.value) - 1)}
        />
        <button type="button" className="round-btn" aria-label={rtl ? "Previous page" : "Next page"} onClick={rtl ? prev : next}>
          <ChevronRight size={19} strokeWidth={2.6} />
        </button>
      </footer>
      {atEnd && nextVolume && onNext && (
        <button type="button" className="btn btn-primary next-volume" onClick={onNext}>
          Next: {nextVolume.label ? `${nextVolume.label} · ` : ""}
          {nextVolume.title} <ArrowRight size={16} />
        </button>
      )}
    </div>
  );
}

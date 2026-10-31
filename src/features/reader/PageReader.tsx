import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ArrowLeft, ArrowLeftRight, ChevronLeft, ChevronRight, Columns2, Expand, RectangleVertical, Rows3, Shrink, ZoomIn, ZoomOut } from "lucide-react";
import { api, pageUrl, type ReaderBook } from "../../lib/api";
import { useAmbient, useAmbientHold } from "../../lib/ambient/AmbientProvider";
import { usePreferences, type ReaderPreferences } from "../../lib/preferences";
import { libraryChanged } from "../../lib/queries";
import { WindowButtons } from "../../components/TitleBar";
import { buildViews, stripWidth, viewHeight, viewOf, type Box } from "./layout";

const appWindow = getCurrentWindow();
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
export function PageReader({ book, onClose }: { book: ReaderBook; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { preferences, update } = usePreferences();
  const settings = preferences.reader;
  const ambient = useAmbient();
  useAmbientHold("reading", ambient.music.pauseWhileReading);

  const pages = book.pages;
  const total = pages.length;
  const [page, setPage] = useState(Math.min(book.position, total - 1));
  const [direction, setDirection] = useState(book.direction);
  const [zoom, setZoom] = useState(1);
  const [chrome, setChrome] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [motion, setMotion] = useState<"next" | "prev" | null>(null);
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

  const toggleFullscreen = useCallback(async () => {
    const next = !(await appWindow.isFullscreen());
    await appWindow.setFullscreen(next);
    setFullscreen(next);
  }, []);
  // Leaving the reader leaves full screen too.
  useEffect(
    () => () => {
      void appWindow.isFullscreen().then((on) => {
        if (on) void appWindow.setFullscreen(false);
      });
    },
    [],
  );

  const hideTimer = useRef(0);
  const holdChrome = useRef(false);
  const poke = useCallback(() => {
    setChrome(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => !holdChrome.current && setChrome(false), 2600);
  }, []);
  useEffect(() => {
    poke();
    return () => window.clearTimeout(hideTimer.current);
  }, [poke]);
  const barProps = {
    onMouseEnter: () => {
      holdChrome.current = true;
    },
    onMouseLeave: () => {
      holdChrome.current = false;
      poke();
    },
  };

  const toggleDirection = () => {
    const next = rtl ? "ltr" : "rtl";
    setDirection(next);
    void api.itemsBulk([book.itemId], [{ op: "setDirection", direction: next }]).catch(() => {});
  };

  // ------------------------------------------------------------------ keyboard, wheel and clicks

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement && event.target.type !== "range") return;
      const element = stage.current;
      const scrollable = !!element && element.scrollHeight > element.clientHeight + 2;
      switch (event.key) {
        case "ArrowRight":
          rtl ? prev() : next();
          break;
        case "ArrowLeft":
          rtl ? next() : prev();
          break;
        case "ArrowDown":
        case "ArrowUp":
          if (scroll || scrollable) return; // the page scrolls natively
          event.key === "ArrowDown" ? next() : prev();
          break;
        case "PageDown":
        case "PageUp":
        case " ":
          if (scroll) {
            element?.scrollBy({ top: (event.key === "PageUp" || event.shiftKey ? -0.9 : 0.9) * element.clientHeight, behavior: "smooth" });
          } else {
            event.key === "PageUp" || event.shiftKey ? prev() : next();
          }
          break;
        case "Home":
          go(0);
          break;
        case "End":
          go(total - 1);
          break;
        case "+":
        case "=":
          zoomBy(1);
          break;
        case "-":
          zoomBy(-1);
          break;
        case "0":
          setZoom(1);
          break;
        case "f":
        case "F11":
          void toggleFullscreen();
          break;
        case "Escape":
          if (fullscreen) void toggleFullscreen();
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
  }, [rtl, next, prev, go, total, zoomBy, toggleFullscreen, fullscreen, onClose, scroll, poke]);

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

  const label =
    scroll || view.length === 1 ? `Page ${page + 1} of ${total}` : `Pages ${view[0] + 1}–${view[view.length - 1] + 1} of ${total}`;
  const transition = settings.transition === "none" || !motion ? "" : ` enter-${settings.transition}-${(motion === "next") !== rtl ? "forward" : "back"}`;
  const sliderFill = total > 1 ? (page / (total - 1)) * 100 : 100;

  return (
    <div className={`reader${chrome ? "" : " calm"}`} onMouseMove={poke}>
      <div
        ref={stage}
        className={`reader-stage${scroll ? " strip" : ""}`}
        onClick={onStageClick}
        onWheel={onWheel}
        onScroll={onStripScroll}
        onPointerDown={pan.onPointerDown}
        onPointerMove={pan.onPointerMove}
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
          <div className={`reader-view${transition}`} key={`${viewIndex}:${settings.mode}`}>
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
      </div>

      <header className={`reader-bar top${chrome ? "" : " hidden"}`} data-tauri-drag-region {...barProps}>
        <button type="button" className="round-btn" aria-label="Close the reader" title="Close (Esc)" onClick={onClose}>
          <ArrowLeft size={18} strokeWidth={2.6} />
        </button>
        <div className="reader-title" data-tauri-drag-region>
          <strong>{book.title}</strong>
          <span>{label}</span>
        </div>
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
        <button type="button" className="round-btn" aria-label={fullscreen ? "Leave full screen" : "Full screen"} title="Full screen (F)" onClick={() => void toggleFullscreen()}>
          {fullscreen ? <Shrink size={17} /> : <Expand size={17} />}
        </button>
        {!fullscreen && <WindowButtons />}
      </header>

      <footer className={`reader-bar bottom${chrome ? "" : " hidden"}`} {...barProps}>
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
    </div>
  );
}

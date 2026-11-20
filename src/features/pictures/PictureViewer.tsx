import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { ArrowLeft, ArrowLeftRight, ArrowUpDown, ChevronLeft, ChevronRight, Expand, FileText, Images, Info, LoaderCircle, Pause, Play, RotateCcw, RotateCw, Shrink, Wallpaper, ZoomIn, ZoomOut } from "lucide-react";
import { Marquee } from "../../components/Marquee";
import { api, errorText, pictureUrl, type ItemDetail, type PictureView, type QueryParams } from "../../lib/api";
import { useItem } from "../../lib/queries";
import { photoContext } from "../../lib/routes";
import { SLIDESHOW_SECONDS, usePreferences } from "../../lib/preferences";
import { WindowButtons } from "../../components/TitleBar";
import { isTyping } from "../../lib/shortcuts";
import { usePad } from "../../lib/gamepad";
import { BpClock, PlayerHints, useButtonNames, usePlayerController, usePlayerHints } from "../bigpicture/consoleControls";
import { useAutoHide, useFullscreen } from "../reader/chrome";
import { bigPictureActive } from "../../lib/bigpicture";

const MIN_ZOOM = 1;
const MAX_ZOOM = 8;
const NO_VIEW: PictureView = { rotate: 0, flipH: false, flipV: false };

/** The photos the viewer steps through: the library view it was opened from, else the photo's album or category. */
function useNeighbors(item: ItemDetail | undefined) {
  const params = useMemo<Omit<QueryParams, "offset" | "limit"> | null>(() => {
    if (!item) return null;
    const album = item.collectionPath.at(-1)?.id ?? null;
    return { category: item.category, collection: album, sort: "takenDesc" };
  }, [item]);
  return useQuery({
    queryKey: ["picture-neighbors", item?.id ?? 0, photoContext.params, params],
    enabled: !!item && !!params,
    staleTime: 60_000,
    queryFn: async () => {
      if (photoContext.params) {
        const fromView = await api.queryIds({ ...photoContext.params, handler: "image" });
        if (item && fromView.includes(item.id)) return fromView;
      }
      return api.queryIds({ ...params!, handler: "image" });
    },
  });
}

function viewOf(item: ItemDetail | undefined): PictureView {
  const view = (item?.metadata?.view ?? null) as Partial<PictureView> | null;
  if (!view) return NO_VIEW;
  const rotate = [0, 90, 180, 270].includes(Number(view.rotate)) ? (Number(view.rotate) as PictureView["rotate"]) : 0;
  return { rotate, flipH: !!view.flipH, flipV: !!view.flipV };
}

/** `/view/$id`: one photo, full window, with the album or gallery around it (D-033). */
export function PictureViewerPage() {
  const { id } = useParams({ from: "/view/$id" });
  const itemId = Number(id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const item = useItem(itemId);
  const neighbors = useNeighbors(item.data);
  const { preferences, update } = usePreferences();
  const { shown, poke, barProps } = useAutoHide();
  const [fullscreen, toggleFullscreen] = useFullscreen();
  const bigPicture = bigPictureActive();
  const [info, setInfo] = useState(false);
  const infoRef = useRef(false);
  infoRef.current = info;
  const [playing, setPlaying] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [loaded, setLoaded] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const drag = useRef<{ x: number; y: number; panX: number; panY: number; moved: boolean } | null>(null);
  const stage = useRef<HTMLDivElement>(null);

  const ids = neighbors.data ?? [];
  const index = ids.indexOf(itemId);
  const prevId = index > 0 ? ids[index - 1] : null;
  const nextId = index >= 0 && index < ids.length - 1 ? ids[index + 1] : null;
  const view = viewOf(item.data);
  const album = item.data?.collectionPath.at(-1) ?? null;

  const close = useCallback(() => {
    if (window.history.length > 1) window.history.back();
    else void navigate({ to: "/" });
  }, [navigate]);
  // Stepping replaces this photo in history, so closing goes back to where viewing began.
  const go = useCallback(
    (target: number | null) => {
      if (target == null) return;
      void navigate({ to: "/view/$id", params: { id: String(target) }, replace: true });
    },
    [navigate],
  );
  const first = ids[0] ?? null;

  // A new photo starts whole and centered.
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setFailed(false);
  }, [itemId]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 2600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  // Slideshow: the next photo after the chosen time, from the start again after the last; it waits
  // for each photo to load, and stops when anything is touched.
  useEffect(() => {
    if (!playing || loaded !== itemId) return;
    const timer = window.setTimeout(() => go(nextId ?? (ids.length > 1 ? first : null)), preferences.slideshowSeconds * 1000);
    return () => window.clearTimeout(timer);
  }, [playing, loaded, itemId, nextId, first, ids.length, go, preferences.slideshowSeconds]);

  // `next` is a zoom level, or a function of the current one (so quick presses add up).
  const zoomTo = useCallback((next: number | ((current: number) => number), around?: { x: number; y: number }) => {
    setZoom((current) => {
      const target = typeof next === "function" ? next(current) : next;
      const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, target));
      if (clamped === MIN_ZOOM) setPan({ x: 0, y: 0 });
      else if (around && stage.current) {
        // Keep the point under the pointer where it is.
        const rect = stage.current.getBoundingClientRect();
        const cx = around.x - rect.left - rect.width / 2;
        const cy = around.y - rect.top - rect.height / 2;
        setPan((p) => ({ x: cx - ((cx - p.x) * clamped) / current, y: cy - ((cy - p.y) * clamped) / current }));
      }
      return clamped;
    });
  }, []);

  const setView = async (next: PictureView) => {
    if (!item.data) return;
    try {
      await api.pictureSetView(item.data.id, next);
      await queryClient.invalidateQueries({ queryKey: ["item", item.data.id] });
      void queryClient.invalidateQueries({ queryKey: ["library"] });
    } catch (reason) {
      setNotice(errorText(reason));
    }
  };
  const turn = (by: 90 | -90) => void setView({ ...view, rotate: (((view.rotate + by) % 360) + 360) % 360 as PictureView["rotate"] });
  const flip = (axis: "flipH" | "flipV") => void setView({ ...view, [axis]: !view[axis] });

  const useAsAlbumCover = async () => {
    if (!album || !item.data) return;
    try {
      await api.collectionSetCover(album.id, item.data.id);
      void queryClient.invalidateQueries({ queryKey: ["collections"] });
      setNotice(`Cover of "${album.name}" set`);
    } catch (reason) {
      setNotice(errorText(reason));
    }
  };
  const useAsWallpaper = () => {
    if (!item.data) return;
    const on = preferences.homeWallpaper === item.data.id;
    update({ homeWallpaper: on ? null : item.data.id });
    setNotice(on ? "Home background removed" : "Set as Home background");
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event)) return;
      poke();
      const keys: Record<string, () => void> = {
        Escape: () => (infoRef.current ? setInfo(false) : close()),
        ArrowLeft: () => go(prevId),
        ArrowRight: () => go(nextId),
        Home: () => go(first),
        End: () => go(ids.at(-1) ?? null),
        " ": () => setPlaying((p) => !p),
        "+": () => zoomTo((z) => z * 1.25),
        "=": () => zoomTo((z) => z * 1.25),
        "-": () => zoomTo((z) => z / 1.25),
        "0": () => zoomTo(1),
        i: () => setInfo((v) => !v),
        r: () => turn(event.shiftKey ? -90 : 90),
        f: () => void toggleFullscreen(),
      };
      const action = keys[event.key];
      if (!action) return;
      event.preventDefault();
      if (event.key !== " ") setPlaying(false);
      action();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // A controller (Big Picture, D-025): left and right step, A zooms, X runs the slideshow, Y shows
  // the info, LB/RB zoom out and in, B closes. In Big Picture's selection mode A brings the
  // controls instead, to move through like a console (D-071), and the rest stays the same.
  const consoleMode = bigPicture && preferences.bigPicture.navigation === "focus";
  const root = useRef<HTMLDivElement>(null);
  const driving = usePlayerController(
    root,
    {
      left: () => { setPlaying(false); go(prevId); },
      right: () => { setPlaying(false); go(nextId); },
      lb: () => zoomTo((z) => z / 1.25),
      rb: () => zoomTo((z) => z * 1.25),
      x: () => setPlaying((p) => !p),
      y: () => setInfo((v) => !v),
      back: () => (infoRef.current ? setInfo(false) : close()),
    },
    poke,
  );
  const buttons = useButtonNames();
  const hints = usePlayerHints(driving, [
    { keys: ["◀", "▶"], label: "Photos" },
    { keys: [buttons.x], label: "Slideshow" },
    { keys: ["LB", "RB"], label: "Zoom" },
    { keys: [buttons.y], label: "Info" },
  ]);
  usePad((action) => {
    poke();
    if (action !== "x") setPlaying(false);
    switch (action) {
      case "left":
        go(prevId);
        return true;
      case "right":
        go(nextId);
        return true;
      case "accept":
        zoomTo(zoom > 1 ? 1 : 2.5);
        return true;
      case "lb":
        zoomTo((z) => z / 1.25);
        return true;
      case "rb":
        zoomTo((z) => z * 1.25);
        return true;
      case "x":
        setPlaying((p) => !p);
        return true;
      case "y":
        setInfo((v) => !v);
        return true;
      case "back":
        if (info) setInfo(false);
        else close();
        return true;
      default:
        return;
    }
  }, !consoleMode);

  const onWheel = (event: ReactWheelEvent) => {
    poke();
    // The wheel zooms; with the photo whole it steps through the photos instead when scrolled sideways.
    if (Math.abs(event.deltaX) > Math.abs(event.deltaY) && zoom === 1) {
      if (Math.abs(event.deltaX) > 30) go(event.deltaX > 0 ? nextId : prevId);
      return;
    }
    const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15;
    zoomTo((z) => z * factor, { x: event.clientX, y: event.clientY });
  };
  const onPointerDown = (event: ReactPointerEvent) => {
    if (event.button !== 0) return;
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y, moved: false };
  };
  const onPointerMove = (event: ReactPointerEvent) => {
    poke();
    const d = drag.current;
    if (!d) return;
    const dx = event.clientX - d.x;
    const dy = event.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 5) d.moved = true;
    if (zoom > 1) setPan({ x: d.panX + dx, y: d.panY + dy });
  };
  const onPointerUp = (event: ReactPointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d || zoom > 1) return;
    // With the photo whole, a sideways swipe steps to the next or previous one.
    const dx = event.clientX - d.x;
    if (d.moved && Math.abs(dx) > 80) go(dx < 0 ? nextId : prevId);
  };

  if (item.error) {
    return (
      <div className="reader picture-viewer">
        <div className="pv-message">
          <p>{errorText(item.error)}</p>
          <button type="button" className="btn" onClick={close}>Back</button>
        </div>
      </div>
    );
  }
  const data = item.data;
  const transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom}) rotate(${view.rotate}deg) scaleX(${view.flipH ? -1 : 1}) scaleY(${view.flipV ? -1 : 1})`;
  const position = index >= 0 && ids.length > 0 ? `${index + 1} of ${ids.length}` : "";
  const meta = (data?.metadata ?? {}) as Record<string, unknown>;
  const showBars = shown || driving || info || !data;

  return (
    <div ref={root} className={`reader picture-viewer${showBars ? "" : " calm"}`} onMouseMove={poke}>
      <div
        ref={stage}
        className={`pv-stage${zoom > 1 ? " zoomed" : ""}`}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={(event) => zoomTo(zoom > 1 ? 1 : 2.5, { x: event.clientX, y: event.clientY })}
      >
        {data && !failed && (
          <img
            key={`${data.id}:${data.updatedAt}`}
            className={`pv-image${loaded === data.id ? " shown" : ""}`}
            src={pictureUrl(data.id)}
            alt={data.title}
            draggable={false}
            style={{ transform }}
            onLoad={() => setLoaded(data.id)}
            onError={() => setFailed(true)}
          />
        )}
        {data && failed && <div className="pv-message"><p>This photo can't be shown. Its file may have moved.</p></div>}
        {(!data || (loaded !== data.id && !failed)) && <LoaderCircle className="pv-spinner spin" size={34} />}
      </div>

      {prevId != null && (
        <button type="button" className={`pv-side left${showBars ? "" : " hidden"}`} aria-label="Previous photo" onClick={() => { setPlaying(false); go(prevId); }}>
          <ChevronLeft size={30} strokeWidth={2.4} />
        </button>
      )}
      {nextId != null && (
        <button type="button" className={`pv-side right${showBars ? "" : " hidden"}`} aria-label="Next photo" onClick={() => { setPlaying(false); go(nextId); }}>
          <ChevronRight size={30} strokeWidth={2.4} />
        </button>
      )}

      <header className={`reader-bar top${showBars ? "" : " hidden"}`} data-tauri-drag-region {...barProps}>
        <button type="button" className="round-btn" aria-label="Close the viewer" title="Close (Esc)" onClick={close}>
          <ArrowLeft size={18} strokeWidth={2.6} />
        </button>
        <div className="reader-title" data-tauri-drag-region>
          <Marquee className="reader-name" text={data?.title ?? ""} />
          <Marquee className="reader-sub" text={[album?.name, position].filter(Boolean).join(" · ")} />
        </div>
        <span className="pv-spacer" data-tauri-drag-region />
        {bigPicture && <BpClock />}
        <button type="button" className={`round-btn${info ? " active" : ""}`} aria-label="Photo info" aria-pressed={info} title="Info (I)" onClick={() => setInfo((v) => !v)}>
          <Info size={17} />
        </button>
        {data && (
          <button type="button" className="round-btn" aria-label="Details" title="Details" onClick={() => void navigate({ to: "/item/$id", params: { id: String(data.id) } })}>
            <FileText size={17} />
          </button>
        )}
        {!bigPicture && (
          <button type="button" className="round-btn" aria-label={fullscreen ? "Leave full screen" : "Full screen"} title="Full screen (F)" onClick={() => void toggleFullscreen()}>
            {fullscreen ? <Shrink size={17} /> : <Expand size={17} />}
          </button>
        )}
        {!fullscreen && !bigPicture && <WindowButtons />}
      </header>

      <footer className={`reader-bar bottom pv-bar${showBars ? "" : " hidden"}`} {...barProps}>
        <button type="button" data-bp-autofocus className={`round-btn${playing ? " active" : ""}`} aria-label={playing ? "Stop the slideshow" : "Start a slideshow"} title="Slideshow (Space)" disabled={ids.length < 2} onClick={() => setPlaying((p) => !p)}>
          {playing ? <Pause size={17} /> : <Play size={17} />}
        </button>
        <select
          className="pv-speed"
          aria-label="Seconds per photo"
          value={preferences.slideshowSeconds}
          onChange={(event) => update({ slideshowSeconds: Number(event.target.value) })}
        >
          {SLIDESHOW_SECONDS.map((s) => (
            <option key={s} value={s}>{s} s</option>
          ))}
        </select>
        <span className="pv-divider" />
        <div className="reader-zoom">
          <button type="button" className="round-btn small" aria-label="Zoom out" disabled={zoom <= MIN_ZOOM} onClick={() => zoomTo(zoom / 1.25)}>
            <ZoomOut size={16} />
          </button>
          <button type="button" className="reader-zoom-value" title="Fit (0)" onClick={() => zoomTo(1)}>
            {Math.round(zoom * 100)}%
          </button>
          <button type="button" className="round-btn small" aria-label="Zoom in" disabled={zoom >= MAX_ZOOM} onClick={() => zoomTo(zoom * 1.25)}>
            <ZoomIn size={16} />
          </button>
        </div>
        <span className="pv-divider" />
        <button type="button" className="round-btn" aria-label="Turn left" title="Turn left (Shift+R)" disabled={!data} onClick={() => turn(-90)}>
          <RotateCcw size={17} />
        </button>
        <button type="button" className="round-btn" aria-label="Turn right" title="Turn right (R)" disabled={!data} onClick={() => turn(90)}>
          <RotateCw size={17} />
        </button>
        <button type="button" className={`round-btn${view.flipH ? " active" : ""}`} aria-label="Mirror left to right" aria-pressed={view.flipH} disabled={!data} onClick={() => flip("flipH")}>
          <ArrowLeftRight size={17} />
        </button>
        <button type="button" className={`round-btn${view.flipV ? " active" : ""}`} aria-label="Mirror top to bottom" aria-pressed={view.flipV} disabled={!data} onClick={() => flip("flipV")}>
          <ArrowUpDown size={17} />
        </button>
        <span className="pv-divider" />
        <button type="button" className="round-btn" aria-label={album ? `Use as the cover of ${album.name}` : "Use as an album cover"} title={album ? `Use as the cover of "${album.name}"` : "This photo isn't in an album"} disabled={!album} onClick={() => void useAsAlbumCover()}>
          <Images size={17} />
        </button>
        <button
          type="button"
          className={`round-btn${data && preferences.homeWallpaper === data.id ? " active" : ""}`}
          aria-label="Use as Home background"
          aria-pressed={!!data && preferences.homeWallpaper === data.id}
          title={data && preferences.homeWallpaper === data.id ? "Remove from Home's background" : "Use as Home background"}
          disabled={!data}
          onClick={useAsWallpaper}
        >
          <Wallpaper size={17} />
        </button>
      </footer>

      <PlayerHints shown={showBars} hints={hints} />
      {info && data && <InfoPanel item={data} meta={meta} />}
      {notice && <div className="pv-notice" role="status">{notice}</div>}
    </div>
  );
}

function InfoPanel({ item, meta }: { item: ItemDetail; meta: Record<string, unknown> }) {
  const file = item.versions.find((v) => v.kind === "digital")?.files[0];
  const width = Number(meta.width) || null;
  const height = Number(meta.height) || null;
  const taken = typeof meta.taken === "string" ? new Date(meta.taken) : null;
  const fileDate = typeof meta.fileDate === "number" ? new Date(meta.fileDate * 1000) : null;
  const location = meta.location as { lat?: number; lon?: number } | undefined;
  const rows: [string, string | null][] = [
    ["Taken", taken && !Number.isNaN(taken.getTime()) ? taken.toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" }) : null],
    ["File date", !taken && fileDate ? fileDate.toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" }) : null],
    ["Camera", typeof meta.camera === "string" ? meta.camera : null],
    ["Lens", typeof meta.lens === "string" ? meta.lens : null],
    ["Exposure", typeof meta.exposure === "string" ? meta.exposure : null],
    ["Size", width && height ? `${width} × ${height} (${((width * height) / 1e6).toFixed(1)} MP)` : null],
    ["File", file ? `${file.path.split(/[\\/]/).pop()}${file.size ? ` · ${formatBytes(file.size)}` : ""}` : null],
    ["Location", location?.lat != null && location.lon != null ? `${location.lat.toFixed(5)}, ${location.lon.toFixed(5)}` : null],
    ["Album", item.collectionPath.map((c) => c.name).join(" › ") || null],
    ["Added", new Date(item.addedAt).toLocaleDateString(undefined, { dateStyle: "medium" })],
  ];
  return (
    <aside className="pv-info" aria-label="Photo info">
      <h2>{item.title}</h2>
      <dl>
        {rows
          .filter(([, value]) => value)
          .map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
      </dl>
      {file && <p className="pv-path" title={file.path}>{file.path}</p>}
    </aside>
  );
}

function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}

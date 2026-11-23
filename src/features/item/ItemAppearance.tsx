import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { open } from "@tauri-apps/plugin-dialog";
import { ImagePlus, Trash } from "lucide-react";
import { api, artworkUrl, errorText, type CoverShape, type ItemDetail } from "../../lib/api";
import { coverShapeOf, SHAPE_ASPECT, usePreferences } from "../../lib/preferences";
import { libraryChanged } from "../../lib/queries";
import { Cover } from "../../components/common";

const COVER_COLORS = ["#1592d0", "#3fae49", "#f2a516", "#ef5f4f", "#d94f8c", "#8a63d2", "#2b3442", "#c9ced6"];
const IMAGES = ["jpg", "jpeg", "png", "webp", "gif", "bmp"];

/**
 * How an item looks, in Edit details (D-175): its artwork, its cover's shape (music square or a CD,
 * videos and Movies & Series horizontal or vertical), its color while it has no artwork, and a
 * video's own background on its page. Each change shows at once.
 */
export function ItemAppearance({ item }: { item: ItemDetail }) {
  const queryClient = useQueryClient();
  const { preferences } = usePreferences();
  const [error, setError] = useState<string | null>(null);
  const metadata = item.metadata as Record<string, unknown>;
  const backdrop = metadata.backdropKey as string | undefined;
  const ownShape = metadata.coverShape as CoverShape | undefined;
  const shape = coverShapeOf({ handler: item.handler, category: item.category, coverShape: ownShape }, preferences.coverShapes);

  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
      libraryChanged(queryClient);
    } catch (reason) {
      setError(errorText(reason));
    }
  };
  const pick = async (title: string) => {
    const path = await open({ multiple: false, title, filters: [{ name: "Images", extensions: IMAGES }] });
    return typeof path === "string" ? path : null;
  };
  // One that matches the default isn't stored.
  const setShape = (value: CoverShape) => {
    const usual = coverShapeOf({ handler: item.handler, category: item.category }, preferences.coverShapes);
    void run(() => api.itemsBulk([item.id], [{ op: "setCoverShape", shape: value === usual ? null : value }]));
  };
  const setColor = (color: string | null) => void run(() => api.itemsBulk([item.id], [{ op: "setCoverColor", color }]));
  const shapes =
    item.handler === "audio"
      ? ([
          ["square", "Square"],
          ["disc", "CD"],
        ] as const)
      : item.handler === "video"
        ? ([
            ["landscape", "Horizontal"],
            ["poster", "Vertical"],
          ] as const)
        : null;

  return (
    <section className="appearance" aria-label="Appearance">
      <div className="appearance-head">
        <span className="appearance-title">Appearance</span>
        <span className="muted">changes here show at once</span>
      </div>
      <div className="appearance-body">
        <div className="appearance-cover" data-shape={shape} style={{ aspectRatio: SHAPE_ASPECT[shape] }}>
          <Cover item={item} size="cover" />
        </div>
        <div className="appearance-controls">
          {item.handler !== "image" && (
            <div className="appearance-row">
              <span className="eyebrow">Artwork</span>
              <button type="button" className="btn btn-sm" onClick={() => void pick("Choose artwork").then((path) => (path ? run(() => api.itemSetCover(item.id, path)) : undefined))}>
                <ImagePlus size={14} /> Change artwork…
              </button>
            </div>
          )}
          {shapes && (
            <div className="appearance-row">
              <span className="eyebrow">Cover</span>
              <div className="segmented" role="group" aria-label="Cover shape">
                {shapes.map(([value, label]) => (
                  <button key={value} type="button" aria-pressed={shape === value} onClick={() => setShape(value)}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {!item.coverKey && (
            <div className="appearance-row cover-color-row" role="group" aria-label="Cover color">
              <span className="eyebrow">Cover color</span>
              <span className="swatches">
                {COVER_COLORS.map((color) => (
                  <button key={color} type="button" className="swatch" style={{ background: color }} aria-label={color} aria-pressed={item.coverColor === color} onClick={() => setColor(color)} />
                ))}
                <label className="swatch swatch-custom" title="Another color" style={{ background: "conic-gradient(red, yellow, lime, aqua, blue, magenta, red)" }}>
                  <span className="sr-only">Another color</span>
                  <input type="color" value={item.coverColor ?? "#5b7290"} onChange={(event) => setColor(event.target.value)} />
                </label>
              </span>
              {item.coverColor && (
                <button type="button" className="btn btn-sm" onClick={() => setColor(null)}>
                  Plain
                </button>
              )}
            </div>
          )}
          {item.handler === "video" && (
            <div className="appearance-row">
              <span className="eyebrow">Background</span>
              {backdrop && <span className="appearance-backdrop" style={{ backgroundImage: `url(${artworkUrl(backdrop)})` }} aria-hidden />}
              <button type="button" className="btn btn-sm" onClick={() => void pick("Choose a background").then((path) => (path ? run(() => api.itemSetBackdrop(item.id, path)) : undefined))}>
                <ImagePlus size={14} /> {backdrop ? "Change…" : "Choose…"}
              </button>
              {backdrop && (
                <button type="button" className="btn btn-sm" onClick={() => void run(() => api.itemSetBackdrop(item.id, null))}>
                  <Trash size={14} /> Remove
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      {error && <div className="dialog-error">{error}</div>}
    </section>
  );
}

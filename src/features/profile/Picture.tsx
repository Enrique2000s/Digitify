import { useRef, useState, type CSSProperties, type ReactNode, type PointerEvent as ReactPointerEvent } from "react";
import { UserRound } from "lucide-react";
import type { Profile, ProfileView } from "../../lib/api";
import { initials } from "./data";

/**
 * The profile's pictures (D-149, D-150): kept whole, each framed by its view (how much it's zoomed
 * in, and which point of it is in the middle). The picture has a frame: a circle, a rounded square
 * or a hexagon, with a rainbow, accent, gold or no ring.
 */

export const DEFAULT_VIEW: ProfileView = { zoom: 1, x: 50, y: 50 };

/** A picture covering its frame as its view says. */
export function viewStyle(view: ProfileView | undefined): CSSProperties {
  const v = view ?? DEFAULT_VIEW;
  return { objectFit: "cover", objectPosition: `${v.x}% ${v.y}%`, transform: v.zoom !== 1 ? `scale(${v.zoom})` : undefined, transformOrigin: `${v.x}% ${v.y}%` };
}

/** The picture in its frame, the initials without one; `ring` draws the frame's ring around it. */
export function Avatar({
  picture,
  name,
  size,
  ring = false,
  view,
  shape = "circle",
  ringStyle = "rainbow",
}: {
  picture: string | null;
  name: string;
  size: number;
  ring?: boolean;
  view?: ProfileView;
  shape?: string;
  ringStyle?: string;
}) {
  return (
    <span className={`profile-avatar${ring && ringStyle !== "none" ? " ring" : ""}`} data-shape={shape} data-ring={ringStyle} style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}>
      <span className="profile-avatar-face">{picture ? <img src={picture} alt="" style={viewStyle(view)} draggable={false} /> : <span className="profile-avatar-initials">{initials(name) || <UserRound size={size * 0.5} />}</span>}</span>
    </span>
  );
}

/** The profile's own picture, framed as chosen. */
export function ProfileAvatar({ profile, size, ring = false }: { profile: Profile | undefined; size: number; ring?: boolean }) {
  return <Avatar picture={profile?.avatar ?? null} name={profile?.name || "My Digitify"} size={size} ring={ring} view={profile?.avatarView} shape={profile?.shape} ringStyle={profile?.ring} />;
}

/** The banner, as its view says (the accent's colours without one); it drifts slowly. */
export function ProfileBanner({ profile }: { profile: Profile | undefined }) {
  return profile?.banner ? (
    <span className="profile-banner-drift">
      <img src={profile.banner} alt="" style={viewStyle(profile.bannerView)} draggable={false} />
    </span>
  ) : (
    <span className="profile-banner-default" />
  );
}

/**
 * Moving a picture in its frame (D-150): drag it to put another part in the middle, the slider (or
 * the wheel) to zoom in. Gives the view as it changes.
 */
export function PictureAdjuster({
  picture,
  view,
  onChange,
  kind,
  shape,
  overlay,
  aspect,
  round,
}: {
  picture: string;
  view: ProfileView;
  onChange: (view: ProfileView) => void;
  /** A tile is a Home Shortcut's screen (D-184), its own shape; a cover, an item's or a game's box (`aspect`). */
  kind: "avatar" | "banner" | "tile" | "cover";
  shape?: string;
  /** What's drawn over the picture where it's used (a shortcut's covers), not in the way of dragging. */
  overlay?: ReactNode;
  /** A cover's shape (width ÷ height), and whether it's a round CD. */
  aspect?: number;
  round?: boolean;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<{ x: number; y: number; view: ProfileView } | null>(null);
  const clamp = (v: number, low: number, high: number) => Math.min(high, Math.max(low, v));
  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging || !frame.current) return;
    const box = frame.current.getBoundingClientRect();
    // Dragging right brings the left of the picture into view: the middle moves left.
    const dx = ((event.clientX - dragging.x) / box.width) * (100 / dragging.view.zoom);
    const dy = ((event.clientY - dragging.y) / box.height) * (100 / dragging.view.zoom);
    onChange({ ...dragging.view, x: clamp(dragging.view.x - dx, 0, 100), y: clamp(dragging.view.y - dy, 0, 100) });
  };
  return (
    <div className="picture-adjuster">
      <div
        ref={frame}
        className={`picture-adjuster-frame ${kind}${round ? " round" : ""}`}
        data-shape={kind === "avatar" ? shape : undefined}
        style={kind === "cover" && aspect ? ({ aspectRatio: String(aspect), width: aspect >= 1 ? "min(100%, 560px)" : `${Math.round(400 * aspect)}px` } as CSSProperties) : undefined}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragging({ x: event.clientX, y: event.clientY, view });
        }}
        onPointerMove={move}
        onPointerUp={() => setDragging(null)}
        onPointerCancel={() => setDragging(null)}
        onWheel={(event) => onChange({ ...view, zoom: clamp(Math.round((view.zoom - event.deltaY / 600) * 100) / 100, 1, 4) })}
      >
        <img src={picture} alt="" style={viewStyle(view)} draggable={false} />
        {overlay}
      </div>
      <label className="picture-adjuster-zoom">
        <span>Zoom</span>
        <input
          type="range"
          min={1}
          max={4}
          step={0.01}
          value={view.zoom}
          aria-label="Zoom"
          style={{ "--fill": `${((view.zoom - 1) / 3) * 100}%` } as CSSProperties}
          onChange={(event) => onChange({ ...view, zoom: Number(event.target.value) })}
        />
      </label>
      <p className="hint">Drag the picture to choose what's in the middle; zoom in with the slider or the mouse wheel.</p>
    </div>
  );
}

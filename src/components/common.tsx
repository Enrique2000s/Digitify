import { spineColors } from "../lib/color";
import { useState, type ComponentType, type CSSProperties, type ReactNode } from "react";
import { Dialog as RadixDialog } from "radix-ui";
import {
  AudioLines,
  BookOpen,
  BookOpenText,
  Box,
  Camera,
  Clapperboard,
  Disc3,
  Folder,
  Gamepad2,
  GraduationCap,
  Image as ImageIcon,
  Map as MapIcon,
  Mic,
  Newspaper,
  PanelsTopLeft,
  Palette,
  Puzzle,
  Sparkles,
  Trophy,
  SquarePlay,
  Tv,
  X,
  type LucideProps,
} from "lucide-react";
import { artworkUrl, type Handler } from "../lib/api";

export function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 34 34" role="img" aria-label="Digitify">
      <rect x="1" y="1" width="32" height="32" rx="11" fill="var(--accent-bright)" />
      <path d="M12 1h10a11 11 0 0 1 11 11v3H1v-3A11 11 0 0 1 12 1z" fill="#ffffff" opacity="0.22" />
      <rect x="9" y="10" width="4" height="15" rx="2" fill="#ffffff" />
      <rect x="14.5" y="12.5" width="4" height="12.5" rx="2" fill="#ffffff" />
      <circle cx="24" cy="20.5" r="4.4" fill="none" stroke="#ffffff" strokeWidth="2.6" />
    </svg>
  );
}

/** Cover sizes the size slider steps through, in pixels of card width. */
export const CARD_SIZES = [120, 140, 160, 185, 210, 240];

/** The cover-size slider: it snaps to a few set sizes instead of sliding freely. */
export function CardSizeSlider({ value, onChange, style }: { value: number; onChange: (size: number) => void; style?: CSSProperties }) {
  const index = CARD_SIZES.reduce((best, size, i) => (Math.abs(size - value) < Math.abs(CARD_SIZES[best] - value) ? i : best), 0);
  return (
    <input
      type="range"
      min={0}
      max={CARD_SIZES.length - 1}
      step={1}
      value={index}
      aria-label="Cover size"
      aria-valuetext={`${CARD_SIZES[index]} pixels`}
      style={{ ...style, "--fill": `${(index / (CARD_SIZES.length - 1)) * 100}%` } as CSSProperties}
      onChange={(event) => onChange(CARD_SIZES[Number(event.target.value)])}
    />
  );
}

/** An on/off switch (announced as a switch to screen readers). */
export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" className="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}>
      <span aria-hidden />
    </button>
  );
}

/** Category icons by name (the core accepts the same names). */
export const CATEGORY_ICONS: Record<string, ComponentType<LucideProps>> = {
  book: BookOpen,
  comic: PanelsTopLeft,
  manga: BookOpenText,
  film: Clapperboard,
  music: AudioLines,
  palette: Palette,
  folder: Folder,
  gamepad: Gamepad2,
  disc: Disc3,
  camera: Camera,
  tv: Tv,
  newspaper: Newspaper,
  graduation: GraduationCap,
  map: MapIcon,
  puzzle: Puzzle,
  mic: Mic,
  image: ImageIcon,
  sparkles: Sparkles,
  trophy: Trophy,
  box: Box,
  play: SquarePlay,
};

const HANDLER_ICONS: Record<Handler, ComponentType<LucideProps>> = {
  book: BookOpen,
  comic: PanelsTopLeft,
  video: Clapperboard,
  audio: AudioLines,
  generic: Folder,
  image: ImageIcon,
};

export function CategoryIcon({ icon, size = 18, strokeWidth = 2.2 }: { icon: string; size?: number; strokeWidth?: number }) {
  const Icon = CATEGORY_ICONS[icon] ?? Folder;
  return <Icon size={size} strokeWidth={strokeWidth} aria-hidden />;
}

interface CoverSource {
  title: string;
  coverKey: string | null;
  handler: Handler;
  /** Without artwork: the color picked for the cover, if any. */
  coverColor?: string | null;
}

/** A picked color for a cover without art, with readable text and icon on it. */
function fallbackColors(color: string): CSSProperties {
  const { background, color: ink } = spineColors(color);
  return { background: `linear-gradient(160deg, ${color}, ${background})`, color: ink, ["--fallback-ink" as string]: ink };
}

/** Artwork, or a neutral tile with the title when there is none. */
export function Cover({ item, size = "thumb" }: { item: CoverSource; size?: "thumb" | "cover" }) {
  const [failed, setFailed] = useState(false);
  if (!item.coverKey || failed) {
    const Icon = HANDLER_ICONS[item.handler] ?? Folder;
    return (
      <div className="cover-fallback" style={!item.coverKey && item.coverColor ? fallbackColors(item.coverColor) : undefined}>
        <Icon size={22} strokeWidth={2} aria-hidden />
        <span>{item.title}</span>
      </div>
    );
  }
  return (
    <img
      className="cover-img"
      src={artworkUrl(item.coverKey, size)}
      alt=""
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setFailed(true)}
    />
  );
}

/** Albums are square; everything else uses a 2:3 poster/book shape. */
export function aspectFor(handler: Handler): number {
  return handler === "audio" ? 1 : 2 / 3;
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  wide,
  children,
  footer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  wide?: boolean;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="dialog-overlay" />
        <RadixDialog.Content className={wide ? "dialog wide" : "dialog"} aria-describedby={undefined}>
          <div className="dialog-header">
            <div>
              <RadixDialog.Title className="dialog-title">{title}</RadixDialog.Title>
              {description && <RadixDialog.Description className="dialog-description">{description}</RadixDialog.Description>}
            </div>
            <RadixDialog.Close className="icon-btn" aria-label="Close">
              <X size={18} />
            </RadixDialog.Close>
          </div>
          <div className="dialog-body">{children}</div>
          {footer && <div className="dialog-footer">{footer}</div>}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small className="hint">{hint}</small>}
    </label>
  );
}

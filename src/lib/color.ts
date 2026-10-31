// Accent color handling: the user picks one color, and readable variants are derived for each
// theme so text and buttons keep at least 4.5:1 contrast.

type Rgb = [number, number, number];

export function parseHex(hex: string): Rgb | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const value = parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function toHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
}

function luminance([r, g, b]: Rgb): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function mix(color: Rgb, target: Rgb, amount: number): Rgb {
  return color.map((c, i) => c + (target[i] - c) * amount) as Rgb;
}

/** Moves `color` toward white or black until it reaches `ratio` contrast against `background`. */
function ensureContrast(color: Rgb, background: Rgb, ratio: number, toward: "white" | "black"): Rgb {
  const target: Rgb = toward === "white" ? [255, 255, 255] : [0, 0, 0];
  for (let step = 0; step <= 20; step++) {
    const candidate = mix(color, target, step * 0.05);
    if (contrast(candidate, background) >= ratio) return candidate;
  }
  return target;
}

const rgba = (color: Rgb, alpha: number) => `rgba(${color.map(Math.round).join(", ")}, ${alpha})`;

// Breeze page backgrounds (tokens.css).
const DARK_BG: Rgb = [15, 22, 32];
const LIGHT_BG: Rgb = [237, 241, 245];
const WHITE: Rgb = [255, 255, 255];
const DARK_INK = "#062030";

export interface AccentVariables {
  /** Fill for primary buttons and switches, readable under `--accent-ink`. */
  "--accent": string;
  "--accent-ink": string;
  "--accent-soft": string;
  /** Accent-colored text on the page background. */
  "--accent-text": string;
  /** The color as picked, for glows, icons, progress and other graphics. */
  "--accent-bright": string;
  "--accent-glow": string;
  "--accent-ring": string;
}

export function accentVariables(hex: string, theme: "dark" | "light"): AccentVariables {
  const base = parseHex(hex) ?? ([21, 146, 208] as Rgb);
  if (theme === "dark") {
    const bright = mix(base, WHITE, 0.15);
    // Bright colors keep their vividness with dark text; mid tones darken a little for white text.
    const darkInk = contrast(base, WHITE) < 4.5 && contrast(base, parseHex(DARK_INK)!) >= 4.5;
    const fill = darkInk ? base : ensureContrast(base, WHITE, 4.5, "black");
    return {
      "--accent": toHex(fill),
      "--accent-ink": darkInk ? DARK_INK : "#ffffff",
      "--accent-soft": rgba(bright, 0.16),
      "--accent-text": toHex(ensureContrast(bright, DARK_BG, 4.5, "white")),
      "--accent-bright": toHex(bright),
      "--accent-glow": rgba(bright, 0.35),
      "--accent-ring": rgba(bright, 0.4),
    };
  }
  const fill = ensureContrast(base, WHITE, 4.5, "black");
  return {
    "--accent": toHex(fill),
    "--accent-ink": "#ffffff",
    "--accent-soft": rgba(base, 0.14),
    "--accent-text": toHex(ensureContrast(fill, LIGHT_BG, 4.5, "black")),
    "--accent-bright": toHex(base),
    "--accent-glow": rgba(base, 0.32),
    "--accent-ring": rgba(base, 0.35),
  };
}

/** A dark, readable background from an artwork's average color (for spines and fallbacks). */
export function spineColors(hex: string | null): { background: string; color: string } {
  const base = (hex && parseHex(hex)) || ([60, 62, 74] as Rgb);
  const background = contrast(base, WHITE) >= 4.5 ? base : mix(base, [0, 0, 0], 0.45);
  return { background: toHex(background), color: contrast(background, WHITE) >= 4.5 ? "#ffffff" : "#111111" };
}

export const ACCENT_PRESETS = [
  { name: "Sky", value: "#1592d0" },
  { name: "Leaf", value: "#3fae49" },
  { name: "Sun", value: "#f2a516" },
  { name: "Coral", value: "#ef5f4f" },
  { name: "Berry", value: "#d94f8c" },
  { name: "Grape", value: "#8a63d2" },
  { name: "Slate", value: "#5b7290" },
];

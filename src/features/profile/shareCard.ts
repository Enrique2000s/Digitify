import { artworkUrl, type Profile, type ProfileView } from "../../lib/api";
import { gameAspect } from "../arcade/shared";
import { hours, initials, sinceLabel, type ProfileSummary } from "./data";

/**
 * The profile's share card (D-149): a 1600 × 900 picture of the profile to send to anyone, no
 * account needed: the banner, the picture and name, four big figures, the most played games' covers
 * and this year's time per activity, signed "Made with Digitify". Drawn here on a canvas (the
 * covers come from the app's own artwork, which allows it) and given back as a PNG.
 */

const W = 1600;
const H = 900;
const FONT = '"Nunito Variable", "Nunito", "Segoe UI", sans-serif';

function load(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** The accent with some transparency (canvas colours don't mix like CSS's). */
function withAlpha(color: string, alpha: number): string {
  const hex = color.replace("#", "");
  const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
  if (!/^[0-9a-f]{6}$/i.test(full)) return `rgba(21, 146, 208, ${alpha})`;
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** Draws an image covering the box, its middle kept. */
function cover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const sw = w / scale;
  const sh = h / scale;
  ctx.drawImage(img, (img.naturalWidth - sw) / 2, (img.naturalHeight - sh) / 2, sw, sh, x, y, w, h);
}

/** Draws a picture in its frame as its view says (D-150), as the page shows it; the caller clips. */
function framed(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number, view: ProfileView | undefined) {
  const v = view ?? { zoom: 1, x: 50, y: 50 };
  const fill = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const iw = img.naturalWidth * fill;
  const ih = img.naturalHeight * fill;
  const ox = x + ((w - iw) * v.x) / 100;
  const oy = y + ((h - ih) * v.y) / 100;
  const px = x + (w * v.x) / 100;
  const py = y + (h * v.y) / 100;
  ctx.drawImage(img, px + (ox - px) * v.zoom, py + (oy - py) * v.zoom, iw * v.zoom, ih * v.zoom);
}

/** The frame's shape as a path, grown by `grow` on every side (D-150). */
function shapePath(ctx: CanvasRenderingContext2D, shape: Profile["shape"], x: number, y: number, size: number, grow = 0) {
  const s = size + grow * 2;
  const left = x - grow;
  const top = y - grow;
  ctx.beginPath();
  if (shape === "rounded") ctx.roundRect(left, top, s, s, s * 0.26);
  else if (shape === "hexagon") {
    const pts = [[0.25, 0.03], [0.75, 0.03], [0.99, 0.5], [0.75, 0.97], [0.25, 0.97], [0.01, 0.5]];
    pts.forEach(([px, py], i) => (i ? ctx.lineTo(left + px * s, top + py * s) : ctx.moveTo(left + px * s, top + py * s)));
    ctx.closePath();
  } else ctx.arc(left + s / 2, top + s / 2, s / 2, 0, Math.PI * 2);
}

/** Text cut with "…" to fit a width. */
function fit(ctx: CanvasRenderingContext2D, text: string, width: number): string {
  if (ctx.measureText(text).width <= width) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > width) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

function logo(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, accent: string) {
  const s = size / 34;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.fillStyle = accent;
  roundRect(ctx, 1, 1, 32, 32, 11);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.22)";
  ctx.beginPath();
  ctx.moveTo(12, 1);
  ctx.lineTo(22, 1);
  ctx.arcTo(33, 1, 33, 12, 11);
  ctx.lineTo(33, 15);
  ctx.lineTo(1, 15);
  ctx.lineTo(1, 12);
  ctx.arcTo(1, 1, 12, 1, 11);
  ctx.fill();
  ctx.fillStyle = "#fff";
  roundRect(ctx, 9, 10, 4, 15, 2);
  ctx.fill();
  roundRect(ctx, 14.5, 12.5, 4, 12.5, 2);
  ctx.fill();
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.arc(24, 20.5, 4.4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

export async function drawShareCard(profile: Profile, summary: ProfileSummary): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const css = getComputedStyle(document.documentElement);
  const accent = css.getPropertyValue("--accent-bright").trim() || "#1592d0";
  await Promise.all([document.fonts.load(`900 64px ${FONT}`), document.fonts.load(`700 24px ${FONT}`)]).catch(() => undefined);
  const [banner, avatar, ...covers] = await Promise.all([
    profile.banner ? load(profile.banner) : Promise.resolve(null),
    profile.avatar ? load(profile.avatar) : Promise.resolve(null),
    ...summary.topGames.slice(0, 5).map((g) => (g.coverKey ? load(artworkUrl(g.coverKey, "cover")) : Promise.resolve(null))),
  ]);

  // The night behind it all, lit by the accent.
  const back = ctx.createLinearGradient(0, 0, W, H);
  back.addColorStop(0, "#0b1220");
  back.addColorStop(1, "#111a2b");
  ctx.fillStyle = back;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W * 0.85, H * 0.95, 40, W * 0.85, H * 0.95, 700);
  glow.addColorStop(0, withAlpha(accent, 0.38));
  glow.addColorStop(1, withAlpha(accent, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // The banner across the top, fading into the night (the accent's colours without one).
  const bannerH = 330;
  if (banner) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, bannerH);
    ctx.clip();
    framed(ctx, banner, 0, 0, W, bannerH, profile.bannerView);
    ctx.restore();
  } else {
    const wash = ctx.createLinearGradient(0, 0, W, bannerH);
    wash.addColorStop(0, accent);
    wash.addColorStop(1, "#24125c");
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, W, bannerH);
    ctx.globalAlpha = 0.18;
    for (let i = 0; i < 9; i++) {
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(120 + i * 190, 60 + (i % 3) * 90, 40 + (i % 4) * 26, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  const fade = ctx.createLinearGradient(0, bannerH * 0.35, 0, bannerH + 2);
  fade.addColorStop(0, "rgba(11,18,32,0)");
  fade.addColorStop(1, "rgba(11,18,32,1)");
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, W, bannerH + 2);

  // The picture in its frame, with its ring (D-150).
  const ax = 90;
  const ay = 214;
  const size = 220;
  const shape = profile.shape ?? "circle";
  if (profile.ring !== "none") {
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.shadowBlur = 40;
    if (profile.ring === "gold") {
      const gold = ctx.createLinearGradient(ax, ay, ax + size, ay + size);
      gold.addColorStop(0, "#fff1a8");
      gold.addColorStop(0.3, "#e2b23c");
      gold.addColorStop(0.55, "#9c6a10");
      gold.addColorStop(0.8, "#f6d77a");
      gold.addColorStop(1, "#c8921f");
      ctx.fillStyle = gold;
    } else if (profile.ring === "rainbow") {
      const turn = ctx.createConicGradient(0, ax + size / 2, ay + size / 2);
      ["#1592d0", "#8b5cf6", "#e0478a", "#f2b33d", "#1592d0"].forEach((c, i, all) => turn.addColorStop(i / (all.length - 1), i === 0 || i === all.length - 1 ? accent : c));
      ctx.fillStyle = turn;
    } else ctx.fillStyle = accent;
    shapePath(ctx, shape, ax, ay, size, 10);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = "#0b1220";
    shapePath(ctx, shape, ax, ay, size, 3);
    ctx.fill();
  }
  ctx.save();
  shapePath(ctx, shape, ax, ay, size);
  ctx.clip();
  if (avatar) {
    framed(ctx, avatar, ax, ay, size, size, profile.avatarView);
  } else {
    const face = ctx.createLinearGradient(ax, ay, ax + size, ay + size);
    face.addColorStop(0, accent);
    face.addColorStop(1, "#3a2a8c");
    ctx.fillStyle = face;
    ctx.fillRect(ax, ay, size, size);
    ctx.fillStyle = "#fff";
    ctx.font = `900 92px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(initials(profile.name || "Digitify") || "D", ax + size / 2, ay + size / 2 + 4);
  }
  ctx.restore();

  // The name, the line about yourself, since when.
  const tx = ax + size + 48;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#fff";
  ctx.font = `900 66px ${FONT}`;
  ctx.fillText(fit(ctx, profile.name || "My Digitify", W - tx - 90), tx, 352);
  ctx.font = `700 28px ${FONT}`;
  ctx.fillStyle = "rgba(235,242,250,0.82)";
  if (profile.motto) ctx.fillText(fit(ctx, profile.motto, W - tx - 90), tx, 396);
  const facts = [sinceLabel(summary.since) && `Collecting since ${sinceLabel(summary.since)}`, summary.bestStreak > 1 && `Best streak ${summary.bestStreak} days`].filter(Boolean) as string[];
  ctx.font = `800 22px ${FONT}`;
  let fx = tx;
  for (const fact of facts) {
    const w = ctx.measureText(fact).width + 32;
    ctx.fillStyle = "rgba(255,255,255,0.1)";
    roundRect(ctx, fx, 418, w, 40, 20);
    ctx.fill();
    ctx.fillStyle = "rgba(235,242,250,0.9)";
    ctx.fillText(fact, fx + 16, 446);
    fx += w + 12;
  }

  // Four big figures.
  const figures: [string, string][] = [
    [summary.items.toLocaleString(), "In the library"],
    [hours(summary.played), "Played in Arcade"],
    [summary.completed.length.toLocaleString(), "Games completed"],
    [`${summary.reached.length}/${summary.achievements.length}`, "Achievements"],
  ];
  const cardY = 500;
  const cardW = (W - 180 - 3 * 24) / 4;
  figures.forEach(([value, label], i) => {
    const x = 90 + i * (cardW + 24);
    ctx.fillStyle = "rgba(255,255,255,0.07)";
    roundRect(ctx, x, cardY, cardW, 132, 26);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = i === 0 ? accent : "#fff";
    ctx.font = `900 54px ${FONT}`;
    ctx.fillText(fit(ctx, value, cardW - 48), x + 26, cardY + 70);
    ctx.fillStyle = "rgba(200,212,226,0.85)";
    ctx.font = `800 20px ${FONT}`;
    ctx.fillText(label.toUpperCase(), x + 26, cardY + 108);
  });

  // Most played, by cover.
  const rowY = 680;
  ctx.fillStyle = "rgba(200,212,226,0.85)";
  ctx.font = `800 20px ${FONT}`;
  ctx.fillText("MOST PLAYED", 90, rowY - 14);
  let cx = 90;
  const coverH = 150;
  summary.topGames.slice(0, 5).forEach((game, i) => {
    const w = Math.round(coverH * gameAspect(game));
    if (cx + w > 900) return;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.5)";
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 8;
    ctx.fillStyle = "#1b2638";
    roundRect(ctx, cx, rowY, w, coverH, 12);
    ctx.fill();
    ctx.restore();
    ctx.save();
    roundRect(ctx, cx, rowY, w, coverH, 12);
    ctx.clip();
    const img = covers[i];
    if (img) cover(ctx, img, cx, rowY, w, coverH);
    else {
      ctx.fillStyle = "rgba(255,255,255,0.8)";
      ctx.font = `800 16px ${FONT}`;
      ctx.fillText(fit(ctx, game.title, w - 16), cx + 8, rowY + coverH - 14);
    }
    ctx.restore();
    cx += w + 16;
  });
  if (summary.topGames.length === 0) {
    ctx.fillStyle = "rgba(235,242,250,0.6)";
    ctx.font = `700 22px ${FONT}`;
    ctx.fillText("No games played yet", 90, rowY + 60);
  }

  // This year, per activity.
  const bx = 960;
  const bw = W - bx - 90;
  ctx.fillStyle = "rgba(200,212,226,0.85)";
  ctx.font = `800 20px ${FONT}`;
  ctx.fillText(`${summary.year} SO FAR`, bx, rowY - 14);
  const rows: [string, number, string][] = [
    ["Read", summary.read, "#f2b33d"],
    ["Watched", summary.watch, "#e5484d"],
    ["Listened", summary.listen, "#30a46c"],
    ["Played", summary.play, accent],
  ];
  const most = Math.max(1, ...rows.map(([, s]) => s));
  rows.forEach(([label, seconds, color], i) => {
    const y = rowY + i * 38;
    ctx.fillStyle = "rgba(235,242,250,0.9)";
    ctx.font = `800 20px ${FONT}`;
    ctx.fillText(label, bx, y + 22);
    const trackX = bx + 120;
    const trackW = bw - 120 - 110;
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    roundRect(ctx, trackX, y + 6, trackW, 18, 9);
    ctx.fill();
    ctx.fillStyle = color;
    roundRect(ctx, trackX, y + 6, Math.max(18, (trackW * seconds) / most), 18, 9);
    ctx.fill();
    ctx.fillStyle = "rgba(235,242,250,0.85)";
    ctx.textAlign = "right";
    ctx.fillText(hours(seconds), bx + bw, y + 22);
    ctx.textAlign = "left";
  });

  // Signed.
  logo(ctx, 90, H - 62, 34, accent);
  ctx.fillStyle = "rgba(235,242,250,0.75)";
  ctx.font = `800 20px ${FONT}`;
  ctx.fillText("Made with Digitify", 136, H - 38);
  ctx.textAlign = "right";
  ctx.fillText(new Date().toLocaleDateString(undefined, { dateStyle: "long" }), W - 90, H - 38);
  ctx.textAlign = "left";

  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("The picture couldn't be made."))), "image/png"));
}

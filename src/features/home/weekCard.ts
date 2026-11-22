import type { WeekReview } from "../../lib/api";
import { timeLabel } from "./Stats";
import { weekChange, weekRange } from "./Week";

/**
 * Your week as a picture (D-164): 1600 × 900, drawn here on a canvas from this library's own
 * figures, nothing sent anywhere. The total and how it compares, the seven days as bars, the time
 * per activity, the week's most played game, most time with and most played artist, and your name,
 * signed "Made with Digitify".
 */

const W = 1600;
const H = 900;
const FONT = '"Nunito Variable", "Nunito", "Segoe UI", sans-serif';
const SERIES = [
  { key: "play", label: "Playing", color: "#cf4fb0" },
  { key: "listen", label: "Listening", color: "#1baf7a" },
  { key: "watch", label: "Watching", color: "#eb6834" },
  { key: "read", label: "Reading", color: "#3987e5" },
] as const;

/** A time short enough for the card's column: "2 h 15 min", "40 min", "<1 min". */
const short = (seconds: number) => (seconds > 0 && seconds < 60 ? "<1 min" : timeLabel(seconds));

function fit(ctx: CanvasRenderingContext2D, text: string, width: number): string {
  if (ctx.measureText(text).width <= width) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > width) cut = cut.slice(0, -1);
  return `${cut}…`;
}

export async function drawWeekCard(w: WeekReview, name: string): Promise<Blob> {
  await document.fonts?.ready;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This computer can't draw the picture.");
  const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent-bright").trim() || "#1592d0";

  // A deep sky, lit by the accent.
  const sky = ctx.createLinearGradient(0, 0, W, H);
  sky.addColorStop(0, "#0b1424");
  sky.addColorStop(1, "#141a33");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W * 0.15, 0, 0, W * 0.15, 0, W * 0.8);
  glow.addColorStop(0, `${accent}55`);
  glow.addColorStop(1, "transparent");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  const all = w.read + w.watch + w.listen + w.play;
  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "alphabetic";
  ctx.font = `900 30px ${FONT}`;
  ctx.globalAlpha = 0.75;
  ctx.fillText(fit(ctx, `${name.toUpperCase()} · MY WEEK IN DIGITIFY`, 900), 90, 120);
  ctx.globalAlpha = 1;
  ctx.font = `900 46px ${FONT}`;
  ctx.fillText(weekRange(w), 90, 180);

  // The total, and how it compares with the week before.
  ctx.font = `900 150px ${FONT}`;
  ctx.fillText(timeLabel(all), 84, 350);
  ctx.font = `800 34px ${FONT}`;
  ctx.globalAlpha = 0.75;
  const change = weekChange(w);
  ctx.fillText(`over ${w.daysActive} ${w.daysActive === 1 ? "day" : "days"}${change ? ` · ${change}` : ""}`, 92, 410);
  ctx.globalAlpha = 1;

  // Time per activity: a bar each, as long as its share of the week.
  let y = 490;
  const most = Math.max(...SERIES.map((s) => w[s.key]), 1);
  for (const s of SERIES) {
    ctx.fillStyle = "rgba(255,255,255,0.1)";
    ctx.beginPath();
    ctx.roundRect(90, y, 620, 22, 11);
    ctx.fill();
    if (w[s.key] > 0) {
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.roundRect(90, y, Math.max(22, (620 * w[s.key]) / most), 22, 11);
      ctx.fill();
    }
    ctx.fillStyle = "#ffffff";
    ctx.font = `800 28px ${FONT}`;
    ctx.fillText(s.label, 740, y + 21);
    ctx.font = `900 28px ${FONT}`;
    const t = short(w[s.key]);
    ctx.fillText(t, 1010 - ctx.measureText(t).width, y + 21);
    y += 62;
  }

  // The seven days.
  const daysTop = 120;
  const daysH = 300;
  const busiest = Math.max(...w.days.map((d) => d.seconds), 1);
  w.days.forEach((d, i) => {
    const x = 1100 + i * 62;
    const h = d.seconds > 0 ? Math.max(10, (daysH * d.seconds) / busiest) : 4;
    ctx.fillStyle = d.seconds > 0 ? accent : "rgba(255,255,255,0.18)";
    ctx.beginPath();
    ctx.roundRect(x, daysTop + daysH - h, 40, h, 8);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.font = `800 22px ${FONT}`;
    const label = new Date(`${d.day}T12:00:00`).toLocaleDateString(undefined, { weekday: "narrow" });
    ctx.fillText(label, x + 20 - ctx.measureText(label).width / 2, daysTop + daysH + 36);
  });

  // The week's favourites.
  const picks = [
    { title: "MOST PLAYED", entry: w.topGames[0], value: (n: number) => timeLabel(n * 60) },
    { title: "MOST TIME WITH", entry: w.topItems[0], value: (n: number) => timeLabel(n * 60) },
    { title: "ON REPEAT", entry: w.topArtists[0], value: (n: number) => `${n} ${n === 1 ? "play" : "plays"}` },
  ].filter((p) => p.entry);
  y = 530;
  for (const p of picks) {
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.font = `900 20px ${FONT}`;
    ctx.fillText(p.title, 1100, y);
    ctx.fillStyle = "#ffffff";
    ctx.font = `900 32px ${FONT}`;
    ctx.fillText(fit(ctx, p.entry.name, 410), 1100, y + 40);
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.font = `800 22px ${FONT}`;
    ctx.fillText(p.value(p.entry.count), 1100, y + 70);
    y += 105;
  }

  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.font = `800 22px ${FONT}`;
  const made = "Made with Digitify";
  ctx.fillText(made, W - 90 - ctx.measureText(made).width, H - 40);

  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("The picture couldn't be made."))), "image/png"));
}

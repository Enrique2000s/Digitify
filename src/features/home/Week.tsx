import { Marquee } from "../../components/Marquee";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { CalendarRange, ImageDown } from "lucide-react";
import { api, errorText, type WeekReview } from "../../lib/api";
import { plural } from "../../lib/format";
import { Dialog } from "../../components/common";
import { useProfile } from "../profile/data";
import { timeLabel } from "./Stats";
import { drawWeekCard } from "./weekCard";

const KINDS = [
  { key: "play", label: "playing" },
  { key: "listen", label: "listening" },
  { key: "watch", label: "watching" },
  { key: "read", label: "reading" },
] as const;

const total = (w: WeekReview) => w.read + w.watch + w.listen + w.play;

/** "Nov 15 – 21". */
export function weekRange(w: Pick<WeekReview, "start" | "end">): string {
  const start = new Date(`${w.start}T12:00:00`);
  const end = new Date(`${w.end}T12:00:00`);
  const sameMonth = start.getMonth() === end.getMonth();
  const a = start.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const b = end.toLocaleDateString(undefined, sameMonth ? { day: "numeric" } : { month: "short", day: "numeric" });
  return `${a} – ${b}`;
}

/** How this week compares with the one before: "+40 % on the week before", "2.5× the week before",
 *  "about the same…"; nothing when the week before had too little (under 10 minutes) to compare. */
export function weekChange(w: WeekReview): string | null {
  const now = total(w);
  if (w.previous < 600) return null;
  const ratio = now / w.previous;
  if (ratio >= 2) return `${ratio >= 10 ? Math.round(ratio) : ratio.toFixed(1).replace(/\.0$/, "")}× the week before`;
  const change = Math.round((ratio - 1) * 100);
  if (Math.abs(change) < 5) return "about the same as the week before";
  return `${change > 0 ? "+" : "−"}${Math.abs(change)} % on the week before`;
}

/**
 * Your week (D-164): one line on Home with the last seven days' time, the activities that had the
 * most, and a button to see it all (and keep it as a picture).
 */
export function WeekLine({ bigPicture = false }: { bigPicture?: boolean }) {
  const week = useQuery({ queryKey: ["week-review"], queryFn: api.weekReview, staleTime: 60_000 });
  const [open, setOpen] = useState(false);
  const w = week.data;
  if (!w) return null;
  const all = total(w);
  const parts = KINDS.filter((k) => w[k.key] > 0)
    .sort((a, b) => w[b.key] - w[a.key])
    .slice(0, 3)
    .map((k) => `${timeLabel(w[k.key])} ${k.label}`);
  if (w.finished > 0) parts.push(`${w.finished} finished`);
  return (
    <div className="week-line">
      <CalendarRange size={16} aria-hidden />
      <span>
        <b>This week</b> {all > 0 ? `· ${timeLabel(all)}${parts.length ? ` · ${parts.join(" · ")}` : ""}` : "· nothing yet: time reading, watching, listening and playing counts here"}
      </span>
      {!bigPicture && all > 0 && (
        <button type="button" className="btn btn-sm" onClick={() => setOpen(true)}>
          Your week
        </button>
      )}
      {!bigPicture && <WeekDialog week={w} open={open} onOpenChange={setOpen} />}
    </div>
  );
}

function WeekDialog({ week: w, open, onOpenChange }: { week: WeekReview; open: boolean; onOpenChange: (open: boolean) => void }) {
  const profile = useProfile();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const all = total(w);
  const most = Math.max(...w.days.map((d) => d.seconds), 1);
  const change = weekChange(w);
  const saveImage = async () => {
    setNote(null);
    const path = await saveDialog({ title: "Save your week as a picture", defaultPath: `My week in Digitify · ${w.end}.png`, filters: [{ name: "PNG picture", extensions: ["png"] }] });
    if (!path) return;
    setBusy(true);
    try {
      const blob = await drawWeekCard(w, profile.data?.name || "My Digitify");
      await api.profileSavePng(path.toLowerCase().endsWith(".png") ? path : `${path}.png`, new Uint8Array(await blob.arrayBuffer()));
      setNote("Saved.");
    } catch (reason) {
      setNote(errorText(reason));
    } finally {
      setBusy(false);
    }
  };
  const lists = [
    { title: "Most played games", list: w.topGames, value: (n: number) => timeLabel(n * 60) },
    { title: "Most time with", list: w.topItems, value: (n: number) => timeLabel(n * 60) },
    { title: "Most played artists", list: w.topArtists, value: (n: number) => plural(n, "play") },
  ].filter((l) => l.list.length > 0);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      wide
      title="Your week"
      description={`${weekRange(w)} · the last seven days, today included`}
      footer={
        <>
          {note && <span className="muted week-note">{note}</span>}
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void saveImage()}>
            <ImageDown size={16} /> Save as image
          </button>
        </>
      }
    >
      <div className="week viz-root">
        <p className="week-lead">
          <b>{timeLabel(all)}</b> with your library over {plural(w.daysActive, "day")}
          {change && <span className="muted"> · {change}</span>}
        </p>
        <div className="week-days" role="img" aria-label={w.days.map((d) => `${new Date(`${d.day}T12:00:00`).toLocaleDateString(undefined, { weekday: "long" })}: ${timeLabel(d.seconds)}`).join(", ")}>
          {w.days.map((d) => (
            <div key={d.day} className="week-day">
              <span className="week-bar" style={{ height: `${Math.max(d.seconds > 0 ? 6 : 2, (d.seconds / most) * 100)}%` }} />
              <span className="week-day-name">{new Date(`${d.day}T12:00:00`).toLocaleDateString(undefined, { weekday: "short" })}</span>
            </div>
          ))}
        </div>
        <div className="year-tiles week-tiles">
          {KINDS.map((k) => (
            <div key={k.key} className="year-tile">
              <span className="stat-label">
                <i className={`stats-swatch series-${k.key}`} aria-hidden />
                {k.label[0].toUpperCase() + k.label.slice(1)}
              </span>
              <strong>{w[k.key] > 0 && w[k.key] < 60 ? "<1 min" : timeLabel(w[k.key])}</strong>
            </div>
          ))}
        </div>
        <div className="year-facts week-facts">
          <div>
            <strong>{w.games.toLocaleString()}</strong>
            <span>{w.games === 1 ? "game played" : "games played"}</span>
          </div>
          <div>
            <strong>{w.items.toLocaleString()}</strong>
            <span>read, watched or listened to</span>
          </div>
          <div>
            <strong>{w.tracks.toLocaleString()}</strong>
            <span>{w.tracks === 1 ? "track played" : "tracks played"}</span>
          </div>
          <div>
            <strong>{w.finished.toLocaleString()}</strong>
            <span>finished</span>
          </div>
          <div>
            <strong>{w.added.toLocaleString()}</strong>
            <span>added to the library</span>
          </div>
        </div>
        {lists.length > 0 && (
          <div className="year-lists">
            {lists.map((l) => (
              <section key={l.title}>
                <h3>{l.title}</h3>
                <ol>
                  {l.list.map((entry) => (
                    <li key={entry.key}>
                      <Marquee className="year-list-name" text={entry.name} />
                      <b>{l.value(entry.count)}</b>
                    </li>
                  ))}
                </ol>
              </section>
            ))}
          </div>
        )}
      </div>
    </Dialog>
  );
}

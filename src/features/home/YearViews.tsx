import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Dialog as RadixDialog } from "radix-ui";
import { Award, CalendarDays, ChevronLeft, ChevronRight, X, CalendarHeart } from "lucide-react";
import { api, type Achievement } from "../../lib/api";
import { plural } from "../../lib/format";
import { timeLabel } from "./Stats";

const longDay = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

/** The activity calendar (D-067): every day of a year as a square, darker the more time it had. */
export function ActivityCalendar({ year, onYear }: { year: number; onYear: (year: number) => void }) {
  const thisYear = new Date().getFullYear();
  const days = useQuery({ queryKey: ["activity-calendar", year], queryFn: () => api.activityCalendar(year), staleTime: 60_000 });
  const [hover, setHover] = useState<{ day: string; seconds: number; x: number; y: number } | null>(null);
  const frame = useRef<HTMLElement>(null);
  const byDay = useMemo(() => new Map((days.data ?? []).map((d) => [d.day, d.seconds])), [days.data]);
  // Levels from the year's own busiest days, so a quiet year still shows its shape.
  const sorted = useMemo(() => [...byDay.values()].sort((a, b) => a - b), [byDay]);
  const level = (seconds: number) => {
    if (seconds <= 0 || sorted.length === 0) return 0;
    const rank = sorted.findIndex((s) => s >= seconds) / Math.max(1, sorted.length - 1);
    return rank < 0.25 ? 1 : rank < 0.5 ? 2 : rank < 0.8 ? 3 : 4;
  };
  // Weeks start on Sunday; the first column holds the days before January 1st as blanks.
  const cells: ({ day: string; seconds: number; future: boolean } | null)[] = [];
  const first = new Date(year, 0, 1);
  for (let i = 0; i < first.getDay(); i++) cells.push(null);
  const today = iso(new Date());
  for (let d = new Date(first); d.getFullYear() === year; d.setDate(d.getDate() + 1)) {
    const day = iso(d);
    cells.push({ day, seconds: byDay.get(day) ?? 0, future: day > today });
  }
  const months = Array.from({ length: 12 }, (_, m) => {
    const offset = first.getDay() + Math.round((new Date(year, m, 1).getTime() - first.getTime()) / 86_400_000);
    return { name: new Date(year, m, 1).toLocaleDateString(undefined, { month: "short" }), column: Math.floor(offset / 7) };
  });
  const total = (days.data ?? []).reduce((sum, d) => sum + d.seconds, 0);
  return (
    <figure ref={frame} className="calendar viz-root">
      <figcaption className="stats-chart-head">
        <span>
          <CalendarDays size={15} aria-hidden /> {year}: {plural(byDay.size, "active day")}
          {total > 0 && <span className="calendar-total"> · {timeLabel(total)}</span>}
        </span>
        <span className="calendar-years">
          <button type="button" className="icon-btn" aria-label="Previous year" onClick={() => onYear(year - 1)}>
            <ChevronLeft size={16} />
          </button>
          <button type="button" className="icon-btn" aria-label="Next year" disabled={year >= thisYear} onClick={() => onYear(year + 1)}>
            <ChevronRight size={16} />
          </button>
        </span>
      </figcaption>
      <div className="calendar-scroll">
        <div className="calendar-months" aria-hidden>
          {months.map((m) => (
            <span key={m.name} style={{ gridColumnStart: m.column + 1 }}>
              {m.name}
            </span>
          ))}
        </div>
        <div
          className="calendar-grid"
          role="img"
          aria-label={`Activity in ${year}: ${plural(byDay.size, "day")} with some, ${timeLabel(total)} in all.`}
          onMouseLeave={() => setHover(null)}
        >
          {cells.map((cell, i) =>
            cell ? (
              <span
                key={cell.day}
                className={`calendar-day level-${level(cell.seconds)}${cell.future ? " future" : ""}${cell.day === today ? " today" : ""}`}
                onMouseEnter={(event) => {
                  const box = frame.current!.getBoundingClientRect();
                  const r = event.currentTarget.getBoundingClientRect();
                  setHover({ day: cell.day, seconds: cell.seconds, x: r.left - box.left + r.width / 2, y: r.top - box.top });
                }}
              />
            ) : (
              <span key={`blank-${i}`} className="calendar-blank" />
            ),
          )}
        </div>
      </div>
      {hover && (
        <div className="stats-tip calendar-tip" role="tooltip" style={{ left: hover.x, top: hover.y }}>
          <strong>{longDay(hover.day)}</strong>
          <span>{hover.seconds > 0 ? timeLabel(hover.seconds) : "Nothing"}</span>
        </div>
      )}
      <div className="calendar-legend" aria-hidden>
        Less
        {[0, 1, 2, 3, 4].map((l) => (
          <span key={l} className={`calendar-day level-${l}`} />
        ))}
        More
      </div>
    </figure>
  );
}

/** One line per achievement family: the highest level reached, and how far to the next one. */
function families(list: Achievement[]) {
  const groups = new Map<string, Achievement[]>();
  for (const a of list) {
    const family = a.key.replace(/-\d+$/, "");
    groups.set(family, [...(groups.get(family) ?? []), a]);
  }
  return [...groups.entries()].map(([family, levels]) => {
    const reached = levels.filter((l) => l.unlockedAt);
    const next = levels.find((l) => !l.unlockedAt) ?? null;
    return { family, levels, reached, top: reached.at(-1) ?? null, next };
  });
}

/**
 * Every check can reach new achievements (the core remembers them as it goes), so every check
 * goes through here and announces what it reached.
 */
const ANNOUNCE = "digitify:achievements";
function checkAchievements(): Promise<Achievement[]> {
  return api.achievementsList().then((list) => {
    const fresh = list.filter((a) => a.new);
    if (fresh.length) window.dispatchEvent(new CustomEvent<Achievement[]>(ANNOUNCE, { detail: fresh }));
    return list;
  });
}

/** Statistics' achievements (D-093): how many are reached, the latest, and the way to their screen. */
export function AchievementsSummary() {
  const list = useQuery({ queryKey: ["achievements"], queryFn: checkAchievements, staleTime: 60_000 });
  if (!list.data) return null;
  const reached = list.data.filter((a) => a.unlockedAt).sort((a, b) => (b.unlockedAt ?? "").localeCompare(a.unlockedAt ?? ""));
  const latest = reached[0];
  return (
    <section className="achievements-summary">
      <span className="achievement-medal" aria-hidden>
        <Award size={22} />
      </span>
      <div>
        <h3>Achievements</h3>
        <span>
          {reached.length} of {list.data.length} reached{latest ? ` · latest: ${latest.title}` : ""}
        </span>
      </div>
      <Link to="/achievements" className="btn btn-sm">
        See all
      </Link>
    </section>
  );
}

const longDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });

/**
 * `/achievements` (D-093): every achievement on a screen of its own. Each family with its levels
 * as medals (reached ones lit, with the day), what it counts, and how far to the next.
 */
export function AchievementsPage() {
  const list = useQuery({ queryKey: ["achievements"], queryFn: checkAchievements, staleTime: 30_000 });
  const all = list.data ? families(list.data) : [];
  const count = list.data?.filter((a) => a.unlockedAt).length ?? 0;
  return (
    <div className="page achievements-page">
      <div className="page-header">
        <div className="title-row">
          <span className="title-badge">
            <Award size={26} strokeWidth={2.2} aria-hidden />
          </span>
          <div>
            <h1 className="display">Achievements</h1>
            <p className="achievements-lead">
              {list.data ? `${count} of ${list.data.length} reached` : "…"} · They come by themselves as you read, watch, listen and play.
            </p>
          </div>
        </div>
        {list.data && (
          <span className="achievements-total" role="progressbar" aria-valuenow={count} aria-valuemin={0} aria-valuemax={list.data.length} aria-label="Achievements reached">
            <span style={{ width: `${(count / Math.max(1, list.data.length)) * 100}%` }} />
          </span>
        )}
      </div>
      <div className="achievement-families">
        {all.map(({ family, levels, reached, next }) => (
          <section key={family} className={`panel achievement-family${reached.length ? " reached" : ""}`}>
            <header>
              <span className="achievement-medal" aria-hidden>
                <Award size={22} />
              </span>
              <div>
                <h2>{levels[0].title.replace(/ I$/, "")}</h2>
                <span>{next ? `Next: ${next.description} · ${next.progress.toLocaleString()} of ${next.goal.toLocaleString()}` : `All ${levels.length} levels reached`}</span>
              </div>
            </header>
            {next && (
              <span className="achievement-meter">
                <span style={{ width: `${(next.progress / next.goal) * 100}%` }} />
              </span>
            )}
            <ol className="achievement-levels">
              {levels.map((level, n) => (
                <li key={level.key} className={level.unlockedAt ? "on" : undefined} title={level.unlockedAt ? `Reached ${longDate(level.unlockedAt)}` : `${level.progress.toLocaleString()} of ${level.goal.toLocaleString()}`}>
                  <span className="achievement-level-medal">{["I", "II", "III", "IV", "V"][n] ?? n + 1}</span>
                  <strong>{level.description}</strong>
                  <span>{level.unlockedAt ? longDate(level.unlockedAt) : "Not yet"}</span>
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>
    </div>
  );
}

/**
 * Checks for new achievements now and then, and shows a small notice for them (D-066). The first
 * check after the library opens counts too, so achievements a library already earned are
 * announced once, together.
 */
export function AchievementNotice() {
  const queryClient = useQueryClient();
  const [shown, setShown] = useState<Achievement[]>([]);
  useEffect(() => {
    const announce = (event: Event) => setShown((event as CustomEvent<Achievement[]>).detail);
    window.addEventListener(ANNOUNCE, announce);
    const check = () => void checkAchievements().then((list) => queryClient.setQueryData(["achievements"], list), () => {});
    const first = window.setTimeout(check, 8_000);
    const every = window.setInterval(check, 5 * 60_000);
    return () => {
      window.removeEventListener(ANNOUNCE, announce);
      window.clearTimeout(first);
      window.clearInterval(every);
    };
  }, [queryClient]);
  useEffect(() => {
    if (!shown.length) return;
    const t = window.setTimeout(() => setShown([]), 7_000);
    return () => window.clearTimeout(t);
  }, [shown]);
  if (!shown.length) return null;
  const last = shown.at(-1)!;
  return (
    <div className="achievement-notice" role="status">
      <span className="achievement-medal" aria-hidden>
        <Award size={20} />
      </span>
      <div>
        <strong>{shown.length === 1 ? "Achievement reached" : `${shown.length} achievements reached`}</strong>
        <span>
          {last.title}: {last.description}
          {shown.length > 1 && " and more, in Statistics"}
        </span>
      </div>
      <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => setShown([])}>
        <X size={16} />
      </button>
    </div>
  );
}

const MONTH = (m: number) => new Date(2000, m - 1, 1).toLocaleDateString(undefined, { month: "long" });

/** Your year in Digitify (D-065): the year's summary, one big screen. */
export function YearReview({ year, open, onOpenChange }: { year: number; open: boolean; onOpenChange: (open: boolean) => void }) {
  const review = useQuery({ queryKey: ["year-review", year], queryFn: () => api.yearReview(year), enabled: open });
  const r = review.data;
  const hours = r ? r.read + r.watch + r.listen + r.play : 0;
  const tiles = r
    ? [
        { label: "Reading", value: r.read, series: "read" },
        { label: "Watching", value: r.watch, series: "watch" },
        { label: "Listening", value: r.listen, series: "listen" },
        { label: "Playing", value: r.play, series: "play" },
      ]
    : [];
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="dialog-overlay year-overlay" />
        <RadixDialog.Content className="year-review viz-root" aria-describedby={undefined}>
          <RadixDialog.Close className="icon-btn year-close" aria-label="Close">
            <X size={20} />
          </RadixDialog.Close>
          <RadixDialog.Title className="year-title">
            <CalendarHeart size={22} aria-hidden /> Your {year} in Digitify
          </RadixDialog.Title>
          {!r ? (
            <div className="year-loading" aria-busy />
          ) : hours === 0 && r.added === 0 ? (
            <p className="year-lead">Nothing recorded in {year}. Time spent reading, watching, listening and playing shows up here.</p>
          ) : (
            <>
              <p className="year-lead">
                <b>{timeLabel(hours)}</b> with your library, over <b>{plural(r.daysActive, "day")}</b>.
              </p>
              <div className="year-tiles">
                {tiles.map((t) => (
                  <div key={t.label} className="year-tile">
                    <span className="stat-label">
                      <i className={`stats-swatch series-${t.series}`} aria-hidden />
                      {t.label}
                    </span>
                    <strong>{timeLabel(t.value)}</strong>
                  </div>
                ))}
              </div>
              <div className="year-facts">
                <div>
                  <strong>{r.finished.toLocaleString()}</strong>
                  <span>finished</span>
                </div>
                <div>
                  <strong>{r.added.toLocaleString()}</strong>
                  <span>added to the library</span>
                </div>
                <div>
                  <strong>{plural(r.longestStreak, "day")}</strong>
                  <span>longest streak</span>
                </div>
                {r.bestMonth && (
                  <div>
                    <strong>{MONTH(r.bestMonth[0])}</strong>
                    <span>busiest month · {timeLabel(r.bestMonth[1])}</span>
                  </div>
                )}
                {r.bestDay && (
                  <div>
                    <strong>{new Date(`${r.bestDay[0]}T12:00:00`).toLocaleDateString(undefined, { month: "long", day: "numeric" })}</strong>
                    <span>busiest day · {timeLabel(r.bestDay[1])}</span>
                  </div>
                )}
              </div>
              <div className="year-lists">
                {[
                  { title: "Most time with", list: r.topItems, value: (n: number) => timeLabel(n * 60) },
                  { title: "Most played games", list: r.topGames, value: (n: number) => timeLabel(n * 60) },
                  { title: "Most played artists", list: r.topArtists, value: (n: number) => plural(n, "play") },
                ]
                  .filter((l) => l.list.length > 0)
                  .map((l) => (
                    <section key={l.title}>
                      <h3>{l.title}</h3>
                      <ol>
                        {l.list.map((entry) => (
                          <li key={entry.key}>
                            <span>{entry.name}</span>
                            <b>{l.value(entry.count)}</b>
                          </li>
                        ))}
                      </ol>
                    </section>
                  ))}
              </div>
            </>
          )}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

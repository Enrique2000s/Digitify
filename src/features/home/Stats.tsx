import { useEffect, useState } from "react";
import { Flame, Sparkles, Target } from "lucide-react";
import { AchievementsList, ActivityCalendar, YearReview } from "./YearViews";
import { usePreferences, type Goals } from "../../lib/preferences";
import { Dialog, Field } from "../../components/common";
import { useQuery } from "@tanstack/react-query";
import { api, type ActivityTime, type LibraryStats } from "../../lib/api";
import { plural } from "../../lib/format";

const SERIES: { key: keyof ActivityTime; label: string }[] = [
  { key: "read", label: "Reading" },
  { key: "watch", label: "Watching" },
  { key: "listen", label: "Listening" },
  { key: "play", label: "Playing" },
];

/** "2 h 15 min", "40 min", "under a minute". */
export function timeLabel(seconds: number): string {
  if (seconds <= 0) return "0 min";
  if (seconds < 60) return "under a minute";
  const minutes = Math.round(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours === 0) return `${minutes} min`;
  return minutes % 60 === 0 ? `${hours} h` : `${hours} h ${minutes % 60} min`;
}

const dayName = (day: string, style: "short" | "long") =>
  new Date(`${day}T12:00:00`).toLocaleDateString(undefined, style === "short" ? { weekday: "narrow" } : { weekday: "long", month: "short", day: "numeric" });

/** The last 14 days as stacked bars (reading, watching, listening, playing), with a tooltip per day and a table view. */
function DaysChart({ days }: { days: LibraryStats["days"] }) {
  const [hover, setHover] = useState<number | null>(null);
  const totals = days.map((d) => d.read + d.watch + d.listen + d.play);
  const max = Math.max(...totals, 1);
  const empty = totals.every((t) => t === 0);
  const summary = `Time per day over the last 14 days: ${empty ? "nothing yet" : `${timeLabel(totals.reduce((a, b) => a + b, 0))} in all`}.`;
  return (
    <figure className="stats-chart">
      <figcaption className="stats-chart-head">
        <span>Last 14 days</span>
        <span className="stats-legend">
          {SERIES.map((series) => (
            <span key={series.key}>
              <i className={`stats-swatch series-${series.key}`} aria-hidden />
              {series.label}
            </span>
          ))}
        </span>
      </figcaption>
      <div className="stats-bars" role="img" aria-label={summary} onMouseLeave={() => setHover(null)}>
        {days.map((day, index) => (
          <div key={day.day} className="stats-col" onMouseEnter={() => setHover(index)}>
            <div className="stats-stack" style={{ height: `${(totals[index] / max) * 100}%` }}>
              {[...SERIES].reverse().map((series) =>
                day[series.key] > 0 ? <span key={series.key} className={`series-${series.key}`} style={{ flexGrow: day[series.key] }} /> : null,
              )}
            </div>
            <span className="stats-day">{dayName(day.day, "short")}</span>
            {hover === index && (
              <div className="stats-tip" role="tooltip">
                <strong>{dayName(day.day, "long")}</strong>
                {SERIES.map((series) => (
                  <span key={series.key}>
                    <i className={`stats-swatch series-${series.key}`} aria-hidden />
                    {series.label} <b>{timeLabel(day[series.key])}</b>
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
        {empty && <p className="stats-empty">Nothing recorded in the last 14 days.</p>}
      </div>
      <details className="stats-table">
        <summary>Show as a table</summary>
        <table>
          <thead>
            <tr>
              <th>Day</th>
              {SERIES.map((series) => (
                <th key={series.key}>{series.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {days.map((day) => (
              <tr key={day.day}>
                <td>{dayName(day.day, "long")}</td>
                {SERIES.map((series) => (
                  <td key={series.key}>{timeLabel(day[series.key])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

const GOAL_ROWS: { key: keyof Goals; label: string; unit: "items" | "hours"; series?: keyof ActivityTime }[] = [
  { key: "finished", label: "Finished", unit: "items" },
  { key: "read", label: "Reading", unit: "hours", series: "read" },
  { key: "watch", label: "Watching", unit: "hours", series: "watch" },
  { key: "listen", label: "Listening", unit: "hours", series: "listen" },
  { key: "play", label: "Playing", unit: "hours", series: "play" },
];

/** This month's goals (D-052): how far along each one is; set them in a small dialog. */
function GoalsRow({ stats }: { stats: LibraryStats }) {
  const { preferences, update } = usePreferences();
  const goals = preferences.goals;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Goals>(goals);
  useEffect(() => {
    if (open) setDraft(goals);
  }, [open, goals]);
  const set = GOAL_ROWS.filter((row) => goals[row.key] > 0);
  const done = (row: (typeof GOAL_ROWS)[number]) => (row.unit === "items" ? stats.finishedMonth : stats.month[row.series!] / 3600);
  return (
    <div className="goals">
      <div className="goals-head">
        <span className="stat-label">
          <Target size={14} aria-hidden /> This month's goals
        </span>
        <button type="button" className="btn btn-sm" onClick={() => setOpen(true)}>
          {set.length ? "Change goals" : "Set goals"}
        </button>
      </div>
      {set.length === 0 ? (
        <p className="stats-none">No goals yet: set how many things to finish, or how many hours to read, watch, listen or play this month.</p>
      ) : (
        <ul className="goal-list">
          {set.map((row) => {
            const value = done(row);
            const target = goals[row.key];
            const fraction = Math.min(1, value / target);
            const reached = value >= target;
            return (
              <li key={row.key} className={reached ? "reached" : undefined}>
                <span className="goal-name">
                  {row.series && <i className={`stats-swatch series-${row.series}`} aria-hidden />}
                  {row.label}
                </span>
                <span className="goal-meter" role="progressbar" aria-valuenow={Math.round(fraction * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={`${row.label}: ${Math.round(fraction * 100)}%`}>
                  <span className={row.series ? `series-${row.series}` : "goal-finished"} style={{ width: `${fraction * 100}%` }} />
                </span>
                <b>
                  {row.unit === "items" ? value.toLocaleString() : value < 1 && value > 0 ? "<1" : Math.floor(value).toLocaleString()} / {target} {row.unit === "items" ? "" : "h"}
                  {reached && " ✓"}
                </b>
              </li>
            );
          })}
        </ul>
      )}
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="This month's goals"
        description="Leave a goal at 0 to have none. Goals start over every month."
        footer={
          <>
            <button type="button" className="btn" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                update({ goals: draft });
                setOpen(false);
              }}
            >
              Save goals
            </button>
          </>
        }
      >
        <div className="goal-fields">
          {GOAL_ROWS.map((row) => (
            <Field key={row.key} label={row.unit === "items" ? "Things to finish (books, comics, films…)" : `Hours of ${row.label.toLowerCase()}`}>
              <input
                className="input"
                type="number"
                min={0}
                inputMode="numeric"
                value={draft[row.key]}
                onChange={(event) => setDraft({ ...draft, [row.key]: Math.max(0, Math.round(Number(event.target.value) || 0)) })}
              />
            </Field>
          ))}
        </div>
      </Dialog>
    </div>
  );
}

/** Home's statistics widget (D-023). */
export function StatsPanel() {
  const stats = useQuery({ queryKey: ["stats"], queryFn: api.stats, staleTime: 60_000 });
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [review, setReview] = useState(false);
  const s = stats.data;
  if (!s) return <div className="stats panel stats-loading" aria-busy />;
  const largest = Math.max(...s.categories.map((c) => c.count), 1);
  return (
    <div className="stats panel viz-root">
      <div className="stat-tiles">
        {SERIES.map((series) => (
          <div key={series.key} className="stat-tile">
            <span className="stat-label">
              <i className={`stats-swatch series-${series.key}`} aria-hidden />
              {series.label} this month
            </span>
            <strong className="stat-value">{timeLabel(s.month[series.key])}</strong>
            <span className="stat-note">{timeLabel(s.year[series.key])} this year</span>
          </div>
        ))}
        <div className="stat-tile streak-tile">
          <span className="stat-label">
            <Flame size={14} aria-hidden /> Streak
          </span>
          <strong className="stat-value">{s.streak === 1 ? "1 day" : `${s.streak.toLocaleString()} days`}</strong>
          <span className="stat-note">Best: {s.bestStreak === 1 ? "1 day" : `${s.bestStreak.toLocaleString()} days`} in a row</span>
        </div>
        <div className="stat-tile">
          <span className="stat-label">Finished this month</span>
          <strong className="stat-value">{s.finishedMonth.toLocaleString()}</strong>
          <span className="stat-note">
            {s.finishedYear.toLocaleString()} this year · {s.inProgress.toLocaleString()} in progress
          </span>
        </div>
      </div>
      <GoalsRow stats={s} />
      <div className="calendar-row">
        <ActivityCalendar year={year} onYear={setYear} />
        <button type="button" className="btn year-button" onClick={() => setReview(true)}>
          <Sparkles size={16} /> Your {year}
        </button>
      </div>
      <YearReview year={year} open={review} onOpenChange={setReview} />
      <div className="stats-row">
        <DaysChart days={s.days} />
        <div className="stats-lists">
          <section>
            <h3>Most played artists this year</h3>
            {s.topArtists.length === 0 ? (
              <p className="stats-none">Nothing played yet this year.</p>
            ) : (
              <ol className="stats-artists">
                {s.topArtists.map((artist) => (
                  <li key={artist.key}>
                    <span>{artist.name}</span>
                    <b>{plural(artist.count, "play")}</b>
                  </li>
                ))}
              </ol>
            )}
          </section>
          {s.topGames.length > 0 && (
            <section>
              <h3>Most played games this year</h3>
              <ol className="stats-artists">
                {s.topGames.map((game) => (
                  <li key={game.key}>
                    <span>{game.name}</span>
                    <b>{timeLabel(game.count * 60)}</b>
                  </li>
                ))}
              </ol>
            </section>
          )}
          <AchievementsList />
          <section>
            <h3>Your library</h3>
            <ul className="stats-categories">
              {s.categories.map((category) => (
                <li key={category.key}>
                  <span>{category.name}</span>
                  <span className="stats-meter" aria-hidden>
                    <span style={{ width: `${(category.count / largest) * 100}%` }} />
                  </span>
                  <b>{category.count.toLocaleString()}</b>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
      <p className="stats-since">
        {s.since
          ? `Time counts while a reader is open and in use, while a video or music plays, or while a game from Arcade runs (since ${new Date(`${s.since}T12:00:00`).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}). It stays on this computer.`
          : "Time spent reading, watching, listening and playing shows up here once you start. It stays on this computer."}
        {s.playsMonth > 0 && ` ${plural(s.playsMonth, "track")} played this month.`}
      </p>
    </div>
  );
}

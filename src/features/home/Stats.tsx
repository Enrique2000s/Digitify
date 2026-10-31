import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type ActivityTime, type LibraryStats } from "../../lib/api";
import { plural } from "../../lib/format";

const SERIES: { key: keyof ActivityTime; label: string }[] = [
  { key: "read", label: "Reading" },
  { key: "watch", label: "Watching" },
  { key: "listen", label: "Listening" },
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

/** The last 14 days as stacked bars (reading, watching, listening), with a tooltip per day and a table view. */
function DaysChart({ days }: { days: LibraryStats["days"] }) {
  const [hover, setHover] = useState<number | null>(null);
  const totals = days.map((d) => d.read + d.watch + d.listen);
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

/** Home's statistics widget (D-023). */
export function StatsPanel() {
  const stats = useQuery({ queryKey: ["stats"], queryFn: api.stats, staleTime: 60_000 });
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
        <div className="stat-tile">
          <span className="stat-label">Finished this month</span>
          <strong className="stat-value">{s.finishedMonth.toLocaleString()}</strong>
          <span className="stat-note">
            {s.finishedYear.toLocaleString()} this year · {s.inProgress.toLocaleString()} in progress
          </span>
        </div>
      </div>
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
          ? `Time counts while a reader is open and in use, or while a video or music plays (since ${new Date(`${s.since}T12:00:00`).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}). It stays on this computer.`
          : "Time spent reading, watching and listening shows up here once you start. It stays on this computer."}
        {s.playsMonth > 0 && ` ${plural(s.playsMonth, "track")} played this month.`}
      </p>
    </div>
  );
}

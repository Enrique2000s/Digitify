import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Marquee } from "../../components/Marquee";
import { Award, BadgeCheck, BookOpen, Clapperboard, Flame, Gamepad2, Headphones, LibraryBig, Star, Trophy } from "lucide-react";
import { api } from "../../lib/api";
import { CategoryIcon, Cover } from "../../components/common";
import { FILTER_LABELS, GameCover, gameAspect } from "../arcade/shared";
import { LogoMark } from "../arcade/logos";
import { hours, sinceLabel, useProfile, useProfileExtras, useProfileSummary } from "./data";
import { ProfileAvatar, ProfileBanner } from "./Picture";
import { LevelBar } from "./ProfilePage";

/**
 * Your profile in Big Picture (D-149, D-184): everything the regular profile shows, in Big Picture's
 * look — the banner, your picture, name, level and chips, the big figures, the year so far, your
 * library, your most played and completed games, consoles and launchers, most listened, your
 * ratings and your achievements. Each block can be selected, so the controller reaches all of it;
 * games, songs, ratings and categories open with A. Edited in the regular app.
 */
export function BpProfileScreen() {
  const profile = useProfile();
  const summary = useProfileSummary();
  const extras = useProfileExtras();
  const status = useQuery({ queryKey: ["arcade-status"], queryFn: api.arcadeStatus });
  const allGames = useQuery({ queryKey: ["arcade-games"], queryFn: api.arcadeGames });
  const navigate = useNavigate();
  const name = profile.data?.name || "My Digitify";
  const figures: [ReactNode, string, string][] = summary
    ? [
        [<LibraryBig size={26} key="l" />, summary.items.toLocaleString(), "In your library"],
        [<Gamepad2 size={26} key="g" />, summary.games.toLocaleString(), "Games in Arcade"],
        [<Clapperboard size={26} key="p" />, hours(summary.played), "Played in Arcade"],
        [<BadgeCheck size={26} key="c" />, summary.completed.length.toLocaleString(), "Games completed"],
        [<Trophy size={26} key="a" />, `${summary.reached.length} of ${summary.achievements.length}`, "Achievements"],
        [<Flame size={26} key="s" />, `${summary.bestStreak}`, summary.bestStreak === 1 ? "Best streak (day)" : "Best streak (days)"],
      ]
    : [];
  const yearTotal = summary ? summary.read + summary.watch + summary.listen + summary.play : 0;
  const activities: [string, number, ReactNode, string][] = summary
    ? [
        ["Read", summary.read, <BookOpen size={20} key="r" />, "#f2b33d"],
        ["Watched", summary.watch, <Clapperboard size={20} key="w" />, "#e5484d"],
        ["Listened", summary.listen, <Headphones size={20} key="l" />, "#30a46c"],
        ["Played", summary.play, <Gamepad2 size={20} key="p" />, "var(--accent-bright)"],
      ]
    : [];
  const most = Math.max(1, ...activities.map(([, s]) => s));
  const launchers = (status.data?.stores ?? []).filter((s) => s.found);
  const emulators = (status.data?.emulators ?? []).filter((e) => e.found && !e.ignored);
  const playable = (allGames.data ?? []).filter((g) => !g.missing);
  const consoles = [...new Set(playable.filter((g) => g.platform !== "pc").map((g) => g.platform))];
  const ratings = extras.data?.ratings ?? [];
  const tracks = extras.data?.topTracks ?? [];
  const openGame = (id: number) => void navigate({ to: "/bp", search: { screen: "game", id } });
  const openItem = (id: number) => void navigate({ to: "/bp", search: { screen: "item", id } });
  return (
    <div className="bp-profile">
      <div className="bp-profile-banner" aria-hidden>
        <ProfileBanner profile={profile.data} />
      </div>
      <div className="bp-profile-head">
        <ProfileAvatar profile={profile.data} size={190} ring />
        <div className="bp-profile-identity">
          <h1>{name}</h1>
          {profile.data?.motto && <p>{profile.data.motto}</p>}
          <div className="bp-profile-chips">
            {summary && sinceLabel(summary.since) && <span className="bp-profile-since">Collecting since {sinceLabel(summary.since)}</span>}
            {summary && summary.streak > 0 && (
              <span className="bp-profile-since">
                <Flame size={16} /> {summary.streak}-day streak
              </span>
            )}
          </div>
          {extras.data && (
            <div className="bp-profile-level">
              <LevelBar level={extras.data.level} />
            </div>
          )}
        </div>
      </div>
      <div className="bp-profile-figures">
        {figures.map(([icon, value, label], index) => (
          <div key={label} className="bp-profile-figure" data-bp-focus tabIndex={-1} data-bp-autofocus={index === 0 || undefined}>
            {icon}
            <strong>{value}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>
      {summary && (
        <>
          <div className="bp-profile-columns">
            <section className="bp-profile-panel" data-bp-focus tabIndex={-1}>
              <h2>{summary.year} so far</h2>
              <p className="bp-profile-note">
                {yearTotal > 0 ? `${hours(yearTotal)} with your library this year, and ${summary.finishedYear.toLocaleString()} finished.` : "Your time with the library this year shows here."}
              </p>
              <ul className="bp-profile-bars">
                {activities.map(([label, seconds, icon, color]) => (
                  <li key={label}>
                    <span className="bp-profile-bar-label">
                      {icon} {label}
                    </span>
                    <span className="bp-profile-bar-track">
                      <span style={{ width: `${(seconds / most) * 100}%`, background: color }} />
                    </span>
                    <span className="bp-profile-bar-value">{hours(seconds)}</span>
                  </li>
                ))}
              </ul>
            </section>
            <section className="bp-profile-panel">
              <h2>Your library</h2>
              {summary.categories.length === 0 ? (
                <p className="bp-profile-note" data-bp-focus tabIndex={-1}>
                  Nothing in your library yet.
                </p>
              ) : (
                <div className="bp-profile-categories">
                  {summary.categories.map(({ category, count }) => (
                    <button key={category.key} type="button" className="bp-button" data-bp-focus onClick={() => void navigate({ to: "/bp", search: { screen: "library", scope: category.key } })}>
                      <CategoryIcon icon={category.icon} size={22} />
                      <strong>{count.toLocaleString()}</strong> {category.name}
                    </button>
                  ))}
                </div>
              )}
              {summary.topArtists.length > 0 && (
                <>
                  <h3>Most played artists this year</h3>
                  <p className="bp-profile-note">{summary.topArtists.map((a) => a.name).join(" · ")}</p>
                </>
              )}
            </section>
          </div>
          {(
            [
              ["Most played", summary.topGames, (g: (typeof summary.topGames)[number]) => hours(g.playSeconds)],
              ["Completed", summary.completed.slice(0, 10), (g: (typeof summary.topGames)[number]) => new Date(g.completedAt!).toLocaleDateString(undefined, { dateStyle: "medium" })],
            ] as const
          ).map(([title, games, detail]) =>
            games.length === 0 ? null : (
              <section key={title} className="bp-row">
                <h2>{title}</h2>
                <div className="bp-profile-shelf">
                  {games.map((game) => (
                    <button key={game.id} type="button" className="bp-tile" data-bp-focus style={{ width: Math.round(240 * gameAspect(game)) }} onClick={() => openGame(game.id)}>
                      <span className="bp-tile-art arcade-bp-art" style={{ width: Math.round(240 * gameAspect(game)), height: 240 }}>
                        <GameCover game={game} size="cover" />
                      </span>
                      <span className="bp-tile-title">
                        <Marquee hover text={game.title} />
                      </span>
                      <span className="bp-tile-sub">{detail(game)}</span>
                    </button>
                  ))}
                </div>
              </section>
            ),
          )}
          <div className="bp-profile-columns">
            <section className="bp-profile-panel" data-bp-focus tabIndex={-1}>
              <h2>Consoles &amp; launchers</h2>
              {launchers.length + consoles.length + emulators.length === 0 ? (
                <p className="bp-profile-note">Arcade shows here the stores, emulators and consoles it finds.</p>
              ) : (
                <>
                  {launchers.length > 0 && <h3>Launchers</h3>}
                  <ul className="bp-profile-systems">
                    {launchers.map((s) => (
                      <li key={s.key}>
                        <LogoMark name={s.key} className="setup-logo" /> {s.name} <span>{s.games.toLocaleString()}</span>
                      </li>
                    ))}
                  </ul>
                  {consoles.length > 0 && <h3>Consoles</h3>}
                  <ul className="bp-profile-systems">
                    {consoles.map((c) => (
                      <li key={c}>
                        <LogoMark name={c} className="setup-logo" /> {FILTER_LABELS[c as keyof typeof FILTER_LABELS] ?? c}{" "}
                        <span>{playable.filter((g) => g.platform === c).length.toLocaleString()}</span>
                      </li>
                    ))}
                  </ul>
                  {emulators.length > 0 && <h3>Emulators</h3>}
                  <ul className="bp-profile-systems">
                    {emulators.map((e) => (
                      <li key={e.key}>{e.name}</li>
                    ))}
                  </ul>
                </>
              )}
            </section>
            <section className="bp-profile-panel">
              <h2>Most listened</h2>
              {tracks.length === 0 ? (
                <p className="bp-profile-note" data-bp-focus tabIndex={-1}>
                  Play some music and your favourite songs show here.
                </p>
              ) : (
                <ol className="bp-profile-tracks">
                  {tracks.map((t, i) => (
                    <li key={t.id}>
                      <button type="button" className="bp-profile-entry" data-bp-focus onClick={() => openItem(t.id)}>
                        <span className="bp-profile-rank">{i + 1}</span>
                        <span className="bp-profile-entry-art">
                          <Cover item={{ title: t.title, coverKey: t.coverKey, handler: "audio" }} iconOnly />
                        </span>
                        <span className="bp-profile-entry-text">
                          <Marquee hover text={t.title} />
                          <span>{t.artist ?? ""}</span>
                        </span>
                        <span className="bp-profile-entry-end">{t.plays === 1 ? "1 play" : `${t.plays} plays`}</span>
                      </button>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>
          <section className="bp-row">
            <h2>Your ratings</h2>
            {ratings.length === 0 ? (
              <p className="bp-profile-note bp-profile-panel" data-bp-focus tabIndex={-1}>
                Give a book, film, song or game your stars from its page or panel, and it shows here.
              </p>
            ) : (
              <div className="bp-profile-ratings">
                {ratings.map((r) => (
                  <button key={`${r.kind}-${r.id}`} type="button" className="bp-profile-entry" data-bp-focus onClick={() => (r.kind === "game" ? openGame(r.id) : openItem(r.id))}>
                    <span className="bp-profile-entry-art">
                      <Cover item={{ title: r.title, coverKey: r.coverKey, handler: r.kind === "game" ? "generic" : "book" }} iconOnly />
                    </span>
                    <span className="bp-profile-entry-text">
                      <Marquee hover text={r.title} />
                      <span>{r.kind === "game" ? (FILTER_LABELS[r.place as keyof typeof FILTER_LABELS] ?? r.place) : r.place}</span>
                    </span>
                    <span className="bp-profile-stars" aria-label={`${r.rating} of 5 stars`}>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <Star key={n} size={18} fill={n <= r.rating ? "currentColor" : "none"} aria-hidden />
                      ))}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>
          <section className="bp-row">
            <h2>Achievements</h2>
            <div className="bp-profile-panel" data-bp-focus tabIndex={-1}>
              <span className="profile-achievement-meter" role="progressbar" aria-valuenow={summary.reached.length} aria-valuemin={0} aria-valuemax={summary.achievements.length} aria-label="Achievements reached">
                <span style={{ width: `${(summary.reached.length / Math.max(1, summary.achievements.length)) * 100}%` }} />
              </span>
              {summary.reached.length === 0 ? (
                <p className="bp-profile-note">They come by themselves as you read, watch, listen and play.</p>
              ) : (
                <div className="bp-profile-medals">
                  {summary.reached.slice(0, 12).map((a) => (
                    <div key={a.key} className="bp-profile-medal">
                      <span className="achievement-medal" aria-hidden>
                        <Award size={24} />
                      </span>
                      <span>
                        <strong>{a.title}</strong>
                        <small>{new Date(a.unlockedAt!).toLocaleDateString(undefined, { dateStyle: "medium" })}</small>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <button type="button" className="bp-button bp-profile-more" data-bp-focus onClick={() => void navigate({ to: "/bp", search: { screen: "achievements" } })}>
              <Trophy size={22} /> See all achievements
            </button>
          </section>
        </>
      )}
    </div>
  );
}

import { useNavigate } from "@tanstack/react-router";
import { Marquee } from "../../components/Marquee";
import { Award, BadgeCheck, Flame, Gamepad2, LibraryBig, Trophy } from "lucide-react";
import { GameCover, gameAspect } from "../arcade/shared";
import { hours, sinceLabel, useProfile, useProfileSummary } from "./data";
import { ProfileAvatar, ProfileBanner } from "./Picture";

/**
 * Your profile in Big Picture (D-149): the banner, your picture and name, the big figures, your most
 * played and completed games (A opens a game), and your achievements. Edited in the regular app.
 */
export function BpProfileScreen() {
  const profile = useProfile();
  const summary = useProfileSummary();
  const navigate = useNavigate();
  const name = profile.data?.name || "My Digitify";
  const figures: [React.ReactNode, string, string][] = summary
    ? [
        [<LibraryBig size={26} key="l" />, summary.items.toLocaleString(), "In your library"],
        [<Gamepad2 size={26} key="g" />, hours(summary.played), "Played in Arcade"],
        [<BadgeCheck size={26} key="c" />, summary.completed.length.toLocaleString(), "Games completed"],
        [<Trophy size={26} key="a" />, `${summary.reached.length} of ${summary.achievements.length}`, "Achievements"],
        [<Flame size={26} key="s" />, `${summary.bestStreak}`, "Best streak (days)"],
      ]
    : [];
  return (
    <div className="bp-profile">
      <div className="bp-profile-banner" aria-hidden>
        <ProfileBanner profile={profile.data} />
      </div>
      <div className="bp-profile-head">
        <ProfileAvatar profile={profile.data} size={190} ring />
        <div>
          <h1>{name}</h1>
          {profile.data?.motto && <p>{profile.data.motto}</p>}
          {summary && sinceLabel(summary.since) && <span className="bp-profile-since">Collecting since {sinceLabel(summary.since)}</span>}
        </div>
      </div>
      <div className="bp-profile-figures">
        {figures.map(([icon, value, label]) => (
          <div key={label} className="bp-profile-figure">
            {icon}
            <strong>{value}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>
      {summary && (
        <>
          {[
            ["Most played", summary.topGames],
            ["Completed", summary.completed.slice(0, 10)],
          ].map(([title, games]) =>
            (games as typeof summary.topGames).length === 0 ? null : (
              <section key={title as string} className="bp-row">
                <h2>{title as string}</h2>
                <div className="bp-profile-shelf">
                  {(games as typeof summary.topGames).map((game, index) => (
                    <button
                      key={game.id}
                      type="button"
                      className="bp-tile"
                      data-bp-focus
                      data-bp-autofocus={(title === "Most played" && index === 0) || undefined}
                      style={{ width: Math.round(240 * gameAspect(game)) }}
                      onClick={() => void navigate({ to: "/bp", search: { screen: "game", id: game.id } })}
                    >
                      <span className="bp-tile-art arcade-bp-art" style={{ width: Math.round(240 * gameAspect(game)), height: 240 }}>
                        <GameCover game={game} size="cover" />
                      </span>
                      <span className="bp-tile-title">
                        <Marquee hover text={game.title} />
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            ),
          )}
          {summary.reached.length > 0 && (
            <section className="bp-row">
              <h2>Achievements</h2>
              <div className="bp-profile-medals">
                {summary.reached.slice(0, 8).map((a) => (
                  <div key={a.key} className="bp-profile-medal">
                    <span className="achievement-medal" aria-hidden>
                      <Award size={24} />
                    </span>
                    <strong>{a.title}</strong>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

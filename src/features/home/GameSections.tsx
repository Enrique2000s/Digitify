import type { ReactNode } from "react";
import { Marquee } from "../../components/Marquee";
import { Link, useNavigate } from "@tanstack/react-router";
import { Gamepad2, Info, Play } from "lucide-react";
import type { ArcadeGame, TileCover } from "../../lib/api";
import { artworkUrl } from "../../lib/api";
import { consoleOf, GameBadge, GameMarks, GameCover, lastPlayed, gameAspect, playTime, useArcade, useLaunch } from "../arcade/shared";

/** Arcade's games for Home (D-041): recently played, favorites, one featured a day, and the tile's covers. */
export function useHomeGames() {
  const { games, starting, status } = useArcade();
  const list = (games.data ?? []).filter((g) => !g.missing);
  const recent = list
    .filter((g) => g.lastPlayedAt)
    .sort((a, b) => (b.lastPlayedAt ?? "").localeCompare(a.lastPlayedAt ?? ""))
    .slice(0, 12);
  const favorites = list.filter((g) => g.isFavorite).slice(0, 12);
  // One game a day, the same all day: those with a cover first.
  const pool = list.some((g) => g.coverKey) ? list.filter((g) => g.coverKey) : list;
  const today = new Date();
  const day = Math.floor(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) / 86_400_000);
  const featured = pool.length ? [...pool].sort((a, b) => a.id - b.id)[(day * 7919) % pool.length] : undefined;
  // The tile moves on through the last played (or else newest) covers (D-177).
  const covers: TileCover[] = [...list]
    .filter((g) => g.coverKey)
    .sort((a, b) => (b.lastPlayedAt ?? b.addedAt).localeCompare(a.lastPlayedAt ?? a.addedAt))
    .slice(0, 15)
    .map((g) => ({ key: g.coverKey!, color: g.coverColor, handler: "book" }));
  return { count: list.length, recent, favorites, featured, covers, starting, running: status.data?.running ?? null, loaded: games.isSuccess };
}

/** Cover height in Home's game rows. */
const GAME_ART_HEIGHT = 200;

/** A game in a Home row: its cover opens it in Arcade; ▶ starts it. */
export function GameCard({ game, running, onPlay }: { game: ArcadeGame; running: boolean; onPlay: () => void }) {
  const aspect = gameAspect(game);
  const when = lastPlayed(game.lastPlayedAt);
  return (
    <div className={`arcade-tile home-game${running ? " running" : ""}`} style={{ width: Math.round(GAME_ART_HEIGHT * aspect) }}>
      <Link to="/arcade" search={{ game: game.id }} className="arcade-tile-art" style={{ aspectRatio: aspect }} aria-label={`${game.title}, ${consoleOf(game)}`} data-blip>
        <GameCover game={game} />
        <GameBadge game={game} />
        <GameMarks game={game} />
      </Link>
      <button type="button" className="arcade-play" aria-label={`Play ${game.title}`} title="Play" onClick={onPlay}>
        <Play size={18} fill="currentColor" />
      </button>
      <div className="arcade-tile-text">
        <strong>
          <Marquee hover text={game.title} />
        </strong>
        <span>{game.playSeconds > 0 ? `${consoleOf(game)} · ${playTime(game.playSeconds)}${when ? ` · ${when}` : ""}` : consoleOf(game)}</span>
      </div>
    </div>
  );
}

/** "Continue playing" and "Favorite games": a row of games, with what starting one says. */
export function GameRow({ title, games, running, starting }: { title: ReactNode; games: ArcadeGame[]; running: number | null; starting: { id: number; store: string } | null }) {
  const { launch, error, clearError } = useLaunch();
  const startingHere = starting && games.find((g) => g.id === starting.id);
  return (
    <section className="section">
      <div className="section-head">
        <h2>{title}</h2>
        <Link to="/arcade">See all</Link>
      </div>
      {(error || startingHere) && (
        <p className={`home-game-note${error ? " error" : ""}`} role={error ? "alert" : "status"} onClick={clearError}>
          {error ?? `Starting ${startingHere!.title} through ${starting!.store}…`}
        </p>
      )}
      <div className="row-scroller home-games">
        {games.map((game) => (
          <GameCard key={game.id} game={game} running={running === game.id} onPlay={() => void launch(game)} />
        ))}
      </div>
    </section>
  );
}

/** "Game of the day": one of Arcade's games, big, like the library's Featured today. */
export function FeaturedGame({ game, running }: { game: ArcadeGame; running: boolean }) {
  const { launch, error } = useLaunch();
  const navigate = useNavigate();
  const aspect = gameAspect(game);
  const when = lastPlayed(game.lastPlayedAt);
  return (
    <section className="section" aria-label="Game of the day">
      <div className="featured-card" style={game.coverColor ? { ["--tint" as string]: game.coverColor } : undefined}>
        {game.coverKey && (
          <div className="featured-backdrop" aria-hidden>
            <img src={artworkUrl(game.coverKey, "cover")} alt="" />
          </div>
        )}
        <Link to="/arcade" search={{ game: game.id }} className="featured-cover" style={{ aspectRatio: aspect, height: aspect > 1 ? 104 : undefined }} tabIndex={-1} data-blip>
          <GameCover game={game} size="cover" />
        </Link>
        <div className="featured-body">
          <span className="featured-eyebrow-row">
            <span className="featured-eyebrow">
              <Gamepad2 size={16} strokeWidth={2.6} aria-hidden /> Game of the day
            </span>
            <span className="section-source">(Arcade)</span>
          </span>
          <h2 className="display featured-title">{game.title}</h2>
          <p className="featured-sub">{consoleOf(game)}</p>
          <p className="featured-facts">{game.playSeconds > 0 ? `${playTime(game.playSeconds)} played${when ? ` · last ${when}` : ""}` : "Not played yet"}</p>
          {error && <p className="home-game-note error" role="alert">{error}</p>}
          <div className="featured-actions">
            <button type="button" className="btn btn-primary" disabled={running} onClick={() => void launch(game)}>
              <Play size={17} /> {running ? "Playing" : "Play"}
            </button>
            <button type="button" className="btn" onClick={() => void navigate({ to: "/arcade", search: { game: game.id } })}>
              <Info size={17} /> Details
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

import { CircleAlert, Heart, Joystick } from "lucide-react";
import type { ArcadeGame } from "../../lib/api";
import { usePad } from "../../lib/gamepad";
import { badgeOf, consoleOf, FILTER_LABELS, GameCover, PLATFORM_ASPECT, playTime, useArcade, useArcadeFilters, useLaunch, useShownGames } from "./shared";
import { PlatformLogo } from "./logos";

/**
 * Arcade in Big Picture (D-034): the games as big tiles a controller reaches. A plays, LB and RB
 * switch between the consoles (Y stays Big Picture's search).
 */
export function ArcadeScreen() {
  const { status, games, starting } = useArcade();
  const shown = useShownGames(games.data, "");
  const { launch, error } = useLaunch();
  const view = useArcadeFilters();
  usePad((action) => {
    if ((action === "lb" || action === "rb") && view.filters.length) {
      const at = view.filters.indexOf(view.current);
      view.choose(view.filters[(at + (action === "rb" ? 1 : -1) + view.filters.length) % view.filters.length]);
      return true;
    }
    return;
  });
  const running = status.data?.running != null ? games.data?.find((g) => g.id === status.data!.running) : undefined;
  return (
    <>
      <div className="bp-tabs" role="tablist">
        <span className="bp-hint-key">LB</span>
        {view.filters.map((filter) => (
          <button key={filter} type="button" role="tab" aria-selected={filter === view.current} className="bp-tab" data-bp-focus onClick={() => view.choose(filter)}>
            {FILTER_LABELS[filter]}
          </button>
        ))}
        <span className="bp-hint-key">RB</span>
      </div>
      {running && <p className="bp-arcade-note">Playing {running.title}. Digitify's music is silent until the game closes (Menu › Music brings it back).</p>}
      {starting && !running && <p className="bp-arcade-note">Starting through {starting.store}…</p>}
      {error && (
        <p className="bp-arcade-note error">
          <CircleAlert size={22} /> {error}
        </p>
      )}
      {games.data && shown.length === 0 ? (
        <div className="bp-empty">
          <Joystick size={48} />
          <p>{games.data.length === 0 ? "No games yet. Set up Arcade from the regular app: Arcade › Emulators & folders." : "No games for this console."}</p>
        </div>
      ) : (
        // A new console pops its games in, like the library's items (D-041).
        <div className="bp-grid" key={view.current}>
          {shown.map((game, index) => (
            <ArcadeTile key={game.id} game={game} autofocus={index === 0} onPlay={() => void launch(game)} />
          ))}
        </div>
      )}
    </>
  );
}

/** A game as a Big Picture tile: A plays it. Also Home's game rows in Big Picture (D-041). */
export function ArcadeTile({ game, autofocus, onPlay, height = 270 }: { game: ArcadeGame; autofocus: boolean; onPlay: () => void; height?: number }) {
  const width = Math.round(height * PLATFORM_ASPECT[game.platform]);
  return (
    <button type="button" className="bp-tile" style={{ width }} data-bp-focus data-bp-autofocus={autofocus || undefined} data-game={game.id} data-favorite={game.isFavorite || undefined} onClick={onPlay}>
      <span className="bp-tile-art arcade-bp-art" style={{ width, height }}>
        <GameCover game={game} size="cover" />
        <span className="arcade-badge" data-platform={game.platform} data-store={game.store ?? undefined}>
          <PlatformLogo game={game} />
          {badgeOf(game)}
        </span>
        {game.isFavorite && <Heart className="arcade-fav" size={22} fill="currentColor" />}
      </span>
      <span className="bp-tile-title">{game.title}</span>
      <span className="bp-tile-sub">{game.playSeconds > 0 ? `${consoleOf(game)} · ${playTime(game.playSeconds)}` : consoleOf(game)}</span>
    </button>
  );
}

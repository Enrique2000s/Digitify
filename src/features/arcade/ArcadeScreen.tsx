import { CircleAlert, Heart, Joystick } from "lucide-react";
import type { ArcadeGame } from "../../lib/api";
import { usePad } from "../../lib/gamepad";
import { usePreferences } from "../../lib/preferences";
import { GameCover, PLATFORM_ASPECT, PLATFORM_FILTERS, PLATFORM_SHORT, playTime, useArcade, useLaunch, useShownGames } from "./shared";

/**
 * Arcade in Big Picture (D-034): the games as big tiles a controller reaches. A plays, LB and RB
 * switch between the consoles (Y stays Big Picture's search).
 */
export function ArcadeScreen() {
  const { status, games } = useArcade();
  const { preferences, update } = usePreferences();
  const shown = useShownGames(games.data, "");
  const { launch, error } = useLaunch();
  const platform = preferences.arcade.platform;
  const setPlatform = (key: typeof platform) => update((c) => ({ arcade: { ...c.arcade, platform: key } }));
  usePad((action) => {
    if (action === "lb" || action === "rb") {
      const at = PLATFORM_FILTERS.findIndex((f) => f.key === platform);
      const next = PLATFORM_FILTERS[(at + (action === "rb" ? 1 : -1) + PLATFORM_FILTERS.length) % PLATFORM_FILTERS.length];
      setPlatform(next.key);
      return true;
    }
    return;
  });
  const running = status.data?.running != null ? games.data?.find((g) => g.id === status.data!.running) : undefined;
  return (
    <>
      <div className="bp-tabs" role="tablist">
        <span className="bp-hint-key">LB</span>
        {PLATFORM_FILTERS.map((filter) => (
          <button key={filter.key} type="button" role="tab" aria-selected={filter.key === platform} className="bp-tab" data-bp-focus onClick={() => setPlatform(filter.key)}>
            {filter.label}
          </button>
        ))}
        <span className="bp-hint-key">RB</span>
      </div>
      {running && <p className="bp-arcade-note">Playing {running.title}. Close the emulator to come back.</p>}
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
        <div className="bp-grid">
          {shown.map((game, index) => (
            <ArcadeTile key={game.id} game={game} autofocus={index === 0} onPlay={() => void launch(game)} />
          ))}
        </div>
      )}
    </>
  );
}

function ArcadeTile({ game, autofocus, onPlay }: { game: ArcadeGame; autofocus: boolean; onPlay: () => void }) {
  const height = 270;
  const width = Math.round(height * PLATFORM_ASPECT[game.platform]);
  return (
    <button type="button" className="bp-tile" style={{ width }} data-bp-focus data-bp-autofocus={autofocus || undefined} data-game={game.id} onClick={onPlay}>
      <span className="bp-tile-art arcade-bp-art" style={{ width, height }}>
        <GameCover game={game} size="cover" />
        <span className="arcade-badge" data-platform={game.platform}>{PLATFORM_SHORT[game.platform]}</span>
        {game.isFavorite && <Heart className="arcade-fav" size={22} fill="currentColor" />}
      </span>
      <span className="bp-tile-title">{game.title}</span>
      {game.playSeconds > 0 && <span className="bp-tile-sub">{playTime(game.playSeconds)}</span>}
    </button>
  );
}

import { Fragment, useMemo } from "react";
import { Marquee } from "../../components/Marquee";
import { BadgeCheck, CircleAlert, Heart, Joystick, ListFilter } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import type { ArcadeGame } from "../../lib/api";
import { usePad } from "../../lib/gamepad";
import { usePreferences } from "../../lib/preferences";
import { BpCollectionCard } from "../bigpicture/BpCollectionCard";
import { allCollections, belongsTo, defaultCollection, gamesOf, isCompleted, isDefault, isFavorites, useCollections } from "./Collections";
import { LogoMark } from "./logos";
import { consoleKey, consoleOf, GameBadge, FILTER_LABELS, GameCover, gameAspect, playTime, useArcade, useArcadeFilters, useLaunch, useShownGames } from "./shared";

/**
 * Arcade in Big Picture (D-034): the games as big tiles a controller reaches. A opens the game's
 * screen, where it's played from (D-120); LB and RB switch between the collections and the consoles
 * (Y stays Big Picture's search). The collections (D-149) are cards, Favorites first; one opens its
 * games ("collection:<id>"), Back returns to the cards.
 */
export function ArcadeScreen({ scope }: { scope?: string }) {
  const { status, games, starting } = useArcade();
  const collections = useCollections();
  const inCollections = scope === "collections" || !!scope?.startsWith("collection:");
  const openId = scope?.startsWith("collection:") ? Number(scope.slice("collection:".length)) : null;
  const open = openId != null ? (defaultCollection(openId) ?? collections.data?.find((c) => c.id === openId)) : undefined;
  const inOpen = useMemo(() => (open ? belongsTo(open) : null), [open]);
  const shown = useShownGames(games.data, "", inOpen);
  const { error } = useLaunch();
  const navigate = useNavigate();
  const view = useArcadeFilters();
  const { preferences } = usePreferences();
  const bySection = preferences.arcade.sort === "console";
  // The tabs: the collections first, then the console views.
  const tabs = ["collections", ...view.filters] as const;
  const currentTab = inCollections ? "collections" : view.current;
  const chooseTab = (tab: (typeof tabs)[number]) => {
    if (tab === "collections") {
      void navigate({ to: "/bp", search: { screen: "arcade", scope: "collections" }, replace: true });
      return;
    }
    view.choose(tab);
    if (inCollections) void navigate({ to: "/bp", search: { screen: "arcade" }, replace: true });
  };
  usePad((action) => {
    if ((action === "lb" || action === "rb") && tabs.length) {
      const at = tabs.indexOf(currentTab as (typeof tabs)[number]);
      chooseTab(tabs[(at + (action === "rb" ? 1 : -1) + tabs.length) % tabs.length]);
      return true;
    }
    return;
  });
  const running = status.data?.running != null ? games.data?.find((g) => g.id === status.data!.running) : undefined;
  return (
    <>
      <div className="bp-tabs" role="tablist">
        <span className="bp-hint-key">LB</span>
        {tabs.map((tab) => (
          <button key={tab} type="button" role="tab" aria-selected={tab === currentTab} className="bp-tab" data-bp-focus onClick={() => chooseTab(tab)}>
            {tab === "collections" ? "Collections" : FILTER_LABELS[tab]}
          </button>
        ))}
        <span className="bp-hint-key">RB</span>
      </div>
      {inCollections && !open && (
        <div className="bp-grid bp-collections">
          {allCollections(collections.data).map((collection, index) => {
            const inIt = gamesOf(collection, games.data);
            return (
              <BpCollectionCard
                key={collection.id}
                name={collection.name}
                detail={`${inIt.length.toLocaleString()} ${inIt.length === 1 ? "game" : "games"}`}
                covers={inIt.filter((g) => g.coverKey).map((g) => g.coverKey!)}
                icon={isFavorites(collection) ? <Heart size={40} /> : isCompleted(collection) ? <BadgeCheck size={40} /> : collection.dynamic ? <ListFilter size={40} /> : <Joystick size={40} />}
                badge={collection.dynamic ? <span className="bp-collection-chip">Dynamic</span> : isDefault(collection) ? <span className="bp-collection-chip">Default</span> : undefined}
                autofocus={index === 0}
                onOpen={() => void navigate({ to: "/bp", search: { screen: "arcade", scope: `collection:${collection.id}` } })}
              />
            );
          })}
        </div>
      )}
      {open && (
        <div className="bp-collection-head">
          <h2>{open.name}</h2>
          <span>{`${shown.length.toLocaleString()} ${shown.length === 1 ? "game" : "games"}`}</span>
        </div>
      )}
      {running && <p className="bp-arcade-note">Playing {running.title}. Digitify's music is silent until the game closes (Menu › Music brings it back).</p>}
      {starting && !running && <p className="bp-arcade-note">Starting through {starting.store}…</p>}
      {error && (
        <p className="bp-arcade-note error">
          <CircleAlert size={22} /> {error}
        </p>
      )}
      {inCollections && !open ? null : games.data && shown.length === 0 ? (
        <div className="bp-empty">
          <Joystick size={48} />
          <p>{games.data.length === 0 ? "No games yet. Set up Arcade from the regular app: Arcade › Emulators & folders." : open ? "No games in this collection." : "No games for this console."}</p>
        </div>
      ) : (
        // A new console pops its games in, like the library's items (D-041).
        <div className="bp-grid" key={open ? `c${open.id}` : view.current}>
          {shown.map((game, index) => (
            <Fragment key={game.id}>
              {bySection && (index === 0 || consoleKey(shown[index - 1]) !== consoleKey(game)) && (
                <div className="bp-section" role="heading" aria-level={2}>
                  <LogoMark name={consoleKey(game) === "others" ? "pc" : consoleKey(game)} size={22} className="bp-section-logo" />
                  {FILTER_LABELS[consoleKey(game)]}
                </div>
              )}
              <ArcadeTile game={game} autofocus={index === 0} onPlay={() => void navigate({ to: "/bp", search: { screen: "game", id: game.id } })} />
            </Fragment>
          ))}
        </div>
      )}
    </>
  );
}

/** A game as a Big Picture tile: A opens its screen (D-120). Also Home's game rows in Big Picture (D-041). */
export function ArcadeTile({ game, autofocus, onPlay, height = 270 }: { game: ArcadeGame; autofocus: boolean; onPlay: () => void; height?: number }) {
  const width = Math.round(height * gameAspect(game));
  return (
    <button type="button" className="bp-tile" style={{ width }} data-bp-focus data-bp-autofocus={autofocus || undefined} data-game={game.id} data-favorite={game.isFavorite || undefined} onClick={onPlay}>
      <span className="bp-tile-art arcade-bp-art" style={{ width, height }}>
        <GameCover game={game} size="cover" />
        <GameBadge game={game} />
        {game.completedAt && (
          <span className="arcade-completed" title="Completed">
            <BadgeCheck size={19} strokeWidth={2.4} aria-label="Completed" />
          </span>
        )}
        {game.isFavorite && (
          <span className="arcade-fav" title="Favorite">
            <Heart size={17} fill="currentColor" strokeWidth={2.4} aria-label="Favorite" />
          </span>
        )}
      </span>
      <span className="bp-tile-title">
        <Marquee hover text={game.title} />
      </span>
      <span className="bp-tile-sub">{game.playSeconds > 0 ? `${consoleOf(game)} · ${playTime(game.playSeconds)}` : consoleOf(game)}</span>
    </button>
  );
}

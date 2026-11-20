import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { BackButton } from "../../components/BackButton";
import { useInfiniteQuery } from "@tanstack/react-query";
import { CircleAlert, Joystick, LibraryBig, LoaderCircle, Search, X } from "lucide-react";
import { api } from "../../lib/api";
import { useCoverShape, usePreferences } from "../../lib/preferences";
import { useLibraryVersion } from "../../lib/queries";
import { MediaCard } from "../../components/MediaCard";
import { matchingGames, useArcade, useLaunch } from "../arcade/shared";
import { GameTile } from "../arcade/ArcadePage";

type Shown = "all" | "library" | "arcade";

/** Media loaded at a time; more come as the page scrolls down. */
const PAGE = 120;

/**
 * The universal search (D-114): its own screen, for Library and Arcade at once. The library's
 * matching media come first ("33 media in Library"), then Arcade's matching games ("223 games in
 * Arcade"), each in a grid that goes on downward, never sideways. A filter shows both, or only one
 * of them, so the games are a click away however much media matched.
 */
export function SearchPage() {
  const { q } = useSearch({ from: "/search" });
  const query = q.trim();
  const navigate = useNavigate();
  const { preferences } = usePreferences();
  const shapeOf = useCoverShape();
  const [shown, setShown] = useState<Shown>("all");
  const version = useLibraryVersion();
  const media = useInfiniteQuery({
    queryKey: ["search-media", query, version],
    queryFn: ({ pageParam }) => api.query({ search: query, offset: pageParam, limit: PAGE }),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, page) => n + page.items.length, 0);
      return loaded < last.total && last.items.length > 0 ? loaded : undefined;
    },
    enabled: !!query,
  });
  const items = useMemo(() => media.data?.pages.flatMap((page) => page.items) ?? [], [media.data]);
  const mediaTotal = media.data?.pages[0]?.total ?? null;
  const { games, status, starting } = useArcade();
  const found = useMemo(() => matchingGames(games.data, query), [games.data, query]);
  const { launch, error, clearError } = useLaunch();
  const artHeight = Math.round(preferences.cardSize * 1.5);

  // More media as the end of the list comes into sight.
  const more = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const target = more.current;
    if (!target || !media.hasNextPage) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && !media.isFetchingNextPage) void media.fetchNextPage();
    }, { rootMargin: "600px 0px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [media, shown]);

  const loading = media.isPending || !games.data;
  const nothing = !loading && mediaTotal === 0 && found.length === 0;
  const startingHere = starting && found.find((g) => g.id === starting.id);
  const mediaLabel = mediaTotal == null ? "Media in Library" : `${mediaTotal.toLocaleString()} media in Library`;
  const gamesLabel = `${found.length.toLocaleString()} ${found.length === 1 ? "game" : "games"} in Arcade`;
  return (
    <div className="page search-page">
      <BackButton />
      <header className="search-head">
        <span className="title-badge">
          <Search size={26} strokeWidth={2.4} aria-hidden />
        </span>
        <div>
          <div className="eyebrow">Search</div>
          <h1 className="display">“{q}”</h1>
          <div className="count">{loading ? " " : `${mediaLabel} · ${gamesLabel}`}</div>
        </div>
      </header>
      {!nothing && (
        <div className="segmented search-shown" role="group" aria-label="Show">
          {(
            [
              ["all", "All", mediaTotal == null ? null : mediaTotal + found.length],
              ["library", "Library", mediaTotal],
              ["arcade", "Arcade", found.length],
            ] as const
          ).map(([key, label, count]) => (
            <button key={key} type="button" aria-pressed={shown === key} onClick={() => setShown(key)}>
              {label}
              {count != null && <span className="count">{count.toLocaleString()}</span>}
            </button>
          ))}
        </div>
      )}
      {(error || startingHere) && (
        <p className={`search-note${error ? " error" : ""}`} role={error ? "alert" : "status"}>
          {error ? <CircleAlert size={16} /> : <LoaderCircle size={16} className="spin" />}
          <span>{error ?? `Starting ${startingHere!.title} through ${starting!.store}…`}</span>
          {error && (
            <button type="button" className="icon-btn" aria-label="Dismiss" onClick={clearError}>
              <X size={15} />
            </button>
          )}
        </p>
      )}
      {nothing ? (
        <div className="empty">
          <p>No matches for “{q}”. Search looks at the library's titles, people, series, albums, genres and collections, and at Arcade's games by name, console or store.</p>
        </div>
      ) : (
        <>
          {shown !== "arcade" && (
            <section className="search-section" aria-label={mediaLabel}>
              <h2>
                <LibraryBig size={19} strokeWidth={2.4} aria-hidden /> {mediaLabel}
              </h2>
              {mediaTotal === 0 ? (
                <p className="muted">Nothing in Library matches “{q}”.</p>
              ) : (
                <div className="search-media">
                  {items.map((item, index) => (
                    <MediaCard key={item.id} item={item} index={index} width={Math.round(artHeight * shapeOf(item).aspect)} />
                  ))}
                </div>
              )}
              {media.hasNextPage && (
                <div ref={more} className="search-more">
                  <LoaderCircle size={18} className="spin" />
                </div>
              )}
            </section>
          )}
          {shown !== "library" && (
            <section className="search-section" aria-label={gamesLabel}>
              <h2>
                <Joystick size={19} strokeWidth={2.4} aria-hidden /> {gamesLabel}
              </h2>
              {found.length === 0 ? (
                <p className="muted">No game in Arcade matches “{q}”.</p>
              ) : (
                <div className="arcade-grid" style={{ ["--card" as string]: `${preferences.cardSize}px` }}>
                  {found.map((game, index) => (
                    <GameTile
                      key={game.id}
                      game={game}
                      index={index}
                      running={status.data?.running === game.id}
                      selecting={false}
                      checked={false}
                      onOpen={() => void navigate({ to: "/arcade", search: { game: game.id } })}
                      onPlay={() => void launch(game)}
                    />
                  ))}
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, LoaderCircle, Search } from "lucide-react";
import { api, errorText, type ArcadeCoverChoice, type ArcadeGame } from "../../lib/api";
import { Dialog } from "../../components/common";

/**
 * Find covers (D-118): every cover Arcade finds for a game, to choose from, on this computer and
 * online. With several games it goes through them one by one ("Game 2 of 5"): a game with only one
 * cover found gets it without asking, one with none is passed; the rest show their covers to pick
 * one or skip. From a game's own panel the covers show even when there's only one. The name looked
 * up can be changed (D-146), for a game whose file name or title doesn't find its covers; a search
 * doesn't need the exact name: games with any of its words show, those with most of them first (D-148).
 */
export function CoverPicker({ games, onClose }: { games: ArcadeGame[]; onClose: (summary: string | null) => void }) {
  const queryClient = useQueryClient();
  const single = games.length === 1;
  const [at, setAt] = useState(0);
  const [choices, setChoices] = useState<ArcadeCoverChoice[] | null>(null);
  const [picked, setPicked] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const tally = useRef({ chosen: 0, automatic: 0, none: 0 });
  const game = games[at];
  /** The name in the search box, and the one last looked up (null: the game's own). */
  const [query, setQuery] = useState(game?.title ?? "");
  const [searched, setSearched] = useState<string | null>(null);
  const [tries, setTries] = useState(0);
  // Without LaunchBox's database, games known by another name (a Japanese title) are harder to find.
  const launchbox = useQuery({ queryKey: ["launchbox"], queryFn: api.arcadeLaunchBoxStatus });

  const finish = () => {
    const { chosen, automatic, none } = tally.current;
    void queryClient.invalidateQueries({ queryKey: ["arcade-games"] });
    const parts = [chosen && `${chosen} chosen`, automatic && `${automatic} with the only cover found`, none && `${none} with none found`].filter(Boolean);
    onClose(single || parts.length === 0 ? null : `Covers: ${parts.join(", ")}.`);
  };
  const next = () => {
    if (at + 1 >= games.length) finish();
    else setAt(at + 1);
  };

  // A new game starts from its own name.
  useEffect(() => {
    setQuery(game?.title ?? "");
    setSearched(null);
  }, [game?.id, game?.title]);

  // Each game's covers as it comes up; one alone is used at once when going through several
  // (not after a search of yours, whose covers always show).
  useEffect(() => {
    if (!game) return;
    let alive = true;
    setChoices(null);
    setPicked(0);
    setError(null);
    api.arcadeCoverChoices(game.id, searched ?? undefined).then(
      async (found) => {
        if (!alive) return;
        if (!single && searched == null && found.length <= 1) {
          if (found.length === 1) {
            await api.arcadeChooseCover(game.id, 0).catch(() => {});
            tally.current.automatic += 1;
          } else {
            tally.current.none += 1;
          }
          if (alive) next();
          return;
        }
        setChoices(found);
      },
      (reason) => alive && setError(errorText(reason)),
    );
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game?.id, searched, tries]);

  const search = (event: React.FormEvent) => {
    event.preventDefault();
    const name = query.trim();
    if (!name || choices == null) return;
    // A search looks by its words too (D-148): names with only some of them show, the closest first.
    setSearched(name);
    // The same name again looks again.
    setTries((n) => n + 1);
  };

  const use = async () => {
    if (!game || !choices?.length) return;
    setBusy(true);
    try {
      await api.arcadeChooseCover(game.id, choices[picked].index);
      tally.current.chosen += 1;
      void queryClient.invalidateQueries({ queryKey: ["arcade-games"] });
      next();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };

  if (!game) return null;
  return (
    <Dialog
      open
      wide
      onOpenChange={(open) => !open && finish()}
      title={single ? "Choose a cover" : `Choose a cover · Game ${at + 1} of ${games.length}`}
      description={game.title}
      footer={
        <>
          <button type="button" className="btn" onClick={single ? finish : next}>
            {single ? "Cancel" : "Skip"}
          </button>
          <button type="button" className="btn btn-primary" disabled={!choices?.length || busy} onClick={() => void use()}>
            <Check size={16} /> Use this cover
          </button>
        </>
      }
    >
      <form className="cover-search" role="search" onSubmit={search}>
        <Search size={16} aria-hidden />
        <input className="input" aria-label="Name to look up" value={query} maxLength={160} onChange={(event) => setQuery(event.target.value)} placeholder="The game's name, or some words of it" />
        <button type="submit" className="btn btn-sm" disabled={!query.trim() || choices == null}>
          Search
        </button>
      </form>
      {error ? (
        <p className="notice danger">{error}</p>
      ) : choices == null ? (
        <p className="cover-picker-wait">
          <LoaderCircle size={18} className="spin" /> Looking for covers on this computer and online…
        </p>
      ) : choices.length === 0 ? (
        <div className="muted">
          <p>No cover found under that name, on this computer or online. Try another name (the game's full or original title, like a Japanese game's), or “Change cover” in its panel for a picture of yours.</p>
          {launchbox.isSuccess && launchbox.data == null && (
            <p>LaunchBox's database knows most games' other names (“Animal Forest” is “Doubutsu no Mori”): download it in Settings › Arcade and it finds them by any of them.</p>
          )}
        </div>
      ) : (
        <div className="cover-picker" role="radiogroup" aria-label="Covers">
          {choices.map((choice, i) => (
            <button key={choice.index} type="button" role="radio" aria-checked={picked === i} className={`cover-choice${picked === i ? " picked" : ""}`} onClick={() => setPicked(i)} onDoubleClick={() => void use()}>
              <img src={choice.preview} alt="" />
              <span className="cover-choice-source">{choice.source}</span>
              <span className="cover-choice-size">
                {choice.width} × {choice.height}
              </span>
            </button>
          ))}
        </div>
      )}
    </Dialog>
  );
}

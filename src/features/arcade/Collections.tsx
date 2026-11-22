import { useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DropdownMenu } from "radix-ui";
import { BadgeCheck, Check, ChevronLeft, Ellipsis, FolderPlus, Heart, Joystick, Layers, ListFilter, Pencil, Plus, Trash } from "lucide-react";
import { api, errorText, type ArcadeCollection, type ArcadeCollectionRules, type ArcadeGame } from "../../lib/api";
import { ARCADE_FILTER_ORDER, type ArcadeFilter } from "../../lib/preferences";
import { Dialog, Field, Switch } from "../../components/common";
import { Marquee } from "../../components/Marquee";
import { plural } from "../../lib/format";
import { FILTER_LABELS, filledFilters, GameCover, inFilter } from "./shared";

/**
 * Arcade's collections (D-148), as in Steam's library: one button beside Emulators & folders opens
 * them as cards (a few of their covers, their name, how many games); a collection opens its games
 * in Arcade's grid. A collection of your own holds the games you put in it (from a game's panel, or
 * several selected); a dynamic one fills and empties by itself, by its filters: words its games'
 * names have (all or any, "a phrase" in quotes) and don't have, their consoles and launchers,
 * played or not, completed or not, favorites, your rating. Favorites is a collection too (D-149),
 * always first and never deleted: a game is in it when it's a favorite.
 */

export const COLLECTIONS_KEY = ["arcade-collections"];

export function useCollections() {
  return useQuery({ queryKey: COLLECTIONS_KEY, queryFn: api.arcadeCollections });
}

export const NO_RULES: ArcadeCollectionRules = { include: "", match: "all", exclude: "", views: [], played: "any", completed: "any", favorites: false, minRating: null };

/** Favorites, the collection every Arcade has (D-149): its games are the favorite ones. */
export const FAVORITES_ID = 0;
export const FAVORITES: ArcadeCollection = { id: FAVORITES_ID, name: "Favorites", dynamic: false, rules: null, games: [] };
export const isFavorites = (collection: ArcadeCollection) => collection.id === FAVORITES_ID;
/** Completed, every Arcade's second collection (D-169): the games marked as completed. */
export const COMPLETED_ID = -1;
export const COMPLETED: ArcadeCollection = { id: COMPLETED_ID, name: "Completed", dynamic: false, rules: null, games: [] };
export const isCompleted = (collection: ArcadeCollection) => collection.id === COMPLETED_ID;
/** Favorites and Completed: always there, never renamed or deleted. */
export const isDefault = (collection: ArcadeCollection) => isFavorites(collection) || isCompleted(collection);
/** One of the default collections by its id. */
export const defaultCollection = (id: number): ArcadeCollection | undefined => (id === FAVORITES_ID ? FAVORITES : id === COMPLETED_ID ? COMPLETED : undefined);

/** The collections in their order: Favorites and Completed first, then yours. */
export function allCollections(list: ArcadeCollection[] | undefined): ArcadeCollection[] {
  return [FAVORITES, COMPLETED, ...(list ?? [])];
}

export function rulesOf(collection: ArcadeCollection): ArcadeCollectionRules {
  const rules = { ...NO_RULES, ...(collection.rules ?? {}) };
  // Rules saved while Favorites was still a view (before D-149) say so with their own switch.
  if (rules.views.includes("favorites")) return { ...rules, views: rules.views.filter((v) => v !== "favorites"), favorites: true };
  return rules;
}

/** Lower case, accents off, so "Pokémon" is found by "pokemon". */
const fold = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** A filter's words: apart by spaces or commas, "a phrase" in quotes kept whole. */
export function filterWords(text: string): string[] {
  return [...fold(text).matchAll(/"([^"]+)"|[^\s,"]+/g)].map((m) => (m[1] ?? m[0]).trim()).filter(Boolean);
}

/** Whether a game passes every filter that's set. */
export function passes(game: ArcadeGame, rules: ArcadeCollectionRules): boolean {
  // Its own keywords count as words of its name (D-160).
  const name = fold(`${game.title} ${game.keywords.join(" ")}`);
  const include = filterWords(rules.include);
  if (include.length > 0 && !(rules.match === "any" ? include.some((w) => name.includes(w)) : include.every((w) => name.includes(w)))) return false;
  if (filterWords(rules.exclude).some((w) => name.includes(w))) return false;
  if (rules.views.length > 0 && !rules.views.some((view) => inFilter(game, view as ArcadeFilter))) return false;
  const played = game.playSeconds > 0 || game.playCount > 0;
  if (rules.played === "played" && !played) return false;
  if (rules.played === "never" && played) return false;
  if (rules.completed === "yes" && !game.completedAt) return false;
  if (rules.completed === "no" && game.completedAt) return false;
  if (rules.favorites && !game.isFavorite) return false;
  if (rules.minRating != null && (game.rating ?? 0) < rules.minRating) return false;
  return true;
}

/** Whether a game is in a collection: put in it, or passing its filters. */
export function belongsTo(collection: ArcadeCollection): (game: ArcadeGame) => boolean {
  if (isFavorites(collection)) return (game) => game.isFavorite;
  if (isCompleted(collection)) return (game) => !!game.completedAt;
  if (collection.dynamic) {
    const rules = rulesOf(collection);
    return (game) => passes(game, rules);
  }
  const ids = new Set(collection.games);
  return (game) => ids.has(game.id);
}

export function gamesOf(collection: ArcadeCollection, games: ArcadeGame[] | undefined): ArcadeGame[] {
  const inIt = belongsTo(collection);
  return (games ?? []).filter((game) => !game.missing && inIt(game));
}

/** "1 game", "1,204 games". */
const countGames = (n: number) => plural(n, "game");

// ---------------------------------------------------------------------------------------------
// The collections, as cards

type Editing = { collection?: ArcadeCollection; dynamic: boolean; games?: number[] };

export function CollectionsBoard({ games, onOpen, onBack }: { games: ArcadeGame[] | undefined; onOpen: (id: number) => void; onBack: () => void }) {
  const collections = useCollections();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [deleting, setDeleting] = useState<ArcadeCollection | null>(null);
  const list = allCollections(collections.data);
  return (
    <section className="arcade-collections" aria-label="Collections">
      <div className="arcade-collections-head">
        <div className="arcade-collections-title">
          <button type="button" className="btn btn-sm btn-ghost arcade-collections-back" onClick={onBack}>
            <ChevronLeft size={16} /> All games
          </button>
          <h2>Collections</h2>
          <p className="muted">Favorites, Completed, your own, and dynamic ones that fill themselves by their filters.</p>
        </div>
        <div className="arcade-collections-actions">
          <button type="button" className="btn" onClick={() => setEditing({ dynamic: false })}>
            <FolderPlus size={16} /> New collection
          </button>
          <button type="button" className="btn" onClick={() => setEditing({ dynamic: true })}>
            <ListFilter size={16} /> New dynamic collection
          </button>
        </div>
      </div>
      {collections.isSuccess && list.length === 2 && (
        <p className="arcade-collections-hint muted">
          Make a collection and put games in it from their panel or by selecting several, or make a dynamic one: say which words, consoles, launchers or play state its games have, and it keeps itself up to date.
        </p>
      )}
      <div className="arcade-collection-grid">
        {list.map((collection) => (
          <CollectionCard
            key={collection.id}
            collection={collection}
            games={gamesOf(collection, games)}
            onOpen={() => onOpen(collection.id)}
            onEdit={() => setEditing({ collection, dynamic: collection.dynamic })}
            onDelete={() => setDeleting(collection)}
          />
        ))}
      </div>
      {editing && (
        <CollectionEditor
          editing={editing}
          games={games}
          onClose={() => setEditing(null)}
          onSaved={(id) => {
            const fresh = !editing.collection;
            setEditing(null);
            if (fresh) onOpen(id);
          }}
        />
      )}
      {deleting && <DeleteCollection collection={deleting} onClose={() => setDeleting(null)} />}
    </section>
  );
}

function CollectionCard({ collection, games, onOpen, onEdit, onDelete }: { collection: ArcadeCollection; games: ArcadeGame[]; onOpen: () => void; onEdit: () => void; onDelete: () => void }) {
  // Covers first for the collage.
  const shown = [...games.filter((g) => g.coverKey), ...games.filter((g) => !g.coverKey)].slice(0, 4);
  const favorites = isFavorites(collection);
  const completed = isCompleted(collection);
  const fixed = favorites || completed;
  return (
    <div className={`arcade-collection-card${fixed ? " favorites" : ""}${completed ? " completed" : ""}`}>
      <button type="button" className="arcade-collection-open" onClick={onOpen} aria-label={`${collection.name}, ${countGames(games.length)}`} data-blip>
        <span className={`arcade-collage n${shown.length}`} aria-hidden>
          {shown.length === 0 ? (
            <span className="arcade-collage-empty">{favorites ? <Heart size={34} /> : completed ? <BadgeCheck size={34} /> : collection.dynamic ? <ListFilter size={34} /> : <Joystick size={34} />}</span>
          ) : (
            shown.map((game) => (
              <span key={game.id} className="arcade-collage-cell">
                <GameCover game={game} fill />
              </span>
            ))
          )}
        </span>
        <span className="arcade-collection-text">
          <strong>
            <Marquee hover text={collection.name} />
          </strong>
          <span>
            {countGames(games.length)}
            {collection.dynamic && (
              <span className="arcade-dynamic-chip">
                <ListFilter size={12} /> Dynamic
              </span>
            )}
            {fixed && (
              <span className={`arcade-dynamic-chip ${completed ? "completed" : "favorites"}`}>
                {completed ? <BadgeCheck size={12} /> : <Heart size={12} fill="currentColor" />} Default
              </span>
            )}
          </span>
        </span>
      </button>
      {!fixed && (
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button type="button" className="round-btn arcade-collection-more" aria-label={`More for ${collection.name}`}>
              <Ellipsis size={16} />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className="menu" align="end" sideOffset={6}>
              <DropdownMenu.Item className="menu-item" onSelect={onEdit}>
                <Pencil size={17} /> {collection.dynamic ? "Edit filters…" : "Rename…"}
              </DropdownMenu.Item>
              <DropdownMenu.Item className="menu-item danger" onSelect={onDelete}>
                <Trash size={17} /> Delete…
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// One collection open: its bar, in place of the console views

export function CollectionBar({ collection, count, games, onBack }: { collection: ArcadeCollection; count: number; games: ArcadeGame[] | undefined; onBack: () => void }) {
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  return (
    <div className="arcade-collection-bar">
      <button type="button" className="btn btn-sm btn-ghost" onClick={onBack}>
        <ChevronLeft size={16} /> Collections
      </button>
      <h2 title={collection.name}>{collection.name}</h2>
      <span className="count">{count.toLocaleString()}</span>
      {collection.dynamic && (
        <span className="arcade-dynamic-chip">
          <ListFilter size={12} /> Dynamic
        </span>
      )}
      {isDefault(collection) ? (
        <span className={`arcade-dynamic-chip ${isCompleted(collection) ? "completed" : "favorites"}`}>
          {isCompleted(collection) ? <BadgeCheck size={12} /> : <Heart size={12} fill="currentColor" />} Default
        </span>
      ) : (
        <>
          <button type="button" className="btn btn-sm" onClick={() => setEditing(true)}>
            <Pencil size={14} /> {collection.dynamic ? "Edit filters" : "Rename"}
          </button>
          <button type="button" className="btn btn-sm" aria-label={`Delete ${collection.name}`} title="Delete" onClick={() => setDeleting(true)}>
            <Trash size={14} />
          </button>
        </>
      )}
      {editing && <CollectionEditor editing={{ collection, dynamic: collection.dynamic }} games={games} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} />}
      {deleting && (
        <DeleteCollection
          collection={collection}
          onClose={(deleted) => {
            setDeleting(false);
            if (deleted) onBack();
          }}
        />
      )}
    </div>
  );
}

function DeleteCollection({ collection, onClose }: { collection: ArcadeCollection; onClose: (deleted: boolean) => void }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const remove = async () => {
    try {
      await api.arcadeCollectionDelete(collection.id);
      await queryClient.invalidateQueries({ queryKey: COLLECTIONS_KEY });
      onClose(true);
    } catch (reason) {
      setError(errorText(reason));
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose(false)}
      title={`Delete “${collection.name}”?`}
      description="Only the collection goes; its games stay in Arcade."
      footer={
        <>
          <button type="button" className="btn" onClick={() => onClose(false)}>
            Cancel
          </button>
          <button type="button" className="btn btn-danger solid" onClick={() => void remove()}>
            Delete
          </button>
        </>
      }
    >
      {error && <div className="dialog-error">{error}</div>}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------------------------
// Making and changing one

const NOT_VIEWS: ArcadeFilter[] = ["all", "all-pc", "all-roms"];

function CollectionEditor({ editing, games, onClose, onSaved }: { editing: Editing; games: ArcadeGame[] | undefined; onClose: () => void; onSaved: (id: number) => void }) {
  const queryClient = useQueryClient();
  const existing = editing.collection;
  const { dynamic } = editing;
  const [name, setName] = useState(existing?.name ?? "");
  const [rules, setRules] = useState<ArcadeCollectionRules>(existing ? rulesOf(existing) : NO_RULES);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (change: Partial<ArcadeCollectionRules>) => setRules((current) => ({ ...current, ...change }));
  const matching = useMemo(() => (dynamic ? (games ?? []).filter((g) => !g.missing && passes(g, rules)).length : 0), [dynamic, games, rules]);
  // The consoles and launchers with games, and any already chosen.
  const views = useMemo(() => {
    const filled = filledFilters(games) ?? new Set<ArcadeFilter>();
    return ARCADE_FILTER_ORDER.filter((view) => !NOT_VIEWS.includes(view) && (filled.has(view) || rules.views.includes(view)));
  }, [games, rules.views]);
  const toggleView = (view: string) => set({ views: rules.views.includes(view) ? rules.views.filter((v) => v !== view) : [...rules.views, view] });

  const save = async () => {
    if (!name.trim()) {
      setError("A collection needs a name.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const id = existing ? existing.id : await api.arcadeCollectionCreate(name, dynamic ? rules : null, editing.games ?? []);
      if (existing) await api.arcadeCollectionUpdate(existing.id, name, dynamic ? rules : null);
      await queryClient.invalidateQueries({ queryKey: COLLECTIONS_KEY });
      onSaved(id);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  };

  const title = existing ? (dynamic ? "Edit dynamic collection" : "Rename collection") : dynamic ? "New dynamic collection" : "New collection";
  const description = dynamic
    ? "Its games are the ones that pass every filter you set; it fills and empties by itself as games come and go."
    : editing.games?.length
      ? `With the ${countGames(editing.games.length)} selected.`
      : existing
        ? undefined
        : "Put games in it from a game's panel (Collections), or select several and use Add to collection.";
  return (
    <Dialog
      open
      wide={dynamic}
      onOpenChange={(open) => !open && onClose()}
      title={title}
      description={description}
      footer={
        <>
          {dynamic && <span className="collection-count muted">{countGames(matching)} match</span>}
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="collection-form" className="btn btn-primary" disabled={busy}>
            {existing ? "Save" : "Create"}
          </button>
        </>
      }
    >
      <form
        id="collection-form"
        className="collection-form"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <Field label="Name">
          <input className="input" autoFocus value={name} maxLength={80} placeholder={dynamic ? "Racing games" : "Couch co-op"} onChange={(event) => setName(event.target.value)} />
        </Field>
        {dynamic && (
          <>
            <div className="field">
              <span>The name or keywords have</span>
              <div className="collection-words">
                <input className="input" aria-label="Words the name or keywords have" value={rules.include} placeholder='mario, kart or "a phrase"' maxLength={300} onChange={(event) => set({ include: event.target.value })} />
                <div className="segmented" role="group" aria-label="Which of the words">
                  {(
                    [
                      ["all", "All of them"],
                      ["any", "Any of them"],
                    ] as const
                  ).map(([value, label]) => (
                    <button key={value} type="button" aria-pressed={rules.match === value} onClick={() => set({ match: value })}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <small className="hint">Words apart by spaces or commas, “a phrase” in quotes. Capitals and accents don't matter. A game's own keywords (in its panel) count as its name.</small>
            </div>
            <Field label="The name or keywords don't have">
              <input className="input" value={rules.exclude} placeholder="demo, beta" maxLength={300} onChange={(event) => set({ exclude: event.target.value })} />
            </Field>
            <div className="field">
              <span>Consoles and launchers</span>
              <div className="collection-chips" role="group" aria-label="Consoles and launchers">
                {views.map((view) => (
                  <button key={view} type="button" className="chip-toggle" aria-pressed={rules.views.includes(view)} onClick={() => toggleView(view)}>
                    {FILTER_LABELS[view]}
                  </button>
                ))}
              </div>
              <small className="hint">{rules.views.length ? "Games from any of the ones chosen." : "None chosen: any console or launcher."}</small>
            </div>
            <div className="collection-row">
              <div className="field">
                <span>Played</span>
                <div className="segmented" role="group" aria-label="Played">
                  {(
                    [
                      ["any", "Any"],
                      ["played", "Played"],
                      ["never", "Never played"],
                    ] as const
                  ).map(([value, label]) => (
                    <button key={value} type="button" aria-pressed={rules.played === value} onClick={() => set({ played: value })}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="field">
                <span>Completed</span>
                <div className="segmented" role="group" aria-label="Completed">
                  {(
                    [
                      ["any", "Any"],
                      ["yes", "Completed"],
                      ["no", "Not completed"],
                    ] as const
                  ).map(([value, label]) => (
                    <button key={value} type="button" aria-pressed={rules.completed === value} onClick={() => set({ completed: value })}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="field">
                <span>Your rating</span>
                <select className="input" value={rules.minRating ?? ""} onChange={(event) => set({ minRating: event.target.value ? Number(event.target.value) : null })}>
                  <option value="">Any</option>
                  {[1, 2, 3, 4, 5].map((stars) => (
                    <option key={stars} value={stars}>
                      {stars === 5 ? "5 stars" : `${stars} stars or more`}
                    </option>
                  ))}
                </select>
              </div>
              <label className="collection-switch">
                <Switch checked={rules.favorites} onChange={(favorites) => set({ favorites })} label="Favorites only" /> Favorites only
              </label>
            </div>
          </>
        )}
        {error && <div className="dialog-error">{error}</div>}
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------------------------
// Putting games in collections: a game's panel, and the games selected

/**
 * A menu of your collections for these games. For one game each collection is ticked when it's in
 * it, and a click puts it in or takes it out; for several, a click puts them all in. Dynamic
 * collections aren't listed: their filters choose. "New collection…" makes one with them in it.
 */
export function CollectionMenu({ ids, games, onNotice, children, side = "bottom" }: { ids: number[]; games: ArcadeGame[] | undefined; onNotice?: (text: string) => void; children: ReactNode; side?: "top" | "bottom" }) {
  const queryClient = useQueryClient();
  const collections = useCollections();
  const [creating, setCreating] = useState(false);
  const mine = (collections.data ?? []).filter((c) => !c.dynamic);
  const single = ids.length === 1;
  const favorite = single && !!games?.find((g) => g.id === ids[0])?.isFavorite;
  const favor = (on: boolean) =>
    run(async () => {
      await (single ? api.arcadeSetFavorite(ids[0], on) : api.arcadeSetFavoriteMany(ids, on));
      await queryClient.invalidateQueries({ queryKey: ["arcade-games"] });
    }, single ? undefined : `${countGames(ids.length)} in Favorites`);
  // Completed is a collection too (D-169): in it is marked as completed.
  const done = single && !!games?.find((g) => g.id === ids[0])?.completedAt;
  const complete = (on: boolean) =>
    run(async () => {
      await api.arcadeSetCompleted(ids, on);
      await queryClient.invalidateQueries({ queryKey: ["arcade-games"] });
    }, single ? undefined : `${countGames(ids.length)} marked as completed`);
  const run = async (action: () => Promise<unknown>, done?: string) => {
    try {
      await action();
      await queryClient.invalidateQueries({ queryKey: COLLECTIONS_KEY });
      if (done) onNotice?.(done);
    } catch (reason) {
      onNotice?.(errorText(reason));
    }
  };
  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>{children}</DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="menu collection-menu" side={side} align="start" sideOffset={8}>
            {single ? (
              <DropdownMenu.CheckboxItem className="menu-item" checked={favorite} onSelect={(event) => event.preventDefault()} onCheckedChange={(on) => void favor(on)}>
                <span className="menu-check">{favorite && <Check size={15} strokeWidth={3} aria-label="In Favorites" />}</span>
                Favorites
              </DropdownMenu.CheckboxItem>
            ) : (
              <DropdownMenu.Item className="menu-item" onSelect={() => void favor(true)}>
                <Heart size={17} /> Favorites
              </DropdownMenu.Item>
            )}
            {single ? (
              <DropdownMenu.CheckboxItem className="menu-item" checked={done} onSelect={(event) => event.preventDefault()} onCheckedChange={(on) => void complete(on)}>
                <span className="menu-check">{done && <Check size={15} strokeWidth={3} aria-label="Completed" />}</span>
                Completed
              </DropdownMenu.CheckboxItem>
            ) : (
              <DropdownMenu.Item className="menu-item" onSelect={() => void complete(true)}>
                <BadgeCheck size={17} /> Completed
              </DropdownMenu.Item>
            )}
            {mine.length > 0 && <DropdownMenu.Separator className="menu-separator" />}
            {mine.map((collection) => {
              const inIt = single && collection.games.includes(ids[0]);
              return single ? (
                <DropdownMenu.CheckboxItem
                  key={collection.id}
                  className="menu-item"
                  checked={inIt}
                  onSelect={(event) => event.preventDefault()}
                  onCheckedChange={(on) => void run(() => (on ? api.arcadeCollectionAdd(collection.id, ids) : api.arcadeCollectionRemove(collection.id, ids)))}
                >
                  <span className="menu-check">{inIt && <Check size={15} strokeWidth={3} aria-label="In this collection" />}</span>
                  {collection.name}
                </DropdownMenu.CheckboxItem>
              ) : (
                <DropdownMenu.Item key={collection.id} className="menu-item" onSelect={() => void run(() => api.arcadeCollectionAdd(collection.id, ids), `${countGames(ids.length)} in “${collection.name}”`)}>
                  <Layers size={17} /> {collection.name}
                </DropdownMenu.Item>
              );
            })}
            <DropdownMenu.Separator className="menu-separator" />
            <DropdownMenu.Item className="menu-item" onSelect={() => setCreating(true)}>
              <Plus size={17} /> New collection…
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      {creating && (
        <CollectionEditor
          editing={{ dynamic: false, games: ids }}
          games={games}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            onNotice?.(single ? "Collection made" : `Collection made with ${countGames(ids.length)}`);
          }}
        />
      )}
    </>
  );
}

import { CoverAdjustDialog } from "../../components/CoverAdjust";
import { coverViewOf } from "../../components/common";
import { useEffect, useState } from "react";
import { ReviewPanel } from "../../components/Review";
import { createPortal } from "react-dom";
import { DropdownMenu } from "radix-ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { BadgeCheck, Info, Tag, ChevronDown, Clock, FolderOpen, Heart, ImageDown, ImagePlus, Layers, Pencil, Play, RotateCcw, Trash, X, Move } from "lucide-react";
import { api, errorText, type ArcadeEmulator, type ArcadeGame } from "../../lib/api";
import { usePreferences } from "../../lib/preferences";
import { CoverPicker } from "./CoverPicker";
import { CollectionMenu } from "./Collections";
import { consoleOf, gameAspect, GameCover, lastPlayed, PLATFORM_NAMES, playTime, playsIn } from "./shared";

/** A game's panel in Arcade (D-034 onward): its cover, Play, time played, review, keywords, the
 *  emulator it plays in, its file, favorites, completed, cover and collections. */

/** Time played outside Digitify (D-043): hours and minutes added to what Digitify counts. */
function ExtraTime({ game, onSave }: { game: ArcadeGame; onSave: (seconds: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [hours, setHours] = useState("");
  const [minutes, setMinutes] = useState("");
  if (!editing) {
    return (
      <button
        type="button"
        className="btn btn-sm btn-ghost arcade-extra-edit"
        onClick={() => {
          setHours(String(Math.floor(game.extraSeconds / 3600)));
          setMinutes(String(Math.floor((game.extraSeconds % 3600) / 60)));
          setEditing(true);
        }}
      >
        <Pencil size={13} /> {game.extraSeconds > 0 ? "Change time added" : "Add time played elsewhere"}
      </button>
    );
  }
  const seconds = (Math.max(0, Number(hours) || 0) * 60 + Math.max(0, Number(minutes) || 0)) * 60;
  return (
    <form
      className="arcade-extra-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(seconds);
        setEditing(false);
      }}
    >
      <span>Played outside Digitify</span>
      <label>
        <input className="input" type="number" min={0} inputMode="numeric" value={hours} onChange={(event) => setHours(event.target.value)} aria-label="Hours" autoFocus /> h
      </label>
      <label>
        <input className="input" type="number" min={0} max={59} inputMode="numeric" value={minutes} onChange={(event) => setMinutes(event.target.value)} aria-label="Minutes" /> min
      </label>
      <button type="submit" className="btn btn-sm btn-primary">
        Save
      </button>
      <button type="button" className="btn btn-sm" onClick={() => setEditing(false)}>
        Cancel
      </button>
    </form>
  );
}

/**
 * A game's own keywords (D-160): words it's found by in the search and in dynamic collections, as if
 * they were in its name. Enter or a comma adds one; × or Backspace in the empty field takes one out.
 */
function KeywordsEditor({ keywords, onSave }: { keywords: string[]; onSave: (keywords: string[]) => void }) {
  const [text, setText] = useState("");
  const add = () => {
    const words = text.split(",").map((w) => w.trim()).filter(Boolean);
    setText("");
    if (words.length) onSave([...keywords, ...words.filter((w) => !keywords.some((k) => k.toLowerCase() === w.toLowerCase()))]);
  };
  return (
    <div className="keywords">
      {keywords.map((keyword) => (
        <span key={keyword} className="keyword">
          {keyword}
          <button type="button" aria-label={`Take out ${keyword}`} onClick={() => onSave(keywords.filter((k) => k !== keyword))}>
            <X size={12} />
          </button>
        </span>
      ))}
      <input
        className="keyword-input"
        value={text}
        placeholder={keywords.length ? "Add another" : "Add a keyword"}
        aria-label="Add a keyword"
        maxLength={80}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === ",") {
            event.preventDefault();
            add();
          } else if (event.key === "Backspace" && !text && keywords.length) {
            onSave(keywords.slice(0, -1));
          }
        }}
        onBlur={add}
      />
    </div>
  );
}

export function GamePanel({ game, running, onClose, onPlay }: { game: ArcadeGame; running: number | null; onClose: () => void; onPlay: () => void }) {
  const queryClient = useQueryClient();
  const { preferences } = usePreferences();
  const [error, setError] = useState<string | null>(null);
  const [naming, setNaming] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["arcade-games"] });
  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
      refresh();
    } catch (reason) {
      setError(errorText(reason));
    }
  };
  useEffect(() => {
    // Escape in one of its menus or dialogs closes that, not the panel.
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && naming == null && !document.querySelector("[role=menu], [role=dialog]") && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, naming]);
  const changeCover = async () => {
    const path = await openDialog({ multiple: false, title: "Choose a cover", filters: [{ name: "Images", extensions: ["jpg", "jpeg", "png", "webp", "bmp"] }] });
    if (typeof path === "string") await run(() => api.arcadeSetCover(game.id, path));
  };
  const rename = async () => {
    if (naming == null) return;
    await run(() => api.arcadeRename(game.id, naming));
    setNaming(null);
  };
  const pc = game.platform === "pc";
  const status = useQuery({ queryKey: ["arcade-status"], queryFn: api.arcadeStatus });
  const games = useQuery({ queryKey: ["arcade-games"], queryFn: api.arcadeGames });
  const emulator = pc ? consoleOf(game) : playsIn(game, preferences.arcade, status.data);
  // The emulators found that play its console, to pick one for this game alone (D-148).
  const players = (status.data?.consoles.find((c) => c.key === game.platform)?.players ?? []).filter((key) => status.data?.emulators.find((e) => e.key === key)?.found);
  const consoleDefault = playsIn({ ...game, emulator: null }, preferences.arcade, status.data);
  const played = lastPlayed(game.lastPlayedAt);
  // On the page's own layer, so it stays put however the page scrolls.
  return createPortal(
    <div className="arcade-panel-scrim" onClick={onClose}>
      <aside className="arcade-panel" aria-label={game.title} onClick={(event) => event.stopPropagation()}>
        <button type="button" className="round-btn arcade-panel-close" aria-label="Close" onClick={onClose}>
          <X size={17} />
        </button>
        <div className="arcade-panel-art" style={{ aspectRatio: gameAspect(game), ["--aspect" as string]: gameAspect(game) }}>
          <GameCover game={game} size="cover" />
        </div>
        {naming == null ? (
          <h2 className="arcade-panel-title">
            {game.title}
            <button type="button" className="icon-btn" aria-label="Rename" title="Rename" onClick={() => setNaming(game.title)}>
              <Pencil size={15} />
            </button>
          </h2>
        ) : (
          <form
            className="arcade-rename"
            onSubmit={(event) => {
              event.preventDefault();
              void rename();
            }}
          >
            <input className="input" autoFocus value={naming} onChange={(event) => setNaming(event.target.value)} onKeyDown={(event) => event.key === "Escape" && setNaming(null)} aria-label="Name" />
            <button type="submit" className="btn btn-sm btn-primary">Save</button>
            <button type="button" className="btn btn-sm" onClick={() => setNaming(null)}>Cancel</button>
          </form>
        )}
        <p className="arcade-panel-sub">{pc ? (game.store ? `PC · starts through ${emulator}` : "PC · added by you · starts by itself") : `${PLATFORM_NAMES[game.platform]}${game.gameId ? ` · ${game.gameId}` : ""} · plays in ${emulator}`}</p>
        <button type="button" className="btn btn-primary arcade-panel-play" disabled={running != null} onClick={onPlay}>
          <Play size={17} fill="currentColor" /> {running === game.id ? "Playing…" : "Play"}
        </button>
        {game.path === "store://minecraft/java" && (
          // Mojang's launcher can't be asked to start the game itself (D-155); Prism Launcher's instances can.
          <p className="arcade-panel-note">
            <Info size={15} aria-hidden />
            <span>
              Play opens the Minecraft Launcher, where you press Play. To start Minecraft straight away, use <b>Prism Launcher</b>: sign in there once with your Microsoft account, and each of its instances shows here and starts directly.
            </span>
          </p>
        )}
        <dl className="arcade-panel-facts">
          <div>
            <dt>
              <Clock size={14} /> Played
            </dt>
            <dd>
              {playTime(game.playSeconds)}
              {game.playCount > 0 ? ` · ${game.playCount} ${game.playCount === 1 ? "session" : "sessions"}` : ""}
              {game.extraSeconds > 0 && <span className="arcade-extra"> · {playTime(game.extraSeconds)} added by you</span>}
              <ExtraTime game={game} onSave={(seconds) => void run(() => api.arcadeSetExtraTime(game.id, seconds))} />
            </dd>
          </div>
          <div>
            <dt>Your review</dt>
            <dd>
              <ReviewPanel compact rating={game.rating} note={game.note} onSave={(rating, note) => void run(() => api.arcadeSetReview(game.id, rating, note))} />
            </dd>
          </div>
          <div>
            <dt>
              <Tag size={13} aria-hidden /> Keywords
            </dt>
            <dd>
              <KeywordsEditor keywords={game.keywords} onSave={(keywords) => void run(() => api.arcadeSetKeywords(game.id, keywords))} />
            </dd>
          </div>
          {played && (
            <div>
              <dt>Last played</dt>
              <dd>{played}</dd>
            </div>
          )}
          {game.completedAt && (
            <div>
              <dt>
                <BadgeCheck size={14} /> Completed
              </dt>
              <dd>{new Date(game.completedAt).toLocaleDateString(undefined, { dateStyle: "medium" })}</dd>
            </div>
          )}
          {!pc && !game.retroarch && players.length > 0 && (
            <div>
              <dt>Plays in</dt>
              <dd>
                <select
                  className="input arcade-emulator-pick"
                  aria-label="Emulator for this game"
                  value={game.emulator ?? ""}
                  onChange={(event) => void run(() => api.arcadeSetGameEmulator(game.id, (event.target.value || null) as ArcadeEmulator | null))}
                >
                  <option value="">{`${PLATFORM_NAMES[game.platform]}'s emulator (${consoleDefault})`}</option>
                  {players.map((key) => (
                    <option key={key} value={key}>
                      {status.data?.emulators.find((e) => e.key === key)?.name ?? key}
                    </option>
                  ))}
                  {game.emulator && !players.includes(game.emulator) && <option value={game.emulator}>{`${game.emulator} (not found)`}</option>}
                </select>
                <small className="muted">Only this game; the console's other games keep theirs.</small>
              </dd>
            </div>
          )}
          {(!pc || !game.store) && (
            <div>
              <dt>{pc ? "Program" : "File"}</dt>
              <dd title={game.path}>
                {game.path.split(/[\\/]/).pop()}
                {game.size ? ` · ${fileSize(game.size)}` : ""}
              </dd>
            </div>
          )}
        </dl>
        <div className="arcade-panel-actions">
          <button type="button" className="btn" aria-pressed={game.isFavorite} onClick={() => void run(() => api.arcadeSetFavorite(game.id, !game.isFavorite))}>
            <Heart size={16} fill={game.isFavorite ? "currentColor" : "none"} /> {game.isFavorite ? "Favorite" : "Add to favorites"}
          </button>
          <button type="button" className="btn arcade-complete-btn" aria-pressed={!!game.completedAt} onClick={() => void run(() => api.arcadeSetCompleted([game.id], !game.completedAt))}>
            <BadgeCheck size={16} /> {game.completedAt ? "Completed" : "Mark as completed"}
          </button>
          {/* One menu for its cover (D-121): covers found to choose from, a picture of yours, or its own back. */}
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button type="button" className="btn">
                <ImagePlus size={16} /> Cover <ChevronDown size={14} />
              </button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content className="menu" align="start" sideOffset={8}>
                <DropdownMenu.Item className="menu-item" onSelect={() => setPicking(true)}>
                  <ImageDown size={17} /> Find covers…
                </DropdownMenu.Item>
                <DropdownMenu.Item className="menu-item" onSelect={() => void changeCover()}>
                  <ImagePlus size={17} /> Choose a picture…
                </DropdownMenu.Item>
                {/* Framed as you like (D-184), as a profile picture is. */}
                {game.coverKey && (
                  <DropdownMenu.Item className="menu-item" onSelect={() => setAdjusting(true)}>
                    <Move size={17} /> Adjust…
                  </DropdownMenu.Item>
                )}
                <DropdownMenu.Item className="menu-item" onSelect={() => void run(() => api.arcadeFindCovers([game.id], preferences.arcade.downloadCovers, true))}>
                  <RotateCcw size={17} /> {pc ? "Its launcher's cover" : "Default cover"}
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
          {adjusting && game.coverKey && (
            <CoverAdjustDialog
              title={`${game.title}: its cover`}
              coverKey={game.coverKey}
              aspect={gameAspect(game)}
              view={coverViewOf(game)}
              onSave={(view) => run(() => api.arcadeSetCoverView(game.id, view))}
              onClose={() => setAdjusting(false)}
            />
          )}
          <CollectionMenu ids={[game.id]} games={games.data}>
            <button type="button" className="btn">
              <Layers size={16} /> Collections <ChevronDown size={14} />
            </button>
          </CollectionMenu>
          <button type="button" className="btn" onClick={() => void run(() => api.arcadeReveal(game.id))}>
            <FolderOpen size={16} /> {pc ? "Show folder" : "Show file"}
          </button>
          <button
            type="button"
            className="btn btn-danger"
            title={pc ? "Takes it off Arcade's list; it stays installed (Emulators & folders can show it again)" : "Takes it off Arcade's list; the file stays where it is"}
            onClick={() =>
              void run(async () => {
                await api.arcadeForget(game.id);
                onClose();
              })
            }
          >
            <Trash size={16} /> Remove from Digitify
          </button>
        </div>
        {error && <p className="notice danger">{error}</p>}
        {picking && <CoverPicker games={[game]} onClose={() => setPicking(false)} />}
      </aside>
    </div>,
    document.body,
  );
}

function fileSize(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}

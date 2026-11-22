import { useState } from "react";
import { createPortal } from "react-dom";
import { DropdownMenu, Popover } from "radix-ui";
import { useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, Tag, ChevronDown, Heart, ImageDown, Layers, RotateCcw, Trash, X } from "lucide-react";
import { api, errorText, type ArcadeGame } from "../../lib/api";
import { plural } from "../../lib/format";
import { usePreferences } from "../../lib/preferences";
import { Dialog } from "../../components/common";
import { COMPLETED_ID, CollectionMenu, FAVORITES_ID } from "./Collections";

/** What can be done to several selected games at once (D-035 onward), at the bottom of Arcade. */

function BulkKeywords({ ids, games, disabled, onChange }: { ids: number[]; games: ArcadeGame[] | undefined; disabled: boolean; onChange: (add: string[], remove: string[], done: string) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const picked = new Set(ids);
  // The keywords the selected games have, with how many have each.
  const counts = new Map<string, { label: string; n: number }>();
  for (const game of games ?? []) {
    if (!picked.has(game.id)) continue;
    for (const keyword of game.keywords) {
      const key = keyword.toLowerCase();
      const entry = counts.get(key) ?? { label: keyword, n: 0 };
      entry.n += 1;
      counts.set(key, entry);
    }
  }
  const had = [...counts.values()].sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
  const countGames = (n: number) => plural(n, "game");
  const add = () => {
    const words = text.split(",").map((w) => w.trim()).filter(Boolean);
    if (!words.length) return;
    setText("");
    onChange(words, [], `${words.join(", ")} added to ${countGames(ids.length)}`);
  };
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" className="btn btn-sm" disabled={disabled}>
          <Tag size={15} /> Keywords <ChevronDown size={13} />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="menu bulk-keywords" side="top" align="center" sideOffset={10} collisionPadding={16}>
          <form
            className="bulk-keywords-add"
            onSubmit={(event) => {
              event.preventDefault();
              add();
            }}
          >
            <input className="input" autoFocus value={text} maxLength={120} placeholder="A keyword for all of them" aria-label="A keyword for all the selected games" onChange={(event) => setText(event.target.value)} />
            <button type="submit" className="btn btn-sm btn-primary" disabled={!text.trim()}>
              Add
            </button>
          </form>
          {had.length > 0 ? (
            <>
              <p className="bulk-keywords-title">Theirs</p>
              <ul className="bulk-keywords-list">
                {had.map(({ label, n }) => (
                  <li key={label}>
                    <span className="keyword">{label}</span>
                    <span className="muted">{n === ids.length ? "all" : countGames(n)}</span>
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => onChange([], [label], `${label} taken out of ${countGames(n)}`)}>
                      Take out
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="muted bulk-keywords-none">None of them has keywords yet.</p>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function BulkBar({
  ids,
  total,
  onSelectAll,
  onClear,
  onDone,
  onNotice,
  onChanged,
  onFindCovers,
  games,
  inCollection,
}: {
  ids: number[];
  total: number;
  onFindCovers: () => void;
  games: ArcadeGame[] | undefined;
  /** The collection of the player's own that's open, if one is (D-148). */
  inCollection: number | null;
  onSelectAll: () => void;
  onClear: () => void;
  onDone: () => void;
  onNotice: (text: string) => void;
  onChanged: () => void;
}) {
  const { preferences } = usePreferences();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = async (action: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try {
      await action();
      onChanged();
      if (done) onNotice(done);
    } catch (reason) {
      onNotice(errorText(reason));
    } finally {
      setBusy(false);
    }
  };
  const none = ids.length === 0;
  return createPortal(
    <>
      <div className="bulk-bar arcade-bulk" role="toolbar" aria-label="Selected games">
        <strong aria-live="polite">{none ? "Select games" : `${ids.length} selected`}</strong>
        {ids.length < total ? (
          <button type="button" className="btn btn-sm btn-ghost" onClick={onSelectAll}>
            Select all {total}
          </button>
        ) : (
          <button type="button" className="btn btn-sm btn-ghost" onClick={onClear}>
            Clear
          </button>
        )}
        <span className="bulk-sep" />
        <button type="button" className="btn btn-sm" disabled={none || busy} onClick={() => void run(() => api.arcadeSetFavoriteMany(ids, true))}>
          <Heart size={15} fill="currentColor" /> Favorite
        </button>
        <button type="button" className="btn btn-sm" disabled={none || busy} onClick={() => void run(() => api.arcadeSetFavoriteMany(ids, false))}>
          <Heart size={15} /> Not favorite
        </button>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button type="button" className="btn btn-sm" disabled={none || busy}>
              <ImageDown size={15} /> Covers <ChevronDown size={13} />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className="menu" side="top" align="center" sideOffset={10}>
              <DropdownMenu.Item className="menu-item" onSelect={onFindCovers}>
                <ImageDown size={17} /> Find covers…
              </DropdownMenu.Item>
              <DropdownMenu.Item className="menu-item" onSelect={() => void run(() => api.arcadeFindCovers(ids, preferences.arcade.downloadCovers, true), "Default covers back")}>
                <RotateCcw size={17} /> Default covers
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button type="button" className="btn btn-sm" disabled={none || busy}>
              <BadgeCheck size={15} /> Completed <ChevronDown size={13} />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className="menu" side="top" align="center" sideOffset={10}>
              <DropdownMenu.Item className="menu-item" onSelect={() => void run(() => api.arcadeSetCompleted(ids, true), `${ids.length} marked as completed`)}>
                <BadgeCheck size={17} /> Mark as completed
              </DropdownMenu.Item>
              <DropdownMenu.Item className="menu-item" onSelect={() => void run(() => api.arcadeSetCompleted(ids, false), `${ids.length} not completed`)}>
                <X size={17} /> Not completed
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
        <BulkKeywords ids={ids} games={games} disabled={none || busy} onChange={(add, remove, done) => void run(() => api.arcadeChangeKeywords(ids, add, remove), done)} />
        <CollectionMenu ids={ids} games={games} onNotice={onNotice} side="top">
          <button type="button" className="btn btn-sm" disabled={none || busy}>
            <Layers size={15} /> Add to collection <ChevronDown size={13} />
          </button>
        </CollectionMenu>
        {inCollection != null && (
          <button
            type="button"
            className="btn btn-sm"
            disabled={none || busy}
            onClick={() =>
              void run(async () => {
                // Out of Favorites is no longer a favorite (D-149).
                // Out of Completed is no longer completed (D-169).
                const removed =
                  inCollection === FAVORITES_ID
                    ? (await api.arcadeSetFavoriteMany(ids, false), ids.length)
                    : inCollection === COMPLETED_ID
                      ? (await api.arcadeSetCompleted(ids, false), ids.length)
                      : await api.arcadeCollectionRemove(inCollection, ids);
                await queryClient.invalidateQueries({ queryKey: ["arcade-collections"] });
                onClear();
                onNotice(`${removed} ${removed === 1 ? "game" : "games"} taken out of the collection`);
              })
            }
          >
            <X size={15} /> Take out of collection
          </button>
        )}
        <button type="button" className="btn btn-sm btn-danger" disabled={none || busy} onClick={() => setConfirming(true)}>
          <Trash size={15} /> Remove from Digitify
        </button>
        <span className="bulk-sep" />
        <button type="button" className="btn btn-sm btn-primary" onClick={onDone}>
          Done
        </button>
      </div>
      <Dialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Remove ${ids.length} ${ids.length === 1 ? "game" : "games"} from Digitify?`}
        description="They leave Arcade's list. Files stay where they are and store games stay installed: emulator games come back with a later search if they're still in a game folder; store games stay off until you show them again in Emulators & folders."
        footer={
          <>
            <button type="button" className="btn" onClick={() => setConfirming(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-danger solid"
              onClick={() => {
                setConfirming(false);
                void run(async () => {
                  const removed = await api.arcadeForgetMany(ids);
                  onClear();
                  onNotice(`${removed} ${removed === 1 ? "game" : "games"} removed from Digitify`);
                });
              }}
            >
              Remove
            </button>
          </>
        }
      >
        <span />
      </Dialog>
    </>,
    document.body,
  );
}

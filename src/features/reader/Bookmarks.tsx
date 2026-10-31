import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Popover } from "radix-ui";
import { Bookmark as BookmarkIcon, BookmarkCheck, Pencil, X } from "lucide-react";
import { api, type Bookmark, type BookmarkLocator } from "../../lib/api";
import { hint } from "../../lib/shortcuts";

export interface Place {
  locator: BookmarkLocator;
  /** A suggested label: the page, or the chapter. */
  label: string;
}

interface BookmarksProps {
  itemId: number;
  container: HTMLElement | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Where the reader is now, once known. */
  here: Place | null;
  /** Whether a bookmark points into what's on screen. */
  isHere: (locator: BookmarkLocator) => boolean;
  /** Where a bookmark is, in words ("Page 12", "42%"). */
  describe: (locator: BookmarkLocator) => string;
  onGo: (locator: BookmarkLocator) => void;
}

export function useBookmarks(itemId: number) {
  const queryClient = useQueryClient();
  const key = ["bookmarks", itemId];
  const list = useQuery({ queryKey: key, queryFn: () => api.bookmarksList(itemId) });
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });
  return {
    bookmarks: list.data ?? [],
    add: (place: Place) => api.bookmarkAdd(itemId, place.locator, place.label).finally(refresh),
    rename: (id: number, label: string) => api.bookmarkRename(id, label).finally(refresh),
    remove: (id: number) => api.bookmarkRemove(id).finally(refresh),
  };
}

/** Adds or removes the bookmark on what's on screen ("B" in the readers). */
export function toggleBookmark(state: ReturnType<typeof useBookmarks>, here: Place | null, isHere: (locator: BookmarkLocator) => boolean) {
  const marked = state.bookmarks.filter((bookmark) => isHere(bookmark.locator));
  if (marked.length > 0) return Promise.all(marked.map((bookmark) => state.remove(bookmark.id)));
  return here ? state.add(here) : Promise.resolve();
}

function Row({ bookmark, describe, onGo, onRename, onRemove }: {
  bookmark: Bookmark;
  describe: string;
  onGo: () => void;
  onRename: (label: string) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(bookmark.label ?? "");
  if (editing) {
    return (
      <li className="bookmark-row">
        <input
          className="input"
          aria-label="Bookmark name"
          autoFocus
          value={text}
          maxLength={200}
          onChange={(event) => setText(event.target.value)}
          onBlur={() => {
            setEditing(false);
            onRename(text);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              event.stopPropagation();
              setText(bookmark.label ?? "");
              setEditing(false);
            }
          }}
        />
      </li>
    );
  }
  return (
    <li className="bookmark-row">
      <button type="button" className="bookmark-go" onClick={onGo}>
        <strong>{bookmark.label || describe}</strong>
        {bookmark.label && bookmark.label !== describe && <span>{describe}</span>}
      </button>
      <button type="button" className="icon-btn" aria-label="Rename bookmark" onClick={() => setEditing(true)}>
        <Pencil size={15} />
      </button>
      <button type="button" className="icon-btn" aria-label="Remove bookmark" onClick={onRemove}>
        <X size={16} />
      </button>
    </li>
  );
}

/** The bookmarks button and list shared by the page reader and the ebook reader. */
export function BookmarksMenu({ itemId, container, open, onOpenChange, here, isHere, describe, onGo }: BookmarksProps) {
  const state = useBookmarks(itemId);
  const marked = state.bookmarks.some((bookmark) => isHere(bookmark.locator));
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>
        <button type="button" className="round-btn" aria-label="Bookmarks" aria-pressed={marked} title={`Bookmarks${hint("readers.bookmark").replace(")", " adds or removes)")}`}>
          {marked ? <BookmarkCheck size={17} /> : <BookmarkIcon size={17} />}
        </button>
      </Popover.Trigger>
      <Popover.Portal container={container}>
        <Popover.Content className="menu reader-panel bookmarks-panel" align="end" sideOffset={12} collisionPadding={16}>
          <button
            type="button"
            className="btn btn-sm bookmark-toggle"
            disabled={!here}
            onClick={() => void toggleBookmark(state, here, isHere)}
          >
            {marked ? <BookmarkCheck size={15} /> : <BookmarkIcon size={15} />}
            {marked ? "Remove the bookmark here" : "Bookmark this page"}
          </button>
          {state.bookmarks.length === 0 ? (
            <p className="bookmarks-empty">No bookmarks yet. Press B to mark the page you're on.</p>
          ) : (
            <ul className="bookmark-list">
              {state.bookmarks.map((bookmark) => (
                <Row
                  key={bookmark.id}
                  bookmark={bookmark}
                  describe={describe(bookmark.locator)}
                  onGo={() => {
                    onOpenChange(false);
                    onGo(bookmark.locator);
                  }}
                  onRename={(label) => void state.rename(bookmark.id, label)}
                  onRemove={() => void state.remove(bookmark.id)}
                />
              ))}
            </ul>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

import { useState } from "react";
import { Popover } from "radix-ui";
import { List, Pencil, Plus, X } from "lucide-react";
import type { Chapter } from "../../lib/api";

/** The chapter a page belongs to: the last one starting on or before it. */
export function chapterAt(chapters: Chapter[], page: number): Chapter | null {
  let found: Chapter | null = null;
  for (const chapter of chapters) {
    if (chapter.page <= page) found = chapter;
    else break;
  }
  return found;
}

function ChapterRow({ chapter, current, onGo, onRename, onRemove }: {
  chapter: Chapter;
  current: boolean;
  onGo: () => void;
  onRename: (title: string) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(chapter.title);
  if (editing) {
    return (
      <li className="bookmark-row">
        <input
          className="input"
          aria-label="Chapter name"
          autoFocus
          value={text}
          maxLength={200}
          onChange={(event) => setText(event.target.value)}
          onBlur={() => {
            setEditing(false);
            if (text.trim() && text !== chapter.title) onRename(text);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              event.stopPropagation();
              setText(chapter.title);
              setEditing(false);
            }
          }}
        />
      </li>
    );
  }
  return (
    <li className="bookmark-row">
      <button
        type="button"
        className="toc-item"
        aria-current={current ? "location" : undefined}
        style={{ paddingLeft: 12 + chapter.depth * 16 }}
        onClick={onGo}
      >
        {chapter.title || "Untitled"} <span className="toc-page">p. {chapter.page + 1}</span>
      </button>
      <button type="button" className="icon-btn" aria-label="Rename chapter" onClick={() => setEditing(true)}>
        <Pencil size={15} />
      </button>
      <button type="button" className="icon-btn" aria-label="Remove chapter" onClick={onRemove}>
        <X size={16} />
      </button>
    </li>
  );
}

/** The page reader's contents: chapters to jump to, and marking where one starts (D-019). */
export function ChaptersMenu({ chapters, page, container, open, onOpenChange, onGo, onChange }: {
  chapters: Chapter[];
  /** The page on screen (the first, in two-page mode). */
  page: number;
  container: HTMLElement | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGo: (page: number) => void;
  /** Saves the reader's own chapters. */
  onChange: (chapters: Chapter[]) => void;
}) {
  const current = chapterAt(chapters, page);
  const startsHere = chapters.some((chapter) => chapter.page === page);
  const mark = () => {
    const title = `Chapter ${chapters.filter((chapter) => chapter.page < page).length + 1}`;
    onChange([...chapters, { title, page, depth: 0 }].sort((a, b) => a.page - b.page));
  };
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>
        <button type="button" className="btn btn-sm" title="Contents">
          <List size={15} /> <span className="label">Contents</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal container={container}>
        <Popover.Content className="menu reader-panel bookmarks-panel" align="start" sideOffset={12} collisionPadding={16}>
          <button type="button" className="btn btn-sm bookmark-toggle" disabled={startsHere} onClick={mark}>
            <Plus size={15} /> {startsHere ? "A chapter starts on this page" : `Start a chapter on page ${page + 1}`}
          </button>
          {chapters.length === 0 ? (
            <p className="bookmarks-empty">This book has no chapters yet. Go to the page where one starts and mark it.</p>
          ) : (
            <ul className="bookmark-list">
              {chapters.map((chapter, index) => (
                <ChapterRow
                  key={`${chapter.page}:${index}`}
                  chapter={chapter}
                  current={chapter === current}
                  onGo={() => {
                    onOpenChange(false);
                    onGo(chapter.page);
                  }}
                  onRename={(title) => onChange(chapters.map((c) => (c === chapter ? { ...c, title: title.trim() } : c)))}
                  onRemove={() => onChange(chapters.filter((c) => c !== chapter))}
                />
              ))}
            </ul>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Dialog as RadixDialog } from "radix-ui";
import { Award, CornerDownLeft, FilePlus, FolderPlus, Gamepad2, Home, Joystick, LibraryBig, Link as LinkIcon, Monitor, Moon, Music, Search, Settings, Disc3, ListFilter } from "lucide-react";
import { api, artworkUrl, type ArcadeGame, type ItemCard } from "../../lib/api";
import { useCategories } from "../../lib/queries";
import { usePreferences } from "../../lib/preferences";
import { useAmbient } from "../../lib/ambient/AmbientProvider";
import { useImporter } from "../../lib/importer";
import { useOpenImportUrl } from "../../app/catalog";
import { enterBigPicture } from "../../lib/bigpicture";
import { itemPath } from "../../lib/routes";
import { CategoryIcon, Cover } from "../../components/common";
import { consoleOf } from "../arcade/shared";

/** One line of the palette: something to open or do. */
interface Entry {
  id: string;
  group: "Go to" | "Do" | "In your library" | "Games";
  label: string;
  hint?: string;
  icon: ReactNode;
  /** Extra words it's found by. */
  words?: string;
  run: () => void;
}

const matches = (entry: Entry, words: string[]) => {
  const text = `${entry.label} ${entry.hint ?? ""} ${entry.words ?? ""}`.toLowerCase();
  return words.every((w) => text.includes(w));
};

/**
 * The command palette (D-048, Ctrl+K): find anything and go there from the keyboard — Library's
 * sections, Arcade, Settings, Big Picture, actions (import, theme, menu music), items in the
 * library and games in Arcade.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [at, setAt] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const categories = useCategories();
  const { preferences, resolvedTheme, update } = usePreferences();
  const ambient = useAmbient();
  const importer = useImporter();
  const openImportUrl = useOpenImportUrl();

  // Ctrl+K (or the key chosen in Settings › Keyboard) opens it from anywhere: the app's shortcuts
  // send this event.
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener("digitify:palette", onOpen);
    return () => window.removeEventListener("digitify:palette", onOpen);
  }, []);
  useEffect(() => {
    if (!open) {
      setText("");
      setQuery("");
    }
  }, [open]);
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(text.trim()), 160);
    return () => window.clearTimeout(timer);
  }, [text]);

  const items = useQuery({
    queryKey: ["palette-items", query],
    queryFn: () => api.query({ search: query, offset: 0, limit: 6 }),
    enabled: open && query.length >= 2,
    staleTime: 10_000,
  });
  const games = useQuery({ queryKey: ["arcade-games"], queryFn: api.arcadeGames, enabled: open });
  const smartLists = useQuery({ queryKey: ["smart-lists"], queryFn: api.smartLists, enabled: open });

  const go = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  const fixed = useMemo<Entry[]>(() => {
    const list: Entry[] = [
      { id: "home", group: "Go to", label: "Home", icon: <Home size={17} />, run: go(() => void navigate({ to: "/" })) },
      ...(preferences.showEverything ? [{ id: "all", group: "Go to" as const, label: "Everything", hint: "Library", icon: <LibraryBig size={17} />, words: "library all", run: go(() => void navigate({ to: "/library/$scope", params: { scope: "all" } })) }] : []),
      ...(categories.data ?? [])
        .filter((c) => !c.isHidden)
        .map<Entry>((c) => ({
          id: `cat-${c.key}`,
          group: "Go to",
          label: c.name,
          hint: "Library",
          icon: <CategoryIcon icon={c.icon} size={17} />,
          run: go(() => void navigate({ to: "/library/$scope", params: { scope: c.key } })),
        })),
      { id: "arcade", group: "Go to", label: "Arcade", hint: "Games", icon: <Joystick size={17} />, words: "games play", run: go(() => void navigate({ to: "/arcade" })) },
      { id: "smart", group: "Go to", label: "Smart lists", hint: "Library", icon: <ListFilter size={17} />, run: go(() => void navigate({ to: "/smart" })) },
      ...(smartLists.data ?? []).map<Entry>((l) => ({
        id: `smart-${l.id}`,
        group: "Go to",
        label: l.name,
        hint: "Smart list",
        icon: <ListFilter size={17} />,
        run: go(() => void navigate({ to: "/smart/$id", params: { id: String(l.id) } })),
      })),
      { id: "achievements", group: "Go to", label: "Achievements", hint: "Statistics", icon: <Award size={17} />, words: "medals stats", run: go(() => void navigate({ to: "/achievements" })) },
      { id: "discs", group: "Go to", label: "Discs", hint: "CDs, DVDs and Blu-rays", icon: <Disc3 size={17} />, run: go(() => void navigate({ to: "/discs" })) },
      { id: "settings", group: "Go to", label: "Settings", icon: <Settings size={17} />, words: "preferences options", run: go(() => void navigate({ to: "/settings" })) },
      { id: "bp", group: "Go to", label: "Big Picture", hint: "TV and controller", icon: <Monitor size={17} />, words: "tv controller fullscreen", run: go(() => void enterBigPicture(() => void navigate({ to: "/bp" }))) },
      { id: "import-folder", group: "Do", label: "Import a folder", icon: <FolderPlus size={17} />, words: "add", run: go(() => void importer.pickFolder()) },
      { id: "import-files", group: "Do", label: "Import files", icon: <FilePlus size={17} />, words: "add", run: go(() => void importer.pickFiles()) },
      { id: "import-url-music", group: "Do", label: "Add music from a link", hint: "YouTube Music, SoundCloud, Bandcamp and more", icon: <LinkIcon size={17} />, words: "url add download song", run: go(() => openImportUrl("music")) },
      { id: "import-url-videos", group: "Do", label: "Add videos from a link", hint: "YouTube, Twitch, Dailymotion and more", icon: <LinkIcon size={17} />, words: "url add download video", run: go(() => openImportUrl("videos")) },
      {
        id: "theme",
        group: "Do",
        label: resolvedTheme === "dark" ? "Switch to light mode" : "Switch to night mode",
        icon: <Moon size={17} />,
        words: "theme dark light night",
        run: go(() => update({ theme: resolvedTheme === "dark" ? "light" : "dark" })),
      },
      { id: "music", group: "Do", label: ambient.musicOn ? "Turn the menu music off" : "Turn the menu music on", icon: <Music size={17} />, words: "sound ambient", run: go(ambient.toggleMusic) },
    ];
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categories.data, smartLists.data, resolvedTheme, ambient.musicOn, preferences.look]);

  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const entries: Entry[] = [
    // With nothing typed, every place to go (D-088): Home, each category, Arcade and the rest; each
    // smart list shows when its name is typed.
    ...(words.length ? fixed.filter((e) => matches(e, words)) : fixed.filter((e) => e.group === "Go to" && !e.id.startsWith("smart-"))),
    ...(words.length
      ? (items.data?.items ?? []).map<Entry>((item: ItemCard) => ({
          id: `item-${item.id}`,
          group: "In your library",
          label: item.title,
          hint: [categories.data?.find((c) => c.key === item.category)?.name, item.year].filter(Boolean).join(" · "),
          icon: (
            <span className="palette-thumb">
              <Cover item={item} />
            </span>
          ),
          run: go(() => void navigate({ to: itemPath(item), params: { id: String(item.id) } })),
        }))
      : []),
    ...(words.length
      ? (games.data ?? [])
          .filter((g: ArcadeGame) => !g.missing && words.every((w) => g.title.toLowerCase().includes(w)))
          .slice(0, 5)
          .map<Entry>((g) => ({
            id: `game-${g.id}`,
            group: "Games",
            label: g.title,
            hint: consoleOf(g),
            icon: g.coverKey ? <img className="palette-thumb" src={artworkUrl(g.coverKey)} alt="" /> : <Gamepad2 size={17} />,
            run: go(() => void navigate({ to: "/arcade", search: { game: g.id } })),
          }))
      : []),
  ];
  const current = Math.min(at, Math.max(0, entries.length - 1));
  useEffect(() => setAt(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${current}"]`)?.scrollIntoView({ block: "nearest" });
  }, [current]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setAt((i) => Math.min(entries.length - 1, i + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setAt((i) => Math.max(0, i - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      entries[current]?.run();
    }
  };

  let lastGroup = "";
  return (
    <RadixDialog.Root open={open} onOpenChange={setOpen}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="dialog-overlay palette-overlay" />
        <RadixDialog.Content className="palette" aria-describedby={undefined} onKeyDown={onKeyDown}>
          <RadixDialog.Title className="sr-only">Find anything</RadixDialog.Title>
          <label className="palette-input">
            <Search size={18} aria-hidden />
            <input autoFocus placeholder="Find an item, a game, a section or something to do…" value={text} onChange={(event) => setText(event.target.value)} aria-label="Find anything" />
            <kbd>Esc</kbd>
          </label>
          <div className="palette-list" ref={listRef} role="listbox">
            {entries.length === 0 && <p className="palette-empty">{items.isFetching ? "Looking…" : `Nothing matches “${text}”.`}</p>}
            {entries.map((entry, index) => {
              const head = entry.group !== lastGroup ? entry.group : null;
              lastGroup = entry.group;
              return (
                <div key={entry.id}>
                  {head && <div className="palette-group">{head}</div>}
                  <button
                    type="button"
                    role="option"
                    aria-selected={index === current}
                    data-index={index}
                    className="palette-entry"
                    onMouseMove={() => setAt(index)}
                    onClick={entry.run}
                  >
                    <span className="palette-icon">{entry.icon}</span>
                    <span className="palette-label">{entry.label}</span>
                    {entry.hint && <span className="palette-hint">{entry.hint}</span>}
                    {index === current && <CornerDownLeft size={15} className="palette-enter" aria-hidden />}
                  </button>
                </div>
              );
            })}
          </div>
          <div className="palette-foot">
            <span>
              <kbd>↑</kbd> <kbd>↓</kbd> to move
            </span>
            <span>
              <kbd>Enter</kbd> to open
            </span>
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

import { useState, type ReactNode } from "react";
import { DropdownMenu } from "radix-ui";
import { useNavigate } from "@tanstack/react-router";
import { AppWindow, BookImage, BookMarked, ChevronRight, Clapperboard, Disc3, FilePlus, FolderPlus, Link2 } from "lucide-react";
import { api, type Category } from "../lib/api";
import { useOpenBuilder, useOpenImportUrl } from "../app/catalog";
import { useImporter } from "../lib/importer";
import { useCategories } from "../lib/queries";
import { CategoryIcon } from "./common";
import { FromVideosDialog } from "../features/organize/FromVideos";

/** A category's ways to add media (D-125): only what it holds, and it goes into it. */
function CategoryItems({ category, onFromVideos }: { category: Category; onFromVideos: () => void }) {
  const importer = useImporter();
  const openBuilder = useOpenBuilder();
  const openImportUrl = useOpenImportUrl();
  const navigate = useNavigate();
  const online = category.handler === "audio" || category.key === "videos";
  const pages = category.handler === "book" || category.handler === "comic";
  const disc = category.handler === "audio" || category.handler === "video";
  return (
    <>
      <DropdownMenu.Item className="menu-item" onSelect={() => void importer.pickFiles(category)}>
        <FilePlus size={17} /> Add files…
      </DropdownMenu.Item>
      <DropdownMenu.Item className="menu-item" onSelect={() => void importer.pickFolder(category)}>
        <FolderPlus size={17} /> Add a folder…
      </DropdownMenu.Item>
      {/* Music's link menu and Videos' are apart (D-134). */}
      {online && (
        <DropdownMenu.Item className="menu-item" onSelect={() => openImportUrl(category.key)}>
          <Link2 size={17} /> From a link…
        </DropdownMenu.Item>
      )}
      {category.key === "video" && (
        <DropdownMenu.Item className="menu-item" onSelect={onFromVideos}>
          <Clapperboard size={17} /> From Videos…
        </DropdownMenu.Item>
      )}
      {/* Books holds books, comics and manga (D-183): each can be made from images. */}
      {pages &&
        (category.key === "books"
          ? ([
              ["book", "Book"],
              ["comic", "Comic"],
              ["manga", "Manga"],
            ] as const)
          : ([["book", "Book"]] as const)
        ).map(([kind, label]) => (
          <DropdownMenu.Item key={kind} className="menu-item" onSelect={() => openBuilder(kind === "book" ? category.key : `${category.key}:${kind}`)}>
            <BookImage size={17} /> {label} from images…
          </DropdownMenu.Item>
        ))}
      {disc && (
        <DropdownMenu.Item className="menu-item" onSelect={() => void navigate({ to: "/discs" })}>
          <Disc3 size={17} /> From a disc…
        </DropdownMenu.Item>
      )}
      {/* The manual that comes with Digitify (D-149): back if it was deleted, opened if it's here. */}
      {category.key === "books" && (
        <DropdownMenu.Item
          className="menu-item"
          onSelect={() =>
            void api.manualAdd().then(
              (id) => navigate({ to: "/item/$id", params: { id: String(id) } }),
              () => undefined,
            )
          }
        >
          <BookMarked size={17} /> Digitify Manual
        </DropdownMenu.Item>
      )}
    </>
  );
}

/**
 * "Add" (D-125). In a category, its own ways in, and what's added goes into it; nothing is guessed.
 * On Home and in Everything, each category's (and on Home, a game for Arcade, `onAddGame`).
 * `children` is the trigger.
 */
export function AddMenu({ children, align = "start", category = null, onAddGame }: { children: ReactNode; align?: "start" | "center" | "end"; category?: string | null; onAddGame?: () => void }) {
  const categories = useCategories();
  const visible = categories.data?.filter((c) => !c.isHidden) ?? [];
  const here = category ? visible.find((c) => c.key === category) ?? categories.data?.find((c) => c.key === category) : undefined;
  const [fromVideos, setFromVideos] = useState(false);
  return (
    <>
    <FromVideosDialog open={fromVideos} onOpenChange={setFromVideos} />
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>{children}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="menu" align={align} sideOffset={8}>
          {here ? (
            <CategoryItems category={here} onFromVideos={() => setFromVideos(true)} />
          ) : (
            <>
              {visible.map((c) => (
                <DropdownMenu.Sub key={c.key}>
                  <DropdownMenu.SubTrigger className="menu-item">
                    <CategoryIcon icon={c.icon} size={17} /> {c.name}
                    <ChevronRight size={15} className="menu-sub-arrow" />
                  </DropdownMenu.SubTrigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.SubContent className="menu" sideOffset={6} alignOffset={-8}>
                      <CategoryItems category={c} onFromVideos={() => setFromVideos(true)} />
                    </DropdownMenu.SubContent>
                  </DropdownMenu.Portal>
                </DropdownMenu.Sub>
              ))}
              {onAddGame && (
                <>
                  <DropdownMenu.Separator className="menu-separator" />
                  <DropdownMenu.Item className="menu-item" onSelect={onAddGame}>
                    <AppWindow size={17} /> A game, for Arcade…
                  </DropdownMenu.Item>
                </>
              )}
            </>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
    </>
  );
}

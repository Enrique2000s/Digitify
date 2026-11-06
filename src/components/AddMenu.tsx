import type { ReactNode } from "react";
import { DropdownMenu } from "radix-ui";
import { useNavigate } from "@tanstack/react-router";
import { BookImage, Disc3, FilePlus, FolderPlus, Link2 } from "lucide-react";
import { useOpenBuilder, useOpenImportUrl } from "../app/catalog";
import { useImporter } from "../lib/importer";

/** "Add to library": import local files or a folder, import from a URL, a book from images, or a disc. `children` is the trigger. */
export function AddMenu({ children, align = "start" }: { children: ReactNode; align?: "start" | "center" | "end" }) {
  const importer = useImporter();
  const openBuilder = useOpenBuilder();
  const openImportUrl = useOpenImportUrl();
  const navigate = useNavigate();
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>{children}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="menu" align={align} sideOffset={8}>
          <DropdownMenu.Item className="menu-item" onSelect={() => void importer.pickFiles()}>
            <FilePlus size={17} /> Import files…
          </DropdownMenu.Item>
          <DropdownMenu.Item className="menu-item" onSelect={() => void importer.pickFolder()}>
            <FolderPlus size={17} /> Import a folder…
          </DropdownMenu.Item>
          <DropdownMenu.Item className="menu-item" onSelect={openImportUrl}>
            <Link2 size={17} /> Import from URL…
          </DropdownMenu.Item>
          <DropdownMenu.Item className="menu-item" onSelect={openBuilder}>
            <BookImage size={17} /> Book from images…
          </DropdownMenu.Item>
          <DropdownMenu.Item className="menu-item" onSelect={() => void navigate({ to: "/discs" })}>
            <Disc3 size={17} /> From a disc (CD, DVD, Blu-ray)…
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

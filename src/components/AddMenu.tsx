import type { ReactNode } from "react";
import { DropdownMenu } from "radix-ui";
import { BookImage, FilePlus, FolderPlus, Package } from "lucide-react";
import { useOpenBuilder, useOpenCatalog } from "../app/catalog";
import { useImporter } from "../lib/importer";

/** "Add to library": import files or a folder, or catalog a physical item. `children` is the trigger. */
export function AddMenu({ children, align = "start" }: { children: ReactNode; align?: "start" | "center" | "end" }) {
  const importer = useImporter();
  const openCatalog = useOpenCatalog();
  const openBuilder = useOpenBuilder();
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
          <DropdownMenu.Item className="menu-item" onSelect={openBuilder}>
            <BookImage size={17} /> Book from images…
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="menu-separator" />
          <DropdownMenu.Item className="menu-item" onSelect={openCatalog}>
            <Package size={17} /> Catalog a physical item…
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

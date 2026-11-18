import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { FolderPlus } from "lucide-react";
import { api, type Category } from "../../lib/api";
import { libraryChanged } from "../../lib/queries";
import { NameDialog } from "./dialogs";

/** "New collection" on a category page (D-090): collections are one level, so only at the top. */
export function CollectionActions({ category }: { category: Category }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        <FolderPlus size={16} /> New collection
      </button>
      <NameDialog
        open={open}
        onOpenChange={setOpen}
        title={`New collection in ${category.name}`}
        description="A collection is a folder of items inside a category, like a series, a trip or a box set."
        label="Name"
        confirm="Create"
        onSubmit={async (name) => {
          const id = await api.collectionCreate(category.key, null, name);
          libraryChanged(queryClient);
          await navigate({ to: "/library/$scope", params: { scope: category.key }, search: { collection: id } });
        }}
      />
    </>
  );
}

import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { DropdownMenu } from "radix-ui";
import { Check, Plus } from "lucide-react";
import { api, errorText } from "../../lib/api";
import { libraryChanged, useShelves } from "../../lib/queries";
import { ShelfDialog } from "./dialogs";

/**
 * Puts items on shelves. With `member` (one item's shelves) each shelf toggles; without it (a
 * selection) shelves only add. `children` is the trigger button.
 */
export function ShelfMenu({ ids, member, children, onError }: { ids: number[]; member?: Set<number>; children: ReactNode; onError?: (message: string) => void }) {
  const queryClient = useQueryClient();
  const shelves = useShelves();
  const [creating, setCreating] = useState(false);

  const change = async (shelf: number, add: boolean) => {
    try {
      await api.itemsBulk(ids, [add ? { op: "addToShelf", shelf } : { op: "removeFromShelf", shelf }]);
      libraryChanged(queryClient);
    } catch (reason) {
      onError?.(errorText(reason));
    }
  };

  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>{children}</DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="menu" align="start" sideOffset={8}>
            {shelves.data?.length === 0 && <div className="menu-note">No shelves yet.</div>}
            {shelves.data?.map((shelf) =>
              member ? (
                <DropdownMenu.CheckboxItem
                  key={shelf.id}
                  className="menu-item"
                  checked={member.has(shelf.id)}
                  onSelect={(event) => event.preventDefault()}
                  onCheckedChange={(checked) => void change(shelf.id, checked === true)}
                >
                  <span className="menu-check">
                    <DropdownMenu.ItemIndicator>
                      <Check size={15} strokeWidth={3} />
                    </DropdownMenu.ItemIndicator>
                  </span>
                  {shelf.name}
                  <small>{shelf.itemCount.toLocaleString()}</small>
                </DropdownMenu.CheckboxItem>
              ) : (
                <DropdownMenu.Item key={shelf.id} className="menu-item" onSelect={() => void change(shelf.id, true)}>
                  {shelf.name}
                  <small>{shelf.itemCount.toLocaleString()}</small>
                </DropdownMenu.Item>
              ),
            )}
            <DropdownMenu.Separator className="menu-separator" />
            <DropdownMenu.Item className="menu-item" onSelect={() => setCreating(true)}>
              <Plus size={16} /> New shelf…
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <ShelfDialog open={creating} onOpenChange={setCreating} onSaved={(shelf) => api.itemsBulk(ids, [{ op: "addToShelf", shelf }])} />
    </>
  );
}

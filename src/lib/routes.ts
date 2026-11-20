import { api } from "./api";
import type { Handler, QueryParams } from "./api";

/** Where an item opens: photos straight in the image viewer (D-033), everything else on its page. */
export function itemPath(item: { handler: Handler | string }): "/view/$id" | "/item/$id" {
  return item.handler === "image" ? "/view/$id" : "/item/$id";
}

/**
 * The library view something was opened from (its category, collection, filter and sort), so
 * previous and next follow what was on screen: photos in the viewer (D-033), videos in the player
 * and the songs queued after one played from its page (D-091). Set by every library view as it shows.
 */
export const photoContext: { params: Omit<QueryParams, "offset" | "limit"> | null } = { params: null };

/**
 * The items of `handler` in the view something was opened from, in its order, when `id` is among
 * them (D-091); otherwise null. `withFiles` leaves out online items, which no player here plays
 * (D-140).
 */
export async function viewList(id: number, handler: Handler, withFiles = false): Promise<number[] | null> {
  if (!photoContext.params) return null;
  const ids = await api.queryIds({ ...photoContext.params, handler, ...(withFiles ? { ownership: "digital" as const } : {}) });
  return ids.includes(id) ? ids : null;
}

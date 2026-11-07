import type { Handler, QueryParams } from "./api";

/** Where an item opens: photos straight in the image viewer (D-033), everything else on its page. */
export function itemPath(item: { handler: Handler | string }): "/view/$id" | "/item/$id" {
  return item.handler === "image" ? "/view/$id" : "/item/$id";
}

/**
 * The library view the image viewer was opened from (its category, album, filter and sort), so
 * previous and next follow what was on screen. Set by every library view as it shows.
 */
export const photoContext: { params: Omit<QueryParams, "offset" | "limit"> | null } = { params: null };

import { useEffect, useMemo, useReducer, useState, useSyncExternalStore } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { api, type ItemCard, type QueryParams } from "./api";

export const keys = {
  status: ["status"] as const,
  categories: ["categories"] as const,
  dashboard: ["dashboard"] as const,
  item: (id: number) => ["item", id] as const,
  tags: ["tags"] as const,
  shelves: ["shelves"] as const,
  collections: (category: string, parent: number | null) => ["collections", category, parent] as const,
  collectionTree: (category: string) => ["collection-tree", category] as const,
};

export const useAppStatus = () => useQuery({ queryKey: keys.status, queryFn: api.appStatus, staleTime: Infinity });
export const useCategories = () => useQuery({ queryKey: keys.categories, queryFn: api.categories });
export const useDashboard = () => useQuery({ queryKey: keys.dashboard, queryFn: api.dashboard });
export const useItem = (id: number, enabled = true) => useQuery({ queryKey: keys.item(id), queryFn: () => api.item(id), enabled });
export const useTags = () => useQuery({ queryKey: keys.tags, queryFn: api.tags });
export const useShelves = () => useQuery({ queryKey: keys.shelves, queryFn: api.shelves });
export const useCollections = (category: string, parent: number | null) =>
  useQuery({ queryKey: keys.collections(category, parent), queryFn: () => api.collections(category, parent) });
export const useCollectionTree = (category: string | null) =>
  useQuery({ queryKey: keys.collectionTree(category ?? ""), queryFn: () => api.collectionTree(category!), enabled: !!category });

// Library version: bumps whenever the library changes, so paged views reload their pages.
let libraryVersion = 0;
const versionListeners = new Set<() => void>();
const subscribeVersion = (listener: () => void) => {
  versionListeners.add(listener);
  return () => versionListeners.delete(listener);
};

export function useLibraryVersion(): number {
  return useSyncExternalStore(subscribeVersion, () => libraryVersion);
}

/** Call after any change to the library (own edits or `library-changed` events from the core). */
export function libraryChanged(queryClient: QueryClient) {
  libraryVersion++;
  versionListeners.forEach((listener) => listener());
  for (const queryKey of [keys.categories, keys.dashboard, keys.tags, keys.shelves, ["item"], ["collections"], ["collection-tree"], ["tracks"], ["artists"], ["playlists"], ["episodes"], ["series"], ["chapters"], ["stats"], ["blurb"], ["shapes"]]) {
    void queryClient.invalidateQueries({ queryKey });
  }
}

/** Listens for changes made in the background (imports, missing-file checks). */
export function useLibraryEvents() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const unlisten = listen("library-changed", () => libraryChanged(queryClient));
    return () => {
      void unlisten.then((stop) => stop());
    };
  }, [queryClient]);
}

const PAGE_SIZE = 200;

/** Loads result pages on demand as rows scroll into view (random access for virtualized views). */
export class PageCache {
  private pages = new Map<number, ItemCard[]>();
  private pending = new Set<number>();
  private readonly params: Omit<QueryParams, "offset" | "limit">;
  private readonly onChange: () => void;

  constructor(params: Omit<QueryParams, "offset" | "limit">, onChange: () => void) {
    this.params = params;
    this.onChange = onChange;
  }

  get(index: number): ItemCard | undefined {
    return this.pages.get(Math.floor(index / PAGE_SIZE))?.[index % PAGE_SIZE];
  }

  ensure(first: number, last: number): void {
    for (let page = Math.floor(first / PAGE_SIZE); page <= Math.floor(last / PAGE_SIZE); page++) {
      if (!this.pages.has(page) && !this.pending.has(page)) {
        this.load(page).catch((error) => console.error("page load failed", error));
      }
    }
  }

  /** Loads one page; resolves with the total number of matching items. */
  async load(page: number): Promise<number> {
    this.pending.add(page);
    try {
      const result = await api.query({ ...this.params, offset: page * PAGE_SIZE, limit: PAGE_SIZE });
      this.pages.set(page, result.items);
      this.onChange();
      return result.total;
    } finally {
      this.pending.delete(page);
    }
  }
}

export function usePagedItems(params: Omit<QueryParams, "offset" | "limit">) {
  const version = useLibraryVersion();
  const signature = JSON.stringify(params);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const [total, setTotal] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A new cache per query and per library version; `signature` stands in for `params`.
  const cache = useMemo(() => new PageCache(JSON.parse(signature), rerender), [signature, version]);

  useEffect(() => {
    let alive = true;
    setError(null);
    cache.load(0).then(
      (count) => alive && setTotal(count),
      (reason) => alive && setError(String(reason)),
    );
    return () => {
      alive = false;
    };
  }, [cache]);

  return { cache, total, error };
}

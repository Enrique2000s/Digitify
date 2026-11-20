import { createContext, useContext } from "react";

/** Opens "Book from images" (the image-set book builder) for a category: Books, Comics or Manga (D-145). */
export const BuilderContext = createContext<(category: string) => void>(() => {});

export const useOpenBuilder = () => useContext(BuilderContext);

/** Opens adding from a link (D-028) for a category: its music menu or the videos one (D-134). */
export const ImportUrlContext = createContext<(category: string) => void>(() => {});

export const useOpenImportUrl = () => useContext(ImportUrlContext);

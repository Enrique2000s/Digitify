import { createContext, useContext } from "react";

/** Opens "Book from images" (the image-set book builder) from anywhere in the app. */
export const BuilderContext = createContext<() => void>(() => {});

export const useOpenBuilder = () => useContext(BuilderContext);

/** Opens "Import from URL" (D-028) from anywhere in the app. */
export const ImportUrlContext = createContext<() => void>(() => {});

export const useOpenImportUrl = () => useContext(ImportUrlContext);

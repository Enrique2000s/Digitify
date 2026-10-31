import { createContext, useContext } from "react";

/** Opens the "Catalog a physical item" dialog from anywhere in the app. */
export const CatalogContext = createContext<() => void>(() => {});

export const useOpenCatalog = () => useContext(CatalogContext);

/** Opens "Book from images" (the image-set book builder) from anywhere in the app. */
export const BuilderContext = createContext<() => void>(() => {});

export const useOpenBuilder = () => useContext(BuilderContext);

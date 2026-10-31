import { createContext, useContext } from "react";

/** Opens the "Catalog a physical item" dialog from anywhere in the app. */
export const CatalogContext = createContext<() => void>(() => {});

export const useOpenCatalog = () => useContext(CatalogContext);

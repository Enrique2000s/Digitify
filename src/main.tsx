import "@fontsource-variable/nunito";
// Cinematic's fonts (D-015, D-023), loaded only when that look is on.
import "@fontsource-variable/inter";
import "@fontsource-variable/archivo/wdth.css";
import "./styles/tokens.css";
import "./styles/app.css";
import "./styles/looks.css";
import "./styles/views.css";
import "./styles/bigpicture.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "./app/router";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 } },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);

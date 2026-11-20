import { useCanGoBack, useNavigate, useRouter } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

/**
 * A page's own Back (D-138): to the screen it was opened from, or `fallback` when it was the first
 * one shown (Home when none is given). The title bar has no back or forward, so every page past Home, Library and Arcade has
 * this one, in the same place (players and readers keep their round one).
 */
export function BackButton({ fallback, className = "" }: { fallback?: () => void; className?: string }) {
  const router = useRouter();
  const navigate = useNavigate();
  const canGoBack = useCanGoBack();
  return (
    <button type="button" className={`btn page-back ${className}`.trim()} onClick={() => (canGoBack ? router.history.back() : fallback ? fallback() : void navigate({ to: "/" }))}>
      <ArrowLeft size={16} /> Back
    </button>
  );
}

/**
 * Turns off the browser's own ways back and forward (D-138): the mouse's side buttons and
 * Alt+←/→, so a page's Back is the one way back, the same everywhere.
 */
export function blockHistoryKeys(): () => void {
  const keys = (event: KeyboardEvent) => {
    const arrow = event.key === "ArrowLeft" || event.key === "ArrowRight";
    if ((event.altKey && arrow && !event.ctrlKey && !event.shiftKey) || event.key === "BrowserBack" || event.key === "BrowserForward") event.preventDefault();
  };
  const mouse = (event: MouseEvent) => {
    if (event.button === 3 || event.button === 4) event.preventDefault();
  };
  window.addEventListener("keydown", keys, true);
  for (const type of ["mousedown", "mouseup", "auxclick"] as const) window.addEventListener(type, mouse, true);
  return () => {
    window.removeEventListener("keydown", keys, true);
    for (const type of ["mousedown", "mouseup", "auxclick"] as const) window.removeEventListener(type, mouse, true);
  };
}

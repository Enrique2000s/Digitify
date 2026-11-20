import { useEffect } from "react";
import { useRouter, type ErrorComponentProps } from "@tanstack/react-router";
import { ArrowLeft, House, TriangleAlert } from "lucide-react";
import { usePad } from "../lib/gamepad";

/**
 * A screen that failed (D-143): it says so and offers Back and Home (B and Esc go back), in the
 * regular app and in Big Picture, instead of a dead end.
 */
export function ScreenError({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  const bigPicture = window.location.hash.startsWith("#/bp");
  const back = () => {
    router.history.back();
    window.setTimeout(reset, 50);
  };
  const home = () => {
    void (bigPicture ? router.navigate({ to: "/bp", search: { screen: "home" } }) : router.navigate({ to: "/" }));
    window.setTimeout(reset, 50);
  };
  useEffect(() => {
    console.error("a screen failed", error);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  usePad((action) => {
    if (action === "back") back();
    else if (action === "start" || action === "guide") home();
    else return;
    return true;
  });
  return (
    <div className={`screen-error${bigPicture ? " bp" : ""}`} role="alert">
      <TriangleAlert size={40} aria-hidden />
      <h1 className="display">This screen ran into a problem</h1>
      <p>{error instanceof Error ? error.message : String(error)}</p>
      <div className="screen-error-actions">
        <button type="button" className="btn btn-primary" autoFocus onClick={back}>
          <ArrowLeft size={16} /> Back
        </button>
        <button type="button" className="btn" onClick={home}>
          <House size={16} /> Home
        </button>
      </div>
    </div>
  );
}

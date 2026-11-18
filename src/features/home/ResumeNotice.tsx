import { useEffect, useState } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { Play, X } from "lucide-react";
import { api, type Resume } from "../../lib/api";
import { usePreferences } from "../../lib/preferences";
import { useLaunch } from "../arcade/shared";

/** Shown once per launch of the app, not every time the library reopens. */
let offered = false;

/**
 * Continue where you left off (D-068): when the app opens, a small notice offers the book, comic,
 * film, series or game left halfway lately. It goes away by itself after a while.
 */
export function ResumeNotice() {
  const { preferences } = usePreferences();
  const navigate = useNavigate();
  const { launch } = useLaunch();
  const atHome = useRouterState({ select: (state) => state.location.pathname === "/" });
  const [resume, setResume] = useState<Resume | null>(null);

  useEffect(() => {
    if (offered || !preferences.resumeOnOpen) return;
    offered = true;
    const t = window.setTimeout(() => void api.resumeGet().then(setResume).catch(() => {}), 1_200);
    return () => window.clearTimeout(t);
  }, [preferences.resumeOnOpen]);

  useEffect(() => {
    if (!resume) return;
    const t = window.setTimeout(() => setResume(null), 15_000);
    return () => window.clearTimeout(t);
  }, [resume]);

  // Opening something else first answers the question.
  useEffect(() => {
    if (!atHome) setResume(null);
  }, [atHome]);

  if (!resume) return null;
  const title = resume.kind === "item" ? resume.card.title : resume.title;
  const what =
    resume.kind === "game"
      ? "Keep playing"
      : resume.card.handler === "video"
        ? "Keep watching"
        : `Keep reading${resume.card.progress ? ` · ${Math.round(resume.card.progress * 100)}%` : ""}`;
  const go = () => {
    setResume(null);
    if (resume.kind === "game") {
      void api.arcadeGames().then((games) => {
        const game = games.find((g) => g.id === resume.id);
        if (game) void launch(game);
      });
    } else if (resume.card.handler === "video") {
      void navigate({ to: "/watch/$id", params: { id: String(resume.card.id) } });
    } else {
      void navigate({ to: "/read/$id", params: { id: String(resume.card.id) } });
    }
  };
  return (
    <div className="resume-notice" role="status">
      <div>
        <span>Continue where you left off?</span>
        <strong title={title}>{title}</strong>
      </div>
      <button type="button" className="btn btn-sm btn-primary" onClick={go}>
        <Play size={14} fill="currentColor" /> {what}
      </button>
      <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => setResume(null)}>
        <X size={16} />
      </button>
    </div>
  );
}

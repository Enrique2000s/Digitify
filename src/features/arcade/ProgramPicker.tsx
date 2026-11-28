import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { AppWindow, Check, FolderOpen, LoaderCircle, Search } from "lucide-react";
import { api, errorText, onLinux, type ProgramEntry } from "../../lib/api";
import { Dialog } from "../../components/common";

/** The open picker's answer: the first game added, or null when nothing was. */
let answer: ((id: number | null) => void) | null = null;

/**
 * Opens the list of programs to add as games (D-183) and waits for it: the first game added, or
 * null. Mounted once (ProgramPicker); everything that adds a game by its program goes through it.
 */
export function pickPrograms(downloadCovers: boolean): Promise<number | null> {
  return new Promise((resolve) => {
    answer?.(null);
    answer = resolve;
    window.dispatchEvent(new CustomEvent("digitify:pick-programs", { detail: downloadCovers }));
  });
}

/**
 * Add games by their program (D-183), as Steam's "Add a non-Steam game" does: the programs found on
 * this computer (the Start menu's and the desktop's shortcuts on Windows, the desktop entries on
 * Linux) with their icon, name and program file, A to Z or Z to A, to find by name and tick several
 * at once; Browse… picks any program file instead. Programs already in Arcade show as such.
 */
export function ProgramPicker() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [downloadCovers, setDownloadCovers] = useState(false);
  const [find, setFind] = useState("");
  const [order, setOrder] = useState<"az" | "za">("az");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [extra, setExtra] = useState<ProgramEntry[]>([]);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onPick = (event: Event) => {
      setDownloadCovers(!!(event as CustomEvent<boolean>).detail);
      setFind("");
      setPicked(new Set());
      setExtra([]);
      setError(null);
      setOpen(true);
    };
    window.addEventListener("digitify:pick-programs", onPick);
    return () => window.removeEventListener("digitify:pick-programs", onPick);
  }, []);

  const programs = useQuery({ queryKey: ["arcade-programs"], queryFn: api.arcadePrograms, enabled: open, staleTime: 60_000 });
  const games = useQuery({ queryKey: ["arcade-games"], queryFn: api.arcadeGames, enabled: open });
  const inArcade = useMemo(() => new Set((games.data ?? []).filter((g) => !g.missing).map((g) => g.path.toLowerCase())), [games.data]);

  const shown = useMemo(() => {
    const all = [...extra, ...(programs.data ?? []).filter((p) => !extra.some((e) => e.path.toLowerCase() === p.path.toLowerCase()))];
    const words = find.trim().toLowerCase();
    const matching = words ? all.filter((p) => p.name.toLowerCase().includes(words) || p.path.toLowerCase().includes(words)) : all;
    // Numbers before letters, and "Game 2" before "Game 10".
    const sorted = [...matching].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
    return order === "az" ? sorted : sorted.reverse();
  }, [programs.data, extra, find, order]);

  const close = (id: number | null) => {
    setOpen(false);
    answer?.(id);
    answer = null;
  };
  const toggle = (path: string) =>
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  const browse = async () => {
    const chosen = await openDialog({ multiple: true, title: "Choose games' programs", filters: onLinux ? undefined : [{ name: "Programs", extensions: ["exe"] }] });
    const paths = (Array.isArray(chosen) ? chosen : typeof chosen === "string" ? [chosen] : []).filter(Boolean);
    if (!paths.length) return;
    const name = (path: string) => path.split(/[\\/]/).pop()?.replace(/\.exe$/i, "") ?? path;
    setExtra((current) => [...paths.filter((p) => !current.some((c) => c.path === p)).map((path) => ({ name: name(path), path, icon: null })), ...current]);
    setPicked((current) => new Set([...current, ...paths.filter((p) => !inArcade.has(p.toLowerCase()))]));
  };
  const add = async () => {
    setAdding(true);
    setError(null);
    let first: number | null = null;
    const failed: string[] = [];
    for (const path of picked) {
      try {
        const id = await api.arcadeAddProgram(path, downloadCovers);
        first ??= id;
      } catch (reason) {
        failed.push(`${path.split(/[\\/]/).pop()}: ${errorText(reason)}`);
      }
    }
    setAdding(false);
    void queryClient.invalidateQueries({ queryKey: ["arcade-games"] });
    void queryClient.invalidateQueries({ queryKey: ["arcade-status"] });
    if (failed.length) {
      setError(failed.join(" · "));
      setPicked(new Set());
      if (first == null) return;
    }
    close(first);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => !o && !adding && close(null)}
      wide
      title="Add games from this computer"
      description={onLinux ? "Programs with a menu entry on this computer. Tick the games to add, or browse for a program." : "Programs from the Start menu and the desktop. Tick the games to add, or browse for a program."}
      footer={
        <>
          <button type="button" className="btn" style={{ marginRight: "auto" }} disabled={adding} onClick={() => void browse()}>
            <FolderOpen size={16} /> Browse…
          </button>
          <button type="button" className="btn" disabled={adding} onClick={() => close(null)}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={adding || picked.size === 0} onClick={() => void add()}>
            {adding ? <LoaderCircle size={16} className="spin" /> : null} {picked.size > 1 ? `Add ${picked.size} games` : "Add game"}
          </button>
        </>
      }
    >
      <div className="program-picker-tools">
        <label className="arcade-search">
          <Search size={15} aria-hidden />
          <input type="search" placeholder="Find a program" value={find} onChange={(event) => setFind(event.target.value)} aria-label="Find a program" autoFocus />
        </label>
        <div className="segmented" role="group" aria-label="Order">
          <button type="button" aria-pressed={order === "az"} onClick={() => setOrder("az")}>
            A to Z
          </button>
          <button type="button" aria-pressed={order === "za"} onClick={() => setOrder("za")}>
            Z to A
          </button>
        </div>
      </div>
      <div className="program-picker-list" role="list">
        {programs.isLoading && !extra.length ? (
          <p className="muted program-picker-note">
            <LoaderCircle size={16} className="spin" /> Looking for programs…
          </p>
        ) : shown.length === 0 ? (
          <p className="muted program-picker-note">{find.trim() ? "No program matches." : "No programs found. Use Browse… to pick one."}</p>
        ) : (
          shown.map((program) => {
            const already = inArcade.has(program.path.toLowerCase());
            const on = picked.has(program.path);
            return (
              <button
                key={program.path}
                type="button"
                role="listitem"
                className={`program-row${on ? " on" : ""}`}
                disabled={already || adding}
                aria-pressed={on}
                onClick={() => toggle(program.path)}
                title={program.path}
              >
                <span className={`program-check${on || already ? " on" : ""}`} aria-hidden>
                  {(on || already) && <Check size={13} strokeWidth={3.2} />}
                </span>
                {program.icon ? <img className="program-icon" src={program.icon} alt="" /> : <AppWindow className="program-icon" size={22} aria-hidden />}
                <span className="program-text">
                  <strong>{program.name}</strong>
                  <span className="muted">{program.path}</span>
                </span>
                {already && <span className="chip">In Arcade</span>}
              </button>
            );
          })
        )}
      </div>
      {error && <p className="notice danger">{error}</p>}
    </Dialog>
  );
}

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { Pencil, Plus, Trash, ListFilter } from "lucide-react";
import { api, errorText, type SmartList, type SmartQuery } from "../../lib/api";
import { plural } from "../../lib/format";
import { useCategories, useTags } from "../../lib/queries";
import { useArrival } from "../../lib/arrival";
import { CategoryStrip } from "../../components/CategoryStrip";
import { Dialog, Field } from "../../components/common";
import { LibraryView } from "../library/LibraryView";

export const useSmartLists = () => useQuery({ queryKey: ["smart-lists"], queryFn: api.smartLists, staleTime: 0 });

/** The rules in words: "Films · not started · 2024 or later · 4+ stars". */
export function describeRules(query: SmartQuery, categoryName: (key: string) => string | undefined, tagName: (id: number) => string | undefined): string {
  const parts: string[] = [];
  parts.push(query.category ? (categoryName(query.category) ?? query.category) : "Everything");
  if (query.progress === "unstarted") parts.push("not started");
  if (query.progress === "inProgress") parts.push("in progress");
  if (query.progress === "finished") parts.push("finished");
  if (query.favorites) parts.push("favorites");
  if (query.ownership === "digital") parts.push("with files");
  if (query.yearFrom && query.yearTo) parts.push(query.yearFrom === query.yearTo ? `${query.yearFrom}` : `${query.yearFrom}–${query.yearTo}`);
  else if (query.yearFrom) parts.push(`${query.yearFrom} or later`);
  else if (query.yearTo) parts.push(`${query.yearTo} or earlier`);
  if (query.addedDays) parts.push(`added in the last ${query.addedDays} days`);
  if (query.minRating) parts.push(`${query.minRating}+ stars`);
  if (query.tag != null) parts.push(`tagged “${tagName(query.tag) ?? "?"}”`);
  return parts.join(" · ");
}

/** Making or changing a smart list: its name and rules, with how many items they find right now. */
export function SmartListDialog({ list, open, onOpenChange }: { list: SmartList | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const categories = useCategories();
  const tags = useTags();
  const [name, setName] = useState("");
  const [rules, setRules] = useState<SmartQuery>({});
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setName(list?.name ?? "");
    setRules(list?.query ?? {});
    setError(null);
  }, [open, list]);
  const set = (change: Partial<SmartQuery>) => setRules((r) => Object.fromEntries(Object.entries({ ...r, ...change }).filter(([, v]) => v !== undefined && v !== null && v !== "" && v !== false)) as SmartQuery);
  const count = useQuery({ queryKey: ["smart-count", rules], queryFn: () => api.query({ ...rules, offset: 0, limit: 1 }), enabled: open });
  const year = (text: string) => (text.trim() && Number.isInteger(Number(text)) ? Number(text) : undefined);

  const save = async () => {
    try {
      const id = await api.smartListSave(list?.id ?? null, name, rules);
      await queryClient.invalidateQueries({ queryKey: ["smart-lists"] });
      onOpenChange(false);
      if (!list) void navigate({ to: "/smart/$id", params: { id: String(id) } });
    } catch (reason) {
      setError(errorText(reason));
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      wide
      title={list ? `Edit “${list.name}”` : "New smart list"}
      description="A smart list fills itself with what matches its rules, and keeps up as your library changes. Items stay where they are."
      footer={
        <>
          <span className="smart-count">{count.data ? plural(count.data.total, "item") + " match now" : " "}</span>
          <button type="button" className="btn" onClick={() => onOpenChange(false)}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={!name.trim()} onClick={() => void save()}>
            {list ? "Save" : "Create smart list"}
          </button>
        </>
      }
    >
      <Field label="Name">
        <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Films to watch, Comics I loved, New this month" />
      </Field>
      <div className="field-row">
        <Field label="From">
          <select className="select" value={rules.category ?? ""} onChange={(e) => set({ category: e.target.value || undefined })}>
            <option value="">Everything</option>
            {categories.data?.map((c) => (
              <option key={c.key} value={c.key}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Progress">
          <select className="select" value={rules.progress ?? ""} onChange={(e) => set({ progress: (e.target.value || undefined) as SmartQuery["progress"] })}>
            <option value="">Any</option>
            <option value="unstarted">Not started</option>
            <option value="inProgress">In progress</option>
            <option value="finished">Finished</option>
          </select>
        </Field>
      </div>
      <div className="field-row">
        <Field label="Your rating">
          <select className="select" value={rules.minRating ?? ""} onChange={(e) => set({ minRating: e.target.value ? Number(e.target.value) : undefined })}>
            <option value="">Any</option>
            {[5, 4, 3, 2, 1].map((n) => (
              <option key={n} value={n}>
                {n === 5 ? "5 stars" : `${n} stars or more`}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Added">
          <select className="select" value={rules.addedDays ?? ""} onChange={(e) => set({ addedDays: e.target.value ? Number(e.target.value) : undefined })}>
            <option value="">Any time</option>
            <option value="7">In the last week</option>
            <option value="30">In the last month</option>
            <option value="90">In the last 3 months</option>
            <option value="365">In the last year</option>
          </select>
        </Field>
      </div>
      <div className="field-row">
        <Field label="Year from">
          <input className="input" inputMode="numeric" placeholder="Any" value={rules.yearFrom ?? ""} onChange={(e) => set({ yearFrom: year(e.target.value) })} />
        </Field>
        <Field label="Year to">
          <input className="input" inputMode="numeric" placeholder="Any" value={rules.yearTo ?? ""} onChange={(e) => set({ yearTo: year(e.target.value) })} />
        </Field>
      </div>
      <div className="field-row">
        <Field label="Tag">
          <select className="select" value={rules.tag ?? ""} onChange={(e) => set({ tag: e.target.value ? Number(e.target.value) : undefined })}>
            <option value="">Any</option>
            {tags.data?.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Only">
          <div className="smart-checks">
            <label>
              <input type="checkbox" checked={!!rules.favorites} onChange={(e) => set({ favorites: e.target.checked || undefined })} /> Favorites
            </label>
            <label>
              <input type="checkbox" checked={rules.ownership === "digital"} onChange={(e) => set({ ownership: e.target.checked ? "digital" : undefined })} /> With files on this computer
            </label>
          </div>
        </Field>
      </div>
      {error && <div className="dialog-error">{error}</div>}
    </Dialog>
  );
}

/** Library › Smart lists: every smart list, and making a new one. */
export function SmartListsPage() {
  const lists = useSmartLists();
  const categories = useCategories();
  const tags = useTags();
  const [editing, setEditing] = useState<SmartList | "new" | null>(null);
  const arriving = useArrival("title:Smart lists");
  const list = lists.data ?? [];
  return (
    <div className="library-view">
      <div className="tags-view">
        <CategoryStrip />
        <div className="page-header">
          <div className={`title-row${arriving ? " arriving" : ""}`}>
            <span className="title-badge">
              <ListFilter size={26} strokeWidth={2.2} aria-hidden />
            </span>
            <div>
              <h1 className="display">Smart lists</h1>
              <div className="count">{lists.data ? plural(list.length, "smart list") : " "}</div>
            </div>
          </div>
          <div className="header-actions">
            <button type="button" className="btn btn-primary" onClick={() => setEditing("new")}>
              <Plus size={17} strokeWidth={2.6} /> New smart list
            </button>
          </div>
        </div>
        <div className="tags-stage">
          {lists.data && list.length === 0 ? (
            <div className="empty">
              <h2 className="display">No smart lists yet</h2>
              <p>Smart lists fill themselves with what matches their rules: films you haven't watched, comics rated 4 stars or more, everything added this month…</p>
              <button type="button" className="btn btn-primary" onClick={() => setEditing("new")}>
                <Plus size={16} /> New smart list
              </button>
            </div>
          ) : (
            <ul className="smart-list">
              {list.map((smart) => (
                <li key={smart.id}>
                  <Link to="/smart/$id" params={{ id: String(smart.id) }} className="smart-card" data-blip>
                    <ListFilter size={18} aria-hidden />
                    <span>
                      <strong>{smart.name}</strong>
                      <span className="muted">{describeRules(smart.query, (k) => categories.data?.find((c) => c.key === k)?.name, (id) => tags.data?.find((t) => t.id === id)?.name)}</span>
                    </span>
                  </Link>
                  <button type="button" className="icon-btn" aria-label={`Edit ${smart.name}`} title="Edit" onClick={() => setEditing(smart)}>
                    <Pencil size={15} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <SmartListDialog list={editing === "new" ? null : editing} open={editing !== null} onOpenChange={(open) => !open && setEditing(null)} />
      </div>
    </div>
  );
}

/** One smart list: the Library view with its rules. */
export function SmartListPage() {
  const { id } = useParams({ from: "/smart/$id" });
  const lists = useSmartLists();
  const categories = useCategories();
  const tags = useTags();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const smart = lists.data?.find((l) => l.id === Number(id));
  if (!smart) {
    return lists.isPending ? null : (
      <div className="page">
        <div className="empty">
          <h2 className="display">This smart list is gone</h2>
          <Link to="/smart" className="btn">
            All smart lists
          </Link>
        </div>
      </div>
    );
  }
  const remove = async () => {
    await api.smartListDelete(smart.id);
    await queryClient.invalidateQueries({ queryKey: ["smart-lists"] });
    void navigate({ to: "/smart" });
  };
  return (
    <>
      <LibraryView
        key={`smart:${smart.id}:${JSON.stringify(smart.query)}`}
        viewKey={`smart:${smart.id}`}
        base={smart.query}
        title={smart.name}
        eyebrow={
          <Link to="/smart" className="crumbs">
            Smart lists
          </Link>
        }
        description={describeRules(smart.query, (k) => categories.data?.find((c) => c.key === k)?.name, (t) => tags.data?.find((x) => x.id === t)?.name)}
        icon={<ListFilter size={26} strokeWidth={2.2} aria-hidden />}
        handler={smart.query.category ? categories.data?.find((c) => c.key === smart.query.category)?.handler : undefined}
        actions={
          <>
            <button type="button" className="btn" onClick={() => setEditing(true)}>
              <Pencil size={15} /> Edit rules
            </button>
            <button type="button" className="btn btn-danger" onClick={() => void remove()} title="Deletes the list only; its items stay where they are">
              <Trash size={15} /> Delete list
            </button>
          </>
        }
        empty={<div className="empty"><p>Nothing matches these rules right now. It fills itself as your library changes.</p></div>}
      />
      <SmartListDialog list={smart} open={editing} onOpenChange={setEditing} />
    </>
  );
}

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Marquee } from "../../components/Marquee";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { Award, BadgeCheck, BookOpen, Camera, Clapperboard, Copy, Download, Flame, Gamepad2, Headphones, ImagePlus, LibraryBig, Pencil, Share2, Star, Trash, Trophy, Move, RotateCcw } from "lucide-react";
import { api, artworkUrl, errorText, type ArcadeGame, type ProfileLevel, type ProfileView } from "../../lib/api";
import { usePreferences } from "../../lib/preferences";
import { CategoryIcon, Cover, Dialog, Field } from "../../components/common";
import { BackButton } from "../../components/BackButton";
import { FILTER_LABELS, GameCover, gameAspect } from "../arcade/shared";
import { LogoMark } from "../arcade/logos";
import { hours, PROFILE_KEY, sinceLabel, useProfile, useProfileExtras, useProfileSummary, type ProfileSummary } from "./data";
import { drawShareCard } from "./shareCard";
import { DEFAULT_VIEW, PictureAdjuster, ProfileAvatar, ProfileBanner } from "./Picture";

/**
 * `/profile` (D-149): your own page in Digitify, on this computer and with no account. A banner and
 * a picture of your choosing, your name and a line about you, then what your library says about
 * you: how much it holds, how much you've played and completed, this year's time per activity, your
 * most played and completed games, your categories and your achievements. Everything arrives with a
 * little motion (none when motion is off). "Share as image" draws it all on one picture to send.
 */
export function ProfilePage() {
  const profile = useProfile();
  const summary = useProfileSummary();
  const extras = useProfileExtras();
  const [editing, setEditing] = useState(false);
  const [sharing, setSharing] = useState(false);
  const name = profile.data?.name || "My Digitify";
  return (
    <div className="page profile-page">
      <BackButton />
      <header className="profile-hero">
        <div className="profile-banner" aria-hidden>
          <ProfileBanner profile={profile.data} />
        </div>
        <div className="profile-hero-body">
          <ProfileAvatar profile={profile.data} size={152} ring />
          <div className="profile-identity">
            <h1 className="display">{name}</h1>
            {profile.data?.motto ? <p className="profile-motto">{profile.data.motto}</p> : <p className="profile-motto muted">Add a line about yourself in Edit profile.</p>}
            <div className="profile-chips">
              {sinceLabel(summary?.since ?? null) && <span className="profile-chip">Collecting since {sinceLabel(summary!.since)}</span>}
              {summary && summary.streak > 0 && (
                <span className="profile-chip">
                  <Flame size={14} /> {summary.streak}-day streak
                </span>
              )}
              {summary && (
                <span className="profile-chip">
                  <Award size={14} /> {summary.reached.length} of {summary.achievements.length} achievements
                </span>
              )}
            </div>
            {extras.data && <LevelBar level={extras.data.level} />}
          </div>
          <div className="profile-actions">
            <button type="button" className="btn" onClick={() => setEditing(true)}>
              <Pencil size={16} /> Edit profile
            </button>
            <button type="button" className="btn btn-primary" disabled={!summary || !profile.data} onClick={() => setSharing(true)}>
              <Share2 size={16} /> Share as image
            </button>
          </div>
        </div>
      </header>

      {summary ? <ProfileBody summary={summary} /> : <p className="muted profile-loading">Gathering your figures…</p>}

      {editing && <ProfileEditor onClose={() => setEditing(false)} />}
      {sharing && profile.data && summary && <ShareDialog onClose={() => setSharing(false)} />}
    </div>
  );
}

/** A number that counts up to its value as it arrives (at once when motion is off). */
function useCountUp(target: number, duration = 900): number {
  const { preferences } = usePreferences();
  const still = preferences.motion === "off" || preferences.motion === "reduced" || preferences.lightMode;
  const [value, setValue] = useState(still ? target : 0);
  useEffect(() => {
    if (still) {
      setValue(target);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      setValue(Math.round(target * (1 - Math.pow(1 - t, 3))));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, duration, still]);
  return value;
}

function Figure({ icon, value, unit, label, index }: { icon: ReactNode; value: number; unit?: string; label: string; index: number }) {
  const shown = useCountUp(value);
  return (
    <div className="profile-figure" style={{ ["--i" as string]: index }}>
      <span className="profile-figure-icon" aria-hidden>
        {icon}
      </span>
      <strong>
        {shown.toLocaleString()}
        {unit && <small>{unit}</small>}
      </strong>
      <span>{label}</span>
    </div>
  );
}

function ProfileBody({ summary }: { summary: ProfileSummary }) {
  const yearTotal = summary.read + summary.watch + summary.listen + summary.play;
  const activities: [string, number, ReactNode, string][] = [
    ["Read", summary.read, <BookOpen size={16} key="r" />, "#f2b33d"],
    ["Watched", summary.watch, <Clapperboard size={16} key="w" />, "#e5484d"],
    ["Listened", summary.listen, <Headphones size={16} key="l" />, "#30a46c"],
    ["Played", summary.play, <Gamepad2 size={16} key="p" />, "var(--accent-bright)"],
  ];
  const most = Math.max(1, ...activities.map(([, s]) => s));
  const playedHours = Math.round(summary.played / 3600);
  return (
    <div className="profile-body">
      <section className="profile-figures" aria-label="At a glance">
        <Figure index={0} icon={<LibraryBig size={20} />} value={summary.items} label="In your library" />
        <Figure index={1} icon={<Gamepad2 size={20} />} value={summary.games} label="Games in Arcade" />
        <Figure index={2} icon={<Clapperboard size={20} />} value={playedHours} unit="h" label="Played in Arcade" />
        <Figure index={3} icon={<BadgeCheck size={20} />} value={summary.completed.length} label="Games completed" />
        <Figure index={4} icon={<Trophy size={20} />} value={summary.reached.length} label="Achievements" />
        <Figure index={5} icon={<Flame size={20} />} value={summary.bestStreak} unit={summary.bestStreak === 1 ? "day" : "days"} label="Best streak" />
      </section>

      <div className="profile-columns">
        <section className="panel profile-section" style={{ ["--i" as string]: 1 }}>
          <h2>{summary.year} so far</h2>
          <p className="muted">{yearTotal > 0 ? `${hours(yearTotal)} with your library this year, and ${summary.finishedYear.toLocaleString()} finished.` : "Your time with the library this year shows here."}</p>
          <ul className="profile-bars">
            {activities.map(([label, seconds, icon, color]) => (
              <li key={label}>
                <span className="profile-bar-label">
                  {icon} {label}
                </span>
                <span className="profile-bar-track">
                  <span style={{ width: `${(seconds / most) * 100}%`, background: color }} />
                </span>
                <span className="profile-bar-value">{hours(seconds)}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel profile-section" style={{ ["--i" as string]: 2 }}>
          <h2>Your library</h2>
          {summary.categories.length === 0 ? (
            <p className="muted">Nothing in your library yet.</p>
          ) : (
            <ul className="profile-categories">
              {summary.categories.map(({ category, count }) => (
                <li key={category.key}>
                  <Link to="/library/$scope" params={{ scope: category.key }}>
                    <CategoryIcon icon={category.icon} size={18} />
                    <strong>{count.toLocaleString()}</strong>
                    <span>{category.name}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {summary.topArtists.length > 0 && (
            <>
              <h3>Most played artists this year</h3>
              <p className="profile-artists">{summary.topArtists.map((a) => a.name).join(" · ")}</p>
            </>
          )}
        </section>
      </div>

      <GameShelf title="Most played" empty="Play a game from Arcade and it shows here." games={summary.topGames} detail={(g) => hours(g.playSeconds)} index={3} />
      <GameShelf
        title="Completed"
        empty="Mark a game as completed from its panel in Arcade, and it shows here."
        games={summary.completed.slice(0, 10)}
        detail={(g) => new Date(g.completedAt!).toLocaleDateString(undefined, { dateStyle: "medium" })}
        index={4}
      />

      <ProfileExtrasSections />

      <section className="panel profile-section" style={{ ["--i" as string]: 5 }}>
        <div className="profile-section-head">
          <h2>Achievements</h2>
          <Link to="/achievements" className="btn btn-sm">
            See all
          </Link>
        </div>
        <span className="profile-achievement-meter" role="progressbar" aria-valuenow={summary.reached.length} aria-valuemin={0} aria-valuemax={summary.achievements.length} aria-label="Achievements reached">
          <span style={{ width: `${(summary.reached.length / Math.max(1, summary.achievements.length)) * 100}%` }} />
        </span>
        {summary.reached.length === 0 ? (
          <p className="muted">They come by themselves as you read, watch, listen and play.</p>
        ) : (
          <ul className="profile-medals">
            {summary.reached.slice(0, 12).map((a) => (
              <li key={a.key} title={a.description}>
                <span className="achievement-medal" aria-hidden>
                  <Award size={20} />
                </span>
                <strong>{a.title}</strong>
                <span>{new Date(a.unlockedAt!).toLocaleDateString(undefined, { dateStyle: "medium" })}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function GameShelf({ title, empty, games, detail, index }: { title: string; empty: string; games: ArcadeGame[]; detail: (game: ArcadeGame) => string; index: number }) {
  return (
    <section className="panel profile-section" style={{ ["--i" as string]: index }}>
      <h2>{title}</h2>
      {games.length === 0 ? (
        <p className="muted">{empty}</p>
      ) : (
        <ul className="profile-shelf">
          {games.map((game, n) => (
            <li key={game.id} style={{ ["--n" as string]: n, width: Math.round(150 * gameAspect(game)) }}>
              <Link to="/arcade" search={{ game: game.id }} className="profile-shelf-art" aria-label={game.title}>
                <GameCover game={game} />
              </Link>
              <strong>
                <Marquee text={game.title} />
              </strong>
              <span>{detail(game)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Editing it

function ProfileEditor({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const profile = useProfile();
  const [name, setName] = useState(profile.data?.name ?? "");
  const [motto, setMotto] = useState(profile.data?.motto ?? "");
  const [choosing, setChoosing] = useState<"avatar" | "banner" | null>(null);
  const [adjusting, setAdjusting] = useState<"avatar" | "banner" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: PROFILE_KEY });
  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
      await refresh();
    } catch (reason) {
      setError(errorText(reason));
    }
  };
  const pick = (kind: "avatar" | "banner") =>
    run(async () => {
      const path = await openDialog({ multiple: false, title: kind === "avatar" ? "Choose your picture" : "Choose your banner", filters: [{ name: "Pictures", extensions: ["jpg", "jpeg", "png", "webp", "bmp", "gif"] }] });
      if (typeof path === "string") await api.profileSetImage(kind, { path });
    });
  const save = () =>
    run(async () => {
      await api.profileSetText(name, motto);
      onClose();
    });
  const part = (kind: "avatar" | "banner", label: string, hint: string) => {
    const picture = kind === "avatar" ? profile.data?.avatar : profile.data?.banner;
    return (
      <div className="field profile-edit-part">
        <span>{label}</span>
        <div className="profile-edit-row">
          {kind === "avatar" ? (
            <ProfileAvatar profile={profile.data && { ...profile.data, name: name || "My Digitify" }} size={72} ring />
          ) : (
            <span className="profile-edit-banner">
              <ProfileBanner profile={profile.data} />
            </span>
          )}
          <div className="profile-edit-buttons">
            {picture && (
              <button type="button" className="btn btn-sm" onClick={() => setAdjusting(kind)}>
                <Move size={15} /> Adjust…
              </button>
            )}
            <button type="button" className="btn btn-sm" onClick={() => void pick(kind)}>
              <Camera size={15} /> Choose a picture…
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setChoosing(kind)}>
              <ImagePlus size={15} /> Use a cover…
            </button>
            {picture && (
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => void run(() => api.profileClearImage(kind))}>
                <Trash size={15} /> Remove
              </button>
            )}
          </div>
        </div>
        <small className="hint">{hint}</small>
      </div>
    );
  };
  return (
    <Dialog
      open
      wide
      onOpenChange={(open) => !open && onClose()}
      title="Edit profile"
      description="Kept on this computer only. Your profile has no account and goes nowhere unless you share its picture."
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="profile-form" className="btn btn-primary">
            Save
          </button>
        </>
      }
    >
      <form
        id="profile-form"
        className="profile-form"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <Field label="Name">
          <input className="input" autoFocus value={name} maxLength={40} placeholder="My Digitify" onChange={(event) => setName(event.target.value)} />
        </Field>
        <Field label="A line about you">
          <input className="input" value={motto} maxLength={120} placeholder="Collector of everything I love" onChange={(event) => setMotto(event.target.value)} />
        </Field>
        {part("avatar", "Picture", "Adjust moves and zooms it in its frame.")}
        <div className="field profile-edit-part">
          <span>Frame</span>
          <div className="profile-frame-row">
            <div className="segmented" role="group" aria-label="Frame shape">
              {(
                [
                  ["circle", "Circle"],
                  ["rounded", "Rounded"],
                  ["hexagon", "Hexagon"],
                ] as const
              ).map(([value, label]) => (
                <button key={value} type="button" aria-pressed={(profile.data?.shape ?? "circle") === value} onClick={() => void run(() => api.profileSetFrame(value, profile.data?.ring ?? "rainbow"))}>
                  {label}
                </button>
              ))}
            </div>
            <div className="segmented" role="group" aria-label="Ring">
              {(
                [
                  ["rainbow", "Rainbow"],
                  ["accent", "Accent"],
                  ["gold", "Gold"],
                  ["none", "No ring"],
                ] as const
              ).map(([value, label]) => (
                <button key={value} type="button" aria-pressed={(profile.data?.ring ?? "rainbow") === value} onClick={() => void run(() => api.profileSetFrame(profile.data?.shape ?? "circle", value))}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
        {part("banner", "Banner", "Shown across the top, wide; Adjust chooses which part and how close.")}
        {error && <div className="dialog-error">{error}</div>}
      </form>
      {adjusting && profile.data && (
        <AdjustDialog
          kind={adjusting}
          onClose={() => setAdjusting(null)}
          onSave={(view) =>
            void run(async () => {
              await api.profileSetView(adjusting, view);
              setAdjusting(null);
            })
          }
        />
      )}
      {choosing && (
        <CoverChooser
          kind={choosing}
          onClose={() => setChoosing(null)}
          onChosen={(key) =>
            void run(async () => {
              await api.profileSetImage(choosing, { artwork: key });
              setChoosing(null);
            })
          }
        />
      )}
    </Dialog>
  );
}

/** Moving a picture in its frame (D-150), with a live preview; Save keeps it. */
/** The level (D-183): its number, the XP into it and what the next takes; what earned it on hover. */
export function LevelBar({ level: l }: { level: ProfileLevel }) {
  const why = `${l.xp.toLocaleString()} XP: ${l.time.toLocaleString()} from time, ${l.finished.toLocaleString()} from finishing, ${l.achievements.toLocaleString()} from achievements, ${l.ratings.toLocaleString()} from ratings`;
  return (
    <div className="profile-level" title={why}>
      <span className="profile-level-badge">
        Level {l.level}
      </span>
      <span className="profile-level-track" role="progressbar" aria-valuenow={l.into} aria-valuemin={0} aria-valuemax={l.step} aria-label={`Level ${l.level}: ${l.into} of ${l.step} XP to the next`}>
        <span style={{ width: `${(l.into / Math.max(1, l.step)) * 100}%` }} />
      </span>
      <span className="profile-level-xp">
        {l.into.toLocaleString()} / {l.step.toLocaleString()} XP
      </span>
    </div>
  );
}

/** Consoles and launchers in use, everything rated, and the songs played most (D-183). */
function ProfileExtrasSections() {
  const extras = useProfileExtras();
  const status = useQuery({ queryKey: ["arcade-status"], queryFn: api.arcadeStatus });
  const games = useQuery({ queryKey: ["arcade-games"], queryFn: api.arcadeGames });
  const [allRatings, setAllRatings] = useState(false);
  const launchers = (status.data?.stores ?? []).filter((s) => s.found);
  const emulators = (status.data?.emulators ?? []).filter((e) => e.found && !e.ignored);
  const consoles = [...new Set((games.data ?? []).filter((g) => !g.missing && g.platform !== "pc").map((g) => g.platform))];
  const ratings = extras.data?.ratings ?? [];
  const tracks = extras.data?.topTracks ?? [];
  return (
    <>
      <div className="profile-columns">
        <section className="panel profile-section" style={{ ["--i" as string]: 5 }}>
          <h2>Consoles &amp; launchers</h2>
          {launchers.length + consoles.length + emulators.length === 0 ? (
            <p className="muted">Arcade shows here the stores, emulators and consoles it finds.</p>
          ) : (
            <>
              {launchers.length > 0 && <h3>Launchers</h3>}
              <ul className="profile-systems">
                {launchers.map((s) => (
                  <li key={s.key}>
                    <LogoMark name={s.key} className="setup-logo" /> {s.name}
                    <span className="muted">{s.games.toLocaleString()}</span>
                  </li>
                ))}
              </ul>
              {consoles.length > 0 && <h3>Consoles</h3>}
              <ul className="profile-systems">
                {consoles.map((c) => (
                  <li key={c}>
                    <LogoMark name={c} className="setup-logo" /> {FILTER_LABELS[c as keyof typeof FILTER_LABELS] ?? c}
                    <span className="muted">{(games.data ?? []).filter((g) => !g.missing && g.platform === c).length.toLocaleString()}</span>
                  </li>
                ))}
              </ul>
              {emulators.length > 0 && <h3>Emulators</h3>}
              <ul className="profile-systems">
                {emulators.map((e) => (
                  <li key={e.key}>{e.name}</li>
                ))}
              </ul>
            </>
          )}
        </section>
        <section className="panel profile-section" style={{ ["--i" as string]: 6 }}>
          <h2>Most listened</h2>
          {tracks.length === 0 ? (
            <p className="muted">Play some music and your favourite songs show here.</p>
          ) : (
            <ol className="profile-tracks">
              {tracks.map((t, i) => (
                <li key={t.id}>
                  <span className="profile-track-rank">{i + 1}</span>
                  <span className="profile-track-art">
                    <Cover item={{ title: t.title, coverKey: t.coverKey, handler: "audio" }} iconOnly />
                  </span>
                  <span className="profile-track-text">
                    <Link to="/item/$id" params={{ id: String(t.id) }}>
                      <Marquee hover text={t.title} />
                    </Link>
                    <span className="muted">{t.artist ?? ""}</span>
                  </span>
                  <span className="muted">{t.plays === 1 ? "1 play" : `${t.plays} plays`}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
      <section className="panel profile-section" style={{ ["--i" as string]: 7 }}>
        <div className="profile-section-head">
          <h2>Your ratings</h2>
          {ratings.length > 12 && (
            <button type="button" className="btn btn-sm" onClick={() => setAllRatings(!allRatings)}>
              {allRatings ? "Show fewer" : `Show all ${ratings.length}`}
            </button>
          )}
        </div>
        {ratings.length === 0 ? (
          <p className="muted">Give a book, film, song or game your stars from its page or panel, and it shows here.</p>
        ) : (
          <ul className="profile-ratings">
            {(allRatings ? ratings : ratings.slice(0, 12)).map((r) => (
              <li key={`${r.kind}-${r.id}`}>
                <Link to={r.kind === "game" ? "/arcade" : "/item/$id"} params={r.kind === "game" ? undefined : { id: String(r.id) }} search={r.kind === "game" ? { game: r.id } : undefined} className="profile-rating">
                  <span className="profile-rating-art">
                    <Cover item={{ title: r.title, coverKey: r.coverKey, handler: r.kind === "game" ? "generic" : "book" }} iconOnly />
                  </span>
                  <span className="profile-rating-text">
                    <Marquee hover text={r.title} />
                    <span className="muted">{r.kind === "game" ? (FILTER_LABELS[r.place as keyof typeof FILTER_LABELS] ?? r.place) : r.place}</span>
                  </span>
                  <span className="profile-rating-stars" aria-label={`${r.rating} of 5 stars`}>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <Star key={n} size={14} fill={n <= r.rating ? "currentColor" : "none"} aria-hidden />
                    ))}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function AdjustDialog({ kind, onClose, onSave }: { kind: "avatar" | "banner"; onClose: () => void; onSave: (view: ProfileView) => void }) {
  const profile = useProfile();
  const picture = kind === "avatar" ? profile.data?.avatar : profile.data?.banner;
  const [view, setView] = useState<ProfileView>((kind === "avatar" ? profile.data?.avatarView : profile.data?.bannerView) ?? DEFAULT_VIEW);
  if (!picture) return null;
  return (
    <Dialog
      open
      wide
      onOpenChange={(open) => !open && onClose()}
      title={kind === "avatar" ? "Adjust your picture" : "Adjust your banner"}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={() => setView(DEFAULT_VIEW)}>
            <RotateCcw size={15} /> Reset
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={() => onSave(view)}>
            Save
          </button>
        </>
      }
    >
      <PictureAdjuster picture={picture} view={view} onChange={setView} kind={kind} shape={profile.data?.shape} />
    </Dialog>
  );
}

/** Covers from Arcade and the library, to use as the picture or the banner: each whole, all one height (D-150). */
function CoverChooser({ kind, onClose, onChosen }: { kind: "avatar" | "banner"; onClose: () => void; onChosen: (key: string) => void }) {
  const games = useQuery({ queryKey: ["arcade-games"], queryFn: api.arcadeGames });
  const items = useQuery({ queryKey: ["profile-covers"], queryFn: () => api.query({ sort: "added", offset: 0, limit: 80 }) });
  const covers = useMemo(() => {
    const seen = new Set<string>();
    const out: { key: string; title: string }[] = [];
    for (const g of games.data ?? []) if (g.coverKey && !g.missing && !seen.has(g.coverKey)) seen.add(g.coverKey) && out.push({ key: g.coverKey, title: g.title });
    for (const i of items.data?.items ?? []) if (i.coverKey && !seen.has(i.coverKey)) seen.add(i.coverKey) && out.push({ key: i.coverKey, title: i.title });
    return out;
  }, [games.data, items.data]);
  return (
    <Dialog open wide onOpenChange={(open) => !open && onClose()} title={kind === "avatar" ? "A cover as your picture" : "A cover as your banner"} description="From your games and your library.">
      {covers.length === 0 ? (
        <p className="muted">No covers yet.</p>
      ) : (
        <div className="profile-cover-grid">
          {covers.map((c) => (
            <button key={c.key} type="button" className="profile-cover-choice" title={c.title} onClick={() => onChosen(c.key)}>
              <img src={artworkUrl(c.key, "thumb")} alt={c.title} loading="lazy" onLoad={(event) => event.currentTarget.parentElement?.style.setProperty("--a", String(event.currentTarget.naturalWidth / event.currentTarget.naturalHeight))} />
            </button>
          ))}
        </div>
      )}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------------------------
// Sharing it

function ShareDialog({ onClose }: { onClose: () => void }) {
  const profile = useProfile();
  const summary = useProfileSummary();
  const extras = useProfileExtras();
  const [card, setCard] = useState<{ blob: Blob; url: string } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const made = useRef(false);
  useEffect(() => {
    if (made.current || !profile.data || !summary || extras.isLoading) return;
    made.current = true;
    drawShareCard(profile.data, summary, extras.data ?? null).then(
      (blob) => setCard({ blob, url: URL.createObjectURL(blob) }),
      (reason) => setNote(errorText(reason)),
    );
  }, [profile.data, summary, extras.isLoading, extras.data]);
  useEffect(
    () => () => {
      if (card) URL.revokeObjectURL(card.url);
    },
    [card],
  );
  const save = async () => {
    if (!card) return;
    const path = await saveDialog({ title: "Save your profile picture", defaultPath: `${(profile.data?.name || "My Digitify").replace(/[\\/:*?"<>|]/g, "")} · Digitify.png`, filters: [{ name: "PNG picture", extensions: ["png"] }] });
    if (!path) return;
    try {
      await api.profileSavePng(path.toLowerCase().endsWith(".png") ? path : `${path}.png`, new Uint8Array(await card.blob.arrayBuffer()));
      setNote("Saved. Send it to anyone: it's just a picture.");
    } catch (reason) {
      setNote(errorText(reason));
    }
  };
  const copy = async () => {
    if (!card) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": card.blob })]);
      setNote("Copied: paste it in any chat or email.");
    } catch {
      setNote("Copying didn't work here; save it instead.");
    }
  };
  return (
    <Dialog
      open
      wide
      onOpenChange={(open) => !open && onClose()}
      title="Share as image"
      description="A picture of your profile, made on this computer. It holds no account and no link: just the picture."
      footer={
        <>
          {note && <span className="profile-share-note">{note}</span>}
          <button type="button" className="btn" disabled={!card} onClick={() => void copy()}>
            <Copy size={16} /> Copy
          </button>
          <button type="button" className="btn btn-primary" disabled={!card} onClick={() => void save()}>
            <Download size={16} /> Save PNG…
          </button>
        </>
      }
    >
      <div className="profile-share-preview">{card ? <img src={card.url} alt="Your profile as a picture" /> : <span className="muted">Drawing your card…</span>}</div>
    </Dialog>
  );
}

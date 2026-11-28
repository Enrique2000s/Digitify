import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type Achievement, type ArcadeGame, type Category } from "../../lib/api";
import { useCategories } from "../../lib/queries";
import { useAchievements } from "../home/YearViews";

/**
 * The personal profile's figures (D-149), gathered from what the app already knows: the library's
 * categories, Arcade's games (play time, completed ones), this year's time per activity, the
 * streaks, and the achievements. Shared by the profile page, its share card and Big Picture.
 */

export const PROFILE_KEY = ["profile"];

/** Level, ratings and most played songs (D-183). */
export function useProfileExtras() {
  return useQuery({ queryKey: ["profile-extras"], queryFn: api.profileExtras, staleTime: 30_000 });
}

export function useProfile() {
  return useQuery({ queryKey: PROFILE_KEY, queryFn: api.profile, staleTime: Infinity });
}

export interface ProfileSummary {
  year: number;
  /** Items in the library, and per category. */
  items: number;
  categories: { category: Category; count: number }[];
  games: number;
  /** Seconds played in Arcade, all time. */
  played: number;
  completed: ArcadeGame[];
  topGames: ArcadeGame[];
  /** This year's seconds per activity. */
  read: number;
  watch: number;
  listen: number;
  play: number;
  finishedYear: number;
  streak: number;
  bestStreak: number;
  since: string | null;
  achievements: Achievement[];
  reached: Achievement[];
  topArtists: { name: string; count: number }[];
}

export function useProfileSummary(): ProfileSummary | null {
  const year = new Date().getFullYear();
  const categories = useCategories();
  const games = useQuery({ queryKey: ["arcade-games"], queryFn: api.arcadeGames });
  const stats = useQuery({ queryKey: ["stats"], queryFn: api.stats, staleTime: 60_000 });
  const review = useQuery({ queryKey: ["year-review", year], queryFn: () => api.yearReview(year) });
  const achievements = useAchievements();
  return useMemo(() => {
    if (!categories.data || !games.data || !stats.data || !review.data || !achievements.data) return null;
    const shown = categories.data.filter((c) => !c.isHidden);
    const playable = games.data.filter((g) => !g.missing);
    const reached = achievements.data.filter((a) => a.unlockedAt).sort((a, b) => (b.unlockedAt ?? "").localeCompare(a.unlockedAt ?? ""));
    return {
      year,
      items: shown.reduce((sum, c) => sum + c.itemCount, 0),
      categories: shown.map((category) => ({ category, count: category.itemCount })).filter((c) => c.count > 0),
      games: playable.length,
      played: playable.reduce((sum, g) => sum + g.playSeconds, 0),
      completed: playable.filter((g) => g.completedAt).sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? "")),
      topGames: playable.filter((g) => g.playSeconds > 0).sort((a, b) => b.playSeconds - a.playSeconds).slice(0, 6),
      read: review.data.read,
      watch: review.data.watch,
      listen: review.data.listen,
      play: review.data.play,
      finishedYear: review.data.finished,
      streak: stats.data.streak,
      bestStreak: stats.data.bestStreak,
      since: stats.data.since,
      achievements: achievements.data,
      reached,
      topArtists: review.data.topArtists.slice(0, 5),
    };
  }, [year, categories.data, games.data, stats.data, review.data, achievements.data]);
}

/** "128 h", "45 min", "< 1 min", "0 h": hours from an hour on, rounded. */
export function hours(seconds: number): string {
  if (seconds >= 3600) return `${Math.round(seconds / 3600).toLocaleString()} h`;
  if (seconds >= 60) return `${Math.round(seconds / 60)} min`;
  return seconds > 0 ? "< 1 min" : "0 h";
}

/** The month and year the library's activity begins: "March 2025". */
export function sinceLabel(since: string | null): string | null {
  if (!since) return null;
  const date = new Date(since);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

/** The initials shown where there's no picture. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[words.length - 1][0] : (words[0] ?? "").slice(0, 2)).toUpperCase();
}

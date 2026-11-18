/**
 * What's new in each version (D-081), newest first, written for the people using Digitify: what
 * they'll notice, not how it was built. Add an entry with every version that goes out.
 */
export interface ReleaseNote {
  version: string;
  /** ISO date of the release. */
  date: string;
  added: { icon: string; title: string; text: string }[];
  fixed: string[];
}

export const RELEASE_NOTES: ReleaseNote[] = [
  {
    version: "0.3.0",
    date: "2026-11-18",
    added: [
      { icon: "gamepad", title: "Games you start anywhere", text: "Open a game from its own launcher or a shortcut, before or after Digitify, and Arcade shows it playing and counts its time." },
      { icon: "monitor", title: "Stays by the clock", text: "Closing the window now keeps Digitify running quietly in the tray. Hold the X for a moment to quit it outright; a ring fills while you hold." },
      { icon: "search", title: "Every place in Ctrl+K", text: "With nothing typed, it lists every category, Arcade and the rest of the app." },
    ],
    fixed: [
      "Big Picture's cursor shows above its menus and pop-ups.",
      "Home's category tiles stay centered when Everything is off.",
    ],
  },
  {
    version: "0.2.0",
    date: "2026-11-18",
    added: [
      { icon: "gamepad", title: "Big Picture feels like a console", text: "It opens with its own startup and sound. Videos, books, comics and photos wear its look: press A for the controls and move between them with the D-pad." },
      { icon: "music", title: "Now playing", text: "Music has a page of its own, in the app and in Big Picture: the cover big, the controls, and a queue you can reorder." },
      { icon: "image", title: "Photos side by side", text: "Pictures line up at one height in every view, each one whole, in neat full rows." },
      { icon: "library", title: "A tidier Library", text: "Library opens where you left it, and everything stays in its own category. Everything is still there if you want it, in Settings › Library." },
      { icon: "search", title: "Find anything with Ctrl+K", text: "Jump to any item, game, section or setting from the keyboard." },
      { icon: "bookmark", title: "Keep track of what you love", text: "Rate things and add notes, save them for Later, make smart lists that fill themselves, bookmark moments in videos, and see what's like the things you rated well." },
      { icon: "chart", title: "Your stats", text: "Monthly goals, a streak, a calendar of your year, achievements, and a look back at your whole year." },
      { icon: "monitor", title: "Around your desktop", text: "Media keys, an icon by the clock, folders that import new files by themselves, a sleep timer, a warm night filter for reading, and an offer to continue where you left off." },
      { icon: "shield", title: "Safe and simple", text: "Automatic backups to another drive, a check for missing files and duplicates, only one Digitify open at a time, and a question before closing it." },
    ],
    fixed: [
      "Games installed with the new Epic Games launcher show up in Arcade again.",
      "Photos of different shapes no longer come out at different heights.",
      "Music no longer keeps playing while Digitify waits in the tray.",
      "Ctrl+K now opens the command palette everywhere.",
    ],
  },
];

/** -1, 0 or 1, comparing "1.2.3" versions. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

/** The notes for what came after `seen`, up to `current`, newest first. */
export function notesSince(seen: string | null, current: string): ReleaseNote[] {
  return RELEASE_NOTES.filter((n) => compareVersions(n.version, current) <= 0 && (!seen || compareVersions(n.version, seen) > 0));
}

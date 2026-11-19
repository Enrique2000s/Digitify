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
    version: "0.6.1",
    date: "2026-11-19",
    added: [],
    fixed: ["Arcade's arrows beside the views stay in place when pressed, and every click moves the views, quick ones too."],
  },
  {
    version: "0.6.0",
    date: "2026-11-18",
    added: [
      { icon: "search", title: "One search for everything", text: "Search your collection opens its own screen: your media, then Arcade's games, each in a grid you scroll down, with a filter to see one or both." },
      { icon: "gamepad", title: "More emulators", text: "Arcade plays NES, Super Nintendo, Game Boy, Mega Drive, Sega CD, PC Engine and Dreamcast games (zipped too) in Mesen, FCEUX, Nestopia, Snes9x, ZSNES, mGBA, Kega Fusion, nullDC or ares." },
      { icon: "gamepad", title: "More launchers", text: "Arcade finds the games of Ubisoft Connect, the EA app, Battle.net, Amazon Games, itch.io and, on Linux, Lutris." },
      { icon: "monitor", title: "Emulators & folders in tabs", text: "Launchers, Emulators by maker, Consoles (which emulator plays each console) and Folders & covers." },
      { icon: "gamepad", title: "Add any game", text: "Add a game… in Arcade adds a PC game by its program, for games no store here installed; they have their own Others view." },
      { icon: "image", title: "Find missing covers", text: "Emulators & folders looks for a cover for every game without one, in one go." },
      { icon: "gamepad", title: "PlayStation, Nintendo DS, RetroArch and GOG in Arcade", text: "Arcade finds PlayStation games for DuckStation, PlayStation 2 for PCSX2, PlayStation 3 for RPCS3 and Nintendo DS for melonDS or DeSmuME, the games in RetroArch's playlists (each console in its own view, started with its core), and GOG's installed games." },
      { icon: "gamepad", title: "Logos and counts in Arcade", text: "Each game's badge shows its store's or console's symbol beside its name, every view says how many games it holds, and a store or console shows only once it has a game." },
      { icon: "monitor", title: "Every emulator in Emulators & folders", text: "The emulators found show their folders; the others Arcade knows are listed with what they play, to install or point to." },
      { icon: "chart", title: "Achievements on Home", text: "An Achievements button sits beside Customize Home." },
      { icon: "library", title: "Tidier tabs", text: "Music's tabs go Tracks, Playlists, Artists, Recently played and Favorites, with the same star as everywhere; the All / Digital / Online filter shows only where there's online media, in Music and Videos." },
    ],
    fixed: [
      "Library's tabs, filter and layout buttons sit on one line, at one height.",
      "A category opens on its Media (Music on Tracks) every time you come back to it.",
      "With many consoles, Arcade's views scroll in one row instead of running off the page.",
      "Changing category no longer makes the buttons jump: they slide to their places.",
      "Switching between Grid, Shelf, List, Detailed and Carousel is smooth: covers fly to their new places without flicker.",
    ],
  },
  {
    version: "0.5.0",
    date: "2026-11-18",
    added: [
      { icon: "library", title: "Tabs in every category", text: "Each category has Media, Collections and Favorites as tabs, beside All, Digital and Online; Music keeps its own tabs in the same place. Collections no longer mix in with everything else." },
      { icon: "music", title: "Music uses playlists", text: "Music has no collections anymore: any you had became playlists with the same songs." },
      { icon: "image", title: "Simpler Pictures", text: "Pictures shows just its tabs, without the All and Digital filter it didn't need." },
    ],
    fixed: [],
  },
  {
    version: "0.4.0",
    date: "2026-11-18",
    added: [
      { icon: "library", title: "Collections are folders", text: "A collection opens in its own window over its category, with Rename and Delete. They're one level now: collections that were inside another moved up beside it, with all their items." },
      { icon: "music", title: "Next follows the list", text: "Play a song from Library and the rest of the list comes after it. In Videos, next and previous go through the videos in the order you see them." },
      { icon: "chart", title: "Achievements screen", text: "See every achievement, its levels and the day you reached each one, from Statistics on Home (or Ctrl+K)." },
      { icon: "shield", title: "Less clutter", text: "Tags and Later are gone, so Library keeps to categories, collections, favorites and smart lists." },
    ],
    fixed: [],
  },
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

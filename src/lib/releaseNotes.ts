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
    version: "0.7.1",
    date: "2026-11-19",
    added: [
      { icon: "image", title: "Find covers by another name", text: "Find covers has a search box with the game's name: change it to the game's full or original title and search again when the covers aren't right." },
      { icon: "download", title: "Playlists a section at a time", text: "A long playlist or channel comes in 25 at a time, never all at once; come back with the same link for the next. Its videos go into a collection and its songs into a playlist, which the next sections join." },
      { icon: "monitor", title: "Dark by default", text: "Digitify starts dark the first time; light and System are in Settings › Appearance." },
      { icon: "image", title: "Covers by a game's other names", text: "With LaunchBox's database, a game known by another name (Animal Forest is Doubutsu no Mori) finds its covers in more places." },
      { icon: "gamepad", title: "Look for games, with the folders", text: "Look for games is in Emulators & folders › Folders & covers now, beside the folders it looks in." },
    ],
    fixed: [
      "Dragging the corner video quickly no longer shows the desktop through the window for a moment.",
      "A link's list of videos no longer shrinks to one line when the download options are open.",
    ],
  },
  {
    version: "0.7.0",
    date: "2026-11-19",
    added: [
      { icon: "gamepad", title: "PSP, 3DS, Wii U, Xbox, Xbox 360 and Switch", text: "Arcade plays their games in PPSSPP, Azahar or Lime3DS, Cemu, xemu, Xenia and Ryujinx, Dreamcast's in Flycast too, and finds the games of the Rockstar Games Launcher and the Riot Client." },
      { icon: "image", title: "Choose among covers", text: "Find covers, in a game's panel or for the games you select, shows every cover found to pick one; with several games it goes one by one." },
      { icon: "monitor", title: "Don't use an emulator", text: "An emulator Arcade finds but you don't want used can be set aside in Emulators & folders, and used again later." },
      { icon: "gamepad", title: "Big Picture all the way", text: "A game opens its own screen with Play first, and Achievements and your year open inside Big Picture." },
      { icon: "library", title: "Symbols everywhere", text: "Stores and consoles show their symbols, sharp and uncut, on the badges and beside their names in Emulators & folders." },
      { icon: "monitor", title: "Tidier", text: "Settings comes in tabs; Arcade groups each maker's consoles in one view, a game's cover options in one menu, and keeps Add a game… in Emulators & folders (also in Settings › Arcade)." },
      { icon: "download", title: "Download from YouTube and more", text: "Music and Videos each have their own From a link, saying which sites they take: YouTube, YouTube Music, SoundCloud, Bandcamp, Twitch, Dailymotion and many more, as sound or as video in the quality and format you pick. Playlists and channels list without a key, what you saved online can be downloaded too, and downloads look like any other file. yt-dlp comes with Digitify; update it in Settings › Online services." },
      { icon: "download", title: "Downloads and imports", text: "A button in the title bar shows what's coming in from links and files, and everything that came in before, with retry for what failed; clear the history whenever you like." },
      { icon: "monitor", title: "The corner video moves", text: "Drag the small video by its bar to any corner of the window; it stays there next time." },
      { icon: "library", title: "Back on every page", text: "Each page has its own Back, and an item's page steps to the previous and next item of its list, going round at the ends. The title bar's arrows are gone." },
      { icon: "music", title: "Play opens the music player", text: "Pressing Play on a song, in Music or on a playlist opens the music player's screen, as in Big Picture; Back returns." },
      { icon: "monitor", title: "Back keeps the video playing", text: "The video player's Back leaves the video playing in a corner while you browse; Settings can make it close instead, with the corner button beside it." },
      { icon: "library", title: "Videos into Movies & Series", text: "Movies & Series › Add › From Videos makes videos you have into movies, or a series' episodes, new or added to one you have." },
      { icon: "music", title: "Music from videos", text: "Add a music video to Music and its sound comes in as an MP3 track, with a frame of the video as its cover; the video stays as it is." },
      { icon: "library", title: "Add, by category", text: "Each category's Add takes only its own kind of media and puts it there; Home and Everything ask where, and Home adds games too. Items stay in their category." },
      { icon: "image", title: "More covers to choose from", text: "LaunchBox's database (downloaded once, searched on your PC), Nintendo's store and the Microsoft Store, with no account; and SteamGridDB with your own key. All by the game's name, emulated games included." },
      { icon: "monitor", title: "Light mode by itself", text: "When the computer struggles, Digitify turns light mode on and tells you, with a way back." },
    ],
    fixed: [
      "Players' names scroll instead of ending in \"…\", and the music player's buttons and an item's arrows no longer move.",
      "Library's and Arcade's counts sit in their own little boxes; PC games added by their .exe show a monitor on their badge.",
      "Big Picture queues the songs after the one you play, and songs without a cover show the audio symbol in the title bar.",
      "Book from images is its own for Books, Comics and Manga; New collection shows on the Collections tab; New playlist sits beside Add.",
      "Big Picture's selection glow is no longer cut at the edges of a row, and shows over an online item's colored border.",
      "Achievements' cards line up, and the empty music screens look tidy.",
      "Big Picture no longer gets stuck on \"Something went wrong\" when leaving the music screen; any screen that fails now offers Back and Home.",
      "Anything that takes a moment (setting up an emulator, adding a folder, saving a cover, removing…) shows \"Working…\" with what it's doing.",
      "The online player's Back returns to the item's page without bouncing back to the player.",
      "\"Open on YouTube\" comes after Play on an item's page.",
      "The video player's previous and next pass online videos by and go round at the end of the list.",
      "A collection's window shows every cover at one height, wide videos as tall as tall ones.",
      "Big Picture's music screen opens again from a song's screen.",
      "Home's category tiles show their covers centred, in their own shapes, fanning out on hover.",
      "Epic Games' badge shows its full name; emulators show their own icons.",
    ],
  },
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

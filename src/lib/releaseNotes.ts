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
    version: "0.10.2",
    date: "2026-11-23",
    added: [],
    fixed: ["Updates keep coming from Digitify's own page on GitHub even if its address changes, and from nowhere else."],
  },
  {
    version: "0.10.1",
    date: "2026-11-23",
    added: [
      { icon: "download", title: "Updates from inside Digitify", text: "When Digitify opens it checks quietly whether there's a newer version and, if there is, offers to install it: Update, Later, or Skip this version. It downloads the right file, checks it, and installs it for you. Turn the check off, or check now, in Settings › About." },
    ],
    fixed: [],
  },
  {
    version: "0.10.0",
    date: "2026-11-22",
    added: [
      { icon: "monitor", title: "Previews on hover", text: "Hold the mouse on a video in Videos and a short silent preview plays on its cover, as on video sites; in Big Picture, the selected one plays. Each video's cover also says what kind of file it is (MP4, MKV…)." },
      { icon: "bookmark", title: "Finished at a glance", text: "A movie, series, book, comic or manga you've finished shows a small check on its cover instead of a full bar. Books, comics and manga have Mark as read, as films have Mark as watched." },
      { icon: "image", title: "GIFs in Pictures", text: "GIFs move in their previews, everywhere they show. Each picture's cover says what it is (GIF, JPG, PNG…), and on its page it keeps its own shape, as do the pictures of its album." },
      { icon: "gamepad", title: "Marks in Big Picture", text: "Mark a game completed, a movie or series watched, or a book read, from its screen in Big Picture." },
      { icon: "music", title: "Music for Settings and Big Picture", text: "Settings and Big Picture each have an original theme of their own, on the same beat as the main menu's, flowing into each other in about a second as you move. Choose each one's music in Settings › Sound: its theme, the main menu's, or your own songs." },
      { icon: "gamepad", title: "Episodes in Big Picture", text: "A series in Big Picture lists all its episodes, by season, with their pictures: pick the one to watch." },
      { icon: "library", title: "Home's tiles come alive", text: "Each category's tile on Home moves on through its newest covers, a few at a time, so it isn't always the same picture. In performance mode they change when you come back to Home." },
      { icon: "image", title: "Edit details holds it all", text: "An item's artwork, cover shape and color, and background are in Edit details now, beside its details, so its page has fewer buttons." },
      { icon: "monitor", title: "Movies & Series, wide and tagged", text: "Covers in Movies & Series are horizontal now (vertical in Settings, or per movie), each tagged Movie or Series." },
      { icon: "library", title: "Edit a series' episodes", text: "A series' Edit sets its episodes' order and pictures (always horizontal), adds episodes from files or from Videos, and takes one out, back to Videos." },
      { icon: "gamepad", title: "Citra in Arcade", text: "Arcade finds Citra, the 3DS emulator, where its installer puts it (and as a Flatpak on Linux), and plays your 3DS games in it." },
    ],
    fixed: [
      "Big Picture opens smoothly after its startup animation, without the screen flickering.",
      "Arcade's Collections and Emulators & folders come in and go out smoothly, as the other screens do (at once in performance mode or with animations off).",
      "Videos no longer show how far you watched: they always play from the start.",
      "Pictures keep their own shape in Big Picture too.",
      "In Big Picture, changing a tab in Library or Arcade brings in only what's under the tabs; Library's Collections tab comes first, as in Arcade; and a running game shows its green dot.",
      "Emulators & folders › Consoles shows the consoles as cards by maker, using the whole width, so there's no long list to scroll.",
      "A movie plays without previous and next buttons, and a series only steps through its own episodes, instead of moving on to another video.",
      "Categories made in an early version of Digitify are gone: everyone has the same fixed categories.",
      "The Digitify Manual in Books describes this version again (0.9.3 came with the one before).",
    ],
  },
  {
    version: "0.9.3",
    date: "2026-11-22",
    added: [
      { icon: "download", title: "Free and open source", text: "Digitify is free and open source under the MIT license. Settings › About links to its page on GitHub, where each new version's installers for Windows and Linux are published." },
    ],
    fixed: [
      "Under the hood: what was left of Tags, Later and cataloging physical items is gone, along with unused code and styles, so Digitify is lighter and quicker to keep up.",
      "Arcade's panel opens quicker: the stores' games are read once a minute at most, and at once when you install or remove one.",
      "The old video lab under Settings › Developer is gone; the players have long done what it tested.",
      "Tracks an hour or longer show their length as hours, minutes and seconds.",
    ],
  },
  {
    version: "0.9.2",
    date: "2026-11-21",
    added: [
      { icon: "gamepad", title: "Keywords for your games", text: "Give any game in Arcade keywords of your own from its panel, or to many at once from the selection bar. The search finds it by them, and dynamic collections count them as part of its name." },
      { icon: "library", title: "Surprise me", text: "Can't choose? Surprise me, in Arcade and in the Library, picks something you haven't finished from what you're looking at." },
      { icon: "monitor", title: "Your week", text: "Home sums up your last seven days, and Your week shows it in full: compare it with the week before and save it as a picture." },
      { icon: "gamepad", title: "All games and Completed", text: "Arcade opens on All games (switch it off in Settings › Arcade if you like), and your completed games have a collection of their own, beside Favorites." },
      { icon: "gamepad", title: "Steam's hours", text: "Bring the time Steam has recorded for your games into Arcade, from Emulators & folders › Launchers. You see it first; nothing changes until you say so." },
    ],
    fixed: [
      "Arcade's Emulators & folders closes when you use any other button, instead of staying open.",
      "The views' arrows no longer show, even for a moment, after changing a maker's console when everything fits.",
      "Your profile's Share as image saves the picture again.",
      "Surprise me no longer pushes the whole app up.",
      "Favorite and Completed badges match in size and sit at the bottom right of the box, clear of the console's badge.",
      "Others is now Other PC, and every emulator's consoles can be read in full.",
      "The Console sort centers each console's games.",
      "Songs without a cover show Digitify's own on Windows' media controls and in the queue, never the previous song's.",
      "The song playing shows its cover on Windows' media controls, and there's only Digitify's card there now.",
      "Arcade's views show whole, with Find, Size, Select and Sort under them when both don't fit; the arrows only show when the views don't fit even on their own line.",
    ],
  },
  {
    version: "0.9.1",
    date: "2026-11-21",
    added: [
      { icon: "gamepad", title: "Minecraft in Arcade", text: "Minecraft: Java Edition, Bedrock and each of your Prism Launcher or MultiMC instances show in Arcade with their covers, beside your Xbox games (in a view of their own on Linux). Start them from there and your play time counts; Prism Launcher's instances start the game straight away." },
    ],
    fixed: [
      "Removing a game folder in Arcade is instant again, instead of taking up to a minute.",
      "Look for games finishes in moments, instead of seeming to search forever.",
      "Arcade no longer waits for network drives that are offline, or for disc drives.",
      "A game's cover shows whole in its panel, however long the panel.",
    ],
  },
  {
    version: "0.9.0",
    date: "2026-11-20",
    added: [
      { icon: "monitor", title: "Your profile", text: "Your picture in the title bar opens your own page: a banner and picture of your choosing, your name and a line about you, and what your library says about you. Share it as a picture made on your computer; see it in Big Picture too." },
      { icon: "monitor", title: "Frutiger Aero and Minimal", text: "Two new styles in Settings: sky, water and glass with glossy aqua buttons, or calm and flat like a game launcher. Each in light and dark." },
      { icon: "library", title: "The Digitify Manual", text: "A designed guide to everything Digitify does, waiting in Books. It updates itself; deleted, Books › Add brings it back." },
      { icon: "gamepad", title: "Collections, their own screen", text: "Arcade's Collections opens a screen with a Back to all games. Favorites is now a collection, always first." },
      { icon: "gamepad", title: "Sort by console, mark as completed", text: "Sort Arcade by console, each under its own heading, and mark the games you've finished with a green seal." },
      { icon: "gamepad", title: "Collections in Big Picture", text: "Library's and Arcade's collections have their own tab in Big Picture." },
      { icon: "image", title: "Your picture, your way", text: "Move and zoom your profile picture and banner, and frame your picture as a circle, rounded square or hexagon with a rainbow, accent, gold or no ring." },
      { icon: "library", title: "Long names slide", text: "A name too long for its card slides to show the rest while you point at it." },
    ],
    fixed: [
      "Epic Games' covers fill their boxes, with no bands.",
      "A Library collection's window centers its items.",
      "Smart lists are gone, for less clutter: collections do the job.",
      "Light mode for slower computers is now Performance mode, so it isn't mistaken for the light theme.",
      "The manual has a cover of its own, shown whole in Books.",
      "Frutiger Aero's bubbles float, and its slider knobs are solid.",
      "No more line under the profile's banner as the page opens, and sliding names no longer fade at their ends.",
    ],
  },
  {
    version: "0.8.0",
    date: "2026-11-20",
    added: [
      { icon: "gamepad", title: "Collections in Arcade", text: "A Collections button beside Emulators & folders: make your own and put games in them from a game's panel or by selecting several, or make dynamic ones that fill themselves by words in the name, consoles and launchers, played or not, favorites and your rating." },
      { icon: "image", title: "Cover search needn't be exact", text: "Find covers looks for any of the words you type, the closest games first, and says which game each cover is of." },
      { icon: "gamepad", title: "An emulator for one game", text: "A game's panel can choose the emulator it plays in, without changing its console's." },
      { icon: "monitor", title: "Badges your way", text: "Settings › Arcade: games' badges with their logo and name, the logo alone, or none." },
      { icon: "image", title: "Boxes the right shape", text: "Each console's games have its real box shape (Nintendo DS and 3DS boxes are wider than tall), and a cover of another shape shows whole, never cut." },
    ],
    fixed: ["Escape in a game panel's menus no longer closes the whole panel."],
  },
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

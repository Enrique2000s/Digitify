# Digitify — Original Project Brief

> Provided by the project owner on 2026-10-30 and preserved verbatim (formatting adapted to Markdown). Approved changes to scope or order are recorded in [DECISIONS.md](DECISIONS.md); the brief itself is not edited.

**PROJECT: DIGITIFY — Your Personal Digital Media Library**

## 1. Project Overview
I want you to help me design, develop, and build a fully functional desktop application for Windows called Digitify.

Digitify is an offline-first, highly customizable personal digital media library that allows users to digitize, import, organize, manage, and enjoy their physical media collections through one cohesive application.

The main concept is simple:

"Your physical collection, digitally preserved and beautifully organized."

Digitify should bring together the functionality of a digital bookshelf, comic reader, manga reader, music library, movie library, and physical media collection manager into a single polished desktop application.

Users should be able to create or import digital copies of media they physically own, organize everything however they want, and consume supported media directly inside Digitify without switching between different applications.

I want Digitify to feel like a complete, professional desktop product rather than a basic media viewer or file explorer.

## 2. Core Philosophy
Digitify should follow these principles:

### A. Everything Is Customizable
Customization is one of the most important aspects of the entire application.

Users should have freedom to customize:
* Library categories and subcategories.
* Collection names and organization.
* Custom shelves and folders.
* Media types.
* Metadata and custom information fields.
* Library layouts.
* Cover art and thumbnails.
* Sorting and filtering rules.
* Themes, colors, and interface preferences.
* Reading and playback experiences.
* Individual collection settings.

The application should provide useful defaults without forcing users to follow one specific organizational structure.

### B. One Unified Media Ecosystem
The user should not need five separate applications to enjoy five types of media.

Digitify should integrate native reading, video playback, and audio playback within one cohesive interface.

Every media format should have a viewing experience appropriate for that medium.

### C. Local-First Ownership
Digitify should prioritize local files, privacy, and offline access.

Core functionality must not require accounts, subscriptions, cloud services, or an internet connection.

The user maintains control over their personal media collection.

### D. Beautiful and Intuitive Design
The application should look modern, dynamic, visually pleasing, responsive, and professional.

The UI should be designed around the experience of interacting with a personal media collection, rather than simply displaying files.

## 3. Supported Media Categories
Digitify should initially support five primary categories, with the ability to add more categories in the future.

### A. Books
Supported formats should include, where technically possible:
* PDF
* EPUB
* JPG / JPEG
* PNG
* WEBP
* Collections of images
* Other practical ebook formats when feasible

Users should be able to import an existing ebook, a scanned PDF, or photographs of pages from a physical book.

If multiple images are imported as part of one book, Digitify should allow users to arrange those images in the correct reading order and save them as one library item.

**Built-in Book Reader**

Develop an immersive reading interface with:
* Animated page-turning effects.
* Optional realistic book-style page flipping.
* Single-page and two-page viewing.
* Smooth zooming and panning.
* Fullscreen reading.
* Table of contents when available.
* Bookmarks.
* Reading progress.
* Resume from the last page.
* Brightness and display adjustments where feasible.
* Night mode.
* Customizable backgrounds.
* Font and typography settings for compatible reflowable formats.

Animations should be smooth and optional, with reduced-motion support.

The reader should feel like opening a book from your personal bookshelf.

### B. Comics and Manga
Supported formats should include:
* CBZ
* CBR, if practical and compatible dependencies are available
* PDF
* Images
* Folders containing numbered pages

**Built-in Comic and Manga Reader**

Features should include:
* Smooth page navigation.
* Realistic page-turning animations.
* Traditional comic book page mode.
* Double-page spreads.
* Continuous vertical scrolling.
* Manga reading mode (right-to-left).
* Western reading mode (left-to-right).
* Automatic page fitting.
* Zooming and panning.
* Fullscreen.
* Bookmarks.
* Reading progress.
* Chapter and volume organization.
* Customizable reader backgrounds.

Users should be able to organize comics and manga into series, volumes, chapters, and collections.

For example:

Manga → One Piece → Volume 01 → Chapters

The application should allow custom hierarchical organization rather than enforcing this exact structure.

### C. Movies, Series, DVDs, and Blu-rays
Users should be able to import local digital video files.

Supported formats should include, subject to available playback support:
* MP4
* MKV
* MOV
* AVI
* WEBM
* Other useful formats supported by the chosen playback engine

**Built-in Video Player**

The application should include its own integrated video playback interface.

Features:
* Play, pause, seek, and volume controls.
* Fullscreen playback.
* Playback speed controls.
* Subtitle support (such as SRT).
* Multiple audio tracks when supported.
* Chapter navigation when supported.
* Resume playback.
* Remember watched progress.
* Recently watched section.
* Watched/unwatched tracking.
* Series and season organization.
* Custom movie posters.
* Background artwork.
* Metadata editing.

The video player should support smooth playback with efficient hardware acceleration where practical.

**Physical DVD and Blu-ray Support**

This is an important feature.

If the user has a compatible optical disc drive connected to their PC, Digitify should detect supported inserted discs and provide relevant actions.

Potential functionality:
1. Detect connected optical drives.
2. Detect inserted media.
3. Identify whether the media is a CD, DVD, or Blu-ray where technically possible.
4. Read available disc information.
5. Play compatible, accessible media directly from the disc.
6. Import or create local copies of media when technically supported and legally permitted.
7. Organize imported media in Digitify.

I understand that commercially distributed DVDs and Blu-rays may use DRM, encryption, region restrictions, or playback protections.

Do not promise universal disc playback or conversion, do not implement DRM circumvention, and do not silently attempt to bypass protected content.

Clearly identify technical limitations and offer supported alternatives. Implement legitimate workflows for compatible, unprotected media first.

If reliable optical disc functionality requires additional dependencies, drivers, libraries, or external applications, explain those requirements to me before integrating them.

I want a realistic, functional implementation rather than placeholder buttons that do nothing.

### D. Music and Audio CDs
Supported audio formats should include:
* MP3
* FLAC
* WAV
* AAC / M4A where supported
* OGG
* Other practical audio formats

**Built-in Music Player**

Features:
* Music playback.
* Albums and artists.
* Track listings.
* Album artwork.
* Playlist creation.
* Custom playlists.
* Playback queue.
* Shuffle and repeat.
* Audio seeking.
* Volume control.
* Track metadata editing.
* Background audio playback.
* Mini-player.
* Recently played.
* Favorite tracks.
* Search by artist, album, genre, and track.

Digitify should feel like a personal music library manager integrated with the rest of the application.

**Physical Audio CD Support**

When the user inserts an audio CD into a compatible disc drive, Digitify should attempt to:
* Detect the CD.
* Display available tracks.
* Play tracks directly when supported.
* Extract compatible audio CD tracks to local files when available.
* Allow the user to choose output formats such as FLAC or WAV, where technically feasible.
* Import extracted tracks into the library.
* Associate album artwork and metadata.

Disc-related operations must be implemented safely, with clear error messages and progress indicators.

### E. Custom Media Types
Do not hardcode the entire library around only the categories described above.

Digitify should support customizable media categories.

For example, a user might want to create:
* Magazines
* Audiobooks
* Artbooks
* Documentaries
* Concerts
* Educational materials
* Personal archives
* Other personal collections

Custom categories should support user-defined names, icons, metadata fields, sorting preferences, and organization rules.

A custom category should be associated with an appropriate existing reader or player when possible.

## 4. Unified Digital Library System
This is the heart of Digitify.

The main dashboard should present the entire collection in a beautiful, organized interface.

**Library Features**

Users should be able to:
* Import individual files.
* Import entire folders.
* Drag and drop files into the application.
* Create collections.
* Create custom categories.
* Create nested collections.
* Move items between collections.
* Rename items.
* Edit metadata.
* Change artwork.
* Assign tags.
* Mark favorites.
* Sort and filter collections.
* Search the entire library.
* View recently added media.
* View recently opened media.
* Continue reading or watching.
* See completion progress.
* Detect duplicate imports.
* Perform bulk editing.

**Multiple Library Layouts**

Provide different ways to visualize collections.

Examples:
- **Grid View:** A modern grid featuring large media covers.
- **Shelf View:** A visual bookshelf displaying books, comics, movies, or albums as physical-style media cases.
- **List View:** A practical, information-focused layout.
- **Detailed View:** An expanded layout showing artwork, descriptions, and metadata.

Users should be able to switch between layouts and customize their appearance.

I especially want a beautiful virtual shelf experience.

It should make the user feel like they are browsing their actual physical collection digitally.

## 5. Physical Collection and Digital Copy Management
Digitify should understand the difference between a physical item and its digital files.

For example, a user might physically own a hardcover book and have a scanned PDF of that same book.

The application should allow both to be represented as one library item, with separate information about:
* Physical ownership.
* Physical format.
* Edition.
* Condition.
* Storage location.
* Digital file format.
* File location.
* Available digital versions.

This is useful because someone might own a DVD, Blu-ray, and digital video version of the same movie.

Digitify should allow those versions to be grouped under one media entry without losing their individual information.

Users should also be able to catalog items they physically own even when no digital copy exists yet.

This allows Digitify to function as both a physical collection organizer and a digital media library.

## 6. File Management
Digitify should provide two import methods.

**Method 1: Reference Existing Files**

The application registers a file in the library without moving it from its original location.

**Method 2: Copy Into Digitify Library**

The application copies the imported file into a user-defined Digitify media directory.

Users should choose which behavior they prefer.

The software should:
* Preserve original files.
* Avoid accidental data deletion.
* Detect missing files.
* Offer a way to relink moved files.
* Handle duplicate imports.
* Support customizable storage locations.
* Provide import progress.
* Support large media files.
* Store metadata separately from the original files when appropriate.
* Allow reliable backup and restoration of the library database.
* Avoid unnecessarily duplicating files.

Deleting a library entry must not automatically delete the actual media file without explicit confirmation.

## 7. Metadata and Collection Information
Each media item should have a detailed information page.

Depending on the type, possible fields include:
- **Books:** Title, author, publisher, publication year, ISBN, edition, genre, description, page count.
- **Comics/Manga:** Series, volume, chapter, author, artist, publisher, issue number, release date.
- **Movies/Series:** Title, director, cast, release year, genre, runtime, resolution, season, episode.
- **Music:** Artist, album, track, genre, release year, duration, disc number.

Users should be able to customize these fields and add their own metadata.

Automatic metadata retrieval may be useful, but it should be an optional feature.

If you propose integration with external metadata databases, APIs, or internet services, explain the options and ask for my approval before implementing them.

Digitify must remain functional without automatic online metadata.

## 8. User Interface and Visual Design
I want Digitify to have a distinctive visual identity.

The UI should feel like a premium, modern desktop application.

**Desired Visual Direction**
* Modern and clean.
* Elegant but not excessively minimalist.
* Beautiful cover artwork presentation.
* Smooth and purposeful animations.
* Dynamic content transitions.
* Responsive layouts.
* Polished navigation.
* Consistent typography.
* Attractive media detail pages.
* Customizable accent colors.
* Light and dark modes.
* Optional transparency or glass-like effects.
* A strong emphasis on library presentation.

The application should have its own identity rather than look like a generic Windows File Explorer clone.

**Main Interface**

Consider a layout with:
* Sidebar navigation.
* Home dashboard.
* All Media.
* Books.
* Comics.
* Manga.
* Movies & Series.
* Music.
* Custom categories.
* Favorites.
* Collections.
* Settings.

These categories should be customizable.

**Dashboard**

The main dashboard could contain:
* Continue Reading.
* Continue Watching.
* Recently Added.
* Recently Played.
* Favorite Collections.
* Featured Media.
* Customizable widgets.

The dashboard should adapt to the media the user actually has in their library.

**Animations**

I want satisfying interactions such as:
* Smooth transitions when opening a collection.
* Hover effects on media artwork.
* Animated book opening.
* Page-turning effects.
* Expanding media details.
* Smooth navigation between categories.
* Optional shelf animations.

Prioritize performance and usability over unnecessary visual effects.

## 9. User Customization System
Provide a dedicated customization section in the settings.

Possible options:
* Application theme.
* Accent color.
* Font preferences.
* Sidebar organization.
* Default home screen.
* Library layout.
* Media card size.
* Shelf appearance.
* Animation intensity.
* Reading preferences.
* Default media players.
* Library storage locations.
* Category visibility.
* Custom category creation.
* Keyboard shortcuts.

Allow preferences to persist between sessions.

The customization system should be designed to accommodate future additions.

## 10. Recommended Technical Architecture
I want Digitify to be a real Windows desktop application, not simply a website pretending to be one.

Use a suitable desktop development architecture.

You may evaluate technologies such as:
* Tauri.
* Electron.
* React.
* TypeScript.
* Rust.
* SQLite.
* Appropriate native media playback and document rendering technologies.

These are suggestions, not mandatory requirements.

Choose the architecture that best fits the entire project, especially its requirements for:
* Local file system access.
* Optical drive integration.
* Video/audio decoding.
* Native Windows compatibility.
* Performance.
* Reliable reading interfaces.
* Local databases.
* Packaging and distribution.

Explain your proposed technology stack and its tradeoffs before committing to it.

Prefer maintainable, established technologies over experimental dependencies.

**Additional Technical Requirements**
* Windows 10/11 compatibility where practical.
* Offline-first functionality.
* Persistent local SQLite database or equivalent.
* Secure handling of local files.
* Background processing for imports and thumbnails.
* Efficient memory usage.
* Reliable support for large collections.
* Virtualized grids for large libraries.
* Thumbnail and metadata caching.
* Proper error handling.
* Clear application logs.
* Modular architecture.
* No unnecessary telemetry.
* No hidden uploading of personal media.
* No mandatory user accounts.
* Proper dependency and license compliance.

The application should be designed for future expansion without requiring a complete rewrite.

## 11. Functional Quality Requirements
I do not want a nonfunctional prototype that only looks impressive.

I want a genuinely working desktop application.

When developing a feature:
1. Implement its actual functionality.
2. Connect the UI to the underlying logic.
3. Handle errors properly.
4. Test expected behavior.
5. Validate compatibility.
6. Avoid placeholder features presented as completed functionality.

If a feature cannot be implemented reliably, explain why and suggest alternatives.

Do not quietly substitute mock behavior for real functionality.

Use real sample media that is created for testing or legally available to use.

Never bundle copyrighted books, movies, or music without appropriate permission.

## 12. Development Roadmap
Because Digitify is a large project, organize development into manageable phases.

**Phase 1 — Core Application**

Build:
* Real Windows desktop shell.
* Navigation system.
* Library dashboard.
* SQLite database.
* File import functionality.
* Category management.
* Basic collection management.
* Media cards and artwork.
* Search and sorting.
* Persistent settings.

**Phase 2 — Readers**

Implement:
* PDF and image reading.
* EPUB reading.
* Comic and manga reading.
* Reading progress.
* Bookmarks.
* Reading modes.
* Page transition effects.

**Phase 3 — Media Playback**

Implement:
* Video player.
* Music player.
* Playlists.
* Resume playback.
* Subtitles.
* Album and series organization.

**Phase 4 — Physical Media**

Investigate and implement supported:
* Optical drive detection.
* Audio CD access.
* Compatible DVD playback.
* Compatible Blu-ray playback.
* Supported disc importing.
* Physical ownership tracking.
* Multiple physical and digital editions.

**Phase 5 — Advanced Personalization**

Implement:
* Expanded themes.
* Custom shelves.
* Advanced metadata.
* Custom dashboard widgets.
* Additional visual layouts.
* Backup and restore.
* Advanced library organization.

These phases are a proposed direction. You can recommend improvements to their order, but discuss significant changes with me first.

Develop incrementally, test each phase, and keep the project runnable.

## 13. Very Important: Ask Me Before Making New Design Decisions
This is one of my most important requirements.

I want this project to be collaborative.

If you discover an opportunity to improve Digitify, I want to hear your ideas.

You are encouraged to be creative and recommend new features, improvements, usability enhancements, technical solutions, and visual concepts.

However:

DO NOT automatically implement features or major design decisions that I have not approved.

Instead:
1. Explain your idea.
2. Explain why it would improve Digitify.
3. Describe how it would work.
4. Mention important tradeoffs.
5. Ask me whether I want to include it.
6. Wait for my answer before implementing it.

For example, if you think Digitify would benefit from:
* A statistics dashboard.
* Achievement systems for completed books or movies.
* Automatic collection organization.
* AI-powered metadata.
* A mobile companion application.
* Local network streaming.
* Cloud synchronization.
* Themes inspired by physical bookstores.
* Smart playlists.
* Custom user profiles.
* Additional media formats.

Do not implement these ideas automatically.

Present them to me as optional proposals and let me decide.

You can bundle related questions to avoid interrupting development unnecessarily.

For minor internal implementation details that do not alter functionality or user experience, use reasonable engineering judgment.

If there is an important ambiguity about what I want, ask rather than inventing requirements.

## 14. How I Want You to Start
Before writing the main application code:

Step 1: Review the full project requirements and identify any important technical challenges.

Step 2: Propose a suitable architecture, including how the readers, players, database, and optical drive features will work.

Step 3: Identify features that require my preferences or important technical decisions.

Step 4: Ask me a focused set of questions about those decisions. Do not overwhelm me with dozens of questions at once.

Step 5: Suggest any particularly useful additional features, clearly distinguishing them from my original requirements.

Step 6: After receiving my answers, create a realistic project roadmap and begin implementation.

Once development starts, do not stop at a high-level plan. Actually create the source code, project structure, database, interface, and working functionality.

Maintain documentation of completed features, incomplete features, technical decisions, and known limitations.

Do not claim a feature is complete until it has been implemented and reasonably tested.

At appropriate milestones, provide instructions for running and testing the application locally.

Eventually, the project should be buildable into a distributable Windows installer or executable.

## 15. Final Vision
I want Digitify to become the definitive personal desktop application for people who love collecting physical media but also want the convenience of enjoying their collections digitally.

Imagine opening Digitify and seeing your entire personal collection:

Your books neatly arranged on beautiful digital shelves.

Your manga organized into volumes and chapters.

Your comics available through an immersive reader.

Your DVD and Blu-ray collection represented with posters, artwork, and compatible playable digital versions.

Your music albums displayed beautifully with an integrated audio player.

Everything searchable, organized, customizable, and accessible from one application.

Digitify should make digital ownership and personal media collecting feel organized, enjoyable, and personal.

The goal is not to imitate a streaming service.

The goal is to create a beautiful digital home for the media you own and the collections you care about.

Start by analyzing this vision, proposing the architecture, and asking me the important questions you need answered before beginning development.

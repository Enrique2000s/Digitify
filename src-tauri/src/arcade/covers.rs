//! Arcade's covers (split from mod.rs, D-173): found for new games (the emulators' own art, the
//! stores', GameTDB, libretro-thumbnails, LaunchBox, the Microsoft Store, SteamGridDB), chosen by
//! hand among every one found, and kept in the library's artwork.

use super::*;

/// Covers for `ids`: Dolphin's cache at once; when `download`, GameTDB (GameCube and Wii, by disc ID)
/// and libretro-thumbnails (every console, by name; D-035) in the background. Returns how many
/// games wait for a download.
/// Each store game's art by its path (`store://…`): on this computer, and its launcher's online.
pub(super) type StoreArt = HashMap<String, (Option<PathBuf>, Option<String>)>;

fn store_art_now() -> StoreArt {
    stores::scan_all_cached()
        .into_iter()
        .flat_map(|found| found.games)
        .map(|g| (format!("store://{}/{}", g.store.key(), g.key), (g.cover, g.cover_url)))
        .collect()
}

pub(super) fn find_covers(app: &AppHandle, library: &std::sync::Arc<Library>, ids: &[i64], local: &LocalArt, download: bool, store_art: Option<StoreArt>) -> AppResult<usize> {
    let sgdb_key = steamgriddb_key(app);
    let launchbox = art_cache(app).map(|c| artsources::launchbox_db_path(&c)).filter(|db| db.is_file());
    type Row = (i64, Option<String>, String, String, String, Option<String>, Option<String>, Option<String>);
    let games: Vec<Row> = library.db.with(|conn| {
        let mut stmt = conn.prepare("SELECT id, game_id, platform, path, title, store, store_key, system FROM arcade_games WHERE id = ?1")?;
        let mut out = Vec::new();
        for id in ids {
            if let Some(row) = stmt.query_row([id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?, row.get(6)?, row.get(7)?))).optional()? {
                out.push(row);
            }
        }
        Ok(out)
    })?;
    let mut queue = Vec::new();
    let mut store_art = store_art;
    for (id, game_id, platform, path, title, store, store_key, system) in games {
        // PC games (D-037, D-039): their launcher's art on this computer (Steam's cache, the Xbox app's
        // logos); else, with downloads, the art their launcher shows (Epic's and Heroic's records name
        // it; Steam's by app id).
        if platform == "pc" {
            let art = store_art.get_or_insert_with(store_art_now).get(&path).cloned().unwrap_or_default();
            // Minecraft (D-153): its box art by the edition's name (an instance is Java Edition); its
            // package's square logo only when none is found.
            let minecraft = store.as_deref() == Some("minecraft");
            let title = if minecraft { minecraft::cover_title(store_key.as_deref().unwrap_or_default()).to_string() } else { title };
            let (local, logo) = if minecraft { (None, art.0) } else { (art.0, None) };
            if let Some(bytes) = local.and_then(|p| std::fs::read(p).ok()) {
                if set_cover(library, id, &bytes, "store").is_ok() {
                    continue;
                }
            }
            if download {
                let mut urls: Vec<String> = art.1.into_iter().collect();
                match (store.as_deref(), store_key.as_deref()) {
                    (Some("steam"), Some(app)) => urls.extend(stores::steam_cover_urls(app)),
                    // GOG's catalogue names its box art by the game's ID (D-101).
                    (Some("gog"), Some(game)) => urls.push(format!("gog:{game}")),
                    _ => {}
                }
                // Not from Steam: Steam's store may know the game by its name (D-108).
                if store.as_deref() != Some("steam") && !minecraft {
                    urls.push(format!("steam-search:{title}"));
                }
                // LaunchBox, when its database is here, and the Microsoft Store (D-131).
                if launchbox.is_some() {
                    urls.push(format!("lb:pc|{title}"));
                }
                if store.as_deref() != Some("steam") {
                    urls.push(format!("ms:{title}"));
                }
                // Then SteamGridDB, by name, with the user's key (D-128).
                if sgdb_key.is_some() {
                    urls.push(format!("sgdb:{title}"));
                }
                urls.extend(logo.as_ref().map(|p| format!("file:{}", p.display())));
                if !urls.is_empty() {
                    queue.push((id, urls));
                }
            } else if let Some(bytes) = logo.and_then(|p| std::fs::read(p).ok()) {
                let _ = set_cover(library, id, &bytes, "store");
            }
            continue;
        }
        let cached = game_id.as_ref().and_then(|g| local.dolphin.as_ref().map(|dir| dir.join(format!("{g}.png")))).filter(|p| p.is_file());
        if let Some(bytes) = cached.and_then(|p| std::fs::read(p).ok()) {
            if set_cover(library, id, &bytes, "dolphin").is_ok() {
                continue;
            }
        }
        let stem = games::title_from_name(Path::new(path.rsplit('#').next().unwrap_or(&path)));
        let names = games::libretro_names(&stem, &title);
        // RetroArch's own box art for the games in its playlists (D-101).
        if let (Some(system), Some(thumbnails)) = (system.as_deref(), local.retroarch.as_deref()) {
            let mut wanted = vec![title.clone()];
            wanted.extend(names.iter().cloned());
            if let Some(bytes) = retroarch::thumbnail(thumbnails, system, &wanted).and_then(|p| std::fs::read(p).ok()) {
                if set_cover(library, id, &bytes, "retroarch").is_ok() {
                    continue;
                }
            }
        }
        // A PlayStation 3 game's own picture: wide, so a downloaded box comes first when allowed.
        let icon = (platform == Platform::Ps3.key()).then(|| games::ps3_icon(Path::new(&path))).flatten();
        if !download {
            if let Some(bytes) = icon.and_then(|p| std::fs::read(p).ok()) {
                let _ = set_cover(library, id, &bytes, "rpcs3");
            }
            continue;
        }
        let mut urls = Vec::new();
        urls.extend(gametdb_urls(&platform, game_id.as_deref()));
        // LaunchBox by name, on this console (D-131).
        if launchbox.is_some() && !artsources::launchbox_platforms(&platform).is_empty() {
            urls.push(format!("lb:{platform}|{title}"));
        }
        let libretro = system.as_deref().map(retroarch::libretro_system).or_else(|| games::libretro_system(&platform).map(str::to_string));
        if let Some(collection) = libretro {
            urls.extend(names.iter().map(|name| games::libretro_url(&collection, name)));
        }
        // The Microsoft Store for Xbox games (D-131).
        if platform == "ogxbox" || platform == "x360" {
            urls.push(format!("ms:{title}"));
        }
        // SteamGridDB by the game's name (D-128): not only the IDs GameTDB knows.
        if sgdb_key.is_some() {
            urls.push(format!("sgdb:{title}"));
        }
        urls.extend(icon.map(|p| format!("file:{}", p.display())));
        if !urls.is_empty() {
            queue.push((id, urls));
        }
    }
    let queued = queue.len();
    if !queue.is_empty() {
        let app = app.clone();
        let library = library.clone();
        std::thread::spawn(move || {
            for (id, urls) in queue {
                for url in urls {
                    // A picture on this computer, tried after the downloads (a PlayStation 3 game's icon).
                    if let Some(file) = url.strip_prefix("file:") {
                        // A PlayStation 3 game's ICON0.PNG, or a package's logo (Minecraft, D-153).
                        let source = if file.to_lowercase().ends_with("icon0.png") { "rpcs3" } else { "store" };
                        if std::fs::read(file).ok().is_some_and(|bytes| set_cover(&library, id, &bytes, source).is_ok()) {
                            let _ = app.emit("arcade-changed", ());
                            break;
                        }
                        continue;
                    }
                    // GOG's catalogue says where the box art is; Steam's store finds a game by its name.
                    let url = if let Some(game) = url.strip_prefix("gog:") {
                        match stores::gog_cover_url(game) {
                            Some(found) => found,
                            None => continue,
                        }
                    } else if let Some(rest) = url.strip_prefix("lb:") {
                        let (platform, title) = rest.split_once('|').unwrap_or(("", rest));
                        match launchbox.as_deref().and_then(|db| artsources::launchbox_covers(db, title, artsources::launchbox_platforms(platform), 1).into_iter().next()) {
                            Some((_, found)) => found,
                            None => continue,
                        }
                    } else if let Some(title) = url.strip_prefix("ms:") {
                        match artsources::msstore_covers(title, 1, false).into_iter().next() {
                            Some((_, found)) => found,
                            None => continue,
                        }
                    } else if let Some(title) = url.strip_prefix("sgdb:") {
                        match sgdb_key.as_deref().and_then(|key| sgdb::first_for(key, title)) {
                            Some(found) => found,
                            None => continue,
                        }
                    } else if let Some(title) = url.strip_prefix("steam-search:") {
                        let urls = stores::steam_search(title).map(|game| stores::steam_cover_urls(&game)).unwrap_or_default();
                        if urls.iter().any(|u| crate::online::http::image(u).is_some_and(|bytes| set_cover(&library, id, &bytes, "steam").is_ok())) {
                            let _ = app.emit("arcade-changed", ());
                            break;
                        }
                        continue;
                    } else {
                        url
                    };
                    let source = if url.contains("steamgriddb") {
                        "steamgriddb"
                    } else if url.contains("launchbox") {
                        "launchbox"
                    } else if url.contains("store-images.s-microsoft") {
                        "msstore"
                    } else if url.contains("gametdb") {
                        "gametdb"
                    } else if url.contains("libretro") {
                        "libretro"
                    } else if url.contains("steamstatic") {
                        "steam"
                    } else if url.contains("gog") {
                        "gog"
                    } else {
                        "store"
                    };
                    if let Some(bytes) = crate::online::http::image(&url) {
                        if set_cover(&library, id, &bytes, source).is_ok() {
                            let _ = app.emit("arcade-changed", ());
                            break;
                        }
                    }
                }
            }
        });
    }
    Ok(queued)
}

/// Where Arcade keeps what it downloads to search (LaunchBox's index, D-131).
pub(super) fn art_cache(app: &AppHandle) -> Option<PathBuf> {
    crate::config::config_dir(app).ok().map(|d| d.join("cache"))
}

/// LaunchBox's index: when it was downloaded and how many games it knows, if it's here (D-131).
#[tauri::command]
pub fn arcade_launchbox_status(app: AppHandle) -> Option<artsources::LaunchBoxStatus> {
    art_cache(&app).and_then(|c| artsources::status(&c))
}

/// Downloads LaunchBox's database (about 110 MB) and indexes it, replacing the one here (D-131).
#[tauri::command]
pub async fn arcade_launchbox_download(app: AppHandle) -> AppResult<artsources::LaunchBoxStatus> {
    let cache = art_cache(&app).ok_or_else(|| AppError::msg("Digitify's settings folder isn't available."))?;
    crate::library::blocking(move || artsources::download(&cache)).await
}

/// Removes LaunchBox's index from this computer (D-131).
#[tauri::command]
pub fn arcade_launchbox_remove(app: AppHandle) -> AppResult<()> {
    if let Some(cache) = art_cache(&app) {
        let db = artsources::launchbox_db_path(&cache);
        if db.is_file() {
            std::fs::remove_file(db)?;
        }
    }
    Ok(())
}

/// The user's SteamGridDB key, if they gave one (D-128).
pub(super) fn steamgriddb_key(app: &AppHandle) -> Option<String> {
    app.try_state::<AppState>().and_then(|state| state.config.get().steamgriddb_key).filter(|k| !k.trim().is_empty())
}

/// Whether a SteamGridDB key is set (D-128).
#[tauri::command]
pub fn arcade_steamgriddb_status(app: AppHandle) -> bool {
    steamgriddb_key(&app).is_some()
}

/// Opens SteamGridDB's page where an account's API key is made (D-128), in the browser.
#[tauri::command]
pub fn arcade_steamgriddb_open() -> AppResult<()> {
    crate::tools::open_link("https://www.steamgriddb.com/profile/preferences/api").map_err(|e| AppError::msg(format!("Couldn't open the browser: {e}")))
}

/// Sets the user's SteamGridDB key after checking that SteamGridDB answers with it; `None` removes it.
#[tauri::command]
pub async fn arcade_steamgriddb_set(state: State<'_, AppState>, key: Option<String>) -> AppResult<()> {
    let key = key.map(|k| k.trim().to_string()).filter(|k| !k.is_empty());
    if let Some(key) = key.clone() {
        let works = crate::library::blocking(move || Ok(sgdb::key_works(&key))).await?;
        if !works {
            return Err(AppError::msg("SteamGridDB didn't accept that key. Check it in your SteamGridDB preferences (API)."));
        }
    }
    state.config.update(|config| config.steamgriddb_key = key)?;
    Ok(())
}

/// GameTDB's box art for a game by its ID: GameCube and Wii, 3DS and Wii U (D-116).
fn gametdb_urls(platform: &str, game_id: Option<&str>) -> Vec<String> {
    let Some(id) = game_id else { return Vec::new() };
    let (folder, kinds): (&str, &[&str]) = match platform {
        "gamecube" | "wii" => ("wii", &["png"]),
        "3ds" => ("3ds", &["jpg", "png"]),
        "wiiu" => ("wiiu", &["jpg", "png"]),
        _ => return Vec::new(),
    };
    games::cover_regions(id).into_iter().flat_map(|region| kinds.iter().map(move |kind| format!("https://art.gametdb.com/{folder}/cover/{region}/{id}.{kind}"))).collect()
}

/// Where a cover to choose from comes from.
enum CoverSource {
    File(PathBuf),
    Url(String),
}

/// Every cover Arcade can find for a game (D-118), for the user to choose among: what's on this
/// computer (the launcher's, Dolphin's, RetroArch's, a PlayStation 3 game's icon), then online
/// (GameTDB, libretro-thumbnails, the stores; Steam's store by name, a few close matches).
/// `search` (D-146), when given, is the name looked up instead of the game's title.
/// A search also finds the names that only have some of its words (D-148), each labelled with its name.
fn cover_sources(library: &Library, id: i64, search: Option<&str>, sgdb_key: Option<&str>, launchbox: Option<&Path>, cache: Option<&Path>) -> AppResult<Vec<(String, CoverSource)>> {
    type Row = (Option<String>, String, String, String, Option<String>, Option<String>, Option<String>);
    let (game_id, platform, path, title, store, store_key, system): Row = library
        .db
        .with(|conn| {
            Ok(conn.query_row("SELECT game_id, platform, path, title, store, store_key, system FROM arcade_games WHERE id = ?1", [id], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?, row.get(6)?))
            })?)
        })?;
    let title = search.map(str::trim).filter(|s| !s.is_empty()).map(str::to_string).unwrap_or(title);
    let fuzzy = search.is_some();
    let mut out: Vec<(String, CoverSource)> = Vec::new();
    if platform == "pc" {
        let art = store_art_now().get(&path).cloned().unwrap_or_default();
        out.extend(art.0.map(|p| ("Its launcher".to_string(), CoverSource::File(p))));
        out.extend(art.1.map(|u| ("Its launcher".to_string(), CoverSource::Url(u))));
        match (store.as_deref(), store_key.as_deref()) {
            (Some("steam"), Some(app)) => out.extend(stores::steam_cover_urls(app).into_iter().map(|u| ("Steam".to_string(), CoverSource::Url(u)))),
            (Some("gog"), Some(game)) => out.extend(stores::gog_cover_url(game).map(|u| ("GOG".to_string(), CoverSource::Url(u)))),
            _ => {}
        }
        if store.as_deref() != Some("steam") {
            for (name, app) in stores::steam_search_all(&title).into_iter().take(if fuzzy { 6 } else { 3 }) {
                out.extend(stores::steam_cover_urls(&app).into_iter().take(2).map(|u| (format!("Steam · {name}"), CoverSource::Url(u))));
            }
        }
        // LaunchBox and the Microsoft Store, by name (D-131).
        if let Some(db) = launchbox {
            let found = if fuzzy { artsources::launchbox_by_words(db, &title, artsources::launchbox_platforms("pc"), 6, 2) } else { artsources::launchbox_covers(db, &title, artsources::launchbox_platforms("pc"), 4) };
            out.extend(found.into_iter().map(|(label, u)| (label, CoverSource::Url(u))));
        }
        out.extend(artsources::msstore_covers(&title, 3, fuzzy).into_iter().map(|(label, u)| (label, CoverSource::Url(u))));
        if let Some(key) = sgdb_key {
            match (store.as_deref(), store_key.as_deref()) {
                (Some("steam"), Some(app)) => out.extend(sgdb::steam_grids(key, app, 6).into_iter().map(|u| ("SteamGridDB".to_string(), CoverSource::Url(u)))),
                _ => out.extend(sgdb_by_name(key, &title)),
            }
        }
        return Ok(out);
    }
    let emulators = found_emulators(library)?;
    let local = local_art(&emulators);
    if let (Some(game), Some(dir)) = (game_id.as_deref(), local.dolphin.as_ref()) {
        out.push(("Dolphin".to_string(), CoverSource::File(dir.join(format!("{game}.png")))));
    }
    let stem = games::title_from_name(Path::new(path.rsplit('#').next().unwrap_or(&path)));
    let mut names = games::libretro_names(&stem, &title);
    // The names LaunchBox knows the game by (D-147): "Animal Forest" is libretro's "Doubutsu no Mori
    // (Japan)". LaunchBox writes "A: B" where libretro writes "A - B".
    if let Some(db) = launchbox {
        for other in artsources::launchbox_names(db, &title, artsources::launchbox_platforms(&platform)).into_iter().take(3) {
            let other = other.replace(": ", " - ");
            for name in games::libretro_names(&other, &other) {
                if !names.iter().any(|n| n.eq_ignore_ascii_case(&name)) {
                    names.push(name);
                }
            }
        }
    }
    let collection = system.clone().map(|s| retroarch::libretro_system(&s)).or_else(|| games::libretro_system(&platform).map(str::to_string));
    if let Some(thumbnails) = local.retroarch.as_deref() {
        let folder = system.clone().or_else(|| collection.as_ref().map(|c| c.replace('_', " ")));
        if let Some(folder) = folder {
            let mut wanted = vec![title.clone()];
            wanted.extend(names.iter().cloned());
            out.extend(retroarch::thumbnail(thumbnails, &folder, &wanted).map(|p| ("RetroArch".to_string(), CoverSource::File(p))));
        }
    }
    if platform == Platform::Ps3.key() {
        out.extend(games::ps3_icon(Path::new(&path)).map(|p| ("The game's icon".to_string(), CoverSource::File(p))));
    }
    out.extend(gametdb_urls(&platform, game_id.as_deref()).into_iter().map(|u| ("GameTDB".to_string(), CoverSource::Url(u))));
    if let Some(collection) = collection {
        out.extend(names.iter().map(|name| ("libretro".to_string(), CoverSource::Url(games::libretro_url(&collection, name)))));
        // By its words, among every box libretro has for the console (D-148).
        if let (true, Some(cache)) = (fuzzy, cache) {
            let index = artsources::libretro_index(cache, &collection);
            for name in artsources::best_by_words(index.iter().map(String::as_str), &title, 8) {
                if !names.iter().any(|n| n.eq_ignore_ascii_case(&name)) {
                    out.push((format!("libretro · {name}"), CoverSource::Url(games::libretro_url(&collection, &name))));
                }
            }
        }
    }
    // By the game's name too, not only its ID (D-128, D-131): LaunchBox, Nintendo's store, the
    // Microsoft Store, SteamGridDB.
    if let Some(db) = launchbox {
        let found = if fuzzy { artsources::launchbox_by_words(db, &title, artsources::launchbox_platforms(&platform), 6, 2) } else { artsources::launchbox_covers(db, &title, artsources::launchbox_platforms(&platform), 6) };
        out.extend(found.into_iter().map(|(label, u)| (label, CoverSource::Url(u))));
    }
    out.extend(artsources::eshop_covers(&platform, &title, 3, fuzzy).into_iter().map(|(label, u)| (label, CoverSource::Url(u))));
    if platform == "ogxbox" || platform == "x360" {
        out.extend(artsources::msstore_covers(&title, 3, fuzzy).into_iter().map(|(label, u)| (label, CoverSource::Url(u))));
    }
    if let Some(key) = sgdb_key {
        out.extend(sgdb_by_name(key, &title));
    }
    Ok(out)
}

/// SteamGridDB's box art for the games it finds by a name: the two closest, a few each.
fn sgdb_by_name(key: &str, title: &str) -> Vec<(String, CoverSource)> {
    sgdb::search(key, title)
        .into_iter()
        .take(2)
        .flat_map(|(game, name)| sgdb::game_grids(key, game, 4).into_iter().map(move |u| (format!("SteamGridDB · {name}"), CoverSource::Url(u))))
        .collect()
}

/// A cover to choose from, as the panel shows it: a small picture and where it's from.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoverChoice {
    pub index: usize,
    pub source: String,
    /// A small JPEG of it, as a data URL.
    pub preview: String,
    pub width: u32,
    pub height: u32,
}

/// Looks for every cover of a game (D-118) and keeps them to choose from: each found once (the
/// same picture from two places counts once), at most a dozen. Online, as asked for by the click.
/// `search` looks them up by another name than the game's (D-146).
#[tauri::command]
pub async fn arcade_cover_choices(app: AppHandle, state: State<'_, AppState>, arcade: State<'_, ArcadeState>, id: i64, search: Option<String>) -> AppResult<Vec<CoverChoice>> {
    let library = state.library()?;
    let key = state.config.get().steamgriddb_key.filter(|k| !k.trim().is_empty());
    let cache = art_cache(&app);
    let launchbox = cache.as_ref().map(|c| artsources::launchbox_db_path(c)).filter(|db| db.is_file());
    let (most_sources, most_kept) = if search.is_some() { (80, 30) } else { (40, 12) };
    let found: Vec<(String, Vec<u8>)> = crate::library::blocking(move || {
        let sources = cover_sources(&library, id, search.as_deref(), key.as_deref(), launchbox.as_deref(), cache.as_deref())?;
        let fetched: Vec<Option<(String, Vec<u8>)>> = std::thread::scope(|scope| {
            let handles: Vec<_> = sources
                .into_iter()
                .take(most_sources)
                .map(|(source, from)| {
                    scope.spawn(move || {
                        let bytes = match from {
                            CoverSource::File(path) => std::fs::read(path).ok(),
                            CoverSource::Url(url) => crate::online::http::image(&url),
                        }?;
                        Some((source, bytes))
                    })
                })
                .collect();
            handles.into_iter().map(|h| h.join().ok().flatten()).collect()
        });
        let mut seen = HashSet::new();
        Ok(fetched.into_iter().flatten().filter(|(_, bytes)| seen.insert(blake3::hash(bytes))).take(most_kept).collect())
    })
    .await?;
    let mut choices = Vec::new();
    let mut kept = Vec::new();
    for (source, bytes) in found {
        let Ok(picture) = image::load_from_memory(&bytes) else { continue };
        let (width, height) = (picture.width(), picture.height());
        let small = picture.thumbnail(320, 320).to_rgb8();
        let mut jpeg = Vec::new();
        if image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, 82).encode_image(&small).is_err() {
            continue;
        }
        choices.push(CoverChoice { index: kept.len(), source: source.clone(), preview: format!("data:image/jpeg;base64,{}", crate::tools::base64(&jpeg)), width, height });
        kept.push((source, bytes));
    }
    if let Ok(mut all) = arcade.choices.lock() {
        all.insert(id, kept);
    }
    Ok(choices)
}

/// Uses one of the covers found for a game (D-118) as its cover.
#[tauri::command]
pub async fn arcade_choose_cover(app: AppHandle, state: State<'_, AppState>, arcade: State<'_, ArcadeState>, id: i64, index: usize) -> AppResult<()> {
    let chosen = arcade.choices.lock().ok().and_then(|mut all| all.remove(&id)).and_then(|mut list| (index < list.len()).then(|| list.swap_remove(index)));
    let (source, bytes) = chosen.ok_or_else(|| AppError::msg("Those covers aren't there anymore; look for them again."))?;
    let source = match source.as_str() {
        "GameTDB" => "gametdb",
        s if s.starts_with("libretro") => "libretro",
        "RetroArch" => "retroarch",
        "Dolphin" => "dolphin",
        "GOG" => "gog",
        s if s.starts_with("SteamGridDB") => "steamgriddb",
        s if s.starts_with("LaunchBox") => "launchbox",
        s if s.starts_with("Nintendo eShop") => "eshop",
        s if s.starts_with("Microsoft Store") => "msstore",
        s if s.starts_with("Steam") => "steam",
        _ => "store",
    };
    with_library(&state, move |library| set_cover(library, id, &bytes, source)).await?;
    let _ = app.emit("arcade-changed", ());
    Ok(())
}

pub(super) fn set_cover(library: &Library, id: i64, bytes: &[u8], source: &str) -> AppResult<()> {
    let art = artwork::store(&library.folder, bytes)?;
    library.db.with(|conn| {
        conn.execute(
            "UPDATE arcade_games SET cover_key = ?2, cover_color = ?3, cover_source = ?4 WHERE id = ?1",
            params![id, art.key, art.color, source],
        )?;
        Ok(())
    })
}

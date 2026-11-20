//! More places for box art, none needing an account (D-131).
//!
//! - **LaunchBox Games Database:** its whole database, published as `Metadata.zip` (about 110 MB),
//!   is downloaded once when the user turns it on (and again when they refresh it); Digitify keeps
//!   a small index of each game's names, platform and front-box images, so finding a cover is a
//!   search on this computer, and only the picture chosen is downloaded.
//! - **Nintendo eShop:** Nintendo's store search, for Nintendo games' store art (square).
//! - **Microsoft Store:** the store's catalogue, for Xbox and PC games' box art (its vertical
//!   poster, else its square box art).

use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

use rusqlite::{params, params_from_iter, Connection, OpenFlags, OptionalExtension};
use serde::Serialize;

use crate::error::{AppError, AppResult};

const LAUNCHBOX_ZIP: &str = "https://gamesdb.launchbox-app.com/Metadata.zip";
const LAUNCHBOX_IMAGES: &str = "https://images.launchbox-app.com/";

/// A name to compare: letters and digits only, lower case, without "(USA)"-style tags.
pub fn simple(title: &str) -> String {
    super::sgdb::search_name(title).chars().filter(|c| c.is_alphanumeric()).collect::<String>().to_lowercase()
}

// ---------------------------------------------------------------------------------------------
// Searching by words (D-148)

/// Words too common to tell games apart.
const SMALL_WORDS: &[&str] = &["the", "and", "for", "of", "an", "no", "de", "la", "le", "el", "in", "on", "to"];

/// The words of a name to look for, each simplified ("Animal Forest (Japan)" → animal, forest):
/// numbers count ("64", "2"), small words don't.
pub fn keywords(text: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for word in super::sgdb::search_name(text).split(|c: char| !c.is_alphanumeric()) {
        let word = word.to_lowercase();
        let digits = !word.is_empty() && word.chars().all(|c| c.is_ascii_digit());
        if word.is_empty() || SMALL_WORDS.contains(&word.as_str()) || (word.chars().count() < 3 && !digits) {
            continue;
        }
        if !out.contains(&word) {
            out.push(word);
        }
    }
    out.truncate(8);
    out
}

/// How a name matches the words looked for: how many it has as whole words ("mori" in "Doubutsu no
/// Mori", not in "Armorines"), how many anywhere, and whether it's the very name. None when it has
/// none of them.
pub fn word_score(name: &str, words: &[String], wanted: &str) -> Option<(usize, usize, bool)> {
    let own: Vec<String> = super::sgdb::search_name(name).split(|c: char| !c.is_alphanumeric()).map(str::to_lowercase).filter(|w| !w.is_empty()).collect();
    let joined = simple(name);
    let whole = words.iter().filter(|w| own.iter().any(|o| o == *w)).count();
    let hits = words.iter().filter(|w| joined.contains(w.as_str())).count();
    (hits > 0).then_some((whole, hits, joined == wanted))
}

/// The names that have any of the words, the ones with most of them first, then the very name, a
/// US one, the shortest (D-148).
pub fn best_by_words<'a>(names: impl Iterator<Item = &'a str>, query: &str, limit: usize) -> Vec<String> {
    let words = keywords(query);
    if words.is_empty() {
        return Vec::new();
    }
    let wanted = simple(query);
    let mut scored: Vec<((usize, usize, bool), bool, usize, &str)> = names
        .filter_map(|name| word_score(name, &words, &wanted).map(|score| (score, name.contains("(USA"), name.len(), name)))
        .collect();
    // Most whole words, then most words, the very name, a US box, the shortest name.
    scored.sort_by(|a, b| b.0.cmp(&a.0).then(b.1.cmp(&a.1)).then(a.2.cmp(&b.2)));
    scored.into_iter().take(limit).map(|(.., name)| name.to_string()).collect()
}

/// libretro-thumbnails' box art names for a console (D-148), from GitHub's list of its files, kept a
/// month in `cache` (an older list is used when GitHub can't be reached).
pub fn libretro_index(cache: &Path, system: &str) -> Vec<String> {
    let file = cache.join("libretro").join(format!("{system}.txt"));
    let read = || std::fs::read_to_string(&file).map(|text| text.lines().map(str::to_string).collect::<Vec<_>>()).unwrap_or_default();
    let fresh = file.metadata().and_then(|m| m.modified()).ok().and_then(|t| t.elapsed().ok()).is_some_and(|age| age.as_secs() < 30 * 86_400);
    if fresh {
        let names = read();
        if !names.is_empty() {
            return names;
        }
    }
    let fetched = (|| -> Option<Vec<String>> {
        let request = crate::online::http::get(&format!("https://api.github.com/repos/libretro-thumbnails/{system}/git/trees/master?recursive=1")).ok()?;
        let json = crate::online::http::json("GitHub", request).ok()?;
        let names: Vec<String> = json
            .get("tree")?
            .as_array()?
            .iter()
            .filter_map(|entry| entry.get("path")?.as_str()?.strip_prefix("Named_Boxarts/")?.strip_suffix(".png").map(str::to_string))
            .collect();
        (!names.is_empty()).then_some(names)
    })();
    match fetched {
        Some(names) => {
            if let Some(dir) = file.parent() {
                let _ = std::fs::create_dir_all(dir);
            }
            let _ = std::fs::write(&file, names.join("\n"));
            names
        }
        None => read(),
    }
}

// ---------------------------------------------------------------------------------------------
// LaunchBox

/// LaunchBox's names for a console of Arcade's.
pub fn launchbox_platforms(platform: &str) -> &'static [&'static str] {
    match platform {
        "pc" => &["Windows", "Windows 3.X", "MS-DOS"],
        "gamecube" => &["Nintendo GameCube"],
        "wii" => &["Nintendo Wii"],
        "wiiu" => &["Nintendo Wii U"],
        "switch" => &["Nintendo Switch", "Nintendo Switch 2"],
        "n64" => &["Nintendo 64", "Nintendo 64DD"],
        "ds" => &["Nintendo DS"],
        "3ds" => &["Nintendo 3DS"],
        "nes" => &["Nintendo Entertainment System", "Nintendo Famicom Disk System"],
        "snes" => &["Super Nintendo Entertainment System", "Nintendo Satellaview"],
        "gb" => &["Nintendo Game Boy"],
        "gbc" => &["Nintendo Game Boy Color"],
        "gba" => &["Nintendo Game Boy Advance"],
        "ps1" => &["Sony Playstation"],
        "ps2" => &["Sony Playstation 2"],
        "ps3" => &["Sony Playstation 3"],
        "psp" => &["Sony PSP", "Sony PSP Minis"],
        "genesis" => &["Sega Genesis", "Sega 32X"],
        "segacd" => &["Sega CD", "Sega CD 32X"],
        "sms" => &["Sega Master System"],
        "gamegear" => &["Sega Game Gear"],
        "saturn" => &["Sega Saturn"],
        "dreamcast" => &["Sega Dreamcast"],
        "pce" => &["NEC TurboGrafx-16", "NEC TurboGrafx-CD", "PC Engine SuperGrafx"],
        "ogxbox" => &["Microsoft Xbox"],
        "x360" => &["Microsoft Xbox 360"],
        "arcade" => &["Arcade"],
        "atari2600" => &["Atari 2600"],
        _ => &[],
    }
}

/// What the index holds, for Settings.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchBoxStatus {
    /// When it was downloaded (ISO date).
    pub updated: String,
    pub games: i64,
}

fn xml_text(text: &str) -> String {
    text.replace("&amp;", "&").replace("&apos;", "'").replace("&quot;", "\"").replace("&lt;", "<").replace("&gt;", ">")
}

/// The value of a one-line `<Tag>value</Tag>`.
fn element<'a>(line: &'a str, tag: &str) -> Option<&'a str> {
    line.strip_prefix('<')?.strip_prefix(tag)?.strip_prefix('>')?.strip_suffix('>')?.strip_suffix(tag)?.strip_suffix("</")
}

/// The front-box pictures kept, best first.
const BOX_TYPES: [&str; 3] = ["Box - Front", "Box - Front - Reconstructed", "Fanart - Box - Front"];

/// Builds the index from LaunchBox's `Metadata.xml` (read as it streams, a line at a time: its
/// games, their other names and their front-box pictures) into `db`.
pub fn index_from(reader: impl std::io::Read, db: &Path) -> AppResult<i64> {
    let _ = std::fs::remove_file(db);
    let mut conn = Connection::open(db)?;
    conn.execute_batch(
        "PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF;
         CREATE TABLE games (id INTEGER PRIMARY KEY, name TEXT NOT NULL, simple TEXT NOT NULL, platform TEXT NOT NULL);
         CREATE TABLE alts (id INTEGER NOT NULL, simple TEXT NOT NULL);
         CREATE TABLE images (id INTEGER NOT NULL, file TEXT NOT NULL, kind INTEGER NOT NULL, region TEXT);
         CREATE TABLE info (key TEXT PRIMARY KEY, value TEXT);",
    )?;
    let tx = conn.transaction()?;
    let mut games = 0i64;
    {
        let mut game = tx.prepare("INSERT OR IGNORE INTO games (id, name, simple, platform) VALUES (?1, ?2, ?3, ?4)")?;
        let mut alt = tx.prepare("INSERT INTO alts (id, simple) VALUES (?1, ?2)")?;
        let mut image = tx.prepare("INSERT INTO images (id, file, kind, region) VALUES (?1, ?2, ?3, ?4)")?;
        let mut block = String::new();
        let (mut id, mut name, mut platform, mut file, mut kind, mut region) = (None::<i64>, None::<String>, None::<String>, None::<String>, None::<usize>, None::<String>);
        for line in BufReader::with_capacity(1 << 20, reader).lines() {
            let line = line?;
            let line = line.trim();
            match line {
                "<Game>" | "<GameImage>" | "<GameAlternateName>" => {
                    block = line.to_string();
                    (id, name, platform, file, kind, region) = (None, None, None, None, None, None);
                    continue;
                }
                "</Game>" => {
                    if let (Some(id), Some(name), Some(platform)) = (id, name.take(), platform.take()) {
                        game.execute(params![id, name, simple(&name), platform])?;
                        games += 1;
                    }
                    block.clear();
                    continue;
                }
                "</GameAlternateName>" => {
                    if let (Some(id), Some(name)) = (id, name.take()) {
                        alt.execute(params![id, simple(&name)])?;
                    }
                    block.clear();
                    continue;
                }
                "</GameImage>" => {
                    if let (Some(id), Some(file), Some(kind)) = (id, file.take(), kind) {
                        image.execute(params![id, file, kind as i64, region.take()])?;
                    }
                    block.clear();
                    continue;
                }
                _ => {}
            }
            match block.as_str() {
                "<Game>" => {
                    if let Some(v) = element(line, "Name") {
                        name.get_or_insert_with(|| xml_text(v));
                    } else if let Some(v) = element(line, "DatabaseID") {
                        id = v.parse().ok();
                    } else if let Some(v) = element(line, "Platform") {
                        platform = Some(xml_text(v));
                    }
                }
                "<GameAlternateName>" => {
                    if let Some(v) = element(line, "AlternateName") {
                        name = Some(xml_text(v));
                    } else if let Some(v) = element(line, "DatabaseID") {
                        id = v.parse().ok();
                    }
                }
                "<GameImage>" => {
                    if let Some(v) = element(line, "DatabaseID") {
                        id = v.parse().ok();
                    } else if let Some(v) = element(line, "FileName") {
                        file = Some(v.to_string());
                    } else if let Some(v) = element(line, "Type") {
                        kind = BOX_TYPES.iter().position(|t| *t == xml_text(v));
                    } else if let Some(v) = element(line, "Region") {
                        region = Some(xml_text(v));
                    }
                }
                _ => {}
            }
        }
    }
    tx.execute("INSERT INTO info (key, value) VALUES ('updated', strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))", [])?;
    tx.commit()?;
    conn.execute_batch("CREATE INDEX games_simple ON games (simple); CREATE INDEX alts_simple ON alts (simple); CREATE INDEX images_id ON images (id);")?;
    Ok(games)
}

/// Downloads LaunchBox's database to `cache` and indexes it, replacing an older index.
pub fn download(cache: &Path) -> AppResult<LaunchBoxStatus> {
    std::fs::create_dir_all(cache)?;
    let zip_path = cache.join("launchbox-metadata.zip");
    {
        let response = crate::online::http::send("LaunchBox", crate::online::http::get(LAUNCHBOX_ZIP)?, None)?;
        let mut file = std::fs::File::create(&zip_path)?;
        std::io::copy(&mut response.into_reader(), &mut file).map_err(|e| AppError::msg(format!("LaunchBox's database didn't download fully: {e}")))?;
    }
    let file = std::fs::File::open(&zip_path)?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| AppError::msg(format!("LaunchBox's database couldn't be opened: {e}")))?;
    let entry = archive.by_name("Metadata.xml").map_err(|_| AppError::msg("LaunchBox's database has no game list in it."))?;
    let building = cache.join("launchbox.db.building");
    index_from(entry, &building)?;
    let db = launchbox_db_path(cache);
    let _ = std::fs::remove_file(&db);
    std::fs::rename(&building, &db)?;
    let _ = std::fs::remove_file(&zip_path);
    status(cache).ok_or_else(|| AppError::msg("LaunchBox's index couldn't be read."))
}

pub fn launchbox_db_path(cache: &Path) -> PathBuf {
    cache.join("launchbox.db")
}

fn open(db: &Path) -> Option<Connection> {
    db.is_file().then(|| Connection::open_with_flags(db, OpenFlags::SQLITE_OPEN_READ_ONLY).ok()).flatten()
}

pub fn status(cache: &Path) -> Option<LaunchBoxStatus> {
    let conn = open(&launchbox_db_path(cache))?;
    let updated: String = conn.query_row("SELECT value FROM info WHERE key = 'updated'", [], |row| row.get(0)).optional().ok()??;
    let games: i64 = conn.query_row("SELECT count(*) FROM games", [], |row| row.get(0)).ok()?;
    Some(LaunchBoxStatus { updated, games })
}

/// LaunchBox's front boxes for a game by its name on one of `platforms` (any platform when empty):
/// (where from, address), the boxes first, North America's, the world's, then the others.
/// The names of the games LaunchBox finds by a name or one of their other names (D-147), on these
/// platforms: its own name for each, best known first.
pub fn launchbox_names(db: &Path, title: &str, platforms: &[&str]) -> Vec<String> {
    let Some(conn) = open(db) else { return Vec::new() };
    let wanted = simple(title);
    if wanted.len() < 2 {
        return Vec::new();
    }
    let Ok(mut stmt) = conn.prepare("SELECT name, platform FROM games WHERE id IN (SELECT id FROM games WHERE simple = ?1 UNION SELECT id FROM alts WHERE simple = ?1) ORDER BY id") else {
        return Vec::new();
    };
    let rows: Vec<(String, String)> = stmt.query_map([&wanted], |row| Ok((row.get(0)?, row.get(1)?))).map(|rows| rows.filter_map(Result::ok).collect()).unwrap_or_default();
    let mut out: Vec<String> = Vec::new();
    for (name, platform) in rows {
        if (platforms.is_empty() || platforms.contains(&platform.as_str())) && !out.contains(&name) {
            out.push(name);
        }
    }
    out
}

/// The order of a game's boxes: North America's, the world's, Europe's, the others, Japan's.
const REGION_RANK: &str = "CASE coalesce(region, '') WHEN 'North America' THEN 0 WHEN 'United States' THEN 0 WHEN 'World' THEN 1 WHEN '' THEN 1 WHEN 'Europe' THEN 2 WHEN 'United Kingdom' THEN 2 WHEN 'Japan' THEN 4 ELSE 3 END";

/// LaunchBox's games with any of the words in a name of theirs (their own or another) on these
/// platforms (any when empty), the ones with most of them first (D-148): a few front boxes of each,
/// labelled with the game's name.
pub fn launchbox_by_words(db: &Path, query: &str, platforms: &[&str], games: usize, per_game: usize) -> Vec<(String, String)> {
    let Some(conn) = open(db) else { return Vec::new() };
    let words = keywords(query);
    if words.is_empty() {
        return Vec::new();
    }
    let wanted = simple(query);
    let likes = vec!["simple LIKE ?"; words.len()].join(" OR ");
    let on = if platforms.is_empty() { String::new() } else { format!(" AND g.platform IN ({})", vec!["?"; platforms.len()].join(", ")) };
    let sql = format!(
        "SELECT g.id, g.name, (SELECT group_concat(simple, ' ') FROM alts a WHERE a.id = g.id) FROM games g \
         WHERE g.id IN (SELECT id FROM games WHERE {likes} UNION SELECT id FROM alts WHERE {likes}){on}"
    );
    let patterns: Vec<String> = words.iter().map(|w| format!("%{w}%")).collect();
    let values: Vec<String> = patterns.iter().chain(patterns.iter()).cloned().chain(platforms.iter().map(|p| p.to_string())).collect();
    let Ok(mut stmt) = conn.prepare(&sql) else { return Vec::new() };
    let rows: Vec<(i64, String, Option<String>)> = stmt
        .query_map(params_from_iter(values.iter()), |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
        .map(|rows| rows.filter_map(Result::ok).collect())
        .unwrap_or_default();
    let mut scored: Vec<((usize, usize, bool), usize, i64, String)> = rows
        .into_iter()
        .filter_map(|(id, name, alts)| {
            let mut best = word_score(&name, &words, &wanted);
            // Other names are kept joined up ("animalforest"): their words count as found anywhere,
            // and the very name as whole.
            for alt in alts.as_deref().unwrap_or_default().split(' ').filter(|a| !a.is_empty()) {
                let hits = words.iter().filter(|w| alt.contains(w.as_str())).count();
                let candidate = (hits > 0).then_some(if alt == wanted { (words.len(), hits, true) } else { (0, hits, false) });
                if candidate > best {
                    best = candidate;
                }
            }
            best.map(|score| (score, name.len(), id, name))
        })
        .collect();
    scored.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)));
    let Ok(mut boxes) = conn.prepare(&format!("SELECT file, region FROM images WHERE id = ?1 ORDER BY kind, {REGION_RANK} LIMIT ?2")) else { return Vec::new() };
    let mut out = Vec::new();
    for (.., id, name) in scored.into_iter().take(games) {
        let found: Vec<(String, Option<String>)> = boxes
            .query_map(params![id, per_game as i64], |row| Ok((row.get(0)?, row.get(1)?)))
            .map(|rows| rows.filter_map(Result::ok).collect())
            .unwrap_or_default();
        out.extend(found.into_iter().map(|(file, region)| (format!("LaunchBox · {name}{}", region.map(|r| format!(" · {r}")).unwrap_or_default()), format!("{LAUNCHBOX_IMAGES}{file}"))));
    }
    out
}

pub fn launchbox_covers(db: &Path, title: &str, platforms: &[&str], limit: usize) -> Vec<(String, String)> {
    let Some(conn) = open(db) else { return Vec::new() };
    let wanted = simple(title);
    if wanted.len() < 2 {
        return Vec::new();
    }
    let rank = "CASE coalesce(i.region, '') WHEN 'North America' THEN 0 WHEN 'United States' THEN 0 WHEN 'World' THEN 1 WHEN '' THEN 1 WHEN 'Europe' THEN 2 WHEN 'United Kingdom' THEN 2 WHEN 'Japan' THEN 4 ELSE 3 END";
    let sql = format!(
        "SELECT g.name, g.platform, i.file, i.region FROM games g JOIN images i ON i.id = g.id \
         WHERE g.id IN (SELECT id FROM games WHERE simple = ?1 UNION SELECT id FROM alts WHERE simple = ?1) \
         ORDER BY i.kind, {rank}, g.id LIMIT 60"
    );
    let Ok(mut stmt) = conn.prepare(&sql) else { return Vec::new() };
    let rows: Vec<(String, String, String, Option<String>)> = stmt
        .query_map([&wanted], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)))
        .map(|rows| rows.filter_map(Result::ok).collect())
        .unwrap_or_default();
    rows.into_iter()
        .filter(|(_, platform, _, _)| platforms.is_empty() || platforms.contains(&platform.as_str()))
        .take(limit)
        .map(|(_, platform, file, region)| (format!("LaunchBox · {}", region.unwrap_or(platform)), format!("{LAUNCHBOX_IMAGES}{file}")))
        .collect()
}

// ---------------------------------------------------------------------------------------------
// Nintendo eShop

/// Nintendo's store names for a console.
fn eshop_systems(platform: &str) -> &'static [&'static str] {
    match platform {
        "switch" => &["Nintendo Switch"],
        "3ds" => &["Nintendo 3DS", "New Nintendo 3DS"],
        "wiiu" => &["Wii U"],
        "wii" => &["Wii"],
        "ds" => &["Nintendo DS"],
        "n64" => &["Nintendo 64"],
        "nes" => &["NES"],
        "snes" => &["Super Nintendo Entertainment System", "SNES"],
        "gb" | "gbc" => &["Game Boy", "Game Boy Color"],
        "gba" => &["Game Boy Advance"],
        "gamecube" => &["Nintendo GameCube"],
        _ => &[],
    }
}

/// Nintendo's store art for a game by its name (square, 500 px), when it's one of Nintendo's.
pub fn eshop_covers(platform: &str, title: &str, limit: usize, loose: bool) -> Vec<(String, String)> {
    let systems = eshop_systems(platform);
    let name = super::sgdb::search_name(title);
    if systems.is_empty() || name.len() < 2 {
        return Vec::new();
    }
    let Ok(request) = crate::online::http::get("https://searching.nintendo-europe.com/en/select") else { return Vec::new() };
    let request = request.query("q", &name).query("fq", "type:GAME").query("rows", "12").query("wt", "json").query("fl", "title,system_names_txt,image_url,image_url_sq_s");
    let Ok(json) = crate::online::http::json("Nintendo eShop", request) else { return Vec::new() };
    let wanted = simple(&name);
    let words = keywords(&name);
    let docs = json.pointer("/response/docs").and_then(|d| d.as_array()).cloned().unwrap_or_default();
    let mut found: Vec<(bool, String, String)> = docs
        .iter()
        .filter_map(|doc| {
            let found_title = doc.get("title")?.as_str()?.to_string();
            let on_system = doc.get("system_names_txt")?.as_array()?.iter().filter_map(|s| s.as_str()).any(|s| systems.contains(&s));
            let image = doc.get("image_url_sq_s").or_else(|| doc.get("image_url")).and_then(|u| u.as_str())?.to_string();
            let close = simple(&found_title);
            let near = close == wanted || close.contains(&wanted) || wanted.contains(&close) || (loose && word_score(&found_title, &words, &wanted).is_some());
            (on_system && near).then_some((close == wanted, found_title, image))
        })
        .collect();
    found.sort_by_key(|(exact, _, _)| !exact);
    found.into_iter().take(limit).map(|(_, name, url)| (format!("Nintendo eShop · {name}"), url)).collect()
}

// ---------------------------------------------------------------------------------------------
// Microsoft Store

/// The Microsoft Store's box art for a game by its name: its vertical poster, else its square box
/// art, for the closest products.
pub fn msstore_covers(title: &str, limit: usize, loose: bool) -> Vec<(String, String)> {
    let name = super::sgdb::search_name(title);
    if name.len() < 2 {
        return Vec::new();
    }
    let Ok(request) = crate::online::http::get("https://displaycatalog.mp.microsoft.com/v7.0/productFamilies/autosuggest") else { return Vec::new() };
    let request = request.query("market", "US").query("languages", "en-us").query("query", &name).query("productFamilyNames", "Games");
    let Ok(json) = crate::online::http::json("the Microsoft Store", request) else { return Vec::new() };
    let wanted = simple(&name);
    let words = keywords(&name);
    let mut products: Vec<(bool, String, String)> = json
        .get("Results")
        .and_then(|r| r.as_array())
        .into_iter()
        .flatten()
        .flat_map(|family| family.get("Products").and_then(|p| p.as_array()).cloned().unwrap_or_default())
        // Games only: not their add-ons (skins, packs).
        .filter(|p| p.get("Type").and_then(|t| t.as_str()).is_none_or(|t| t == "Game"))
        .filter_map(|p| Some((p.get("ProductId")?.as_str()?.to_string(), p.get("Title")?.as_str()?.to_string())))
        .filter(|(_, t)| {
            let close = simple(t);
            close == wanted || close.contains(&wanted) || wanted.contains(&close) || (loose && word_score(t, &words, &wanted).is_some())
        })
        .map(|(id, t)| (simple(&t) == wanted, id, t))
        .collect();
    products.sort_by_key(|(exact, _, _)| !exact);
    products.truncate(3);
    if products.is_empty() {
        return Vec::new();
    }
    let ids: Vec<&str> = products.iter().map(|(_, id, _)| id.as_str()).collect();
    let Ok(request) = crate::online::http::get("https://displaycatalog.mp.microsoft.com/v7.0/products") else { return Vec::new() };
    let request = request.query("bigIds", &ids.join(",")).query("market", "US").query("languages", "en-us");
    let Ok(details) = crate::online::http::json("the Microsoft Store", request) else { return Vec::new() };
    let mut out = Vec::new();
    for product in details.get("Products").and_then(|p| p.as_array()).into_iter().flatten() {
        let Some(props) = product.pointer("/LocalizedProperties/0") else { continue };
        let title = props.get("ProductTitle").and_then(|t| t.as_str()).unwrap_or_default().to_string();
        let images = props.get("Images").and_then(|i| i.as_array()).cloned().unwrap_or_default();
        for purpose in ["Poster", "BoxArt"] {
            if let Some(uri) = images.iter().find(|i| i.get("ImagePurpose").and_then(|p| p.as_str()) == Some(purpose)).and_then(|i| i.get("Uri")?.as_str()) {
                let url = if uri.starts_with("//") { format!("https:{uri}") } else { uri.to_string() };
                out.push((format!("Microsoft Store · {title}"), url));
                break;
            }
        }
    }
    out.truncate(limit);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn launchbox_index_finds_front_boxes_by_name_and_platform() {
        let xml = r#"<?xml version="1.0" standalone="yes"?>
<LaunchBox>
  <Game>
    <Name>Super Mario 64</Name>
    <Overview>Mario's first 3D adventure.
<Name>not a name</Name> in an overview</Overview>
    <DatabaseID>10</DatabaseID>
    <Platform>Nintendo 64</Platform>
  </Game>
  <Game>
    <Name>Halo: Combat Evolved</Name>
    <DatabaseID>1</DatabaseID>
    <Platform>Microsoft Xbox</Platform>
  </Game>
  <GameAlternateName>
    <AlternateName>Halo CE</AlternateName>
    <DatabaseID>1</DatabaseID>
  </GameAlternateName>
  <GameImage>
    <DatabaseID>10</DatabaseID>
    <FileName>sm64-jp.jpg</FileName>
    <Type>Box - Front</Type>
    <Region>Japan</Region>
  </GameImage>
  <GameImage>
    <DatabaseID>10</DatabaseID>
    <FileName>sm64-na.jpg</FileName>
    <Type>Box - Front</Type>
    <Region>North America</Region>
  </GameImage>
  <GameImage>
    <DatabaseID>10</DatabaseID>
    <FileName>sm64-shot.jpg</FileName>
    <Type>Screenshot - Gameplay</Type>
  </GameImage>
  <GameImage>
    <DatabaseID>1</DatabaseID>
    <FileName>halo.jpg</FileName>
    <Type>Box - Front</Type>
  </GameImage>
</LaunchBox>"#;
        let dir = std::env::temp_dir().join(format!("digitify-launchbox-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let db = dir.join("launchbox.db");
        assert_eq!(index_from(xml.as_bytes(), &db).unwrap(), 2);
        let mario = launchbox_covers(&db, "Super Mario 64 (USA)", launchbox_platforms("n64"), 5);
        assert_eq!(mario.iter().map(|(_, u)| u.rsplit('/').next().unwrap()).collect::<Vec<_>>(), ["sm64-na.jpg", "sm64-jp.jpg"], "boxes only, North America first");
        assert!(launchbox_covers(&db, "Super Mario 64", launchbox_platforms("ds"), 5).is_empty(), "another platform's game isn't this one");
        assert_eq!(launchbox_covers(&db, "Halo CE", launchbox_platforms("ogxbox"), 5).len(), 1, "found by its other name");
        assert_eq!(launchbox_names(&db, "Halo CE (USA)", launchbox_platforms("ogxbox")), ["Halo: Combat Evolved"], "its own name, from another");
        assert!(launchbox_names(&db, "Halo CE", launchbox_platforms("n64")).is_empty());
        // D-148: by words, not the whole name.
        let mario = launchbox_by_words(&db, "mario adventure", launchbox_platforms("n64"), 6, 2);
        assert_eq!(mario.len(), 2, "two boxes of the one game with a word of it: {mario:?}");
        assert!(mario[0].0.starts_with("LaunchBox · Super Mario 64 · North America"), "{mario:?}");
        assert_eq!(launchbox_by_words(&db, "ce", launchbox_platforms("ogxbox"), 6, 2).len(), 0, "a word too short to tell");
        assert_eq!(launchbox_by_words(&db, "combat", &[], 6, 2).len(), 1, "any platform");
        let status = status(&dir).unwrap();
        assert_eq!(status.games, 2);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn names_by_their_words() {
        assert_eq!(keywords("The Legend of Zelda: Ocarina of Time (USA) [!]"), ["legend", "zelda", "ocarina", "time"]);
        assert_eq!(keywords("Super Mario 64"), ["super", "mario", "64"]);
        let names = ["Doubutsu no Mori (Japan)", "Animal Crossing (USA)", "Mario Kart 64 (USA)", "Mario Kart 64 (Europe)", "Animal Forest Plus (Japan)"];
        assert_eq!(best_by_words(names.iter().copied(), "animal forest", 3), ["Animal Forest Plus (Japan)", "Animal Crossing (USA)"], "both words first, then one");
        assert_eq!(best_by_words(names.iter().copied(), "kart", 1), ["Mario Kart 64 (USA)"], "the US box first");
        let mori = ["Armorines - Project S.W.A.R.M. (USA)", "Morita Shougi 64 (Japan)", "Doubutsu no Mori (Japan)"];
        assert_eq!(best_by_words(mori.iter().copied(), "mori", 1), ["Doubutsu no Mori (Japan)"], "a whole word before a part of one");
        assert!(best_by_words(names.iter().copied(), "zelda", 3).is_empty());
    }

    /// With LaunchBox's real database (DIGITIFY_LAUNCHBOX_ZIP): how long the index takes, what it finds.
    #[test]
    #[ignore]
    fn launchbox_real_database() {
        let Some(zip) = std::env::var_os("DIGITIFY_LAUNCHBOX_ZIP") else { return };
        let dir = std::env::temp_dir().join("digitify-launchbox-real");
        std::fs::create_dir_all(&dir).unwrap();
        let started = std::time::Instant::now();
        let mut archive = zip::ZipArchive::new(std::fs::File::open(zip).unwrap()).unwrap();
        let games = index_from(archive.by_name("Metadata.xml").unwrap(), &dir.join("launchbox.db")).unwrap();
        println!("indexed {games} games in {:?}, {} MB", started.elapsed(), std::fs::metadata(dir.join("launchbox.db")).unwrap().len() / 1_000_000);
        for (title, platform) in [("Super Mario 64 (USA)", "n64"), ("Halo: Combat Evolved", "ogxbox"), ("Shenmue", "dreamcast"), ("The Legend of Zelda: Breath of the Wild", "switch"), ("Hollow Knight", "pc")] {
            let started = std::time::Instant::now();
            let found = launchbox_covers(&dir.join("launchbox.db"), title, launchbox_platforms(platform), 3);
            println!("{title}: {found:?} in {:?}", started.elapsed());
        }
    }
}

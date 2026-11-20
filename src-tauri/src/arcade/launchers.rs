//! More PC launchers (D-112): Ubisoft Connect, the EA app, Battle.net and Amazon Games on Windows,
//! Lutris on Linux. Like the other stores (D-037), each is only read, from the records it keeps of
//! its installed games; a game starts the way its launcher starts it.
//!
//! - Ubisoft Connect: `HKLM\SOFTWARE\Ubisoft\Launcher\Installs\<id>` (`InstallDir`), named by its
//!   uninstall entry (`Uplay Install <id>`); started with `uplay://launch/<id>/0`.
//! - EA app: the games whose folder has EA's `__Installer\installerdata.xml` (from the uninstall
//!   entries, and EA's usual game folders), named by it; started by the program it names, which
//!   brings up the EA app as it needs.
//! - Battle.net: the uninstall entries Battle.net writes (`--uid=<game>`); started with
//!   `Battle.net.exe --exec="launch <code>"`, as Battle.net's own shortcuts do.
//! - Amazon Games: its `GameInstallInfo.sqlite`; started with `amazon-games://play/<id>`.
//! - Lutris: its `pga.db`; started with `lutris:rungameid/<id>`, with Lutris's own cover art.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use super::stores::{Store, StoreGame};

/// One key of `reg query … /s` output, with its values (names in lower case).
#[derive(Debug, Default, Clone)]
pub(crate) struct RegBlock {
    pub key: String,
    pub values: HashMap<String, String>,
}

impl RegBlock {
    pub fn get(&self, name: &str) -> Option<&str> {
        self.values.get(&name.to_lowercase()).map(|v| v.trim()).filter(|v| !v.is_empty())
    }

    /// The key's own name (its last part).
    pub fn leaf(&self) -> &str {
        self.key.rsplit('\\').next().unwrap_or(&self.key)
    }
}

/// The keys and values in `reg query … /s` output.
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn reg_blocks(text: &str) -> Vec<RegBlock> {
    let mut blocks: Vec<RegBlock> = Vec::new();
    for line in text.lines() {
        if line.starts_with("HKEY_") {
            blocks.push(RegBlock { key: line.trim().to_string(), values: HashMap::new() });
            continue;
        }
        let mut parts = line.trim().splitn(3, "    ");
        if let (Some(name), Some(kind), Some(value), Some(block)) = (parts.next(), parts.next(), parts.next(), blocks.last_mut()) {
            if kind.starts_with("REG_") {
                block.values.insert(name.trim().to_lowercase(), value.to_string());
            }
        }
    }
    blocks
}

#[cfg(windows)]
fn reg_query(key: &str, recursive: bool) -> String {
    let mut command = crate::tools::command(Path::new("reg"));
    command.args(["query", key]);
    if recursive {
        command.arg("/s");
    }
    command.output().map(|o| String::from_utf8_lossy(&o.stdout).into_owned()).unwrap_or_default()
}

/// Every program's uninstall entry (for this computer and this user).
#[cfg(windows)]
pub(crate) fn uninstall_entries() -> Vec<RegBlock> {
    [
        "HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
        "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
        "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
    ]
    .iter()
    .flat_map(|root| reg_blocks(&reg_query(root, true)))
    .collect()
}

/// A launcher's own folder, from its uninstall entry.
#[cfg_attr(not(windows), allow(dead_code))]
fn launcher_dir(uninstall: &[RegBlock], name: &str) -> Option<PathBuf> {
    uninstall.iter().find(|u| u.get("DisplayName").is_some_and(|n| n.eq_ignore_ascii_case(name))).and_then(|u| u.get("InstallLocation")).map(|p| PathBuf::from(p.trim_matches('"')))
}

fn exists(path: &Path) -> bool {
    cfg!(test) || path.exists()
}

// ---------------------------------------------------------------------------------------------
// Ubisoft Connect

/// Ubisoft Connect's installed games: `installs` are the blocks of its `Installs` key.
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn ubisoft_games(installs: &[RegBlock], uninstall: &[RegBlock]) -> Vec<StoreGame> {
    let mut games = Vec::new();
    for block in installs {
        let id = block.leaf();
        let Some(dir) = block.get("InstallDir") else { continue };
        if !id.chars().all(|c| c.is_ascii_digit()) {
            continue;
        }
        let install_dir = PathBuf::from(dir.replace('/', std::path::MAIN_SEPARATOR_STR).trim_end_matches(['\\', '/']));
        if !exists(&install_dir) {
            continue;
        }
        let entry = format!("Uplay Install {id}");
        let title = uninstall
            .iter()
            .find(|u| u.leaf().eq_ignore_ascii_case(&entry))
            .and_then(|u| u.get("DisplayName"))
            .map(str::to_string)
            .or_else(|| install_dir.file_name().map(|n| n.to_string_lossy().into_owned()))
            .unwrap_or_else(|| id.to_string());
        games.push(StoreGame { store: Store::Ubisoft, key: id.to_string(), title, install_dir, launch: format!("uplay://launch/{id}/0"), cover: None, cover_url: None });
    }
    games
}

#[cfg(windows)]
pub(crate) fn ubisoft(uninstall: &[RegBlock]) -> (Option<String>, Vec<StoreGame>) {
    let installs = reg_blocks(&reg_query("HKLM\\SOFTWARE\\WOW6432Node\\Ubisoft\\Launcher\\Installs", true));
    let games = ubisoft_games(&installs, uninstall);
    let launcher = launcher_dir(uninstall, "Ubisoft Connect").or_else(|| reg_blocks(&reg_query("HKLM\\SOFTWARE\\WOW6432Node\\Ubisoft\\Launcher", false)).first().and_then(|b| b.get("InstallDir")).map(PathBuf::from));
    let found = launcher.filter(|d| d.is_dir()).map(|d| d.display().to_string()).or_else(|| (!games.is_empty()).then(|| "Ubisoft Connect's games".to_string()));
    (found, games)
}

// ---------------------------------------------------------------------------------------------
// EA app

/// What a game's `__Installer\installerdata.xml` says: its name and the program that starts it.
#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct EaManifest {
    pub title: Option<String>,
    /// As written: `[HKEY_LOCAL_MACHINE\…\Install Dir]Game.exe`, or a path in the game's folder.
    pub launcher: Option<String>,
}

fn xml_text(text: &str) -> String {
    text.trim().replace("&amp;", "&").replace("&apos;", "'").replace("&quot;", "\"").replace("&lt;", "<").replace("&gt;", ">")
}

/// The text inside the first `<tag …>…</tag>` of `xml`.
fn xml_inner<'a>(xml: &'a str, tag: &str) -> Option<&'a str> {
    let start = xml.find(&format!("<{tag}"))?;
    let after = &xml[start..];
    let open = after.find('>')? + 1;
    let close = after.find(&format!("</{tag}>"))?;
    after.get(open..close)
}

pub(crate) fn ea_manifest(xml: &str) -> EaManifest {
    // The English name if there is one, else the first.
    let mut titles = Vec::new();
    let mut rest = xml;
    while let Some(at) = rest.find("<gameTitle") {
        rest = &rest[at..];
        let Some(end) = rest.find("</gameTitle>") else { break };
        let element = &rest[..end];
        if let Some(open) = element.find('>') {
            let english = element[..open].contains("en_US");
            titles.push((english, xml_text(&element[open + 1..])));
        }
        rest = &rest[end..];
    }
    let title = titles.iter().find(|(english, _)| *english).or(titles.first()).map(|(_, t)| t.clone()).filter(|t| !t.is_empty());
    // The first launcher that isn't a trial's.
    let mut launcher = None;
    let mut rest = xml;
    while let Some(at) = rest.find("<launcher") {
        rest = &rest[at..];
        let end = rest.find("</launcher>").unwrap_or(rest.len());
        let block = &rest[..end];
        let trial = xml_inner(block, "trial").is_some_and(|t| t.trim() == "1" || t.trim().eq_ignore_ascii_case("true"));
        if !trial {
            if let Some(path) = xml_inner(block, "filePath").map(xml_text).filter(|p| !p.is_empty()) {
                launcher = Some(path);
                break;
            }
        }
        rest = &rest[end.min(rest.len())..];
        if rest.len() <= "</launcher>".len() {
            break;
        }
        rest = &rest["</launcher>".len()..];
    }
    EaManifest { title, launcher }
}

/// The program a manifest names: `[<registry key>\<value>]rest` is that registry value's folder
/// plus the rest (the game's folder when the value isn't there); else a path in the game's folder.
pub(crate) fn ea_program(launcher: &str, game_dir: &Path, registry: impl Fn(&str, &str) -> Option<String>) -> PathBuf {
    if let Some((inside, rest)) = launcher.strip_prefix('[').and_then(|l| l.split_once(']')) {
        let base = inside.rsplit_once('\\').and_then(|(key, value)| registry(key, value)).map(PathBuf::from).unwrap_or_else(|| game_dir.to_path_buf());
        return base.join(rest.trim_start_matches(['\\', '/']));
    }
    game_dir.join(launcher.trim_start_matches(['\\', '/']))
}

/// The EA games in `dirs` (each game's folder, with its `__Installer\installerdata.xml`).
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn ea_games(dirs: &[(PathBuf, Option<String>)], registry: impl Fn(&str, &str) -> Option<String>) -> Vec<StoreGame> {
    let mut seen = HashSet::new();
    let mut games = Vec::new();
    for (dir, display_name) in dirs {
        let dir = PathBuf::from(dir.to_string_lossy().trim_end_matches(['\\', '/']));
        if !seen.insert(dir.to_string_lossy().to_lowercase()) {
            continue;
        }
        let Ok(xml) = std::fs::read_to_string(dir.join("__Installer").join("installerdata.xml")) else { continue };
        let manifest = ea_manifest(&xml);
        let Some(program) = manifest.launcher.as_deref().map(|l| ea_program(l, &dir, &registry)) else { continue };
        if !exists(&program) {
            continue;
        }
        let folder = dir.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        let title = manifest.title.or_else(|| display_name.clone()).unwrap_or_else(|| folder.clone());
        games.push(StoreGame { store: Store::Ea, key: folder, title, install_dir: dir.clone(), launch: format!("exe:{}", program.display()), cover: None, cover_url: None });
    }
    games
}

#[cfg(windows)]
pub(crate) fn ea(uninstall: &[RegBlock]) -> (Option<String>, Vec<StoreGame>) {
    let mut dirs: Vec<(PathBuf, Option<String>)> = uninstall
        .iter()
        .filter_map(|u| Some((PathBuf::from(u.get("InstallLocation")?.trim_matches('"')), u.get("DisplayName").map(str::to_string))))
        .filter(|(dir, _)| dir.join("__Installer").join("installerdata.xml").is_file())
        .collect();
    // EA's usual game folders, for games without an uninstall entry.
    let env = |name: &str| std::env::var_os(name).map(PathBuf::from);
    for root in [env("ProgramFiles").map(|p| p.join("EA Games")), env("ProgramFiles(x86)").map(|p| p.join("Origin Games"))].into_iter().flatten() {
        if let Ok(entries) = std::fs::read_dir(&root) {
            dirs.extend(entries.filter_map(Result::ok).map(|e| (e.path(), None)));
        }
    }
    let games = ea_games(&dirs, |key, value| {
        let key = key.replacen("HKEY_LOCAL_MACHINE", "HKLM", 1).replacen("HKEY_CURRENT_USER", "HKCU", 1);
        let wow = key.replacen("HKLM\\SOFTWARE\\", "HKLM\\SOFTWARE\\WOW6432Node\\", 1);
        [key, wow].iter().find_map(|k| {
            let output = crate::tools::command(Path::new("reg")).args(["query", k, "/v", value]).output().ok()?;
            reg_blocks(&String::from_utf8_lossy(&output.stdout)).first()?.get(value).map(str::to_string)
        })
    });
    let app = env("ProgramFiles").map(|p| p.join("Electronic Arts").join("EA Desktop").join("EA Desktop").join("EADesktop.exe")).filter(|p| p.is_file());
    let found = app.or_else(|| launcher_dir(uninstall, "EA app")).map(|p| p.display().to_string()).or_else(|| (!games.is_empty()).then(|| "EA games".to_string()));
    (found, games)
}

// ---------------------------------------------------------------------------------------------
// Battle.net

/// Battle.net's games: the start of the `--uid` its uninstall entries carry, and the product code
/// that starts the game (`Battle.net.exe --exec="launch <code>"`). Longer names first.
const BATTLE_NET: &[(&str, &str)] = &[
    ("wow_classic", "WoWC"),
    ("wow", "WoW"),
    ("diablo3", "D3"),
    ("fenris", "Fen"),
    ("osi", "OSI"),
    ("anbs", "ANBS"),
    ("d1", "D1"),
    ("prometheus", "Pro"),
    ("hs_beta", "WTCG"),
    ("heroes", "Hero"),
    ("s2", "S2"),
    ("s1", "S1"),
    ("w3", "W3"),
    ("w1r", "W1R"),
    ("w2r", "W2R"),
    ("w1", "W1"),
    ("w2", "W2"),
    ("viper", "VIPR"),
    ("odin", "ODIN"),
    ("lazarus", "LAZR"),
    ("zeus", "ZEUS"),
    ("fore", "FORE"),
    ("auks", "AUKS"),
    ("pinta", "PNTA"),
    ("wlby", "WLBY"),
    ("rtro", "RTRO"),
    ("gryphon", "GRY"),
    ("aris", "ARIS"),
    ("scorpio", "SCOR"),
    ("arkansas", "ARK"),
    ("libra", "LBRA"),
    ("aqua", "AQUA"),
];

/// A game's product code by its `--uid`.
pub(crate) fn battle_net_code(uid: &str) -> Option<&'static str> {
    let uid = uid.to_ascii_lowercase();
    BATTLE_NET.iter().find(|(prefix, _)| uid.starts_with(prefix)).map(|(_, code)| *code)
}

#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn battle_net_games(uninstall: &[RegBlock]) -> Vec<StoreGame> {
    let mut games = Vec::new();
    for entry in uninstall {
        let Some(uninstaller) = entry.get("UninstallString") else { continue };
        if !uninstaller.contains("Battle.net") {
            continue;
        }
        let Some(uid) = uninstaller.split("--uid=").nth(1).map(|u| u.split(|c: char| c.is_whitespace() || c == '"').next().unwrap_or("")) else { continue };
        let (Some(code), Some(title), Some(dir)) = (battle_net_code(uid), entry.get("DisplayName"), entry.get("InstallLocation")) else { continue };
        let install_dir = PathBuf::from(dir.trim_matches('"'));
        if !exists(&install_dir) || games.iter().any(|g: &StoreGame| g.key == code) {
            continue;
        }
        games.push(StoreGame { store: Store::BattleNet, key: code.to_string(), title: title.to_string(), install_dir, launch: format!("bnet:{code}"), cover: None, cover_url: None });
    }
    games
}

/// Battle.net's program.
#[cfg(windows)]
pub(crate) fn battle_net_client(uninstall: Option<&[RegBlock]>) -> Option<PathBuf> {
    let owned;
    let uninstall = match uninstall {
        Some(u) => u,
        None => {
            owned = uninstall_entries();
            &owned
        }
    };
    let env = |name: &str| std::env::var_os(name).map(PathBuf::from);
    launcher_dir(uninstall, "Battle.net")
        .map(|d| d.join("Battle.net.exe"))
        .into_iter()
        .chain(env("ProgramFiles(x86)").map(|p| p.join("Battle.net").join("Battle.net.exe")))
        .find(|p| p.is_file())
}

#[cfg(windows)]
pub(crate) fn battle_net(uninstall: &[RegBlock]) -> (Option<String>, Vec<StoreGame>) {
    let games = battle_net_games(uninstall);
    (battle_net_client(Some(uninstall)).map(|p| p.display().to_string()), games)
}

// ---------------------------------------------------------------------------------------------
// Rockstar Games Launcher (D-116)

/// Rockstar's games: the uninstall entry each one has, the key Arcade knows it by and its program
/// (started with `-launchTitleInFolder <folder>`, which hands it to the launcher).
const ROCKSTAR: &[(&str, &str, &str)] = &[
    ("{5EFC6C07-6B87-43FC-9524-F9E967241741}", "gta5", "PlayGTAV.exe"),
    ("Red Dead Redemption 2", "rdr2", "RDR2.exe"),
    ("Red Dead Redemption", "rdr", "RDR.exe"),
    ("Grand Theft Auto IV", "gta4", "GTAIV.exe"),
    ("{D417C96A-FCC7-4590-A1BB-FAF73F5BC98E}", "gtasa", "gta_sa.exe"),
    ("{92B94569-6683-4617-8C54-EB27A1B51B30}", "gta3", "gta3.exe"),
    ("{4B35F00C-E63D-40DC-9839-DF15A33EAC46}", "gtavc", "gta-vc.exe"),
    ("GTA III - Definitive Edition", "gta3unreal", "Gameface\\Binaries\\Win64\\LibertyCity.exe"),
    ("GTA Vice City - Definitive Edition", "gtavcunreal", "Gameface\\Binaries\\Win64\\ViceCity.exe"),
    ("GTA San Andreas - Definitive Edition", "gtasaunreal", "Gameface\\Binaries\\Win64\\SanAndreas.exe"),
    ("{915726DF-7891-444A-AA03-0DF1D64F561A}", "lanoire", "LANoire.exe"),
    ("{1AA94747-3BF6-4237-9E1A-7B3067738FE1}", "mp3", "MaxPayne3.exe"),
    ("{A724605D-B399-4304-B8C7-33B3EF7D4677}", "bully", "Bully.exe"),
];

/// The program that starts one of Rockstar's games, in its folder.
pub(crate) fn rockstar_program(key: &str, dir: &Path) -> Option<PathBuf> {
    ROCKSTAR.iter().find(|(_, k, _)| *k == key).map(|(_, _, exe)| dir.join(exe))
}

#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn rockstar_games(uninstall: &[RegBlock]) -> Vec<StoreGame> {
    let mut games = Vec::new();
    for (entry, key, exe) in ROCKSTAR {
        let Some(block) = uninstall.iter().find(|u| u.leaf().eq_ignore_ascii_case(entry)) else { continue };
        let (Some(title), Some(dir)) = (block.get("DisplayName"), block.get("InstallLocation")) else { continue };
        let install_dir = PathBuf::from(dir.trim_matches('"').trim_end_matches(['\\', '/']));
        if !exists(&install_dir.join(exe)) {
            continue;
        }
        games.push(StoreGame { store: Store::Rockstar, key: key.to_string(), title: title.to_string(), install_dir, launch: format!("rockstar:{key}"), cover: None, cover_url: None });
    }
    games
}

#[cfg(windows)]
pub(crate) fn rockstar(uninstall: &[RegBlock]) -> (Option<String>, Vec<StoreGame>) {
    let games = rockstar_games(uninstall);
    let launcher = uninstall.iter().find(|u| u.leaf().eq_ignore_ascii_case("Rockstar Games Launcher")).and_then(|u| u.get("InstallLocation")).map(|p| p.trim_matches('"').to_string());
    (launcher.or_else(|| (!games.is_empty()).then(|| "Rockstar's games".to_string())), games)
}

// ---------------------------------------------------------------------------------------------
// Riot Client (D-116)

/// Riot's games by their product name.
fn riot_title(product: &str) -> String {
    match product {
        "league_of_legends" => "League of Legends".to_string(),
        "valorant" => "VALORANT".to_string(),
        "bacon" => "Legends of Runeterra".to_string(),
        "lion" => "2XKO".to_string(),
        other => other.split('_').map(|w| w.chars().next().map(|c| c.to_uppercase().collect::<String>() + &w[c.len_utf8()..]).unwrap_or_default()).collect::<Vec<_>>().join(" "),
    }
}

/// Riot's installed games: each product's `<product>.<patchline>.product_settings.yaml` (in
/// `Metadata`) names its folder; started with the Riot Client's `--launch-product` and
/// `--launch-patchline`.
pub(crate) fn riot_games(metadata: &Path) -> Vec<StoreGame> {
    let mut games = Vec::new();
    let Ok(entries) = std::fs::read_dir(metadata) else { return games };
    for entry in entries.filter_map(Result::ok) {
        let name = entry.file_name().to_string_lossy().into_owned();
        let Some((product, patchline)) = name.split_once('.') else { continue };
        if product == "riot_client" {
            continue;
        }
        let settings = entry.path().join(format!("{name}.product_settings.yaml"));
        let Ok(text) = std::fs::read_to_string(&settings) else { continue };
        let Some(dir) = text.lines().find_map(|l| l.trim().strip_prefix("product_install_full_path:")).map(|v| v.trim().trim_matches('"').trim_matches('\'').to_string()) else { continue };
        let install_dir = PathBuf::from(dir.trim_end_matches(['\\', '/']));
        if !exists(&install_dir) {
            continue;
        }
        games.push(StoreGame {
            store: Store::Riot,
            key: name.clone(),
            title: riot_title(product),
            install_dir,
            launch: format!("riot:{product}:{patchline}"),
            cover: None,
            cover_url: None,
        });
    }
    games.sort_by(|a, b| a.key.cmp(&b.key));
    games
}

/// The Riot Client's program, from `RiotClientInstalls.json`.
#[cfg(windows)]
pub(crate) fn riot_client() -> Option<PathBuf> {
    let base = std::env::var_os("ProgramData").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("C:\\ProgramData")).join("Riot Games");
    let json: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(base.join("RiotClientInstalls.json")).ok()?).ok()?;
    ["rc_default", "rc_live"].iter().filter_map(|k| json.get(*k)?.as_str()).map(PathBuf::from).find(|p| p.is_file())
}

#[cfg(windows)]
pub(crate) fn riot() -> (Option<String>, Vec<StoreGame>) {
    let base = std::env::var_os("ProgramData").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("C:\\ProgramData")).join("Riot Games");
    let games = riot_games(&base.join("Metadata"));
    (riot_client().map(|p| p.display().to_string()).or_else(|| (!games.is_empty()).then(|| base.display().to_string())), games)
}

// ---------------------------------------------------------------------------------------------
// Amazon Games and Lutris: their own SQLite databases, opened read-only.

#[cfg_attr(not(windows), allow(dead_code))]
fn open_read_only(db: &Path) -> rusqlite::Result<rusqlite::Connection> {
    use rusqlite::OpenFlags;
    let flags = OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_URI | OpenFlags::SQLITE_OPEN_NO_MUTEX;
    let uri = format!("file:{}?mode=ro", db.display().to_string().replace('\\', "/").replace('?', "%3f").replace('#', "%23"));
    rusqlite::Connection::open_with_flags(&uri, flags)
}

/// Amazon Games' installed games, from its `GameInstallInfo.sqlite` (`DbSet`).
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn amazon_games(db: &Path) -> rusqlite::Result<Vec<StoreGame>> {
    let conn = open_read_only(db)?;
    let mut stmt = conn.prepare("SELECT Id, ProductTitle, InstallDirectory FROM DbSet WHERE Installed = 1")?;
    let rows: Vec<(String, String, String)> = stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?.collect::<Result<_, _>>()?;
    Ok(rows
        .into_iter()
        .map(|(id, title, dir)| (id, title, PathBuf::from(dir)))
        .filter(|(_, _, dir)| exists(dir))
        .map(|(id, title, install_dir)| StoreGame { store: Store::Amazon, launch: format!("amazon-games://play/{id}"), key: id, title, install_dir, cover: None, cover_url: None })
        .collect())
}

#[cfg(windows)]
pub(crate) fn amazon() -> (Option<String>, Vec<StoreGame>) {
    let Some(base) = std::env::var_os("LOCALAPPDATA").map(|p| PathBuf::from(p).join("Amazon Games")) else { return (None, Vec::new()) };
    let db = base.join("Data").join("Games").join("Sql").join("GameInstallInfo.sqlite");
    let games = if db.is_file() {
        amazon_games(&db).unwrap_or_else(|e| {
            log::warn!("arcade: couldn't read Amazon Games' games: {e}");
            Vec::new()
        })
    } else {
        Vec::new()
    };
    let app = base.join("App").join("Amazon Games.exe");
    let found = app.is_file().then(|| app.display().to_string()).or_else(|| (!games.is_empty()).then(|| base.display().to_string()));
    (found, games)
}

/// Lutris's installed games, from its `pga.db` (Steam's left to Steam), with its cover art when
/// it has some (`coverart/<slug>.jpg`, in `art` folders).
#[cfg_attr(windows, allow(dead_code))]
pub(crate) fn lutris_games(db: &Path, art: &[PathBuf]) -> rusqlite::Result<Vec<StoreGame>> {
    let conn = open_read_only(db)?;
    let mut stmt = conn.prepare("SELECT id, name, slug, coalesce(directory, ''), coalesce(runner, '') FROM games WHERE installed = 1")?;
    let rows: Vec<(i64, String, String, String, String)> = stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)))?.collect::<Result<_, _>>()?;
    Ok(rows
        .into_iter()
        .filter(|(_, _, _, _, runner)| runner != "steam")
        .map(|(id, name, slug, dir, _)| {
            let cover = art.iter().flat_map(|a| [a.join("coverart").join(format!("{slug}.jpg")), a.join("coverart").join(format!("{slug}.png"))]).find(|p| p.is_file());
            StoreGame { store: Store::Lutris, key: id.to_string(), title: name, install_dir: PathBuf::from(dir), launch: format!("lutris:rungameid/{id}"), cover, cover_url: None }
        })
        .collect())
}

#[cfg(not(windows))]
pub(crate) fn lutris() -> (Option<String>, Vec<StoreGame>) {
    let home = std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default();
    let data = std::env::var_os("XDG_DATA_HOME").map(PathBuf::from).unwrap_or_else(|| home.join(".local/share"));
    let cache = std::env::var_os("XDG_CACHE_HOME").map(PathBuf::from).unwrap_or_else(|| home.join(".cache"));
    let places = [(data.join("lutris"), cache.join("lutris")), (home.join(".var/app/net.lutris.Lutris/data/lutris"), home.join(".var/app/net.lutris.Lutris/cache/lutris"))];
    for (base, cache) in places {
        let db = base.join("pga.db");
        if db.is_file() {
            let games = lutris_games(&db, &[base.clone(), cache]).unwrap_or_else(|e| {
                log::warn!("arcade: couldn't read Lutris's games: {e}");
                Vec::new()
            });
            return (Some(base.display().to_string()), games);
        }
    }
    (None, Vec::new())
}

/// The folders whose changes mean a game was installed or removed (D-037's watch).
pub(crate) fn watched_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    #[cfg(windows)]
    {
        dirs.extend(std::env::var_os("LOCALAPPDATA").map(|p| PathBuf::from(p).join("Amazon Games").join("Data").join("Games").join("Sql")));
        dirs.push(PathBuf::from("C:\\ProgramData\\Battle.net\\Agent"));
    }
    #[cfg(not(windows))]
    {
        let home = std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default();
        dirs.push(std::env::var_os("XDG_DATA_HOME").map(PathBuf::from).unwrap_or_else(|| home.join(".local/share")).join("lutris"));
    }
    dirs
}

#[cfg(test)]
mod tests {
    use super::*;

    const UNINSTALL: &str = "
HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Uplay Install 5059
    DisplayName    REG_SZ    Assassin's Creed Odyssey
    InstallLocation    REG_SZ    D:\\Ubisoft\\ACO\\

HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Diablo IV
    DisplayName    REG_SZ    Diablo IV
    InstallLocation    REG_SZ    C:\\Program Files (x86)\\Diablo IV
    UninstallString    REG_SZ    \"C:\\ProgramData\\Battle.net\\Agent\\Blizzard Uninstaller.exe\" --lang=enUS --uid=fenris --displayname=\"Diablo IV\"

HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Unknown Blizzard
    DisplayName    REG_SZ    Something New
    InstallLocation    REG_SZ    C:\\Games\\New
    UninstallString    REG_SZ    \"C:\\ProgramData\\Battle.net\\Agent\\Blizzard Uninstaller.exe\" --uid=zzz_new
";

    #[test]
    fn ubisoft_and_battle_net_from_the_registry() {
        let uninstall = reg_blocks(UNINSTALL);
        assert_eq!(uninstall.len(), 3);
        let installs = reg_blocks(
            "\nHKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Ubisoft\\Launcher\\Installs\n\nHKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Ubisoft\\Launcher\\Installs\\5059\n    InstallDir    REG_SZ    D:/Ubisoft/ACO/\n\nHKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Ubisoft\\Launcher\\Installs\\720\n    InstallDir    REG_SZ    D:/Ubisoft/Rayman Legends/\n",
        );
        let ubisoft = ubisoft_games(&installs, &uninstall);
        assert_eq!(ubisoft.iter().map(|g| (g.title.as_str(), g.launch.as_str())).collect::<Vec<_>>(), [("Assassin's Creed Odyssey", "uplay://launch/5059/0"), ("Rayman Legends", "uplay://launch/720/0")]);
        let blizzard = battle_net_games(&uninstall);
        assert_eq!(blizzard.len(), 1, "an unknown game is left out");
        assert_eq!((blizzard[0].title.as_str(), blizzard[0].launch.as_str()), ("Diablo IV", "bnet:Fen"));
        assert_eq!(battle_net_code("wow_classic_era"), Some("WoWC"));
        assert_eq!(battle_net_code("w1r"), Some("W1R"));
    }

    #[test]
    fn ea_games_from_their_installer_data() {
        let xml = r#"<?xml version="1.0"?><DiPManifest><gameTitles><gameTitle locale="fr_FR">Titanfall® 2 FR</gameTitle><gameTitle locale="en_US">Titanfall® 2 &amp; More</gameTitle></gameTitles>
<runtime><launcher><filePath>[HKEY_LOCAL_MACHINE\SOFTWARE\Respawn\Titanfall2\Install Dir]Titanfall2_trial.exe</filePath><trial>1</trial></launcher>
<launcher><filePath>[HKEY_LOCAL_MACHINE\SOFTWARE\Respawn\Titanfall2\Install Dir]Titanfall2.exe</filePath><trial>0</trial></launcher></runtime></DiPManifest>"#;
        let manifest = ea_manifest(xml);
        assert_eq!(manifest.title.as_deref(), Some("Titanfall® 2 & More"));
        assert_eq!(manifest.launcher.as_deref(), Some(r"[HKEY_LOCAL_MACHINE\SOFTWARE\Respawn\Titanfall2\Install Dir]Titanfall2.exe"));
        let dir = Path::new("/games/Titanfall2");
        let from_registry = ea_program(manifest.launcher.as_deref().unwrap(), dir, |key, value| (key.ends_with("Titanfall2") && value == "Install Dir").then(|| "/elsewhere/TF2".to_string()));
        assert_eq!(from_registry, Path::new("/elsewhere/TF2").join("Titanfall2.exe"));
        assert_eq!(ea_program(manifest.launcher.as_deref().unwrap(), dir, |_, _| None), dir.join("Titanfall2.exe"));
        assert_eq!(ea_program("bin/game.exe", dir, |_, _| None), dir.join("bin/game.exe"));
    }

    #[test]
    fn amazon_and_lutris_from_their_databases() {
        let dir = std::env::temp_dir().join(format!("digitify-launchers-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("coverart")).unwrap();
        let amazon = dir.join("GameInstallInfo.sqlite");
        {
            let conn = rusqlite::Connection::open(&amazon).unwrap();
            conn.execute_batch("CREATE TABLE DbSet (Id TEXT, ProductTitle TEXT, InstallDirectory TEXT, Installed INTEGER); INSERT INTO DbSet VALUES ('amzn1.x', 'Fallout 3', 'C:/Amazon/Fallout 3', 1), ('amzn1.y', 'Gone', 'C:/Amazon/Gone', 0);").unwrap();
        }
        let games = amazon_games(&amazon).unwrap();
        assert_eq!(games.iter().map(|g| (g.title.as_str(), g.launch.as_str())).collect::<Vec<_>>(), [("Fallout 3", "amazon-games://play/amzn1.x")]);
        let lutris = dir.join("pga.db");
        {
            let conn = rusqlite::Connection::open(&lutris).unwrap();
            conn.execute_batch("CREATE TABLE games (id INTEGER, name TEXT, slug TEXT, directory TEXT, runner TEXT, installed INTEGER); INSERT INTO games VALUES (3, 'Overwatch 2', 'overwatch-2', '/games/ow', 'wine', 1), (4, 'Dota 2', 'dota-2', '', 'steam', 1), (5, 'Old', 'old', '', 'wine', 0);").unwrap();
        }
        std::fs::write(dir.join("coverart").join("overwatch-2.jpg"), b"jpg").unwrap();
        let games = lutris_games(&lutris, &[dir.clone()]).unwrap();
        assert_eq!(games.len(), 1, "Steam's games stay Steam's, and only installed ones count");
        assert_eq!((games[0].title.as_str(), games[0].launch.as_str()), ("Overwatch 2", "lutris:rungameid/3"));
        assert_eq!(games[0].cover.as_deref(), Some(dir.join("coverart").join("overwatch-2.jpg").as_path()));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rockstar_and_riot_games() {
        let uninstall = reg_blocks(
            "\nHKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{5EFC6C07-6B87-43FC-9524-F9E967241741}\n    DisplayName    REG_SZ    Grand Theft Auto V\n    InstallLocation    REG_SZ    \"D:\\Rockstar\\GTAV\"\n\nHKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Red Dead Redemption 2\n    DisplayName    REG_SZ    Red Dead Redemption 2\n    InstallLocation    REG_SZ    D:\\Rockstar\\RDR2\\\n",
        );
        let games = rockstar_games(&uninstall);
        assert_eq!(games.iter().map(|g| (g.title.as_str(), g.launch.as_str())).collect::<Vec<_>>(), [("Grand Theft Auto V", "rockstar:gta5"), ("Red Dead Redemption 2", "rockstar:rdr2")]);
        assert_eq!(rockstar_program("rdr2", &games[1].install_dir), Some(PathBuf::from("D:\\Rockstar\\RDR2").join("RDR2.exe")));
        // Riot: each product's settings name its folder; the client itself isn't a game.
        let dir = std::env::temp_dir().join(format!("digitify-riot-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        for (name, path) in [("valorant.live", "C:/Riot Games/VALORANT/live"), ("league_of_legends.live", "C:/Riot Games/League of Legends"), ("riot_client.live", "C:/Riot Games/Riot Client")] {
            std::fs::create_dir_all(dir.join(name)).unwrap();
            std::fs::write(dir.join(name).join(format!("{name}.product_settings.yaml")), format!("product_install_full_path: \"{path}\"\nproduct_install_root: \"C:/Riot Games\"\n")).unwrap();
        }
        let riot = riot_games(&dir);
        assert_eq!(riot.iter().map(|g| (g.title.as_str(), g.launch.as_str())).collect::<Vec<_>>(), [("League of Legends", "riot:league_of_legends:live"), ("VALORANT", "riot:valorant:live")]);
        assert_eq!(riot_title("new_game"), "New Game");
        let _ = std::fs::remove_dir_all(&dir);
    }
}

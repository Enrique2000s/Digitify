//! Minecraft (D-153): its own launcher in Arcade, only read like the other stores (D-037).
//!
//! - **Minecraft: Java Edition** through Mojang's Minecraft Launcher: the Microsoft Store's or the
//!   Xbox app's (package `Microsoft.4297127D64EC6`, started as an app), the older installer's
//!   (`MinecraftLauncher.exe`), or on Linux `minecraft-launcher` or its Flatpak. The launcher opens;
//!   playing is pressing Play there, as always.
//! - **Minecraft for Windows** (Bedrock), the Microsoft Store's or the Xbox app's (package
//!   `Microsoft.MinecraftUWP`), started as an app.
//! - Each instance of **Prism Launcher** and **MultiMC**, which start it directly (`--launch <id>`).
//!
//! Its time played counts while the game's Java (or Bedrock) runs from the folder it plays from.

use std::path::{Path, PathBuf};

use super::stores::{Store, StoreGame};

/// The Minecraft Launcher's package family (the Microsoft Store and the Xbox app).
#[cfg_attr(not(windows), allow(dead_code))] // Windows only, and in the tests
pub const LAUNCHER_FAMILY: &str = "Microsoft.4297127D64EC6_8wekyb3d8bbwe";
/// Minecraft for Windows' (Bedrock's) package family.
#[cfg_attr(not(windows), allow(dead_code))] // Windows only, and in the tests
pub const BEDROCK_FAMILY: &str = "Microsoft.MinecraftUWP_8wekyb3d8bbwe";

/// Whether a package family is Minecraft's (the Xbox app writes some in capitals).
#[cfg(windows)]
pub fn is_minecraft_family(family: &str) -> bool {
    family.eq_ignore_ascii_case(LAUNCHER_FAMILY) || family.eq_ignore_ascii_case(BEDROCK_FAMILY)
}

pub const JAVA_TITLE: &str = "Minecraft: Java Edition";
pub const BEDROCK_TITLE: &str = "Minecraft for Windows";

/// How a Prism Launcher or MultiMC instance starts: its launcher's program (or Flatpak) and the
/// instance's id. Kept in the game's launch text as `minecraft:<json>`.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Start {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exe: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub flatpak: Option<String>,
    pub instance: String,
}

impl Start {
    pub fn launch_text(&self) -> String {
        format!("minecraft:{}", serde_json::to_string(self).unwrap_or_default())
    }

    pub fn parse(text: &str) -> Option<Self> {
        serde_json::from_str(text).ok()
    }

    /// The command that starts the instance, or why it can't.
    pub fn command(&self) -> Result<std::process::Command, String> {
        // The official launcher's Flatpak has no instance: it just opens.
        let launch: Vec<&str> = if self.instance.is_empty() { Vec::new() } else { vec!["--launch", &self.instance] };
        if let Some(id) = &self.flatpak {
            let mut command = crate::tools::host_command("flatpak");
            command.args(["run", id]).args(&launch);
            return Ok(command);
        }
        let exe = self.exe.as_deref().map(Path::new).filter(|p| p.is_file()).ok_or_else(|| "The launcher of that Minecraft instance isn't there anymore. Was it moved or uninstalled?".to_string())?;
        let mut command = crate::tools::host_command(exe);
        command.args(&launch);
        if let Some(dir) = exe.parent() {
            command.current_dir(dir);
        }
        Ok(command)
    }
}

/// Everything Minecraft on this computer: what was found (for Emulators & folders) and its games.
pub fn scan(#[cfg(windows)] uninstall: &[super::launchers::RegBlock]) -> (Option<String>, Vec<StoreGame>) {
    let mut found: Vec<&str> = Vec::new();
    let mut games: Vec<StoreGame> = Vec::new();
    #[cfg(windows)]
    let official = official_windows(uninstall);
    #[cfg(not(windows))]
    let official = official_linux();
    if let Some(game) = official {
        found.push("Minecraft Launcher");
        games.push(game);
    }
    #[cfg(windows)]
    if let Some(game) = bedrock() {
        found.push("Minecraft for Windows");
        games.push(game);
    }
    #[cfg(windows)]
    let prism = prism_windows(uninstall);
    #[cfg(not(windows))]
    let prism = prism_linux();
    if let Some((data, start)) = prism {
        found.push("Prism Launcher");
        games.extend(instances(&data, "prismlauncher.cfg", "prism", &start));
    }
    if let Some((data, start)) = multimc() {
        found.push("MultiMC");
        games.extend(instances(&data, "multimc.cfg", "multimc", &start));
    }
    ((!found.is_empty()).then(|| found.join(", ")), games)
}

// ---------------------------------------------------------------------------------------------
// The Minecraft Launcher and Bedrock (Windows): installed packages, from the registry.

/// An installed package of `family`: its folder and the app id its manifest names (`fallback_app`
/// when it can't be read). A package whose files aren't there (half uninstalled) isn't one.
#[cfg(windows)]
fn package(family: &str, fallback_app: &str) -> Option<(PathBuf, String)> {
    const REPOSITORY: &str = "HKCU\\Software\\Classes\\Local Settings\\Software\\Microsoft\\Windows\\CurrentVersion\\AppModel\\Repository\\Packages";
    let blocks = super::launchers::reg_blocks(&super::registry::query(REPOSITORY, true));
    blocks.iter().filter(|b| package_matches(b.leaf(), family)).find_map(|block| {
        let root = PathBuf::from(block.get("PackageRootFolder")?);
        let manifest = ["AppxManifest.xml", "appxmanifest.xml"].iter().map(|m| root.join(m)).find(|m| m.is_file())?;
        let app = std::fs::read_to_string(manifest).ok().and_then(|text| manifest_app(&text)).unwrap_or_else(|| fallback_app.to_string());
        Some((root, app))
    })
}

/// Whether a package's full name (`Name_Version_Arch_ResourceId_PublisherId`) is of `family`
/// (`Name_PublisherId`) and is the app itself, not one of its resource packs.
#[cfg_attr(not(windows), allow(dead_code))] // Windows only, and in the tests
pub(crate) fn package_matches(full_name: &str, family: &str) -> bool {
    let Some((name, publisher)) = family.split_once('_') else { return false };
    let parts: Vec<&str> = full_name.split('_').collect();
    parts.len() == 5 && parts[0].eq_ignore_ascii_case(name) && parts[4].eq_ignore_ascii_case(publisher) && parts[3].is_empty() && parts[2] != "neutral"
}

/// The first app id in a package manifest.
#[cfg_attr(not(windows), allow(dead_code))] // Windows only, and in the tests
pub(crate) fn manifest_app(text: &str) -> Option<String> {
    let doc = roxmltree::Document::parse(text).ok()?;
    doc.descendants().find(|n| n.has_tag_name("Application")).and_then(|n| n.attribute("Id")).map(str::to_string)
}

/// A package's square logo, for when no cover is found online.
#[cfg(windows)]
fn package_logo(root: &Path) -> Option<PathBuf> {
    ["GraphicsLogo.png", "Square150x150Logo.png", "StoreLogo.png"].iter().map(|f| root.join(f)).find(|p| p.is_file())
}

#[cfg(windows)]
fn official_windows(uninstall: &[super::launchers::RegBlock]) -> Option<StoreGame> {
    let local = std::env::var_os("LOCALAPPDATA").map(PathBuf::from);
    // Java runs from the package's own data (the Microsoft Store's and the Xbox app's launcher).
    let data = local.map(|l| l.join("Packages").join(LAUNCHER_FAMILY)).filter(|d| d.is_dir());
    // The Xbox app's, in its game folders.
    if let Some(game) = super::stores::xbox_package(LAUNCHER_FAMILY) {
        return Some(java_game(data.unwrap_or_else(|| game.install_dir.clone()), game.launch, game.cover));
    }
    // The Microsoft Store's.
    if let Some((root, app)) = package(LAUNCHER_FAMILY, "Minecraft") {
        return Some(java_game(data.unwrap_or_else(|| root.clone()), format!("shell:AppsFolder\\{LAUNCHER_FAMILY}!{app}"), package_logo(&root)));
    }
    // The older installer's: Java runs from the launcher's own folder.
    let named = uninstall
        .iter()
        .find(|u| u.get("DisplayName").is_some_and(|n| n.eq_ignore_ascii_case("Minecraft Launcher")))
        .and_then(|u| u.get("InstallLocation"))
        .map(|p| PathBuf::from(p.trim_matches('"')));
    let x86 = std::env::var_os("ProgramFiles(x86)").map(|p| PathBuf::from(p).join("Minecraft Launcher"));
    let program = [named, x86].into_iter().flatten().map(|dir| dir.join("MinecraftLauncher.exe")).find(|p| p.is_file())?;
    let dir = program.parent()?.to_path_buf();
    Some(java_game(dir, format!("exe:{}", program.display()), None))
}

#[cfg(not(windows))]
fn official_linux() -> Option<StoreGame> {
    let home = home();
    if let Some(program) = crate::tools::find_on_path("minecraft-launcher") {
        return Some(java_game(home.join(".minecraft"), format!("exe:{}", program.display()), None));
    }
    let id = "com.mojang.Minecraft";
    flatpak_installed(id).then(|| java_game(home.join(".var/app").join(id).join(".minecraft"), Start { exe: None, flatpak: Some(id.into()), instance: String::new() }.launch_text(), None))
}

fn java_game(install_dir: PathBuf, launch: String, cover: Option<PathBuf>) -> StoreGame {
    StoreGame { store: Store::Minecraft, key: "java".into(), title: JAVA_TITLE.into(), install_dir, launch, cover, cover_url: None }
}

#[cfg(windows)]
fn bedrock() -> Option<StoreGame> {
    // The Xbox app's (Bedrock is installed there now), else the Microsoft Store's.
    if let Some(game) = super::stores::xbox_package(BEDROCK_FAMILY) {
        return Some(StoreGame { store: Store::Minecraft, key: "bedrock".into(), title: BEDROCK_TITLE.into(), ..game });
    }
    let (root, app) = package(BEDROCK_FAMILY, "App")?;
    Some(StoreGame {
        store: Store::Minecraft,
        key: "bedrock".into(),
        title: BEDROCK_TITLE.into(),
        launch: format!("shell:AppsFolder\\{BEDROCK_FAMILY}!{app}"),
        cover: package_logo(&root),
        install_dir: root,
        cover_url: None,
    })
}

// ---------------------------------------------------------------------------------------------
// Prism Launcher and MultiMC: their instances.

/// Prism Launcher on Windows: installed (its uninstall entry, its usual folder, Scoop), with its
/// data in `%APPDATA%\PrismLauncher`, or portable beside its program.
#[cfg(windows)]
fn prism_windows(uninstall: &[super::launchers::RegBlock]) -> Option<(PathBuf, Start)> {
    let env = |name: &str| std::env::var_os(name).map(PathBuf::from);
    let named = uninstall
        .iter()
        .find(|u| u.get("DisplayName").is_some_and(|n| n.to_ascii_lowercase().starts_with("prism launcher")))
        .and_then(|u| u.get("InstallLocation"))
        .map(|p| PathBuf::from(p.trim_matches('"')));
    let dirs = [
        named,
        env("LOCALAPPDATA").map(|p| p.join("Programs").join("PrismLauncher")),
        env("ProgramFiles").map(|p| p.join("PrismLauncher")),
        env("USERPROFILE").map(|p| p.join("scoop").join("apps").join("prismlauncher").join("current")),
    ];
    let program = dirs.into_iter().flatten().map(|d| d.join("prismlauncher.exe")).find(|p| p.is_file())?;
    let beside = program.parent()?.to_path_buf();
    let data = if beside.join("portable.txt").is_file() { beside } else { env("APPDATA")?.join("PrismLauncher") };
    data.is_dir().then(|| (data, Start { exe: Some(program.display().to_string()), flatpak: None, instance: String::new() }))
}

#[cfg(not(windows))]
fn prism_linux() -> Option<(PathBuf, Start)> {
    let home = home();
    if let Some(program) = crate::tools::find_on_path("prismlauncher") {
        let data = home.join(".local/share/PrismLauncher");
        return data.is_dir().then(|| (data, Start { exe: Some(program.display().to_string()), flatpak: None, instance: String::new() }));
    }
    let id = "org.prismlauncher.PrismLauncher";
    let data = home.join(".var/app").join(id).join("data/PrismLauncher");
    (flatpak_installed(id) && data.is_dir()).then(|| (data, Start { exe: None, flatpak: Some(id.into()), instance: String::new() }))
}

/// MultiMC: portable, in a `MultiMC` folder in one of the usual places (Windows), or installed by
/// its package in `~/.local/share/multimc` (Linux); its data is beside its program.
fn multimc() -> Option<(PathBuf, Start)> {
    #[cfg(windows)]
    let (program, data) = {
        let env = |name: &str| std::env::var_os(name).map(PathBuf::from);
        let mut places: Vec<PathBuf> = Vec::new();
        if let Some(profile) = env("USERPROFILE") {
            places.extend(["Desktop", "Documents", "Downloads", "Games"].iter().map(|d| profile.join(d)));
        }
        places.extend(env("LOCALAPPDATA").map(|p| p.join("Programs")));
        places.extend(env("ProgramFiles"));
        places.extend(["C:\\", "C:\\Games"].iter().map(PathBuf::from));
        let program = places.iter().map(|p| p.join("MultiMC").join("MultiMC.exe")).find(|p| p.is_file())?;
        let data = program.parent()?.to_path_buf();
        (program, data)
    };
    #[cfg(not(windows))]
    let (program, data) = {
        let data = home().join(".local/share/multimc");
        let program = ["MultiMC", "multimc"].iter().map(|n| data.join(n)).find(|p| p.is_file()).or_else(|| crate::tools::find_on_path("multimc"))?;
        (program, data)
    };
    data.is_dir().then(|| (data, Start { exe: Some(program.display().to_string()), flatpak: None, instance: String::new() }))
}

/// A launcher's instances, each a game: in the folder its settings name (`InstanceDir`, by default
/// `instances` in its data), each with an `instance.cfg` that names it.
fn instances(data: &Path, config: &str, kind: &str, start: &Start) -> Vec<StoreGame> {
    let dir = instances_dir(data, config);
    let Ok(entries) = std::fs::read_dir(&dir) else { return Vec::new() };
    let mut games: Vec<StoreGame> = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let folder = entry.path();
            let text = std::fs::read_to_string(folder.join("instance.cfg")).ok()?;
            let id = entry.file_name().to_string_lossy().into_owned();
            let name = ini_value(&text, "name").unwrap_or_else(|| id.clone());
            let start = Start { instance: id.clone(), ..start.clone() };
            Some(StoreGame { store: Store::Minecraft, key: format!("{kind}:{id}"), title: instance_title(&name), install_dir: folder, launch: start.launch_text(), cover: None, cover_url: None })
        })
        .collect();
    games.sort_by(|a, b| a.title.cmp(&b.title));
    games
}

/// Where Prism Launcher keeps its instances, in its usual data folders: watched, so an instance
/// made or deleted shows in Arcade by itself.
pub fn watched_dirs() -> Vec<PathBuf> {
    #[cfg(windows)]
    let data = std::env::var_os("APPDATA").map(|p| vec![PathBuf::from(p).join("PrismLauncher")]).unwrap_or_default();
    #[cfg(not(windows))]
    let data = vec![home().join(".local/share/PrismLauncher"), home().join(".var/app/org.prismlauncher.PrismLauncher/data/PrismLauncher")];
    data.into_iter().filter(|d| d.is_dir()).map(|d| instances_dir(&d, "prismlauncher.cfg")).collect()
}

fn instances_dir(data: &Path, config: &str) -> PathBuf {
    let dir = std::fs::read_to_string(data.join(config)).ok().and_then(|text| ini_value(&text, "InstanceDir")).unwrap_or_else(|| "instances".into());
    if Path::new(&dir).is_absolute() {
        PathBuf::from(dir)
    } else {
        data.join(dir)
    }
}

/// An instance's name as a game's: "Minecraft: Fabulously Optimized" (unless it says Minecraft).
pub(crate) fn instance_title(name: &str) -> String {
    let name = name.trim();
    if name.to_lowercase().contains("minecraft") {
        name.to_string()
    } else {
        format!("Minecraft: {name}")
    }
}

/// A value from an INI-style file (`key=value`, any section).
pub(crate) fn ini_value(text: &str, key: &str) -> Option<String> {
    text.lines().find_map(|line| {
        let (k, v) = line.split_once('=')?;
        (k.trim().eq_ignore_ascii_case(key)).then(|| v.trim().to_string()).filter(|v| !v.is_empty())
    })
}

/// The name its cover is looked for by: the instances are Java Edition.
pub fn cover_title(key: &str) -> &'static str {
    if key == "bedrock" {
        BEDROCK_TITLE
    } else {
        JAVA_TITLE
    }
}

#[cfg(not(windows))]
use super::detect::{flatpak_installed, home};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn packages_are_told_from_their_resource_packs() {
        assert!(package_matches("Microsoft.4297127D64EC6_2.6.2.0_x64__8wekyb3d8bbwe", LAUNCHER_FAMILY));
        assert!(package_matches("Microsoft.MinecraftUWP_1.26.6501.0_x64__8wekyb3d8bbwe", BEDROCK_FAMILY));
        assert!(!package_matches("Microsoft.MinecraftUWP_1.26.6501.0_neutral_split.scale-100_8wekyb3d8bbwe", BEDROCK_FAMILY));
        assert!(!package_matches("Microsoft.MinecraftUWP_1.0.0.0_x64__8wekyb3d8bbwe", LAUNCHER_FAMILY));
        assert_eq!(manifest_app(r#"<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"><Applications><Application Id="Minecraft" Executable="GameLaunchHelper.exe"/></Applications></Package>"#).as_deref(), Some("Minecraft"));
    }

    #[test]
    fn instances_are_read_with_their_names() {
        let root = std::env::temp_dir().join(format!("digitify-mc-{}", std::process::id()));
        let data = root.join("PrismLauncher");
        let custom = root.join("elsewhere");
        for (dir, cfg) in [("Fabulously Optimized", "[General]\nInstanceType=OneSix\nname=Fabulously Optimized\n"), ("1.21.4", "InstanceType=OneSix\nname=Minecraft 1.21.4\n"), ("broken", "")] {
            std::fs::create_dir_all(custom.join(dir)).unwrap();
            if !cfg.is_empty() {
                std::fs::write(custom.join(dir).join("instance.cfg"), cfg).unwrap();
            }
        }
        std::fs::create_dir_all(&data).unwrap();
        std::fs::write(data.join("prismlauncher.cfg"), format!("[General]\nInstanceDir={}\n", custom.display())).unwrap();
        let start = Start { exe: Some("C:\\Prism\\prismlauncher.exe".into()), flatpak: None, instance: String::new() };
        let games = instances(&data, "prismlauncher.cfg", "prism", &start);
        let titles: Vec<&str> = games.iter().map(|g| g.title.as_str()).collect();
        assert_eq!(titles, ["Minecraft 1.21.4", "Minecraft: Fabulously Optimized"]);
        assert_eq!(games[1].key, "prism:Fabulously Optimized");
        let launch = games[1].launch.strip_prefix("minecraft:").and_then(Start::parse).unwrap();
        assert_eq!(launch.instance, "Fabulously Optimized");
        assert_eq!(launch.exe.as_deref(), Some("C:\\Prism\\prismlauncher.exe"));
        let _ = std::fs::remove_dir_all(root);
    }
}

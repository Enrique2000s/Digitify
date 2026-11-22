//! Playing (split from mod.rs, D-173): starting a game in its emulator or through its store,
//! its session and play time, games started elsewhere, and watching the stores' installs.

use super::*;


/// What Digitify does while a game runs (D-041).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum WhilePlaying {
    /// Stays open; the UI silences its music (the default).
    Stay,
    /// Hides, out of the taskbar, and comes back when the game ends (D-035).
    Hide,
    /// Quits once the game is started; play time isn't counted.
    Quit,
}

impl WhilePlaying {
    fn parse(mode: Option<&str>) -> Self {
        match mode {
            Some("hide") => Self::Hide,
            Some("quit") => Self::Quit,
            _ => Self::Stay,
        }
    }
}

/// Quits Digitify a moment after a game was started (`WhilePlaying::Quit`), leaving the game running.
fn quit_for_game(app: &AppHandle, id: i64) {
    log::info!("arcade: game {id} started; Digitify quits as asked");
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(800));
        app.exit(0);
    });
}

/// Starts the emulator on a game, with the emulator's own settings. Nintendo 64 games use `n64`
/// (`project64` or `rmg`) and Nintendo DS games `ds` (`melonds` or `desmume`) when both are found;
/// games from RetroArch's playlists start in RetroArch with their core. Play time is counted until
/// the emulator closes. `mode` says what Digitify does meanwhile: `stay` (default), `hide` or
/// `quit` (D-041).
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn arcade_launch(
    app: AppHandle,
    state: State<'_, AppState>,
    arcade: State<'_, ArcadeState>,
    id: i64,
    n64: Option<String>,
    ds: Option<String>,
    mode: Option<String>,
    choices: Option<HashMap<String, String>>,
) -> AppResult<()> {
    let mode = WhilePlaying::parse(mode.as_deref());
    if arcade.running.lock().map(|r| r.is_some()).unwrap_or(false) {
        return Err(AppError::msg("A game is already running. Close it first."));
    }
    let library = state.library()?;
    type Row = (String, String, Option<String>, Option<String>, Option<String>, Option<String>, Option<String>, Option<String>);
    let (path, platform, store, launch, install_dir, core, system, own): Row = library
        .db
        .with(|conn| {
            Ok(conn
                .query_row("SELECT path, platform, store, launch, install_dir, core, system, emulator FROM arcade_games WHERE id = ?1", [id], |row| {
                    Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?, row.get(6)?, row.get(7)?))
                })
                .optional()?)
        })?
        .ok_or_else(|| AppError::msg("That game is no longer in Arcade."))?;
    if platform == "pc" {
        let launch = launch.ok_or_else(|| AppError::msg("Arcade doesn't know how to start that game."))?;
        // A program added by hand (D-107) starts by itself; a store's game through its store.
        let name = match store.as_deref() {
            None => "the game",
            Some(key) => Store::parse(key).ok_or_else(|| AppError::msg("That game's store isn't known."))?.name(),
        };
        return launch_store_game(app, library, id, name, &launch, install_dir.map(PathBuf::from), mode);
    }
    let file = retroarch::file_of(&path);
    // A game kept as a folder (PlayStation 3, Wii U, Xbox 360) is its folder.
    let there = file.exists();
    if !there {
        return Err(AppError::msg("The game's file isn't there anymore (was its drive unplugged?)."));
    }
    let emulators = found_emulators(&library)?;
    let found = |e: Emulator| emulators.iter().find(|(k, f, _, _)| *k == e && f.is_some()).and_then(|(_, f, _, _)| f.clone());
    let need = |text: &str| AppError::msg(format!("{text} Install it, or point Arcade to it in Emulators & folders."));
    let chosen = if system.is_some() {
        // From RetroArch's playlists (D-101): RetroArch, with the core the playlist names.
        let found = found(Emulator::RetroArch).ok_or_else(|| need("This game is from RetroArch's playlists, and RetroArch isn't found anymore."))?;
        if core.is_none() {
            return Err(AppError::msg("RetroArch's playlist doesn't say which core plays this game. Choose one for its playlist in RetroArch, then look for games again."));
        }
        found
    } else {
        let console = Platform::parse(&platform).ok_or_else(|| AppError::msg("Arcade doesn't know which emulator plays this game."))?;
        // The game's own emulator (D-148), else the one chosen for its console (Emulators & folders ›
        // Consoles), else Arcade's order. The game's own has to be there: it was picked for it.
        if let Some(own) = own.as_deref().and_then(Emulator::parse) {
            if found(own).is_none() {
                return Err(need(&format!("This game is set to play in {}, which isn't found.", own.name())));
            }
        }
        let chosen = choices
            .as_ref()
            .and_then(|c| c.get(&platform))
            .cloned()
            .or(match console {
                Platform::N64 => n64,
                Platform::Ds => ds,
                _ => None,
            })
            .and_then(|key| Emulator::parse(&key));
        let own = own.as_deref().and_then(Emulator::parse);
        let candidates: Vec<Emulator> = own.into_iter().chain(chosen).chain(players(console).iter().copied()).filter(|e| e.available_here()).collect();
        match candidates.iter().find_map(|e| found(*e)) {
            Some(found) => found,
            None => {
                let mut names: Vec<&str> = players(console).iter().filter(|e| e.available_here()).map(|e| e.name()).collect();
                let last = names.pop().unwrap_or("an emulator");
                let which = if names.is_empty() { last.to_string() } else { format!("{} or {last}", names.join(", ")) };
                return Err(need(&format!("{} games need {which}.", console.name())));
            }
        }
    };
    let mut command = launch_command(&chosen, Path::new(&path), core.as_deref(), &platform);
    let mut child = command.spawn().map_err(|e| AppError::msg(format!("Couldn't start {}: {e}", chosen.emulator.name())))?;
    log::info!("arcade: {} started for game {id} (pid {})", chosen.emulator.name(), child.id());
    if mode == WhilePlaying::Quit {
        quit_for_game(&app, id);
        return Ok(());
    }
    if let Ok(mut running) = arcade.running.lock() {
        *running = Some(Running { game: id });
    }
    let _ = app.emit("arcade-session", serde_json::json!({ "running": id }));
    // The UI goes silent on the event above. Hiding (D-035): out of the taskbar until the game closes.
    if mode == WhilePlaying::Hide {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.hide();
        }
    }
    let started = Instant::now();
    std::thread::spawn(move || {
        let _ = child.wait();
        finish_session(&app, &library, id, started.elapsed().as_secs() as i64, mode == WhilePlaying::Hide);
    });
    Ok(())
}

/// The end of a game session: play time (a start that ends at once isn't a session), Arcade free
/// again, the UI told, and Digitify back where it was when it hid (Big Picture stays full screen).
fn finish_session(app: &AppHandle, library: &Library, id: i64, seconds: i64, restore: bool) {
    if seconds >= 5 {
        let _ = library.db.with(|conn| {
            conn.execute(
                "UPDATE arcade_games SET play_seconds = play_seconds + ?2, play_count = play_count + 1, \
                 last_played_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?1",
                params![id, seconds],
            )?;
            // Home's statistics (D-041).
            conn.execute(
                "INSERT INTO arcade_activity (day, game_id, seconds) SELECT date('now', 'localtime'), id, ?2 FROM arcade_games WHERE id = ?1 \
                 ON CONFLICT (day, game_id) DO UPDATE SET seconds = seconds + excluded.seconds",
                params![id, seconds],
            )?;
            Ok(())
        });
    }
    if let Some(state) = app.try_state::<ArcadeState>() {
        if let Ok(mut running) = state.running.lock() {
            *running = None;
        }
    }
    let _ = app.emit("arcade-session", serde_json::json!({ "running": null, "seconds": seconds }));
    if restore {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    }
}

/// How long a store game has to show up after its launcher was asked to start it.
const STORE_START_WAIT: u64 = 90;

/// Starts a PC game through its store (D-037). The store starts the game in its own way, so
/// Digitify watches for the game's own program — one running from its install folder — and only
/// then hides and goes quiet; when no program from that folder is left, the session ends. A game
/// never seen leaves Digitify as it was.
fn launch_store_game(app: AppHandle, library: std::sync::Arc<Library>, id: i64, name: &str, launch: &str, install_dir: Option<PathBuf>, mode: WhilePlaying) -> AppResult<()> {
    if let Some(game) = launch.strip_prefix("gog:") {
        // GOG's games start through GOG Galaxy, or by themselves without it (D-101).
        let mut command = stores::gog_command(game).ok_or_else(|| AppError::msg("GOG's record of that game isn't there anymore. Is it still installed?"))?;
        command.spawn().map_err(|e| AppError::msg(format!("Couldn't start the game: {e}")))?;
    } else if let Some(code) = launch.strip_prefix("bnet:") {
        // Battle.net starts its games itself, as its shortcuts ask it to (D-112).
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            let client = launchers::battle_net_client(None).ok_or_else(|| AppError::msg("Battle.net isn't found anymore. Is it still installed?"))?;
            crate::tools::command(&client).raw_arg(format!("--exec=\"launch {code}\"")).spawn().map_err(|e| AppError::msg(format!("Couldn't ask Battle.net to start the game: {e}")))?;
        }
        #[cfg(not(windows))]
        return Err(AppError::msg(format!("Battle.net ({code}) is only on Windows.")));
    } else if let Some(key) = launch.strip_prefix("rockstar:") {
        // Rockstar's games start by their program, which hands them to its launcher (D-116).
        let dir = install_dir.clone().ok_or_else(|| AppError::msg("Rockstar's record of that game isn't there anymore."))?;
        let program = launchers::rockstar_program(key, &dir).filter(|p| p.is_file()).ok_or_else(|| AppError::msg("The game's program isn't there anymore. Is it still installed?"))?;
        let mut command = crate::tools::command(&program);
        command.arg("-launchTitleInFolder").arg(&dir).arg("@commandline.txt").current_dir(&dir);
        command.spawn().map_err(|e| AppError::msg(format!("Couldn't start the game: {e}")))?;
    } else if let Some(product) = launch.strip_prefix("riot:") {
        // The Riot Client starts its games itself (D-116).
        #[cfg(windows)]
        {
            let (product, patchline) = product.split_once(':').unwrap_or((product, "live"));
            let client = launchers::riot_client().ok_or_else(|| AppError::msg("The Riot Client isn't found anymore. Is it still installed?"))?;
            crate::tools::command(&client)
                .arg(format!("--launch-product={product}"))
                .arg(format!("--launch-patchline={patchline}"))
                .spawn()
                .map_err(|e| AppError::msg(format!("Couldn't ask the Riot Client to start the game: {e}")))?;
        }
        #[cfg(not(windows))]
        return Err(AppError::msg(format!("The Riot Client ({product}) is only on Windows.")));
    } else if let Some(start) = launch.strip_prefix("minecraft:") {
        // A Prism Launcher or MultiMC instance, started directly; the official launcher's Flatpak (D-153).
        let start = minecraft::Start::parse(start).ok_or_else(|| AppError::msg("That Minecraft game's record isn't readable. Look for games again."))?;
        start.command().map_err(AppError::msg)?.spawn().map_err(|e| AppError::msg(format!("Couldn't start Minecraft: {e}")))?;
    } else if let Some(program) = launch.strip_prefix("exe:") {
        // A program of its own (added by hand, D-107, or installed by itch.io): from its folder.
        let program = Path::new(program);
        if !program.is_file() {
            return Err(AppError::msg("The game's program isn't there anymore (was it moved or uninstalled?)."));
        }
        let mut command = crate::tools::host_command(program);
        if let Some(dir) = program.parent() {
            command.current_dir(dir);
        }
        command.spawn().map_err(|e| AppError::msg(format!("Couldn't start the game: {e}")))?;
    } else {
        crate::tools::open_link(launch).map_err(|e| AppError::msg(format!("Couldn't ask {name} to start the game: {e}")))?;
    }
    log::info!("arcade: started game {id} ({name})");
    if mode == WhilePlaying::Quit {
        quit_for_game(&app, id);
        return Ok(());
    }
    let _ = app.emit("arcade-session", serde_json::json!({ "starting": id, "store": name }));
    let Some(dir) = install_dir.filter(|d| d.is_dir()) else { return Ok(()) };
    let set_starting = |app: &AppHandle, value: Option<i64>| {
        if let Some(state) = app.try_state::<ArcadeState>() {
            if let Ok(mut starting) = state.starting.lock() {
                *starting = value;
            }
        }
    };
    set_starting(&app, Some(id));
    std::thread::spawn(move || {
        let mut system = sysinfo::System::new();
        let deadline = Instant::now() + std::time::Duration::from_secs(STORE_START_WAIT);
        // Wait for the game to appear.
        loop {
            if game_running(&mut system, &dir) {
                break;
            }
            if Instant::now() > deadline {
                log::info!("arcade: game {id} wasn't seen running; Digitify stays as it is");
                set_starting(&app, None);
                let _ = app.emit("arcade-session", serde_json::json!({ "running": null, "notSeen": id }));
                return;
            }
            std::thread::sleep(std::time::Duration::from_secs(2));
        }
        log::info!("arcade: game {id} is running");
        if let Some(state) = app.try_state::<ArcadeState>() {
            if let Ok(mut running) = state.running.lock() {
                *running = Some(Running { game: id });
            }
        }
        set_starting(&app, None);
        let _ = app.emit("arcade-session", serde_json::json!({ "running": id }));
        if mode == WhilePlaying::Hide {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.hide();
            }
        }
        let started = Instant::now();
        // Wait for it to end: no program from its folder for two checks in a row (launchers
        // sometimes hand over from one program to another).
        let mut absent = 0;
        while absent < 2 {
            std::thread::sleep(std::time::Duration::from_secs(3));
            absent = if game_running(&mut system, &dir) { 0 } else { absent + 1 };
        }
        finish_session(&app, &library, id, started.elapsed().as_secs() as i64, mode == WhilePlaying::Hide);
    });
    Ok(())
}

/// Whether a program from `dir` is running: its program file, working folder or command line is
/// inside it (games under Proton show their Windows path, `Z:\home\…`, in the command line).
fn game_running(system: &mut sysinfo::System, dir: &Path) -> bool {
    // The program, its command line and its working folder, read again every time: launchers often
    // start a helper that then becomes the game, keeping its process (the default refresh reads
    // only the program, once).
    let what = sysinfo::ProcessRefreshKind::nothing()
        .with_exe(sysinfo::UpdateKind::Always)
        .with_cmd(sysinfo::UpdateKind::Always)
        .with_cwd(sysinfo::UpdateKind::Always);
    system.refresh_processes_specifics(sysinfo::ProcessesToUpdate::All, true, what);
    let wanted = normalize(&dir.display().to_string());
    if wanted.len() < 4 {
        return false;
    }
    system.processes().values().any(|process| {
        process.exe().is_some_and(|p| normalize(&p.display().to_string()).starts_with(&wanted))
            || process.cwd().is_some_and(|p| normalize(&p.display().to_string()).starts_with(&wanted))
            || process.cmd().iter().any(|arg| normalize(&arg.to_string_lossy()).contains(&wanted))
    })
}

/// The PC game (if any) of `games` whose program runs now: one refresh of the process list, the
/// programs and their command lines (on Linux, for Proton; on Windows, Java's for Minecraft). Cheap enough to run every few seconds.
fn running_among(system: &mut sysinfo::System, games: &[(i64, String)]) -> Option<i64> {
    // Command lines too (read once per program): Java names the Minecraft instance it plays (D-153).
    let what = sysinfo::ProcessRefreshKind::nothing().with_exe(sysinfo::UpdateKind::OnlyIfNotSet).with_cmd(sysinfo::UpdateKind::OnlyIfNotSet);
    system.refresh_processes_specifics(sysinfo::ProcessesToUpdate::All, true, what);
    let paths: Vec<(String, Vec<String>)> = system
        .processes()
        .values()
        // Crash reporters and anti-cheat helpers can outlive the game itself: they don't count.
        .filter(|p| !p.exe().and_then(|e| e.file_stem()).is_some_and(|n| helper_program(&n.to_string_lossy())))
        .map(|p| {
            // On Windows only Java's (Minecraft's) command line counts: other programs name folders freely.
            let java = p.exe().and_then(|e| e.file_stem()).is_some_and(|n| n.to_string_lossy().to_lowercase().starts_with("java"));
            let cmd = if cfg!(windows) && !java { Vec::new() } else { p.cmd().iter().map(|a| normalize(&a.to_string_lossy())).collect() };
            (p.exe().map(|e| normalize(&e.display().to_string())).unwrap_or_default(), cmd)
        })
        .collect();
    games.iter().find_map(|(id, dir)| {
        let wanted = format!("{}/", normalize(dir));
        (wanted.len() > 4 && paths.iter().any(|(exe, cmd)| exe.starts_with(&wanted) || cmd.iter().any(|a| a.contains(&wanted)))).then_some(*id)
    })
}

/// Programs beside a game that aren't the game: crash reporters, anti-cheat services, redistributable
/// installers (D-083).
fn helper_program(stem: &str) -> bool {
    let s = stem.to_lowercase();
    ["crashreportclient", "unitycrashhandler", "crashpad_handler", "crashhandler", "easyanticheat", "battleye", "beservice", "vc_redist", "dxsetup", "dotnetfx"]
        .iter()
        .any(|h| s.starts_with(h))
}

/// Games started some other way (D-083): from their own launcher, a desktop shortcut, or before
/// Digitify opened. Every few seconds, when no game is being played, Digitify looks for a program
/// running from one of Arcade's PC games' folders; it then shows that game as playing and counts
/// its time until no program from its folder is left, as if it had been started from Arcade.
pub fn watch_outside(app: AppHandle) {
    std::thread::Builder::new()
        .name("arcade-outside".into())
        .spawn(move || {
            std::thread::sleep(std::time::Duration::from_secs(6));
            let mut system = sysinfo::System::new();
            loop {
                std::thread::sleep(std::time::Duration::from_secs(8));
                let Some(state) = app.try_state::<ArcadeState>() else { continue };
                let busy = state.running.lock().map(|r| r.is_some()).unwrap_or(true) || state.starting.lock().map(|s| s.is_some()).unwrap_or(true);
                if busy {
                    continue;
                }
                let Some(library) = app.try_state::<AppState>().and_then(|s| s.library().ok()) else { continue };
                let games: Vec<(i64, String)> = library
                    .db
                    .with(|conn| {
                        Ok(conn
                            .prepare("SELECT id, install_dir FROM arcade_games WHERE platform = 'pc' AND hidden = 0 AND missing = 0 AND install_dir IS NOT NULL AND length(install_dir) > 3")?
                            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
                            .collect::<Result<_, _>>()?)
                    })
                    .unwrap_or_default();
                if games.is_empty() {
                    continue;
                }
                let Some(id) = running_among(&mut system, &games) else { continue };
                // Claimed now, unless a launch from Arcade got there first.
                {
                    let Ok(mut running) = state.running.lock() else { continue };
                    if running.is_some() || state.starting.lock().map(|s| s.is_some()).unwrap_or(true) {
                        continue;
                    }
                    *running = Some(Running { game: id });
                }
                log::info!("arcade: game {id} is running, started outside Digitify");
                let _ = app.emit("arcade-session", serde_json::json!({ "running": id, "outside": true }));
                let dir = games.iter().find(|(g, _)| *g == id).map(|(_, d)| d.clone()).unwrap_or_default();
                let started = Instant::now();
                let mut absent = 0;
                while absent < 2 {
                    std::thread::sleep(std::time::Duration::from_secs(4));
                    absent = if running_among(&mut system, &[(id, dir.clone())]).is_some() { 0 } else { absent + 1 };
                }
                finish_session(&app, &library, id, started.elapsed().as_secs() as i64, false);
            }
        })
        .ok();
}

/// Paths compared loosely: forward slashes, lower case, no Wine drive letter, no trailing slash.
fn normalize(path: &str) -> String {
    let mut p = path.replace('\\', "/").to_lowercase();
    if p.starts_with("z:/") {
        p = p[2..].to_string();
    }
    p.trim_end_matches('/').to_string()
}

/// Watches the stores' install records and tells the UI when a game was installed or removed, so
/// Arcade refreshes by itself (D-037). Cheap: names and dates of a few folders, every 20 seconds.
pub fn watch_stores(app: AppHandle) {
    std::thread::Builder::new()
        .name("arcade-stores".into())
        .spawn(move || {
            let mut last = stores::fingerprint();
            loop {
                std::thread::sleep(std::time::Duration::from_secs(20));
                let now = stores::fingerprint();
                if now != last {
                    last = now;
                    stores::forget_cached();
                    log::info!("arcade: a store's installed games changed");
                    let _ = app.emit("arcade-stores-changed", ());
                }
            }
        })
        .ok();
}

fn launch_command(found: &Found, game: &Path, core: Option<&str>, platform: &str) -> std::process::Command {
    let mut command = match &found.program {
        Program::Native(path) => {
            let mut c = crate::tools::host_command(path);
            if let Some(dir) = path.parent() {
                c.current_dir(dir);
            }
            c
        }
        Program::Flatpak(id) => {
            let mut c = crate::tools::host_command("flatpak");
            c.args(["run", id]);
            c
        }
    };
    match found.emulator {
        // Batch: no game list, and Dolphin closes with the game.
        Emulator::Dolphin => command.args(["-b", "-e"]).arg(game),
        Emulator::Project64 => command.arg(game),
        // Quit after emulation: RMG closes with the game too.
        Emulator::Rmg => command.arg("--quit-after-emulation").arg(game),
        // Batch mode: DuckStation and PCSX2 close with the game.
        Emulator::DuckStation | Emulator::Pcsx2 => command.args(["-batch", "--"]).arg(game),
        // No game list; RPCS3 boots the game's EBOOT.BIN.
        Emulator::Rpcs3 => {
            let eboot = [game.join("PS3_GAME").join("USRDIR").join("EBOOT.BIN"), game.join("USRDIR").join("EBOOT.BIN")].into_iter().find(|p| p.is_file());
            command.arg("--no-gui").arg(eboot.as_deref().unwrap_or(game))
        }
        Emulator::MelonDs | Emulator::Desmume | Emulator::Mesen | Emulator::Fceux | Emulator::Mgba | Emulator::Zsnes | Emulator::Snes9x | Emulator::Nestopia => command.arg(game),
        // Kega Fusion is told when it's a Sega CD disc.
        Emulator::Fusion if platform == Platform::SegaCd.key() => command.arg("-scd").arg(game),
        Emulator::Fusion => command.arg(game),
        // nullDC starts the disc at once instead of showing its menu.
        Emulator::NullDc => {
            let mut image = std::ffi::OsString::from("ImageReader:DefaultImage=");
            image.push(game);
            command.args(["-config", "nullDC:Emulator.Autostart=1", "-config", "ImageReader:LoadDefaultImage=1", "-config"]).arg(image)
        }
        // ares tells most consoles by the file; a Sega CD disc and a Mega Drive .bin are named.
        Emulator::Ares if platform == Platform::SegaCd.key() => command.args(["--system", "Mega CD"]).arg(game),
        Emulator::Ares if platform == Platform::Genesis.key() && games::extension(game) == "bin" => command.args(["--system", "Mega Drive"]).arg(game),
        Emulator::Ares => command.arg(game),
        // D-116: each opens the game as given; Cemu with -g, xemu its disc with -dvd_path; a game
        // kept as a folder starts by its program.
        Emulator::Ppsspp | Emulator::Flycast | Emulator::Azahar | Emulator::Ryujinx => command.arg(game),
        Emulator::Cemu => command.arg("-g").arg(if game.is_dir() { games::folder_program(game) } else { game.to_path_buf() }),
        Emulator::Xenia => command.arg(if game.is_dir() { games::folder_program(game) } else { game.to_path_buf() }),
        Emulator::Xemu => command.arg("-dvd_path").arg(game),
        Emulator::RetroArch => {
            if let Some(core) = core {
                command.arg("-L").arg(core);
            }
            command.arg(game)
        }
    };
    command
}

#[cfg(test)]
mod outside_tests {
    use super::*;

    #[test]
    fn folders_and_helpers_for_games_started_elsewhere() {
        // A folder matches whole names: "Fort" isn't "Fortnite".
        let program = format!("{}/", normalize(r"D:\Games\Fortnite\bin\game.exe"));
        assert!(!program.starts_with(&format!("{}/", normalize(r"D:\Games\Fort"))));
        assert!(program.starts_with(&format!("{}/", normalize(r"D:\Games\Fortnite"))));
        assert_eq!(normalize(r"Z:\home\me\Games\X\\"), "/home/me/games/x");
        assert!(helper_program("CrashReportClient") && helper_program("EasyAntiCheat_EOS") && !helper_program("FortniteClient-Win64-Shipping"));
    }
}

#[cfg(test)]
mod launch_tests {
    use super::*;

    fn args(emulator: Emulator, game: &Path, core: Option<&str>) -> Vec<String> {
        args_for(emulator, game, core, "")
    }

    fn args_for(emulator: Emulator, game: &Path, core: Option<&str>, platform: &str) -> Vec<String> {
        let found = Found { emulator, program: Program::Native(PathBuf::from("/emu/program")), folders: Vec::new(), covers: None };
        launch_command(&found, game, core, platform).get_args().map(|a| a.to_string_lossy().into_owned()).collect()
    }

    #[test]
    fn the_newer_emulators_start_their_games() {
        assert_eq!(args(Emulator::Snes9x, Path::new("/g/a.sfc"), None), ["/g/a.sfc"]);
        assert_eq!(args_for(Emulator::Fusion, Path::new("/g/s.cue"), None, "segacd"), ["-scd", "/g/s.cue"]);
        assert_eq!(args_for(Emulator::Fusion, Path::new("/g/s.md"), None, "genesis"), ["/g/s.md"]);
        assert_eq!(
            args_for(Emulator::NullDc, Path::new("/g/Shenmue/disc.gdi"), None, "dreamcast"),
            ["-config", "nullDC:Emulator.Autostart=1", "-config", "ImageReader:LoadDefaultImage=1", "-config", "ImageReader:DefaultImage=/g/Shenmue/disc.gdi"]
        );
        assert_eq!(args_for(Emulator::Ares, Path::new("/g/x.cue"), None, "segacd"), ["--system", "Mega CD", "/g/x.cue"]);
        assert_eq!(args_for(Emulator::Ares, Path::new("/g/x.pce"), None, "pce"), ["/g/x.pce"]);
    }

    #[test]
    fn every_console_has_its_emulators_and_every_emulator_its_consoles() {
        for platform in Platform::ALL {
            assert!(!players(platform).is_empty(), "{} has no emulator", platform.key());
        }
        for emulator in Emulator::ALL {
            assert_eq!(looking_for(emulator).is_none(), emulator == Emulator::RetroArch, "{}", emulator.key());
        }
        let ares = looking_for(Emulator::Ares).unwrap().platforms;
        assert!(ares.contains(&Platform::Pce) && ares.contains(&Platform::Genesis) && !ares.contains(&Platform::Ps2));
    }

    #[test]
    fn each_emulator_starts_the_game_its_own_way() {
        let game = Path::new("/games/Ico.iso");
        assert_eq!(args(Emulator::DuckStation, game, None), ["-batch", "--", "/games/Ico.iso"]);
        assert_eq!(args(Emulator::Pcsx2, game, None), ["-batch", "--", "/games/Ico.iso"]);
        assert_eq!(args(Emulator::MelonDs, Path::new("/games/p.nds"), None), ["/games/p.nds"]);
        assert_eq!(args(Emulator::Mesen, Path::new("/games/z.sfc"), None), ["/games/z.sfc"]);
        assert_eq!(args(Emulator::Fceux, Path::new("/games/m.nes"), None), ["/games/m.nes"]);
        assert_eq!(args(Emulator::Mgba, Path::new("/games/p.gba"), None), ["/games/p.gba"]);
        assert_eq!(args(Emulator::RetroArch, Path::new("/r/a.zip#b.sfc"), Some("/cores/snes9x.so")), ["-L", "/cores/snes9x.so", "/r/a.zip#b.sfc"]);
        // RPCS3 boots the disc's EBOOT.BIN when it's there, else the game's folder.
        let dir = std::env::temp_dir().join(format!("digitify-rpcs3-launch-{}", std::process::id()));
        let eboot = dir.join("PS3_GAME").join("USRDIR").join("EBOOT.BIN");
        std::fs::create_dir_all(eboot.parent().unwrap()).unwrap();
        assert_eq!(args(Emulator::Rpcs3, &dir, None), ["--no-gui".to_string(), dir.display().to_string()]);
        std::fs::write(&eboot, b"x").unwrap();
        assert_eq!(args(Emulator::Rpcs3, &dir, None), ["--no-gui".to_string(), eboot.display().to_string()]);
        let _ = std::fs::remove_dir_all(&dir);
    }
}

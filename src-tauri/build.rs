use std::path::Path;

fn main() {
    println!("cargo:rerun-if-changed=icons/icon.ico");

    // The Windows resource compiler misreads paths that contain an apostrophe (tauri-winres 0.3.7
    // writes it as \'), e.g. "C:\Users\me\Documents\Sam's Projects". In that case, embed the
    // window icon from a temporary copy whose path is safe.
    let mut windows = tauri_build::WindowsAttributes::new();
    let icon = std::fs::canonicalize(Path::new("icons").join("icon.ico")).expect("icons/icon.ico is missing");
    if icon.to_string_lossy().contains('\'') {
        let dir = std::env::temp_dir().join("digitify-build");
        std::fs::create_dir_all(&dir).expect("cannot create a temporary folder for the app icon");
        let copy = dir.join("icon.ico");
        std::fs::copy(&icon, &copy).expect("cannot copy the app icon");
        windows = windows.window_icon_path(copy);
    }

    tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows))
        .expect("failed to run tauri-build");
}

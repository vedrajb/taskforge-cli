use std::path::PathBuf;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct LaunchContext {
    root: String,
    worker_path: String,
    package_root: String,
}

#[tauri::command]
fn launch_context() -> Result<LaunchContext, String> {
    // Resolve paths from Cargo's manifest dir so Tauri dev mode works from any cwd.
    let tauri_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let package_root = tauri_dir
        .parent()
        .ok_or_else(|| "Could not resolve package root".to_string())?
        .to_path_buf();
    let root = std::env::var("TASKFORGE_ROOT")
        .unwrap_or_else(|_| package_root.to_string_lossy().to_string());
    let worker_path = package_root.join("dist").join("desktop").join("worker.js");

    Ok(LaunchContext {
        root,
        worker_path: worker_path.to_string_lossy().to_string(),
        package_root: package_root.to_string_lossy().to_string(),
    })
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![launch_context])
        .run(tauri::generate_context!())
        .expect("error while running TaskForge desktop");
}

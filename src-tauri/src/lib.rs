mod clipboard;
mod documents;
mod error;
mod menu;
mod settings;

use serde::Serialize;
use tauri::{Emitter, Manager};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    name: String,
    version: String,
    tauri_version: String,
    platform: String,
    config_dir: String,
    document_limit_bytes: u64,
}

#[tauri::command]
fn app_info(app: tauri::AppHandle) -> Result<AppInfo, error::AppError> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_default();
    let package = app.package_info();
    Ok(AppInfo {
        name: package.name.clone(),
        version: package.version.to_string(),
        tauri_version: tauri::VERSION.to_string(),
        platform: std::env::consts::OS.to_string(),
        config_dir,
        document_limit_bytes: documents::MAX_DOCUMENT_BYTES,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    // The single-instance plugin must be registered before any other plugin.
    builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
        let paths = documents::collect_paths(argv);
        if !paths.is_empty() {
            let access = app.state::<documents::DocumentAccess>();
            for path in paths {
                access.push_pending(path);
            }
            let _ = app.emit("documents-pending", ());
        }
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    }));

    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(documents::DocumentAccess::default())
        .manage(settings::SettingsState::default())
        .manage(clipboard::ClipboardState::default())
        // Drag-and-drop paths are captured here, in Rust. Accepting a path list
        // from the webview would let a compromised renderer authorise (and then
        // read or overwrite) any diagram-extension file on disk.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) = event {
                let access = window.state::<documents::DocumentAccess>();
                let (accepted, ignored) = documents::queue_dropped(&access, paths.clone());
                let _ = window.app_handle().emit(
                    "documents-dropped",
                    serde_json::json!({ "accepted": accepted, "ignored": ignored }),
                );
            }
        })
        .setup(|app| {
            let args: Vec<String> = std::env::args().collect();
            let access = app.state::<documents::DocumentAccess>();
            for path in documents::collect_paths(args) {
                access.push_pending(path);
            }
            menu::install(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            documents::read_document,
            documents::open_document,
            documents::save_document,
            documents::save_document_as,
            documents::export_document,
            documents::export_beside_document,
            clipboard::copy_image_to_clipboard,
            documents::take_pending_documents,
            documents::reveal_document,
            settings::load_app_settings,
            settings::save_app_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running MermaidDesk");
}

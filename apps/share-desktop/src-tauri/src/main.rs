mod capture;
mod encode;
mod jpeg;
mod peer;
mod picture;
mod protocol;
mod session;
mod settings;

#[tauri::command]
fn load_settings() -> settings::Settings {
    settings::load()
}

#[tauri::command]
fn save_settings(server: String) -> Result<(), String> {
    settings::save(&server)
}

#[tauri::command]
fn prepare_share(server: String, code: String) -> Result<(), String> {
    session::prepare(&server, &code)
}

#[tauri::command]
fn list_sources() -> Result<Vec<capture::SourceInfo>, String> {
    session::sources()
}

#[tauri::command]
fn start_share(app: tauri::AppHandle, server: String, code: String, source_id: String) -> Result<(), String> {
    session::start(app, server, code, source_id)
}

#[tauri::command]
fn set_display_mode(mode: String) -> Result<(), String> {
    session::set_mode(&mode)
}

#[tauri::command]
fn stop_share() {
    session::stop();
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            load_settings,
            save_settings,
            prepare_share,
            list_sources,
            start_share,
            set_display_mode,
            stop_share
        ])
        .build(tauri::generate_context!())
        .expect("the share app failed to start")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                session::stop();
                app.cleanup_before_exit();
            }
        });
}

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&[
                "load_settings",
                "save_settings",
                "prepare_share",
                "list_sources",
                "start_share",
                "set_display_mode",
                "set_volume",
                "stop_share",
            ]),
        ),
    )
    .expect("failed to run tauri-build");
}

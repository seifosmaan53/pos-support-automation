mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            commands::audio::save_audio_file,
            commands::audio::delete_audio_file,
            commands::audio::read_audio_file,
            commands::audio::audio_data_dir,
            commands::audio::reveal_audio_file,
            commands::audio::list_audio_files,
            commands::audio::import_audio_file,
            commands::system::app_paths,
            commands::system::open_in_folder,
            commands::system::check_paths_exist,
            commands::system::write_text_file,
            commands::system::read_text_file,
            commands::system::copy_audio_files,
            commands::whisper::transcribe_audio,
            commands::whisper::test_whisper,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Store Ticket Assistant");
}

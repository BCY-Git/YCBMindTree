#[tauri::command]
fn reveal_export_in_finder(path: String) -> Result<(), String> {
  #[cfg(target_os = "macos")]
  {
    std::process::Command::new("open")
      .arg("-R")
      .arg(path)
      .spawn()
      .map(|_| ())
      .map_err(|error| format!("无法在 Finder 中显示文件：{error}"))
  }
  #[cfg(not(target_os = "macos"))]
  {
    let _ = path;
    Err("当前系统暂不支持定位导出文件".to_string())
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_http::init())
    .invoke_handler(tauri::generate_handler![reveal_export_in_finder])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

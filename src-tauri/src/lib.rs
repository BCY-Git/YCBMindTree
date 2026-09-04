use std::fs;
use std::path::PathBuf;

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use tauri::Manager;

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

/// 拖放进来的 HTML 只允许从原始路径读取字节；类型校验放在原生侧，
/// 避免前端误把其他文件当作导图预览源。
#[tauri::command]
fn read_dropped_html(path: String) -> Result<Vec<u8>, String> {
  let lowered = path.to_ascii_lowercase();
  if !lowered.ends_with(".html") && !lowered.ends_with(".htm") {
    return Err("只能读取 HTML 文件".to_string());
  }
  fs::read(&path).map_err(|error| format!("无法读取文件：{error}"))
}

/// 预览编号只允许 UUID 字符；文件名直接拼接进协议路径，必须杜绝路径穿越。
fn is_safe_preview_id(id: &str) -> bool {
  !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

fn preview_cache_dir(app: &tauri::AppHandle) -> PathBuf {
  let base = app.path().app_cache_dir().unwrap_or_else(|_| std::env::temp_dir().join("mindtree"));
  let dir = base.join("html-previews");
  let _ = fs::create_dir_all(&dir);
  dir
}

/// 前端把 IndexedDB 里的附件字节转成 base64 存入预览缓存，
/// 之后 iframe 通过 mindtree-preview 协议按编号读取。
#[tauri::command]
fn store_html_preview(app: tauri::AppHandle, id: String, base64: String) -> Result<(), String> {
  if !is_safe_preview_id(&id) {
    return Err("非法的预览编号".to_string());
  }
  let bytes = BASE64_STANDARD
    .decode(base64.as_bytes())
    .map_err(|error| format!("无法解析预览内容：{error}"))?;
  if bytes.len() > 20 * 1024 * 1024 {
    return Err("HTML 预览超过 20 MB 上限".to_string());
  }
  fs::write(preview_cache_dir(&app).join(format!("{id}.html")), bytes)
    .map_err(|error| format!("无法写入预览缓存：{error}"))
}

/// 预览文档自带宽松 CSP：脚本允许内联执行（导出页、图表页普遍是内联脚本），
/// 但与主应用的严格 CSP 完全隔离，避免 blob/srcdoc 继承主策略导致脚本被禁。
const HTML_PREVIEW_CSP: &str = "default-src * data: blob:; script-src * data: blob: 'unsafe-inline' 'unsafe-eval'; style-src * 'unsafe-inline'; img-src * data: blob:; font-src * data:; media-src * data: blob:; connect-src *; object-src 'none'";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_http::init())
    .register_uri_scheme_protocol("mindtree-preview", |context, request| {
      let name = request.uri().path().trim_start_matches('/');
      let trusted = !name.is_empty()
        && !name.contains("..")
        && name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-'))
        && (name.ends_with(".html") || name.ends_with(".htm"));
      let body = trusted
        .then(|| preview_cache_dir(context.app_handle()).join(name))
        .and_then(|path| fs::read(path).ok());
      match body {
        Some(bytes) => tauri::http::Response::builder()
          .header("Content-Type", "text/html; charset=utf-8")
          .header("Content-Security-Policy", HTML_PREVIEW_CSP)
          .header("Cache-Control", "no-store")
          .body(bytes)
          .unwrap(),
        None => tauri::http::Response::builder()
          .status(404)
          .body(Vec::new())
          .unwrap(),
      }
    })
    .invoke_handler(tauri::generate_handler![reveal_export_in_finder, read_dropped_html, store_html_preview])
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

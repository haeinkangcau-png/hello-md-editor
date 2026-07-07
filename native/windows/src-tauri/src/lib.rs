// Tauri backend for Hi MD Editor.
//
// This is a 1:1 port of the former Electron `electron/main.js` IPC layer.
// Every command mirrors the shape (arguments + return value) the React
// frontend already expects from `window.electronAPI`, so the frontend is
// reused essentially unchanged (see `src/tauri-bridge.js`).

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

use base64::Engine;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

// ── Shared state ───────────────────────────────────────────
struct AppState {
    /// File path passed on the command line (file association / "open with").
    pending_open: Mutex<Option<String>>,
    /// Last content + title injected into the schedule window (survives reload).
    schedule_last: Mutex<(String, String)>,
    /// Last content + title injected into the spec window (survives reload).
    spec_last: Mutex<(String, String)>,
    /// Counter for unique labels of extra editor windows (Ctrl+Shift+N).
    win_counter: AtomicUsize,
}

// ── Helpers ────────────────────────────────────────────────
fn resolve_path(p: &str) -> PathBuf {
    let path = PathBuf::from(p);
    if path.is_absolute() {
        path
    } else {
        std::env::current_dir()
            .map(|c| c.join(&path))
            .unwrap_or(path)
    }
}

fn mime_for(ext: &str) -> &'static str {
    match ext {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        _ => "application/octet-stream",
    }
}

/// Directory listing mirroring the Electron `readDir`: hide `.assets` folders,
/// keep only `.md`/`.html` files, folders first, then case-insensitive by name.
fn read_dir_items(dir: &Path) -> Vec<Value> {
    let mut items: Vec<(bool, String, String)> = Vec::new();
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            let is_dir = match entry.file_type() {
                Ok(ft) => ft.is_dir(),
                Err(_) => continue,
            };
            if is_dir && name.ends_with(".assets") {
                continue;
            }
            if !is_dir && !(name.ends_with(".md") || name.ends_with(".html")) {
                continue;
            }
            items.push((is_dir, name, entry.path().to_string_lossy().to_string()));
        }
    }
    items.sort_by(|a, b| {
        if a.0 != b.0 {
            return if a.0 {
                std::cmp::Ordering::Less
            } else {
                std::cmp::Ordering::Greater
            };
        }
        a.1.to_lowercase().cmp(&b.1.to_lowercase())
    });
    items
        .into_iter()
        .map(|(is_dir, name, full)| json!({ "name": name, "path": full, "isDirectory": is_dir }))
        .collect()
}

fn copy_dir_recursive(src: &Path, dest: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dest)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let ft = entry.file_type()?;
        let target = dest.join(entry.file_name());
        if ft.is_dir() {
            copy_dir_recursive(&entry.path(), &target)?;
        } else {
            std::fs::copy(entry.path(), &target)?;
        }
    }
    Ok(())
}

/// Find the first existing `.md`/`.html` file among CLI args (file association).
fn find_file_arg(args: &[String]) -> Option<String> {
    args.iter().skip(1).find(|a| {
        let lower = a.to_lowercase();
        (lower.ends_with(".md") || lower.ends_with(".html") || lower.ends_with(".htm"))
            && Path::new(a).exists()
    })
    .cloned()
}

fn build_schedule_inject(content: &str, file_name: &str) -> String {
    let c = serde_json::to_string(content).unwrap_or_else(|_| "\"\"".into());
    let f = serde_json::to_string(file_name).unwrap_or_else(|_| "\"스케줄\"".into());
    format!(
        r#"(function(){{
      function go(){{
        try {{
          var el = document.getElementById('mdInput');
          if (el) {{ el.value = {c}; }}
          var h1 = document.querySelector('header h1');
          if (h1) h1.textContent = {f};
          if (typeof render === 'function') render(typeof currentMode !== 'undefined' ? currentMode : 'fit');
        }} catch (e) {{}}
      }}
      go(); setTimeout(go, 250); setTimeout(go, 600);
    }})();"#,
        c = c,
        f = f
    )
}

fn build_spec_inject(content: &str, file_name: &str) -> String {
    let c = serde_json::to_string(content).unwrap_or_else(|_| "\"\"".into());
    let f = serde_json::to_string(file_name).unwrap_or_else(|_| "\"spec\"".into());
    format!(
        r#"(function(){{
      function go(){{
        try {{
          if (typeof loadSpecFromText !== 'function') return;
          loadSpecFromText({c}, {f});
          if (typeof hideStartup === 'function') hideStartup();
          if (typeof render === 'function') render();
          var ca = document.getElementById('ca');
          if (ca) ca.classList.add('panel-open');
          if (typeof initListWidth === 'function') initListWidth();
          if (typeof setPanelWidth === 'function') setPanelWidth(780);
        }} catch (e) {{}}
      }}
      go(); setTimeout(go, 250); setTimeout(go, 600);
    }})();"#,
        c = c,
        f = f
    )
}

// ── Custom protocol: local-image:// (served as http://local-image.localhost) ──
fn handle_local_image(
    request: tauri::http::Request<Vec<u8>>,
) -> tauri::http::Response<Vec<u8>> {
    let not_found = || {
        tauri::http::Response::builder()
            .status(404)
            .body(Vec::new())
            .unwrap()
    };

    let path = request.uri().path(); // e.g. /img/D%3A/dir/x.png
    let rest = match path.strip_prefix("/img/") {
        Some(r) => r,
        None => return not_found(),
    };
    let decoded = match urlencoding::decode(rest) {
        Ok(d) => d.into_owned(),
        Err(_) => return not_found(),
    };

    // Windows: strip a leading slash before a drive letter (/D:/... → D:/...)
    let mut file_path = decoded;
    let b = file_path.as_bytes();
    if b.len() >= 3 && b[0] == b'/' && b[2] == b':' {
        file_path = file_path[1..].to_string();
    }

    let pb = PathBuf::from(&file_path);
    if !pb.exists() {
        return not_found();
    }
    let data = match std::fs::read(&pb) {
        Ok(d) => d,
        Err(_) => return not_found(),
    };
    let ext = pb
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    tauri::http::Response::builder()
        .status(200)
        .header("Content-Type", mime_for(&ext))
        .header("Access-Control-Allow-Origin", "*")
        .body(data)
        .unwrap()
}

// ── File I/O commands ──────────────────────────────────────
#[tauri::command]
fn list_files(dir: String) -> Result<Value, String> {
    let resolved = resolve_path(&dir);
    if !resolved.exists() {
        return Err("디렉토리를 찾을 수 없습니다".into());
    }
    if !resolved.is_dir() {
        return Err("폴더가 아닙니다".into());
    }
    Ok(json!({ "items": read_dir_items(&resolved), "dir": resolved.to_string_lossy().to_string() }))
}

#[tauri::command]
fn read_file(path: String) -> Result<Value, String> {
    let resolved = resolve_path(&path);
    if !resolved.exists() {
        return Err("파일을 찾을 수 없습니다".into());
    }
    let content = std::fs::read_to_string(&resolved).map_err(|e| e.to_string())?;
    Ok(json!({ "content": content, "path": resolved.to_string_lossy().to_string() }))
}

#[tauri::command]
fn write_file(path: String, content: String) -> Result<Value, String> {
    let resolved = resolve_path(&path);
    if let Some(parent) = resolved.parent() {
        if !parent.exists() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
    }
    std::fs::write(&resolved, content).map_err(|e| e.to_string())?;
    Ok(json!({ "success": true, "path": resolved.to_string_lossy().to_string() }))
}

#[tauri::command]
fn check_exists(path: String) -> bool {
    resolve_path(&path).exists()
}

#[tauri::command(rename_all = "camelCase")]
fn create_folder(dir_path: String) -> Result<Value, String> {
    let resolved = resolve_path(&dir_path);
    if !resolved.exists() {
        std::fs::create_dir_all(&resolved).map_err(|e| e.to_string())?;
    }
    Ok(json!({ "success": true, "path": resolved.to_string_lossy().to_string() }))
}

#[tauri::command(rename_all = "camelCase")]
fn rename_file(old_path: String, new_path: String) -> Result<Value, String> {
    let o = resolve_path(&old_path);
    let n = resolve_path(&new_path);
    if !o.exists() {
        return Err("파일을 찾을 수 없습니다".into());
    }
    if n.exists() {
        return Err("같은 이름의 파일이 이미 존재합니다".into());
    }
    std::fs::rename(&o, &n).map_err(|e| e.to_string())?;
    Ok(json!({ "success": true, "oldPath": o.to_string_lossy().to_string(), "newPath": n.to_string_lossy().to_string() }))
}

#[tauri::command(rename_all = "camelCase")]
fn save_image(dir: String, file_name: String, base64_data: String) -> Result<Value, String> {
    let resolved = resolve_path(&dir);
    if !resolved.exists() {
        std::fs::create_dir_all(&resolved).map_err(|e| e.to_string())?;
    }
    let file_path = resolved.join(&file_name);
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(base64_data.as_bytes())
        .map_err(|e| e.to_string())?;
    std::fs::write(&file_path, bytes).map_err(|e| e.to_string())?;
    Ok(json!({ "success": true, "path": file_path.to_string_lossy().to_string() }))
}

#[tauri::command(rename_all = "camelCase")]
fn cleanup_images(assets_dir: String, referenced_images: Vec<String>) -> Result<Value, String> {
    let resolved = resolve_path(&assets_dir);
    if !resolved.exists() {
        return Ok(json!({ "deleted": [] }));
    }
    let exts = ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"];
    let refset: HashSet<&str> = referenced_images.iter().map(|s| s.as_str()).collect();
    let mut deleted: Vec<String> = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&resolved) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            let ext = Path::new(&name)
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("")
                .to_lowercase();
            if exts.contains(&ext.as_str()) && !refset.contains(name.as_str()) {
                if std::fs::remove_file(entry.path()).is_ok() {
                    deleted.push(name);
                }
            }
        }
    }
    // Remove the folder if it is now empty.
    if let Ok(mut rd) = std::fs::read_dir(&resolved) {
        if rd.next().is_none() {
            let _ = std::fs::remove_dir(&resolved);
        }
    }
    Ok(json!({ "deleted": deleted }))
}

#[tauri::command]
fn copy_assets(src: String, dest: String) -> Result<Value, String> {
    let s = resolve_path(&src);
    let d = resolve_path(&dest);
    if !s.exists() {
        return Err("원본 폴더를 찾을 수 없습니다".into());
    }
    copy_dir_recursive(&s, &d).map_err(|e| e.to_string())?;
    Ok(json!({ "success": true }))
}

#[tauri::command]
fn read_image_base64(path: String) -> Option<String> {
    let resolved = resolve_path(&path);
    if !resolved.exists() {
        return None;
    }
    let data = std::fs::read(&resolved).ok()?;
    let ext = resolved
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    let b64 = base64::engine::general_purpose::STANDARD.encode(&data);
    Some(format!("data:{};base64,{}", mime_for(&ext), b64))
}

// ── Dialogs (native, via rfd) ──────────────────────────────
#[tauri::command]
async fn open_folder() -> Result<Option<String>, String> {
    let folder = rfd::AsyncFileDialog::new()
        .set_title("폴더 열기")
        .pick_folder()
        .await;
    Ok(folder.map(|h| h.path().to_string_lossy().to_string()))
}

#[tauri::command(rename_all = "camelCase")]
async fn save_dialog(default_path: Option<String>) -> Result<Option<String>, String> {
    let mut dlg = rfd::AsyncFileDialog::new()
        .set_title("다른 이름으로 저장")
        .add_filter("Markdown", &["md"]);
    match default_path {
        Some(dp) if !dp.is_empty() => {
            let p = PathBuf::from(&dp);
            if let Some(name) = p.file_name() {
                dlg = dlg.set_file_name(name.to_string_lossy().to_string());
            }
            if let Some(parent) = p.parent() {
                if parent.is_dir() {
                    dlg = dlg.set_directory(parent);
                }
            }
        }
        _ => {
            dlg = dlg.set_file_name("untitled.md");
        }
    }
    let file = dlg.save_file().await;
    Ok(file.map(|h| h.path().to_string_lossy().to_string()))
}

// ── Shell integration ──────────────────────────────────────
#[tauri::command(rename_all = "camelCase")]
fn reveal_in_explorer(file_path: String) -> Result<(), String> {
    let resolved = resolve_path(&file_path);
    #[cfg(target_os = "windows")]
    {
        let win_path = resolved.to_string_lossy().replace('/', "\\");
        std::process::Command::new("explorer")
            .arg("/select,")
            .arg(&win_path)
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = resolved;
    }
    Ok(())
}

#[tauri::command]
fn open_path(target: String) -> Result<Value, String> {
    let t = target.trim();
    if t.is_empty() {
        return Ok(json!({ "success": false, "error": "empty path" }));
    }
    let mut p = t.to_string();
    if p.to_lowercase().starts_with("file://") {
        p = p.trim_start_matches("file://").trim_start_matches('/').to_string();
    }
    #[cfg(target_os = "windows")]
    {
        let win_path = p.replace('/', "\\");
        // `start` opens folders in Explorer and files in their default app.
        match std::process::Command::new("cmd")
            .args(["/C", "start", "", &win_path])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
        {
            Ok(_) => Ok(json!({ "success": true })),
            Err(e) => Ok(json!({ "success": false, "error": e.to_string() })),
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = p;
        Ok(json!({ "success": false, "error": "unsupported platform" }))
    }
}

// Open an external http(s) URL in the default browser. Unlike `open_path` this
// MUST NOT rewrite '/'→'\' — that corrupts URLs. Electron opened these via
// window.open→setWindowOpenHandler→shell.openExternal; WebView2 ignores
// window.open, so the frontend routes URL opens through this command instead.
#[tauri::command]
fn open_external(url: String) -> Result<Value, String> {
    let u = url.trim();
    if u.is_empty() {
        return Ok(json!({ "success": false, "error": "empty url" }));
    }
    #[cfg(target_os = "windows")]
    {
        match std::process::Command::new("cmd")
            .args(["/C", "start", "", u])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
        {
            Ok(_) => Ok(json!({ "success": true })),
            Err(e) => Ok(json!({ "success": false, "error": e.to_string() })),
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = u;
        Ok(json!({ "success": false, "error": "unsupported platform" }))
    }
}

#[tauri::command]
fn get_open_file_path(app: AppHandle) -> Option<String> {
    app.state::<AppState>().pending_open.lock().unwrap().clone()
}

// ── Windows ────────────────────────────────────────────────
#[tauri::command]
fn open_new_window(app: AppHandle) -> Result<(), String> {
    {
        // A fresh editor window starts blank.
        *app.state::<AppState>().pending_open.lock().unwrap() = None;
    }
    let n = app
        .state::<AppState>()
        .win_counter
        .fetch_add(1, Ordering::SeqCst);
    let label = format!("editor-{}", n);
    let app2 = app.clone();
    app.run_on_main_thread(move || {
        let _ = WebviewWindowBuilder::new(&app2, label, WebviewUrl::App("index.html".into()))
            .title("Hi MD Editor")
            .inner_size(1280.0, 800.0)
            .min_inner_size(900.0, 600.0)
            .build();
    })
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
fn open_schedule_window(
    app: AppHandle,
    content: Option<String>,
    file_name: Option<String>,
) -> Result<(), String> {
    let c = content.unwrap_or_default();
    let f = file_name.filter(|s| !s.is_empty()).unwrap_or_else(|| "스케줄".into());
    *app.state::<AppState>().schedule_last.lock().unwrap() = (c.clone(), f.clone());

    let app2 = app.clone();
    app.run_on_main_thread(move || {
        if let Some(win) = app2.get_webview_window("schedule") {
            let _ = win.set_focus();
            let (c, f) = app2.state::<AppState>().schedule_last.lock().unwrap().clone();
            let _ = win.eval(&build_schedule_inject(&c, &f));
            return;
        }
        let app3 = app2.clone();
        let _ = WebviewWindowBuilder::new(&app2, "schedule", WebviewUrl::App("schedule.html".into()))
            .title("스케줄 뷰어")
            .inner_size(1400.0, 900.0)
            .on_page_load(move |wv, _| {
                let (c, f) = app3.state::<AppState>().schedule_last.lock().unwrap().clone();
                let _ = wv.eval(&build_schedule_inject(&c, &f));
            })
            .build();
    })
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
fn open_spec_window(
    app: AppHandle,
    content: Option<String>,
    file_name: Option<String>,
) -> Result<(), String> {
    let c = content.unwrap_or_default();
    let f = file_name.filter(|s| !s.is_empty()).unwrap_or_else(|| "spec".into());
    *app.state::<AppState>().spec_last.lock().unwrap() = (c.clone(), f.clone());

    let app2 = app.clone();
    app.run_on_main_thread(move || {
        if let Some(win) = app2.get_webview_window("spec") {
            let _ = win.set_focus();
            let (c, f) = app2.state::<AppState>().spec_last.lock().unwrap().clone();
            let _ = win.eval(&build_spec_inject(&c, &f));
            return;
        }
        let app3 = app2.clone();
        let _ = WebviewWindowBuilder::new(&app2, "spec", WebviewUrl::App("specviewer.html".into()))
            .title("Spec Viewer")
            .inner_size(1400.0, 900.0)
            .on_page_load(move |wv, _| {
                let (c, f) = app3.state::<AppState>().spec_last.lock().unwrap().clone();
                let _ = wv.eval(&build_spec_inject(&c, &f));
            })
            .build();
    })
    .map_err(|e| e.to_string())?;
    Ok(())
}

// ── Full-page HTML → PNG capture ───────────────────────────
// TODO: reimplemented on top of WebView2 `CapturePreviewAsync` in a follow-up.
// Until then the frontend degrades gracefully (it alerts with this message).
#[tauri::command(rename_all = "camelCase")]
async fn capture_full_html(
    html: String,
    view_width: Option<f64>,
    scale: Option<f64>,
) -> Result<Value, String> {
    let _ = (html, view_width, scale); // args accepted for API parity; not yet used
    Err("이미지 복사(전체 페이지 캡처)는 현재 준비 중입니다.".into())
}

// ── Entry point ────────────────────────────────────────────
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let args: Vec<String> = std::env::args().collect();
    let pending = find_file_arg(&args);

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.set_focus();
            }
            if let Some(file) = find_file_arg(&argv) {
                let _ = app.emit("open-file", file);
            }
        }))
        .manage(AppState {
            pending_open: Mutex::new(pending),
            schedule_last: Mutex::new((String::new(), "스케줄".into())),
            spec_last: Mutex::new((String::new(), "spec".into())),
            win_counter: AtomicUsize::new(1),
        })
        .register_uri_scheme_protocol("local-image", |_ctx, request| handle_local_image(request))
        .invoke_handler(tauri::generate_handler![
            list_files,
            read_file,
            write_file,
            check_exists,
            open_folder,
            save_dialog,
            reveal_in_explorer,
            open_path,
            open_external,
            create_folder,
            rename_file,
            save_image,
            cleanup_images,
            copy_assets,
            read_image_base64,
            get_open_file_path,
            open_new_window,
            open_schedule_window,
            open_spec_window,
            capture_full_html
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

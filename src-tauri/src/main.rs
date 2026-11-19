#![windows_subsystem = "windows"]

use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::Manager;

fn data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

#[tauri::command]
fn load_state(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let path = data_dir(&app)?.join("data.json");
    if !path.exists() {
        return Ok(serde_json::Value::Null);
    }
    let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&text).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_state(app: tauri::AppHandle, state: serde_json::Value) -> Result<(), String> {
    let path = data_dir(&app)?.join("data.json");
    let tmp = path.with_extension("json.tmp");
    let text = serde_json::to_string_pretty(&state).map_err(|e| e.to_string())?;
    fs::write(&tmp, text).map_err(|e| e.to_string())?;
    if fs::rename(&tmp, &path).is_err() {
        fs::copy(&tmp, &path).map_err(|e| e.to_string())?;
        let _ = fs::remove_file(&tmp);
    }
    Ok(())
}

/// 选择背景图片并复制到应用数据目录，返回复制后的绝对路径。
#[tauri::command]
fn pick_image(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let picked = rfd::FileDialog::new()
        .set_title("选择背景图片")
        .add_filter("图片", &["png", "jpg", "jpeg", "bmp", "webp", "gif"])
        .pick_file();

    let Some(src) = picked else {
        return Ok(None);
    };

    let dir = data_dir(&app)?;
    let ext = src
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("png")
        .to_ascii_lowercase();
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let dst = dir.join(format!("bg-{stamp}.{ext}"));
    fs::copy(&src, &dst).map_err(|e| e.to_string())?;
    Ok(Some(dst.to_string_lossy().to_string()))
}

/// 弹出保存对话框，把文本写入用户选择的文件；取消时返回 None。
#[tauri::command]
fn export_text(default_name: String, content: String) -> Result<Option<String>, String> {
    let picked = rfd::FileDialog::new()
        .set_title("导出近期待办")
        .set_file_name(&default_name)
        .add_filter("文本文件", &["txt"])
        .save_file();

    let Some(path) = picked else {
        return Ok(None);
    };
    let path = if path.extension().is_none() {
        path.with_extension("txt")
    } else {
        path
    };
    fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(Some(path.to_string_lossy().to_string()))
}

/// 代用户请求天气接口，绕开 WebView 的跨域限制。
#[tauri::command]
async fn fetch_json(url: String) -> Result<serde_json::Value, String> {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("仅支持 http/https 链接".into());
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(12))
        .user_agent("desktop-todo/0.1")
        .build()
        .map_err(|e| e.to_string())?;
    let res = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("天气请求失败：HTTP {}", res.status()));
    }
    res.json::<serde_json::Value>()
        .await
        .map_err(|e| format!("天气数据解析失败：{e}"))
}

const AUTOSTART_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
const AUTOSTART_NAME: &str = "DesktopTodo";

static WINDOW_ANIM_GEN: AtomicU64 = AtomicU64::new(0);

/// 在 Rust 侧逐帧移动窗口，避免每帧一次 IPC 在系统繁忙时造成抖动。
#[tauri::command]
async fn animate_window(
    window: tauri::Window,
    x: f64,
    y: f64,
    duration_ms: u64,
) -> Result<(), String> {
    let gen = WINDOW_ANIM_GEN.fetch_add(1, Ordering::SeqCst) + 1;
    let start = window.outer_position().map_err(|e| e.to_string())?;
    let sx = start.x as f64;
    let sy = start.y as f64;
    let steps = (duration_ms as f64 / 8.0).round().max(12.0) as u64;
    let began = std::time::Instant::now();
    for i in 1..=steps {
        if WINDOW_ANIM_GEN.load(Ordering::SeqCst) != gen {
            return Ok(());
        }
        let t = i as f64 / steps as f64;
        let eased = t * t * (3.0 - 2.0 * t);
        let nx = (sx + (x - sx) * eased).round() as i32;
        let ny = (sy + (y - sy) * eased).round() as i32;
        window
            .set_position(tauri::PhysicalPosition::new(nx, ny))
            .map_err(|e| e.to_string())?;
        let target = std::time::Duration::from_millis((duration_ms as f64 * t) as u64);
        let elapsed = began.elapsed();
        if target > elapsed {
            tokio::time::sleep(target - elapsed).await;
        }
    }
    Ok(())
}

#[tauri::command]
fn cancel_window_anim() {
    WINDOW_ANIM_GEN.fetch_add(1, Ordering::SeqCst);
}

#[tauri::command]
fn get_autostart() -> Result<bool, String> {
    #[cfg(windows)]
    {
        let output = std::process::Command::new("reg")
            .args(["query", AUTOSTART_KEY, "/v", AUTOSTART_NAME])
            .output()
            .map_err(|e| e.to_string())?;
        return Ok(output.status.success());
    }
    #[cfg(not(windows))]
    {
        Ok(false)
    }
}

#[tauri::command]
fn set_autostart(enabled: bool) -> Result<bool, String> {
    #[cfg(windows)]
    {
        if enabled {
            let exe = std::env::current_exe().map_err(|e| e.to_string())?;
            let value = exe.to_string_lossy().to_string();
            let status = std::process::Command::new("reg")
                .args([
                    "add",
                    AUTOSTART_KEY,
                    "/v",
                    AUTOSTART_NAME,
                    "/t",
                    "REG_SZ",
                    "/d",
                    &value,
                    "/f",
                ])
                .status()
                .map_err(|e| e.to_string())?;
            if !status.success() {
                return Err("写入开机启动项失败".into());
            }
        } else {
            // 不存在时 reg delete 会返回非 0，这里视为已关闭
            let _ = std::process::Command::new("reg")
                .args(["delete", AUTOSTART_KEY, "/v", AUTOSTART_NAME, "/f"])
                .status();
        }
        return Ok(enabled);
    }
    #[cfg(not(windows))]
    {
        Err("仅支持 Windows".into())
    }
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            load_state,
            save_state,
            pick_image,
            export_text,
            fetch_json,
            animate_window,
            cancel_window_anim,
            get_autostart,
            set_autostart
        ])
        .run(tauri::generate_context!())
        .expect("failed to run desktop todo widget");
}

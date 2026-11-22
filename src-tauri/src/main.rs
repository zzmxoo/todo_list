#![windows_subsystem = "windows"]

use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager};

#[cfg(windows)]
#[link(name = "winmm")]
extern "system" {
    fn timeBeginPeriod(period: u32) -> u32;
}

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
        // OSM Nominatim 使用政策要求可识别的 UA，含应用名与联系方式
        .user_agent("desktop-todo/0.0.7 (https://github.com/zzmxoo/todo_list)")
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

/// 窗口动画缓动：smoothstep，两端速度为 0。
fn ease_in_out(t: f64) -> f64 {
    t * t * (3.0 - 2.0 * t)
}

fn lerp(start: f64, end: f64, t: f64) -> f64 {
    start + (end - start) * t
}

/// 开机启动写入命令的参数单独构造，便于单元测试。
fn autostart_add_args(exe: &str) -> Vec<String> {
    [
        "add",
        AUTOSTART_KEY,
        "/v",
        AUTOSTART_NAME,
        "/t",
        "REG_SZ",
        "/d",
        exe,
        "/f",
    ]
    .iter()
    .map(|value| value.to_string())
    .collect()
}

fn autostart_delete_args() -> Vec<String> {
    ["delete", AUTOSTART_KEY, "/v", AUTOSTART_NAME, "/f"]
        .iter()
        .map(|value| value.to_string())
        .collect()
}

static WINDOW_ANIM_GEN: AtomicU64 = AtomicU64::new(0);

/// 在 Rust 侧逐帧移动窗口，避免每帧一次 IPC 在系统繁忙时造成抖动。
#[tauri::command]
async fn animate_window(
    window: tauri::Window,
    x: f64,
    y: f64,
    duration_ms: u64,
    id: u64,
) -> Result<(), String> {
    let gen = WINDOW_ANIM_GEN.fetch_add(1, Ordering::SeqCst) + 1;
    let start = window.outer_position().map_err(|e| e.to_string())?;
    let _ = window.emit("edge-anim-start", id);
    let sx = start.x as f64;
    let sy = start.y as f64;
    let steps = (duration_ms as f64 / 8.0).round().max(12.0) as u64;
    let began = std::time::Instant::now();
    let mut last_x = i32::MIN;
    let mut last_y = i32::MIN;
    for i in 1..=steps {
        if WINDOW_ANIM_GEN.load(Ordering::SeqCst) != gen {
            return Ok(());
        }
        let t = i as f64 / steps as f64;
        let eased = ease_in_out(t);
        let nx = lerp(sx, x, eased).round() as i32;
        let ny = lerp(sy, y, eased).round() as i32;
        if nx != last_x || ny != last_y {
            window
                .set_position(tauri::PhysicalPosition::new(nx, ny))
                .map_err(|e| e.to_string())?;
            last_x = nx;
            last_y = ny;
        }
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
async fn get_autostart() -> Result<bool, String> {
    #[cfg(windows)]
    {
        let output = tokio::process::Command::new("reg")
            .args(["query", AUTOSTART_KEY, "/v", AUTOSTART_NAME])
            .output()
            .await
            .map_err(|e| e.to_string())?;
        return Ok(output.status.success());
    }
    #[cfg(not(windows))]
    {
        Ok(false)
    }
}

#[tauri::command]
async fn set_autostart(enabled: bool) -> Result<bool, String> {
    #[cfg(windows)]
    {
        if enabled {
            let exe = std::env::current_exe().map_err(|e| e.to_string())?;
            let value = exe.to_string_lossy().to_string();
            let status = tokio::process::Command::new("reg")
                .args(autostart_add_args(&value))
                .status()
                .await
                .map_err(|e| e.to_string())?;
            if !status.success() {
                return Err("写入开机启动项失败".into());
            }
        } else {
            // 不存在时 reg delete 会返回非 0，这里视为已关闭
            let _ = tokio::process::Command::new("reg")
                .args(autostart_delete_args())
                .status()
                .await;
        }
        return Ok(enabled);
    }
    #[cfg(not(windows))]
    {
        Err("仅支持 Windows".into())
    }
}

const TRAY_ID: &str = "main-tray";

fn show_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
    // 通知前端：如果当前是边缘收起状态，立即弹出并启动自动收起计时
    let _ = app.emit("tray-show", ());
}

fn build_tray(app: &tauri::AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let show = MenuItem::with_id(app, "show", "显示主界面", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出程序", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;
    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or("missing default window icon")?;
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .tooltip("桌面待办")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        })
        .build(app)?;
    // 默认不占任务栏，托盘图标先隐藏，由设置决定是否显示
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_visible(false);
    }
    Ok(())
}

/// 隐藏任务栏按钮，并把托盘图标放进系统托盘的隐藏区域。
#[tauri::command]
fn set_taskbar_hidden(
    app: tauri::AppHandle,
    window: tauri::Window,
    enabled: bool,
) -> Result<(), String> {
    window
        .set_skip_taskbar(enabled)
        .map_err(|e| e.to_string())?;
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        tray.set_visible(enabled).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn main() {
    // 提高系统定时器精度到 1ms，保证 Rust 侧窗口动画的逐帧间隔均匀
    #[cfg(windows)]
    unsafe {
        timeBeginPeriod(1);
    }
    tauri::Builder::default()
        .setup(|app| {
            let _ = build_tray(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_state,
            save_state,
            pick_image,
            export_text,
            fetch_json,
            animate_window,
            cancel_window_anim,
            set_taskbar_hidden,
            get_autostart,
            set_autostart
        ])
        .run(tauri::generate_context!())
        .expect("failed to run desktop todo widget");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ease_in_out_hits_endpoints_and_midpoint() {
        assert!((ease_in_out(0.0) - 0.0).abs() < 1e-12);
        assert!((ease_in_out(1.0) - 1.0).abs() < 1e-12);
        assert!((ease_in_out(0.5) - 0.5).abs() < 1e-12);
    }

    #[test]
    fn ease_in_out_is_monotonic() {
        let mut prev = 0.0;
        for i in 0..=100 {
            let value = ease_in_out(i as f64 / 100.0);
            assert!(value >= prev, "not monotonic at step {i}");
            prev = value;
        }
    }

    #[test]
    fn lerp_maps_both_endpoints() {
        assert!((lerp(10.0, 30.0, 0.0) - 10.0).abs() < 1e-12);
        assert!((lerp(10.0, 30.0, 1.0) - 30.0).abs() < 1e-12);
        assert!((lerp(10.0, 30.0, 0.5) - 20.0).abs() < 1e-12);
    }

    #[test]
    fn autostart_add_args_target_same_registry_value() {
        let exe = r"C:\Apps\desktop-todo.exe";
        let args = autostart_add_args(exe);
        assert_eq!(args[0], "add");
        assert!(args.contains(&AUTOSTART_KEY.to_string()));
        assert!(args.contains(&AUTOSTART_NAME.to_string()));
        assert!(args.contains(&exe.to_string()));
        assert_eq!(args.last().map(String::as_str), Some("/f"));
    }

    #[test]
    fn autostart_delete_args_remove_same_registry_value() {
        let args = autostart_delete_args();
        assert_eq!(args[0], "delete");
        assert!(args.contains(&AUTOSTART_KEY.to_string()));
        assert!(args.contains(&AUTOSTART_NAME.to_string()));
        assert_eq!(args.last().map(String::as_str), Some("/f"));
    }
}

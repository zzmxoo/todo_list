#![windows_subsystem = "windows"]

mod ai;

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
    let _guard = ai::inbox::lock_state();
    let path = data_dir(&app)?.join("data.json");
    // 损坏文件会被改名保留并返回错误，前端据此停止写盘，避免覆盖唯一副本。
    ai::inbox::read_state_root(&path)
}

#[tauri::command]
fn save_state(app: tauri::AppHandle, state: serde_json::Value) -> Result<(), String> {
    let _guard = ai::inbox::lock_state();
    let path = data_dir(&app)?.join("data.json");
    ai::inbox::ensure_overwritable(&path)?;
    ai::write_json_atomic(&path, &state)
}

/// 设置页「AI 接入」使用：返回当前 exe 路径和可直接复制的配置片段。
#[tauri::command]
fn get_ai_setup() -> Result<serde_json::Value, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    Ok(ai::install::setup_info(&exe))
}

/// 把外部 AI 工具写进 ai-inbox 的待办合并进 data.json，返回本次新增项。
/// 前端每秒调用一次；桌面端没运行时收件箱文件会保留到下次启动。
#[tauri::command]
fn drain_ai_todos(app: tauri::AppHandle) -> Result<Vec<ai::providers::AiTodo>, String> {
    ai::inbox::drain(&data_dir(&app)?)
}

/// 选择背景图片并复制到应用数据目录，返回复制后的绝对路径。
/// 原生对话框是阻塞调用，放到阻塞线程，避免无边框窗口停止重绘。
#[tauri::command]
async fn pick_image(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let picked = tauri::async_runtime::spawn_blocking(|| {
        rfd::FileDialog::new()
            .set_title("选择背景图片")
            .add_filter("图片", &["png", "jpg", "jpeg", "bmp", "webp", "gif"])
            .pick_file()
    })
    .await
    .map_err(|e| e.to_string())?;

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
async fn export_text(default_name: String, content: String) -> Result<Option<String>, String> {
    let picked = tauri::async_runtime::spawn_blocking(move || {
        rfd::FileDialog::new()
            .set_title("导出近期待办")
            .set_file_name(&default_name)
            .add_filter("文本文件", &["txt"])
            .save_file()
    })
    .await
    .map_err(|e| e.to_string())?;

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

/// 把 reqwest 错误归类成前端可稳定识别的文案。
///
/// reqwest 的 `Display` 对 `Kind::Request` 只输出 `error sending request for url (...)`，
/// 真正的根因（超时、DNS、连接失败）在 source 链里拿不到，前端无法据此判断网络故障。
/// 因此在这里用 `is_timeout` / `is_connect` 归一化，并统一加上 `NET_ERR` 前缀。
fn classify_request_error(err: &reqwest::Error) -> String {
    if err.is_timeout() {
        format!("{NET_ERR}请求超时")
    } else if err.is_connect() {
        format!("{NET_ERR}连接失败")
    } else if err.is_request() {
        format!("{NET_ERR}请求发送失败")
    } else if err.is_body() || err.is_decode() {
        format!("{NET_ERR}响应读取失败")
    } else {
        format!("{NET_ERR}{err}")
    }
}

/// 网络类错误的统一标记，前端据此决定是否退避重试。
const NET_ERR: &str = "NET_ERR:";

/// 代用户请求接口，绕开 WebView 的跨域限制。
#[tauri::command]
async fn fetch_json(url: String) -> Result<serde_json::Value, String> {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("仅支持 http/https 链接".into());
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(12))
        // OSM Nominatim 使用政策要求可识别的 UA；版本号取 Cargo，避免发版后过期
        .user_agent(concat!(
            "desktop-todo/",
            env!("CARGO_PKG_VERSION"),
            " (https://github.com/zzmxoo/todo_list)"
        ))
        .build()
        .map_err(|e| classify_request_error(&e))?;
    let res = client
        .get(&url)
        .send()
        .await
        .map_err(|e| classify_request_error(&e))?;
    if !res.status().is_success() {
        // HTTP 状态错误属于服务端/配置问题，不是网络不可用：不带 NET_ERR 前缀。
        // 5xx 与 429 视为暂时性错误，前端可重试。
        let code = res.status().as_u16();
        let retryable = res.status().is_server_error() || code == 429;
        let prefix = if retryable { NET_ERR } else { "" };
        return Err(format!("{prefix}请求失败：HTTP {code}"));
    }
    // 这是渲染进程唯一的外网通道，限制响应体大小，避免异常接口拖垮进程。
    const MAX_BODY_BYTES: usize = 2 * 1024 * 1024;
    if res
        .content_length()
        .map(|len| len as usize > MAX_BODY_BYTES)
        .unwrap_or(false)
    {
        return Err("响应体过大（超过 2MB）".into());
    }
    let bytes = res
        .bytes()
        .await
        .map_err(|e| classify_request_error(&e))?;
    if bytes.len() > MAX_BODY_BYTES {
        return Err("响应体过大（超过 2MB）".into());
    }
    serde_json::from_slice(&bytes).map_err(|e| format!("数据解析失败：{e}"))
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
/// Run 值必须带引号：路径含空格时，未加引号的命令行会被拆成多个参数。
fn autostart_add_args(exe: &str) -> Vec<String> {
    vec![
        "add".into(),
        AUTOSTART_KEY.into(),
        "/v".into(),
        AUTOSTART_NAME.into(),
        "/t".into(),
        "REG_SZ".into(),
        "/d".into(),
        format!("\"{exe}\""),
        "/f".into(),
    ]
}

fn autostart_delete_args() -> Vec<String> {
    vec![
        "delete".into(),
        AUTOSTART_KEY.into(),
        "/v".into(),
        AUTOSTART_NAME.into(),
        "/f".into(),
    ]
}

/// 固定使用系统目录下的 reg.exe，避免 PATH / 工作目录被替换。
fn reg_exe() -> PathBuf {
    std::env::var_os("SystemRoot")
        .map(|root| PathBuf::from(root).join("System32").join("reg.exe"))
        .unwrap_or_else(|| PathBuf::from("reg"))
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
        // 包身份下注册表方案不生效，直接报告为关闭，避免界面显示与实际不符
        if has_package_identity() {
            return Ok(false);
        }
        let output = tokio::time::timeout(
            std::time::Duration::from_secs(10),
            tokio::process::Command::new(reg_exe())
                .args(["query", AUTOSTART_KEY, "/v", AUTOSTART_NAME])
                .kill_on_drop(true)
                .output(),
        )
        .await
        .map_err(|_| "查询开机启动超时".to_string())?
        .map_err(|e| e.to_string())?;
        return Ok(output.status.success());
    }
    #[cfg(not(windows))]
    {
        Ok(false)
    }
}

/// 判断当前进程是否运行在 MSIX 包身份下。
///
/// 打包运行时写 HKCU\...\Run 会被 Windows 的应用虚拟化重定向到
/// 每个应用私有的 hive，系统的登录启动机制看不到，开机自启会静默失效。
/// 这种情况必须走 StartupTask API，不能沿用注册表方案。
#[cfg(windows)]
fn has_package_identity() -> bool {
    #[link(name = "kernel32")]
    extern "system" {
        fn GetCurrentPackageFullName(len: *mut u32, name: *mut u16) -> i32;
    }
    // APPMODEL_ERROR_NO_PACKAGE = 15700
    const APPMODEL_ERROR_NO_PACKAGE: i32 = 15700;
    let mut len: u32 = 0;
    let rc = unsafe { GetCurrentPackageFullName(&mut len, std::ptr::null_mut()) };
    rc != APPMODEL_ERROR_NO_PACKAGE
}

#[tauri::command]
async fn set_autostart(enabled: bool) -> Result<bool, String> {
    #[cfg(windows)]
    {
        if has_package_identity() {
            return Err("商店版暂不支持开机自启，请使用安装版（NSIS）".into());
        }
        if enabled {
            let exe = std::env::current_exe().map_err(|e| e.to_string())?;
            let value = exe.to_string_lossy().to_string();
            let status = tokio::time::timeout(
                std::time::Duration::from_secs(10),
                tokio::process::Command::new(reg_exe())
                    .args(autostart_add_args(&value))
                    .kill_on_drop(true)
                    .status(),
            )
            .await
            .map_err(|_| "写入开机启动超时".to_string())?
            .map_err(|e| e.to_string())?;
            if !status.success() {
                return Err("写入开机启动项失败".into());
            }
        } else {
            // 不存在时 reg delete 会返回非 0，这里视为已关闭
            let _ = tokio::time::timeout(
                std::time::Duration::from_secs(10),
                tokio::process::Command::new(reg_exe())
                    .args(autostart_delete_args())
                    .kill_on_drop(true)
                    .status(),
            )
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

/// 命名互斥量做单实例保护：双开会用同一份 data.json 交替全量写盘。
/// 拿不到锁时不要阻止启动（例如权限异常），只是放弃单实例保护。
#[cfg(windows)]
fn already_running() -> bool {
    use std::ffi::c_void;
    #[link(name = "kernel32")]
    extern "system" {
        fn CreateMutexW(attributes: *mut c_void, initial_owner: i32, name: *const u16) -> *mut c_void;
        fn GetLastError() -> u32;
    }
    const ERROR_ALREADY_EXISTS: u32 = 183;
    let name: Vec<u16> = "Local\\DesktopTodoWidgetSingleInstance\0"
        .encode_utf16()
        .collect();
    let handle = unsafe { CreateMutexW(std::ptr::null_mut(), 0, name.as_ptr()) };
    if handle.is_null() {
        return false;
    }
    unsafe { GetLastError() == ERROR_ALREADY_EXISTS }
}

fn main() {
    // MCP / CLI 模式不启动窗口：AI 工具通过 stdio 或命令行写入待办。
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|arg| arg == "--mcp") {
        std::process::exit(ai::mcp::run());
    }
    if let Some(code) = ai::install::run(&args) {
        std::process::exit(code);
    }
    if let Some(code) = ai::cli::run(&args) {
        std::process::exit(code);
    }

    // 单实例：第二个进程直接退出，避免两个实例交替覆盖 data.json。
    #[cfg(windows)]
    if already_running() {
        return;
    }

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
            get_ai_setup,
            drain_ai_todos,
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
    fn autostart_add_args_quote_exe_path() {
        let exe = r"C:\Program Files\Todo\desktop-todo.exe";
        let args = autostart_add_args(exe);
        assert_eq!(args[0], "add");
        assert!(args.contains(&AUTOSTART_KEY.to_string()));
        assert!(args.contains(&AUTOSTART_NAME.to_string()));
        assert!(
            args.contains(&format!("\"{exe}\"")),
            "Run value must be quoted: {args:?}"
        );
        assert_eq!(args.last().map(String::as_str), Some("/f"));
    }

    #[test]
    fn reg_exe_is_absolute_when_system_root_exists() {
        if std::env::var_os("SystemRoot").is_some() {
            let path = reg_exe();
            assert!(path.is_absolute(), "reg path: {}", path.display());
            assert!(path.ends_with("System32/reg.exe") || path.ends_with("System32\\reg.exe"));
        }
    }

    #[test]
    fn autostart_delete_args_remove_same_registry_value() {
        let args = autostart_delete_args();
        assert_eq!(args[0], "delete");
        assert!(args.contains(&AUTOSTART_KEY.to_string()));
        assert!(args.contains(&AUTOSTART_NAME.to_string()));
        assert_eq!(args.last().map(String::as_str), Some("/f"));
    }

    /// HTTP 状态错误不能被前端当成「网络不可用」：否则一次 401 会让
    /// networkOk 永久为 false，连带日历悬浮信息失效。
    /// 5xx / 429 属于暂时性错误，需要带 NET_ERR 前缀让前端重试。
    #[test]
    fn http_status_error_prefix_follows_retryability() {
        let msg = |code: u16| {
            let status = reqwest::StatusCode::from_u16(code).unwrap();
            let retryable = status.is_server_error() || code == 429;
            let prefix = if retryable { NET_ERR } else { "" };
            format!("{prefix}请求失败：HTTP {code}")
        };
        // 4xx（认证/找不到）不是网络故障，不带前缀 -> 不重试、不污染 networkOk
        assert!(!msg(401).starts_with(NET_ERR));
        assert!(!msg(403).starts_with(NET_ERR));
        assert!(!msg(404).starts_with(NET_ERR));
        // 5xx / 429 是暂时性的，带前缀 -> 前端退避重试
        assert!(msg(500).starts_with(NET_ERR));
        assert!(msg(503).starts_with(NET_ERR));
        assert!(msg(429).starts_with(NET_ERR));
    }

    /// classify_request_error 必须给所有分支加上 NET_ERR 前缀，
    /// 否则前端无法识别真实的断网/超时。
    #[test]
    fn request_errors_are_prefixed_and_timeout_recognized() {
        // 构造一个真实的连接失败：指向必然拒绝的端口
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let msg = rt.block_on(async {
            let client = reqwest::Client::builder()
                .timeout(std::time::Duration::from_millis(300))
                .build()
                .unwrap();
            // 127.0.0.1 上未监听的端口 -> is_connect
            match client.get("http://127.0.0.1:1/").send().await {
                Ok(_) => String::new(),
                Err(e) => classify_request_error(&e),
            }
        });
        assert!(msg.starts_with(NET_ERR), "expected NET_ERR prefix, got: {msg}");
        assert!(
            msg.contains("连接失败") || msg.contains("请求发送失败") || msg.contains("请求超时"),
            "unexpected message: {msg}"
        );
    }
}

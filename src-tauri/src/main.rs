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
    fn timeEndPeriod(period: u32) -> u32;
}

/// 只在窗口动画期间提高定时器精度，常驻进程不长期锁 1ms。
#[cfg(windows)]
struct TimerPrecision;
#[cfg(windows)]
impl TimerPrecision {
    fn new() -> Self {
        unsafe {
            timeBeginPeriod(1);
        }
        Self
    }
}
#[cfg(windows)]
impl Drop for TimerPrecision {
    fn drop(&mut self) {
        unsafe {
            timeEndPeriod(1);
        }
    }
}

fn data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    // 与 CLI/MCP 共用不受 MSIX 虚拟化影响的用户目录。
    let dir = ai::data_dir()?;
    // 首次升级时把旧 AppData 里的 data.json 复制到新位置（测试目录不迁移）。
    let marker = dir.join(".migrated-from-appdata");
    if ai::data_dir_override().is_none()
        && !dir.join("data.json").exists()
        && !marker.exists()
    {
        // 已有损坏备份时绝不能拿旧副本复活陈旧数据。
        let has_corrupt = fs::read_dir(&dir)
            .map(|entries| {
                entries.flatten().any(|entry| {
                    entry
                        .file_name()
                        .to_str()
                        .map(|name| name.starts_with("data.json.corrupt-"))
                        .unwrap_or(false)
                })
            })
            .unwrap_or(false);
        if !has_corrupt {
            if let Ok(old) = app.path().app_data_dir() {
                let old_file = old.join("data.json");
                if old != dir && old_file.exists() {
                    fs::copy(&old_file, dir.join("data.json")).map_err(|e| {
                        format!(
                            "迁移旧数据失败：{e}；旧文件仍在 {}，请复制到 {} 后重试",
                            old_file.display(),
                            dir.display()
                        )
                    })?;
                    let _ = fs::write(&marker, "migrated");
                    let _ = fs::rename(&old_file, old_file.with_extension("json.migrated"));
                }
            }
        }
    }
    // 新目录已有数据时也记下迁移标记：以后即使 data.json 丢失，也不能拿旧副本复活。
    if ai::data_dir_override().is_none() && dir.join("data.json").exists() && !marker.exists() {
        let _ = fs::write(&marker, "present");
    }
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
    if !state.is_object() {
        return Err("状态格式异常，已拒绝写入".into());
    }
    if state
        .get("todos")
        .map(|value| !value.is_array())
        .unwrap_or(false)
    {
        return Err("待办列表格式异常，已拒绝写入".into());
    }
    if state
        .get("settings")
        .map(|value| !value.is_object())
        .unwrap_or(false)
    {
        return Err("设置格式异常，已拒绝写入".into());
    }
    let _guard = ai::inbox::lock_state();
    let path = data_dir(&app)?.join("data.json");
    ai::inbox::ensure_overwritable(&path)?;
    // 保留上一版完整快照；copy 失败不阻断正常保存。
    if path.exists() {
        let _ = fs::copy(&path, path.with_extension("json.bak"));
    }
    ai::write_json_atomic(&path, &state)
}

/// 全局左键状态：窗口拖动期间 DOM 可能收不到 pointerdown，
/// 边缘收起必须问系统，避免“鼠标还没松就缩进去”。
#[tauri::command]
fn left_button_down() -> bool {
    #[cfg(windows)]
    {
        #[link(name = "user32")]
        extern "system" {
            fn GetAsyncKeyState(key: i32) -> i16;
        }
        const VK_LBUTTON: i32 = 0x01;
        unsafe { (GetAsyncKeyState(VK_LBUTTON) as u16 & 0x8000) != 0 }
    }
    #[cfg(not(windows))]
    {
        false
    }
}

/// 设置页「AI 接入」使用：返回当前 exe 路径和可直接复制的配置片段。
#[tauri::command]
fn get_ai_setup() -> Result<serde_json::Value, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    Ok(ai::install::setup_info(&exe))
}

/// 数据文件异常时，从告警条直接打开数据目录，避免用户自己摸路径。
#[tauri::command]
fn reveal_data_dir(app: tauri::AppHandle) -> Result<(), String> {
    let dir = data_dir(&app)?;
    #[cfg(windows)]
    {
        let explorer = std::env::var_os("SystemRoot")
            .map(|root| PathBuf::from(root).join("explorer.exe"))
            .unwrap_or_else(|| PathBuf::from("explorer.exe"));
        std::process::Command::new(explorer)
            .arg(&dir)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = dir;
        Err("仅支持 Windows".into())
    }
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
    let src_copy = src.clone();
    let dst_copy = dst.clone();
    tauri::async_runtime::spawn_blocking(move || fs::copy(&src_copy, &dst_copy))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
    // 前端只引用 settings.bg_image 一个路径，旧背景图不再需要。
    // 但要跳过当前正在用的那张：前端保存新路径失败时它仍是唯一可显示的图。
    let keep_bg = fs::read(dir.join("data.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(ai::inbox::strip_bom(&bytes)).ok())
        .and_then(|root| {
            root.get("settings")?
                .get("bg_image")?
                .as_str()
                .map(|value| value.to_string())
        });
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path == dst {
                continue;
            }
            if keep_bg.as_deref() == Some(path.to_string_lossy().as_ref()) {
                continue;
            }
            let is_bg = path
                .file_name()
                .and_then(|name| name.to_str())
                .map(|name| name.starts_with("bg-"))
                .unwrap_or(false);
            if is_bg {
                // 只清理一小时前的旧背景，给前端保存新路径留出失败回滚窗口。
                let old = fs::metadata(&path)
                    .and_then(|meta| meta.modified())
                    .ok()
                    .and_then(|time| time.elapsed().ok())
                    .map(|age| age.as_secs() > 3600)
                    .unwrap_or(false);
                if old {
                    let _ = fs::remove_file(path);
                }
            }
        }
    }
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
    let path_for_write = path.clone();
    tauri::async_runtime::spawn_blocking(move || fs::write(&path_for_write, content))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
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

fn ip_blocked(ip: std::net::IpAddr) -> bool {
    match ip {
        std::net::IpAddr::V4(ip) => {
            let o = ip.octets();
            ip.is_loopback()
                || ip.is_private()
                || ip.is_unspecified()
                || ip.is_link_local()
                || o[0] == 0 // 0.0.0.0/8
                || (o[0] == 100 && (64..=127).contains(&o[1])) // 100.64/10 CGNAT/云元数据
                || (o[0] == 198 && (o[1] == 18 || o[1] == 19)) // 198.18/15 基准测试网段
                || o[0] >= 224 // 224/4 组播 + 240/4 保留
                || (o[0] == 192 && o[1] == 0 && o[2] == 2) // TEST-NET-1
                || (o[0] == 198 && o[1] == 51 && o[2] == 100) // TEST-NET-2
                || (o[0] == 203 && o[1] == 0 && o[2] == 113) // TEST-NET-3
        }
        std::net::IpAddr::V6(ip) => {
            if let Some(v4) = ip.to_ipv4_mapped() {
                return ip_blocked(std::net::IpAddr::V4(v4));
            }
            let seg = ip.segments();
            ip.is_loopback()
                || ip.is_unspecified()
                || (seg[0] & 0xfe00) == 0xfc00 // fc00::/7 unique local
                || (seg[0] & 0xffc0) == 0xfe80 // fe80::/10 link local
                || (seg[0] & 0xffc0) == 0xfec0 // fec0::/10 site local (deprecated)
                || seg[0] == 0x2002 // 6to4
                || (seg[0] == 0x0064 && seg[1] == 0xff9b) // NAT64 64:ff9b::/96
        }
    }
}

/// 渲染进程的外网通道不接受本机 / 内网地址，避免被当作 SSRF 代理。
fn is_blocked_host(url: &reqwest::Url) -> bool {
    let Some(host) = url.host_str() else {
        return true;
    };
    // URL 的 IPv6 host_str 可能带方括号；域名末尾的点等价于根域，也要去掉。
    let host = host
        .trim_start_matches('[')
        .trim_end_matches(']')
        .trim_end_matches('.');
    let host_lower = host.to_ascii_lowercase();
    if host_lower == "localhost" || host_lower.ends_with(".localhost") {
        return true;
    }
    host.parse::<std::net::IpAddr>()
        .map(ip_blocked)
        .unwrap_or(false)
}

/// 仅允许自定义天气接口访问本机/内网：从 data.json 里取用户填写的 host 作为白名单。
fn custom_weather_url(app: &tauri::AppHandle) -> Option<reqwest::Url> {
    let dir = data_dir(app).ok()?;
    let bytes = fs::read(dir.join("data.json")).ok()?;
    let root: serde_json::Value =
        serde_json::from_slice(ai::inbox::strip_bom(&bytes)).ok()?;
    let api = root.get("settings")?.get("weather_api")?.as_str()?.trim();
    // 占位符会让 Url::parse 失败；host 部分不含占位符，先去掉花括号再解析。
    let sanitized = api.replace('{', "").replace('}', "");
    reqwest::Url::parse(&sanitized).ok()
}

fn same_origin(a: &reqwest::Url, b: &reqwest::Url) -> bool {
    let host = |url: &reqwest::Url| {
        url.host_str()
            .unwrap_or("")
            .trim_matches(['[', ']'])
            .to_ascii_lowercase()
    };
    a.scheme().eq_ignore_ascii_case(b.scheme())
        && host(a) == host(b)
        && a.port_or_known_default() == b.port_or_known_default()
}

/// HTTP 状态错误属于服务端/配置问题，不是网络不可用；5xx 与 429 可重试。
fn http_status_error(code: u16) -> String {
    let retryable = (500..=599).contains(&code) || code == 429;
    let prefix = if retryable { NET_ERR } else { "" };
    format!("{prefix}请求失败：HTTP {code}")
}

/// 代用户请求接口，绕开 WebView 的跨域限制。
#[tauri::command]
async fn fetch_json(
    app: tauri::AppHandle,
    url: String,
) -> Result<serde_json::Value, String> {
    let parsed = reqwest::Url::parse(&url).map_err(|_| "链接格式不正确".to_string())?;
    if !(parsed.scheme() == "http" || parsed.scheme() == "https") {
        return Err("仅支持 http/https 链接".into());
    }
    // 仅当请求与用户填写的自定义天气接口同源（scheme + host + port）时才允许本机/内网。
    let allowed = custom_weather_url(&app);
    let allow_local = allowed
        .as_ref()
        .map(|custom| same_origin(custom, &parsed))
        .unwrap_or(false);
    if !allow_local && is_blocked_host(&parsed) {
        return Err("不允许访问本机或内网地址".into());
    }
    let redirect = if allow_local {
        // 自定义接口允许跳转，但每一跳都必须仍与自定义接口同源。
        let allow = allowed.clone();
        reqwest::redirect::Policy::custom(move |attempt| {
            if attempt.previous().len() >= 5 {
                return attempt.stop();
            }
            let same = allow
                .as_ref()
                .map(|custom| same_origin(custom, attempt.url()))
                .unwrap_or(false);
            if same {
                attempt.follow()
            } else {
                attempt.stop()
            }
        })
    } else {
        // 公共地址不跟随重定向：否则 302 到 127.0.0.1 可绕过首跳校验。
        reqwest::redirect::Policy::none()
    };
    let mut builder = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(12))
        // 不让环境代理绕过 DNS 钉扎与内网过滤。
        .no_proxy()
        .redirect(redirect)
        // OSM Nominatim 使用政策要求可识别的 UA；版本号取 Cargo，避免发版后过期
        .user_agent(concat!(
            "desktop-todo/",
            env!("CARGO_PKG_VERSION"),
            " (https://github.com/zzmxoo/todo_list)"
        ));
    // 公共域名：预检通过后把地址钉进 client，避免 reqwest 二次解析造成 DNS 重绑定。
    if !allow_local
        && parsed
            .host_str()
            .and_then(|h| h.parse::<std::net::IpAddr>().ok())
            .is_none()
    {
        if let Some(host) = parsed.host_str() {
            let port = parsed.port_or_known_default().unwrap_or(443);
            let addrs = tokio::net::lookup_host((host, port))
                .await
                .map_err(|_| "解析域名失败".to_string())?;
            let pinned: Vec<std::net::SocketAddr> = addrs.collect();
            for addr in &pinned {
                if ip_blocked(addr.ip()) {
                    return Err("不允许访问本机或内网地址".into());
                }
            }
            // resolve_to_addrs 一次保留全部候选地址；循环 resolve 会互相覆盖，
            // 双栈域名只剩最后一个地址时可能整体连不上。
            builder = builder.resolve_to_addrs(host, &pinned);
        }
    }
    let client = builder
        .build()
        .map_err(|e| classify_request_error(&e))?;
    let mut res = client
        .get(parsed)
        .send()
        .await
        .map_err(|e| classify_request_error(&e))?;
    if !res.status().is_success() {
        return Err(http_status_error(res.status().as_u16()));
    }
    // 这是渲染进程唯一的外网通道，边读边限制响应体大小，
    // 不能先 res.bytes() 再校验（chunked 响应会先占满内存）。
    const MAX_BODY_BYTES: usize = 2 * 1024 * 1024;
    if res
        .content_length()
        .map(|len| len as usize > MAX_BODY_BYTES)
        .unwrap_or(false)
    {
        return Err("响应体过大（超过 2MB）".into());
    }
    let mut body = Vec::new();
    while let Some(chunk) = res
        .chunk()
        .await
        .map_err(|e| classify_request_error(&e))?
    {
        if body.len() + chunk.len() > MAX_BODY_BYTES {
            return Err("响应体过大（超过 2MB）".into());
        }
        body.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&body).map_err(|e| format!("数据解析失败：{e}"))
}

#[cfg(not(feature = "test-data-dir"))]
const AUTOSTART_KEY: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
#[cfg(feature = "test-data-dir")]
const AUTOSTART_KEY: &str = r"HKCU\Software\DesktopTodo.Test\Run";
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

/// reg.exe 的输出走 OEM 代码页，中文路径可能被 from_utf8_lossy 变成 U+FFFD；
/// 整路径匹配失败时退化为文件名匹配（文件名是 ASCII，不受编码影响）。
fn autostart_output_matches(stdout: &str, exe: &std::path::Path) -> bool {
    let actual = stdout.to_ascii_lowercase();
    let expected = exe.to_string_lossy().to_ascii_lowercase();
    let name = exe
        .file_name()
        .map(|value| value.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    let non_ascii = exe.to_string_lossy().chars().any(|c| !c.is_ascii());
    actual.contains(&expected) || (non_ascii && !name.is_empty() && actual.contains(&name))
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
    #[cfg(windows)]
    let _timer = TimerPrecision::new();
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
        if !output.status.success() {
            return Ok(false);
        }
        // 值存在但指向旧路径/已删除的 exe 时，登录自启不会生效，开关应显示关闭。
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let actual = String::from_utf8_lossy(&output.stdout);
        return Ok(autostart_output_matches(&actual, &exe));
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
    // 传空缓冲区时打包进程返回 ERROR_INSUFFICIENT_BUFFER(122)，
    // 未打包进程返回 APPMODEL_ERROR_NO_PACKAGE(15700)；其它错误不能当成「已打包」。
    const ERROR_INSUFFICIENT_BUFFER: i32 = 122;
    let mut len: u32 = 0;
    let rc = unsafe { GetCurrentPackageFullName(&mut len, std::ptr::null_mut()) };
    rc == ERROR_INSUFFICIENT_BUFFER || rc == 0
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
            // 删完再查一次：权限/策略导致删除失败时不能假装成功。
            let check = tokio::time::timeout(
                std::time::Duration::from_secs(10),
                tokio::process::Command::new(reg_exe())
                    .args(["query", AUTOSTART_KEY, "/v", AUTOSTART_NAME])
                    .kill_on_drop(true)
                    .output(),
            )
            .await
            .map_err(|_| "校验开机启动删除超时".to_string())?
            .map_err(|e| e.to_string())?;
            if check.status.success() {
                return Err("删除开机启动项失败（可能权限不足）".into());
            }
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
            "quit" => {
                // 前端先 flush 未落盘的改动；3 秒后兜底退出，避免页面卡死关不掉。
                let _ = app.emit("tray-quit", ());
                let handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_secs(8)).await;
                    handle.exit(0);
                });
            }
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

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

/// 隐藏任务栏按钮，并把托盘图标放进系统托盘的隐藏区域。
#[tauri::command]
fn set_taskbar_hidden(
    app: tauri::AppHandle,
    window: tauri::Window,
    enabled: bool,
) -> Result<(), String> {
    if enabled {
        // 托盘缺失时先尝试重新创建一次；仍然失败才拒绝隐藏任务栏。
        let tray = if let Some(tray) = app.tray_by_id(TRAY_ID) {
            tray
        } else {
            build_tray(&app).map_err(|e| format!("托盘重建失败：{e}"))?;
            app.tray_by_id(TRAY_ID)
                .ok_or("托盘创建失败，无法隐藏任务栏；请重启程序后重试")?
        };
        tray.set_visible(true).map_err(|e| e.to_string())?;
        if let Err(err) = window.set_skip_taskbar(true) {
            let _ = tray.set_visible(false);
            return Err(format!("隐藏任务栏失败：{err}"));
        }
    } else {
        window
            .set_skip_taskbar(false)
            .map_err(|e| e.to_string())?;
        if let Some(tray) = app.tray_by_id(TRAY_ID) {
            if let Err(err) = tray.set_visible(false) {
                eprintln!("hide tray failed: {err}");
            }
        }
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
    let global: Vec<u16> = "Global\\DesktopTodoWidgetSingleInstance\0"
        .encode_utf16()
        .collect();
    let mut handle = unsafe { CreateMutexW(std::ptr::null_mut(), 0, global.as_ptr()) };
    if handle.is_null() {
        eprintln!("single-instance: Global mutex failed, retrying Local");
        let local: Vec<u16> = "Local\\DesktopTodoWidgetSingleInstance\0"
            .encode_utf16()
            .collect();
        handle = unsafe { CreateMutexW(std::ptr::null_mut(), 0, local.as_ptr()) };
        if handle.is_null() {
            eprintln!("single-instance: mutex unavailable, protection disabled");
            #[cfg(not(feature = "test-data-dir"))]
            show_message(
                "单实例保护不可用，为避免两个实例互相覆盖数据，本次不启动。",
                "桌面待办",
            );
            // 无法确认是否已有实例时，宁可不启动，也不冒险双开写坏 data.json。
            return true;
        }
    }
    unsafe { GetLastError() == ERROR_ALREADY_EXISTS }
}

/// 无控制台窗口下的兜底提示：启动失败 / 重复启动时至少让用户看到原因。
#[cfg(windows)]
fn show_message(text: &str, caption: &str) {
    use std::ffi::c_void;
    #[link(name = "user32")]
    extern "system" {
        fn MessageBoxW(hwnd: *mut c_void, text: *const u16, caption: *const u16, flags: u32) -> i32;
    }
    let text: Vec<u16> = format!("{text}\0").encode_utf16().collect();
    let caption: Vec<u16> = format!("{caption}\0").encode_utf16().collect();
    const MB_OK: u32 = 0x0;
    const MB_ICONERROR: u32 = 0x10;
    unsafe {
        MessageBoxW(
            std::ptr::null_mut(),
            text.as_ptr(),
            caption.as_ptr(),
            MB_OK | MB_ICONERROR,
        );
    }
}

/// 第二个实例直接退出会让人以为程序打不开（任务栏/托盘可能都被隐藏）。
#[cfg(all(windows, not(feature = "test-data-dir")))]
fn notify_already_running() {
    show_message(
        "桌面待办已经在运行（可能在另一个 Windows 会话、托盘或任务栏）。",
        "桌面待办",
    );
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

    // 单实例：第二个进程提示后退出，避免两个实例交替覆盖 data.json。
    #[cfg(windows)]
    if already_running() {
        #[cfg(not(feature = "test-data-dir"))]
        notify_already_running();
        return;
    }

    let result = tauri::Builder::default()
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // 先让前端 flush 未落盘的改动，再真正销毁；3 秒兜底避免卡死关不掉。
                api.prevent_close();
                let _ = window.emit("window-close-request", ());
                let win = window.clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_secs(8)).await;
                    let _ = win.destroy();
                });
            }
        })
        .setup(|app| {
            if let Err(err) = build_tray(app.handle()) {
                eprintln!("tray init failed: {err}");
                #[cfg(windows)]
                show_message(&format!("托盘初始化失败：{err}"), "桌面待办");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            load_state,
            save_state,
            get_ai_setup,
            reveal_data_dir,
            left_button_down,
            drain_ai_todos,
            pick_image,
            export_text,
            fetch_json,
            animate_window,
            cancel_window_anim,
            set_taskbar_hidden,
            quit_app,
            get_autostart,
            set_autostart
        ])
        .run(tauri::generate_context!());
    if let Err(err) = result {
        eprintln!("failed to run desktop todo widget: {err}");
        #[cfg(windows)]
        show_message(&format!("启动失败：{err}"), "桌面待办");
        std::process::exit(1);
    }
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

    #[test]
    fn autostart_output_falls_back_to_ascii_file_name() {
        let exe = PathBuf::from(r"C:\Users\lenovo\AppData\Local\桌面待办\desktop-todo.exe");
        // 模拟 reg.exe 在 OEM 代码页下把中文路径解成 U+FFFD 的输出
        let stdout = "DesktopTodo    REG_SZ    \"C:\\Users\\lenovo\\AppData\\Local\\���\\desktop-todo.exe\"";
        assert!(autostart_output_matches(stdout, &exe));
        assert!(!autostart_output_matches("DesktopTodo REG_SZ \"C:\\Other\\foo.exe\"", &exe));
        // 纯 ASCII 路径下不同目录的同名 exe 不能误报
        let ascii = PathBuf::from(r"C:\Apps\desktop-todo.exe");
        assert!(!autostart_output_matches(
            "DesktopTodo REG_SZ \"C:\\Old\\desktop-todo.exe\"",
            &ascii
        ));
    }

    #[test]
    fn blocks_local_and_private_fetch_hosts() {
        for url in [
            "http://localhost/x",
            "http://localhost./x",
            "http://FOO.LOCALHOST/x",
            "http://foo.localhost/x",
            "http://127.0.0.1/x",
            "http://10.0.0.1/x",
            "http://192.168.1.2/x",
            "http://169.254.1.1/x",
            "http://100.100.100.200/x",
            "http://0.1.2.3/x",
            "http://198.18.0.1/x",
            "http://[::1]/x",
            "http://[fc00::1]/x",
            "http://[fe80::1]/x",
            "http://[::ffff:127.0.0.1]/x",
        ] {
            let parsed = reqwest::Url::parse(url).unwrap();
            assert!(is_blocked_host(&parsed), "should block {url}");
        }
        let public = reqwest::Url::parse("https://api.open-meteo.com/v1/forecast").unwrap();
        assert!(!is_blocked_host(&public));
    }

    /// HTTP 状态错误不能被前端当成「网络不可用」：否则一次 401 会让
    /// networkOk 永久为 false，连带日历悬浮信息失效。
    /// 5xx / 429 属于暂时性错误，需要带 NET_ERR 前缀让前端重试。
    #[test]
    fn http_status_error_prefix_follows_retryability() {
        let msg = http_status_error;
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

/*!
 * AI 待办接入。
 *
 * 设计目标：让 DeepSeek Harness、WorkBuddy、豆包 CLI 等外部工具以统一的
 * 方式写入待办，同时不把各家的字段差异散落到业务代码里。
 *
 * 链路：
 *   MCP (stdio) / CLI  ->  ai-inbox/<id>.json  ->  桌面端每秒 drain
 *   -> 合并进 data.json（按 id 去重）-> 前端列表刷新
 *
 * 使用文件收件箱而不是本地 HTTP：不占端口、不需要鉴权配置、进程崩溃/桌面端
 * 未启动时消息不会丢；每个条目单独一个文件，写入用临时文件 + rename，避免
 * 半截 JSON。
 */

pub mod cli;
pub mod inbox;
pub mod install;
pub mod mcp;
pub mod providers;

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

pub const APP_IDENTIFIER: &str = "com.desktoptodo.widget";
pub const INBOX_DIR: &str = "ai-inbox";

static AI_SEQ: AtomicU64 = AtomicU64::new(0);

/// 仅测试构建启用：集成测试用临时数据目录，避免碰用户真实 data.json。
#[cfg(feature = "test-data-dir")]
pub fn data_dir_override() -> Option<PathBuf> {
    std::env::var_os("DESKTOP_TODO_DATA_DIR").map(PathBuf::from)
}

#[cfg(not(feature = "test-data-dir"))]
pub fn data_dir_override() -> Option<PathBuf> {
    None
}

/// 不依赖 Tauri AppHandle 的数据目录，供 `--mcp` / `--add` 进程使用。
pub fn data_dir() -> Result<PathBuf, String> {
    if let Some(dir) = data_dir_override() {
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        return Ok(dir);
    }
    let base = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .ok_or_else(|| "APPDATA 未设置".to_string())?;
    let dir = base.join(APP_IDENTIFIER);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

pub fn inbox_dir(dir: &Path) -> Result<PathBuf, String> {
    let path = dir.join(INBOX_DIR);
    fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    Ok(path)
}

/// 生成跨进程唯一的待办 id。
pub fn new_id() -> String {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let seq = AI_SEQ.fetch_add(1, Ordering::SeqCst);
    format!("ai-{stamp}-{}-{seq}", std::process::id())
}

/// UTC ISO-8601 时间，例如 2026-11-23T08:30:00Z。
pub fn now_iso() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;
    let days = secs.div_euclid(86_400);
    let sod = secs.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        sod / 3600,
        (sod % 3600) / 60,
        sod % 60
    )
}

/// Howard Hinnant 的 civil_from_days：Unix epoch 天数 -> 公历年月日。
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (if m <= 2 { y + 1 } else { y }, m as u32, d as u32)
}

/// 原子替换：std::fs::rename 在 Windows 已能覆盖，但这里显式用
/// MoveFileEx(REPLACE_EXISTING|WRITE_THROUGH)，保证替换原子且写穿透到磁盘。
#[cfg(windows)]
pub(crate) fn atomic_replace(tmp: &Path, dst: &Path) -> bool {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "kernel32")]
    extern "system" {
        fn MoveFileExW(from: *const u16, to: *const u16, flags: u32) -> i32;
    }
    const MOVEFILE_REPLACE_EXISTING: u32 = 0x1;
    const MOVEFILE_WRITE_THROUGH: u32 = 0x8;
    let from: Vec<u16> = tmp.as_os_str().encode_wide().chain(Some(0)).collect();
    let to: Vec<u16> = dst.as_os_str().encode_wide().chain(Some(0)).collect();
    unsafe {
        MoveFileExW(
            from.as_ptr(),
            to.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        ) != 0
    }
}

#[cfg(not(windows))]
pub(crate) fn atomic_replace(tmp: &Path, dst: &Path) -> bool {
    fs::rename(tmp, dst).is_ok()
}

/// 原子写 JSON：临时文件 + 原子替换，避免桌面端/外部进程读到半截文件。
/// 临时文件名带 PID：双开时两个进程不会共用同一个临时文件。
/// 替换失败只重试并返回错误，绝不退化成就地 copy（那会制造半截文件）。
pub fn write_json_atomic(path: &Path, value: &serde_json::Value) -> Result<(), String> {
    use std::io::Write;
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("data.json");
    let tmp = path.with_file_name(format!("{name}.{}.tmp", std::process::id()));
    let text = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    let mut file = fs::File::create(&tmp).map_err(|e| e.to_string())?;
    file.write_all(text.as_bytes()).map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())?;
    drop(file);
    for attempt in 0..3 {
        if atomic_replace(&tmp, path) {
            return Ok(());
        }
        if attempt < 2 {
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
    }
    let _ = fs::remove_file(&tmp);
    Err(format!("替换 {} 失败（文件可能被杀软或其它进程占用）", path.display()))
}

#[cfg(test)]
pub(crate) fn test_dir(tag: &str) -> PathBuf {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let dir = std::env::temp_dir().join(format!(
        "desktop-todo-ai-{tag}-{}-{stamp}",
        std::process::id()
    ));
    fs::create_dir_all(&dir).unwrap();
    dir
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn now_iso_has_expected_shape() {
        let text = now_iso();
        assert_eq!(text.len(), 20, "unexpected: {text}");
        assert!(text.starts_with("20"), "unexpected: {text}");
        assert_eq!(&text[4..5], "-");
        assert_eq!(&text[7..8], "-");
        assert_eq!(&text[10..11], "T");
        assert!(text.ends_with('Z'));
    }
}

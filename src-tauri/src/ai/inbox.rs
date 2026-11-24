use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};

use super::providers::AiTodo;
use super::{inbox_dir, write_json_atomic};

/// data.json 的读改写锁：前端保存、AI 收件箱合并都可能同时发生，
/// 没有锁时一次全量 save 会把刚合并的 AI 待办覆盖掉。
pub static STATE_LOCK: Mutex<()> = Mutex::new(());

pub fn lock_state() -> MutexGuard<'static, ()> {
    STATE_LOCK.lock().unwrap_or_else(|poison| poison.into_inner())
}

pub fn enqueue(dir: &Path, todo: &AiTodo) -> Result<PathBuf, String> {
    if todo.id.is_empty()
        || todo.id.contains('/')
        || todo.id.contains('\\')
        || todo.id.contains(':')
        || todo.id.contains("..")
    {
        return Err("待办 id 非法".into());
    }
    let inbox = inbox_dir(dir)?;
    let tmp = inbox.join(format!(".{}.tmp", todo.id));
    let dst = inbox.join(format!("{}.json", todo.id));
    let text = serde_json::to_string_pretty(todo).map_err(|e| e.to_string())?;
    fs::write(&tmp, text).map_err(|e| e.to_string())?;
    if fs::rename(&tmp, &dst).is_err() {
        fs::copy(&tmp, &dst).map_err(|e| e.to_string())?;
        let _ = fs::remove_file(&tmp);
    }
    Ok(dst)
}

fn inbox_files(dir: &Path) -> Result<Vec<PathBuf>, String> {
    let inbox = inbox_dir(dir)?;
    let mut files: Vec<PathBuf> = fs::read_dir(&inbox)
        .map_err(|e| e.to_string())?
        .filter_map(|entry| entry.ok().map(|item| item.path()))
        .filter(|path| {
            path.extension().and_then(|ext| ext.to_str()) == Some("json")
                && !path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .map(|name| name.starts_with('.'))
                    .unwrap_or(false)
        })
        .collect();
    files.sort();
    files.truncate(200);
    Ok(files)
}

fn read_pending(path: &Path) -> Option<AiTodo> {
    let text = fs::read_to_string(path).ok()?;
    serde_json::from_str::<AiTodo>(&text).ok()
}

pub fn pending(dir: &Path) -> Vec<AiTodo> {
    inbox_files(dir)
        .unwrap_or_default()
        .into_iter()
        .filter_map(|path| read_pending(&path))
        .collect()
}

pub fn read_todos(dir: &Path) -> Vec<Value> {
    let path = dir.join("data.json");
    let Ok(text) = fs::read_to_string(path) else {
        return Vec::new();
    };
    let Ok(root) = serde_json::from_str::<Value>(&text) else {
        return Vec::new();
    };
    root.get("todos")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}

fn quarantine(path: &Path) {
    let bad = path.with_extension("bad");
    let _ = fs::remove_file(&bad);
    let _ = fs::rename(path, bad);
}

/// 把损坏的 data.json 改名保留，返回保留后的路径。
/// 改名失败时返回原路径，绝不删除原文件。
fn quarantine_data_file(path: &Path) -> PathBuf {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or_default();
    let mut dst = path.with_file_name(format!("data.json.corrupt-{stamp}"));
    let mut seq = 1;
    while dst.exists() {
        dst = path.with_file_name(format!("data.json.corrupt-{stamp}-{seq}"));
        seq += 1;
    }
    if fs::rename(path, &dst).is_err() {
        return path.to_path_buf();
    }
    dst
}

fn corrupt_error(path: &Path, detail: String) -> String {
    let saved = quarantine_data_file(path);
    if saved == path {
        format!("data.json 已损坏（{detail}），且无法备份原文件，已停止写入")
    } else {
        format!(
            "data.json 已损坏（{detail}），原文件已保留为 {}，本次不写入",
            saved.display()
        )
    }
}

/// 同目录下是否存在损坏备份。`data.json` 被隔离后路径不存在，
/// 但这不等于首次安装：只要还有 `.corrupt-*`，就必须继续报错。
fn find_corrupt_backup(path: &Path) -> Option<PathBuf> {
    let dir = path.parent()?;
    let prefix = format!(
        "{}.corrupt-",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("data.json")
    );
    let mut found: Vec<PathBuf> = fs::read_dir(dir)
        .ok()?
        .filter_map(|entry| entry.ok().map(|item| item.path()))
        .filter(|item| {
            item.file_name()
                .and_then(|name| name.to_str())
                .map(|name| name.starts_with(&prefix))
                .unwrap_or(false)
        })
        .collect();
    found.sort();
    found.pop()
}

fn missing_state_error(path: &Path, saved: &Path) -> String {
    format!(
        "{} 不存在，但发现损坏备份 {}；请先恢复该文件后再启动",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("data.json"),
        saved.display()
    )
}

/// 读取 data.json 根对象：文件不存在且没有损坏备份时返回空对象；
/// 解析失败或根节点不是对象时，先把原文件改名保留再返回错误。
/// 损坏文件绝不能当成空对象继续参与写盘，否则唯一的数据副本会被覆盖。
pub fn read_state_root(path: &Path) -> Result<Value, String> {
    if !path.exists() {
        if let Some(saved) = find_corrupt_backup(path) {
            return Err(missing_state_error(path, &saved));
        }
        return Ok(json!({}));
    }
    let text = fs::read_to_string(path).map_err(|e| format!("读取 data.json 失败：{e}"))?;
    let root = match serde_json::from_str::<Value>(&text) {
        Ok(value) => value,
        Err(err) => return Err(corrupt_error(path, err.to_string())),
    };
    if !root.is_object() {
        return Err(corrupt_error(path, "根节点不是对象".into()));
    }
    Ok(root)
}

/// 写入前的最后一道保护：现有 data.json 必须可解析，否则拒绝覆盖。
/// `data.json` 缺失但存在损坏备份时同样拒绝，避免写出「全新安装」的空壳。
pub fn ensure_overwritable(path: &Path) -> Result<(), String> {
    if !path.exists() {
        if let Some(saved) = find_corrupt_backup(path) {
            return Err(missing_state_error(path, &saved));
        }
        return Ok(());
    }
    let text = fs::read_to_string(path).map_err(|e| format!("读取 data.json 失败：{e}"))?;
    match serde_json::from_str::<Value>(&text) {
        Ok(value) if value.is_object() => Ok(()),
        Ok(_) => Err(corrupt_error(path, "根节点不是对象".into())),
        Err(err) => Err(corrupt_error(path, err.to_string())),
    }
}

/// 读取 ai-inbox 中所有合法条目，合并进 data.json（按 id 去重），
/// 写盘成功后再删除收件箱文件。返回本次真正新增的待办。
pub fn drain(dir: &Path) -> Result<Vec<AiTodo>, String> {
    let files = inbox_files(dir)?;
    if files.is_empty() {
        return Ok(Vec::new());
    }

    let mut entries = Vec::new();
    let mut used = Vec::new();
    for path in files {
        match read_pending(&path) {
            Some(todo) if !todo.text.trim().is_empty() => {
                entries.push(todo);
                used.push(path);
            }
            _ => quarantine(&path),
        }
    }
    if entries.is_empty() {
        return Ok(Vec::new());
    }

    let _guard = lock_state();
    let data_path = dir.join("data.json");
    // 损坏时返回错误并保留原文件；收件箱条目不删除，修复后可重试。
    let mut root = read_state_root(&data_path)?;

    let mut added = Vec::new();
    {
        let object = root.as_object_mut().expect("root is object");
        let todos = object.entry("todos").or_insert_with(|| json!([]));
        if !todos.is_array() {
            *todos = json!([]);
        }
        let list = todos.as_array_mut().expect("todos is array");
        let mut seen: HashSet<String> = list
            .iter()
            .filter_map(|todo| todo.get("id").and_then(Value::as_str))
            .map(ToOwned::to_owned)
            .collect();
        for todo in entries {
            if seen.insert(todo.id.clone()) {
                let value = serde_json::to_value(&todo).map_err(|e| e.to_string())?;
                list.push(value);
                added.push(todo);
            }
        }
    }

    if !added.is_empty() {
        write_json_atomic(&data_path, &root)?;
    }
    // 数据落盘成功后才清理收件箱；中途失败时文件还在，下次会重试。
    for path in used {
        let _ = fs::remove_file(path);
    }
    Ok(added)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::providers::normalize;
    use crate::ai::test_dir;
    use serde_json::json;

    fn todo(id: &str, text: &str) -> AiTodo {
        AiTodo {
            id: id.into(),
            text: text.into(),
            created: "2026-11-23T00:00:00Z".into(),
            due: None,
            start: None,
            pinned: false,
            source: "Test".into(),
            provider: "generic".into(),
        }
    }

    #[test]
    fn enqueue_and_drain_merges_into_data_json() {
        let dir = test_dir("drain");
        enqueue(&dir, &todo("ai-1", "AI 待办")).unwrap();
        let added = drain(&dir).unwrap();
        assert_eq!(added.len(), 1);
        assert_eq!(added[0].text, "AI 待办");
        assert!(!dir.join("ai-inbox").join("ai-1.json").exists());
        let todos = read_todos(&dir);
        assert_eq!(todos.len(), 1);
        assert_eq!(todos[0]["id"], "ai-1");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn drain_is_idempotent_and_quarantines_bad_json() {
        let dir = test_dir("dedupe");
        enqueue(&dir, &todo("ai-2", "只出现一次")).unwrap();
        enqueue(&dir, &todo("ai-2", "只出现一次")).unwrap();
        fs::write(dir.join("ai-inbox").join("broken.json"), "{bad").unwrap();
        let added = drain(&dir).unwrap();
        assert_eq!(added.len(), 1);
        assert_eq!(read_todos(&dir).len(), 1);
        assert!(dir.join("ai-inbox").join("broken.bad").exists());
        assert!(drain(&dir).unwrap().is_empty());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn drain_keeps_corrupt_data_json_and_refuses_to_overwrite() {
        let dir = test_dir("corrupt");
        let data_path = dir.join("data.json");
        let original = "{\"todos\": [ broken";
        fs::write(&data_path, original).unwrap();
        enqueue(&dir, &todo("ai-4", "不能覆盖")).unwrap();

        let err = drain(&dir).unwrap_err();
        assert!(err.contains("损坏"), "unexpected error: {err}");

        let saved: Vec<PathBuf> = fs::read_dir(&dir)
            .unwrap()
            .filter_map(|entry| entry.ok().map(|item| item.path()))
            .filter(|path| {
                path.file_name()
                    .and_then(|name| name.to_str())
                    .map(|name| name.starts_with("data.json.corrupt-"))
                    .unwrap_or(false)
            })
            .collect();
        assert_eq!(saved.len(), 1, "corrupt data.json should be kept");
        assert_eq!(fs::read_to_string(&saved[0]).unwrap(), original);
        assert!(!data_path.exists(), "corrupt data.json must not stay in place");
        assert!(
            dir.join("ai-inbox").join("ai-4.json").exists(),
            "inbox item should stay for the next retry"
        );

        // 第二次 tick：data.json 已被隔离，但存在 .corrupt-* 时仍必须报错，
        // 不能走「首次安装」分支写出只含 AI 条目的空壳数据。
        let second = drain(&dir).unwrap_err();
        assert!(second.contains("损坏备份"), "unexpected error: {second}");
        assert!(!data_path.exists(), "second drain must not create data.json");
        assert!(dir.join("ai-inbox").join("ai-4.json").exists());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn missing_state_with_corrupt_backup_is_not_a_fresh_install() {
        let dir = test_dir("restart");
        let data_path = dir.join("data.json");
        fs::write(&data_path, "{bad").unwrap();

        let first = read_state_root(&data_path).unwrap_err();
        assert!(first.contains("损坏"), "unexpected error: {first}");

        // 模拟重启：data.json 不存在，但同目录有 .corrupt-*。
        let err = read_state_root(&data_path).unwrap_err();
        assert!(err.contains("损坏备份"), "unexpected error: {err}");
        assert!(err.contains("data.json.corrupt-"), "unexpected error: {err}");
        assert!(ensure_overwritable(&data_path).is_err());

        // 用户恢复出合法的 data.json 后应立即恢复可读写，旧的 .corrupt 不影响启动。
        fs::write(&data_path, "{\"todos\":[]}").unwrap();
        assert!(read_state_root(&data_path).is_ok());
        assert!(ensure_overwritable(&data_path).is_ok());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn save_guard_rejects_corrupt_file_and_allows_valid_one() {
        let dir = test_dir("save-guard");
        let data_path = dir.join("data.json");
        fs::write(&data_path, "not json").unwrap();

        let err = ensure_overwritable(&data_path).unwrap_err();
        assert!(err.contains("损坏"), "unexpected error: {err}");
        assert!(!data_path.exists());

        fs::write(&data_path, "{\"todos\":[]}").unwrap();
        assert!(ensure_overwritable(&data_path).is_ok());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn normalize_then_enqueue_keeps_provider_metadata() {
        let dir = test_dir("meta");
        let todo = normalize(
            "workbuddy",
            &json!({"title": "整理会议纪要", "deadline": "2026-11-24"}),
        )
        .unwrap();
        enqueue(&dir, &todo).unwrap();
        let added = drain(&dir).unwrap();
        assert_eq!(added[0].provider, "workbuddy");
        assert_eq!(added[0].source, "WorkBuddy");
        assert_eq!(
            added[0].due.as_deref(),
            Some("2026-11-24T18:00:00")
        );
        let _ = fs::remove_dir_all(dir);
    }
}

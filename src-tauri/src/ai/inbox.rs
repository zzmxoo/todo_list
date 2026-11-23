use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

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
    let mut root = if data_path.exists() {
        let text = fs::read_to_string(&data_path).map_err(|e| e.to_string())?;
        serde_json::from_str::<Value>(&text).unwrap_or_else(|_| json!({}))
    } else {
        json!({})
    };
    if !root.is_object() {
        root = json!({});
    }

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

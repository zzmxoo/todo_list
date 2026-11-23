use serde_json::json;

use super::inbox::enqueue;
use super::providers::normalize;
use super::data_dir;

#[derive(Debug, PartialEq)]
pub struct AddOptions {
    pub text: String,
    pub due: Option<String>,
    pub start: Option<String>,
    pub duration: Option<String>,
    pub provider: String,
    pub source: Option<String>,
    pub pinned: bool,
}

fn take_value(args: &[String], index: usize, flag: &str) -> Result<(String, usize), String> {
    let arg = &args[index];
    if let Some(value) = arg.strip_prefix(&format!("{flag}=")) {
        return Ok((value.to_string(), index + 1));
    }
    let value = args
        .get(index + 1)
        .ok_or_else(|| format!("{flag} 缺少参数"))?;
    if value.starts_with("--") {
        return Err(format!("{flag} 缺少参数"));
    }
    Ok((value.clone(), index + 2))
}

/// 解析 `--add` 模式；没有 --add / --todo 时返回 None，继续走 GUI。
pub fn parse_args(args: &[String]) -> Result<Option<AddOptions>, String> {
    let has_add = args
        .iter()
        .any(|arg| arg == "--add" || arg == "--todo" || arg.starts_with("--add=") || arg.starts_with("--todo="));
    if !has_add {
        return Ok(None);
    }

    let mut text = None;
    let mut due = None;
    let mut start = None;
    let mut duration = None;
    let mut provider = "cli".to_string();
    let mut source = None;
    let mut pinned = false;
    // argv[0] 是 exe 路径，不参与参数解析
    let mut index = if args.first().map(|arg| !arg.starts_with("--")).unwrap_or(false) {
        1
    } else {
        0
    };
    while index < args.len() {
        let arg = &args[index];
        match arg.as_str() {
            "--add" | "--todo" => {
                let (value, next) = take_value(args, index, arg)?;
                text = Some(value);
                index = next;
            }
            "--due" => {
                let (value, next) = take_value(args, index, "--due")?;
                due = Some(value);
                index = next;
            }
            "--start" => {
                let (value, next) = take_value(args, index, "--start")?;
                start = Some(value);
                index = next;
            }
            "--duration" => {
                let (value, next) = take_value(args, index, "--duration")?;
                duration = Some(value);
                index = next;
            }
            "--provider" => {
                let (value, next) = take_value(args, index, "--provider")?;
                provider = value;
                index = next;
            }
            "--source" => {
                let (value, next) = take_value(args, index, "--source")?;
                source = Some(value);
                index = next;
            }
            "--pinned" => {
                pinned = true;
                index += 1;
            }
            _ if arg.starts_with("--add=") || arg.starts_with("--todo=") => {
                let (value, next) = take_value(args, index, arg.split('=').next().unwrap())?;
                text = Some(value);
                index = next;
            }
            _ if arg.starts_with("--due=") => {
                due = Some(arg["--due=".len()..].to_string());
                index += 1;
            }
            _ if arg.starts_with("--start=") => {
                start = Some(arg["--start=".len()..].to_string());
                index += 1;
            }
            _ if arg.starts_with("--duration=") => {
                duration = Some(arg["--duration=".len()..].to_string());
                index += 1;
            }
            _ if arg.starts_with("--provider=") => {
                provider = arg["--provider=".len()..].to_string();
                index += 1;
            }
            _ if arg.starts_with("--source=") => {
                source = Some(arg["--source=".len()..].to_string());
                index += 1;
            }
            _ => {
                // GUI 模式可能带 WebView2 参数；只有 --add 模式才把未知参数当错误
                return Err(format!("未知参数：{arg}"));
            }
        }
    }

    let text = text
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "--add 需要待办内容".to_string())?;
    Ok(Some(AddOptions {
        text,
        due,
        start,
        duration,
        provider,
        source,
        pinned,
    }))
}

/// 返回 Some(exit_code) 表示这是 CLI 调用，不应启动 GUI。
pub fn run(args: &[String]) -> Option<i32> {
    let options = match parse_args(args) {
        Ok(Some(options)) => options,
        Ok(None) => return None,
        Err(err) => {
            eprintln!("desktop-todo: {err}");
            return Some(2);
        }
    };

    let dir = match data_dir() {
        Ok(dir) => dir,
        Err(err) => {
            eprintln!("desktop-todo: {err}");
            return Some(1);
        }
    };
    let input = json!({
        "text": options.text,
        "due": options.due,
        "start": options.start,
        "duration": options.duration,
        "provider": options.provider,
        "source": options.source,
        "pinned": options.pinned
    });
    let todo = match normalize(&options.provider, &input) {
        Ok(todo) => todo,
        Err(err) => {
            eprintln!("desktop-todo: {err}");
            return Some(2);
        }
    };
    match enqueue(&dir, &todo) {
        Ok(path) => {
            println!(
                "{}",
                json!({
                    "ok": true,
                    "id": todo.id,
                    "text": todo.text,
                    "due": todo.due,
                    "provider": todo.provider,
                    "source": todo.source,
                    "inbox": path.to_string_lossy()
                })
            );
            Some(0)
        }
        Err(err) => {
            eprintln!("desktop-todo: {err}");
            Some(1)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| value.to_string()).collect()
    }

    #[test]
    fn parses_add_with_metadata() {
        let parsed = parse_args(&args(&[
            "desktop-todo.exe",
            "--add",
            "写周报",
            "--due",
            "2026-11-24",
            "--start",
            "2026-11-24T09:00",
            "--duration",
            "1小时",
            "--provider",
            "dsh",
            "--source",
            "DeepSeek Harness",
            "--pinned",
        ]))
        .unwrap()
        .unwrap();
        assert_eq!(parsed.text, "写周报");
        assert_eq!(parsed.due.as_deref(), Some("2026-11-24"));
        assert_eq!(parsed.start.as_deref(), Some("2026-11-24T09:00"));
        assert_eq!(parsed.duration.as_deref(), Some("1小时"));
        assert_eq!(parsed.provider, "dsh");
        assert_eq!(parsed.source.as_deref(), Some("DeepSeek Harness"));
        assert!(parsed.pinned);
    }

    #[test]
    fn parses_equals_form() {
        let parsed = parse_args(&args(&[
            "desktop-todo.exe",
            "--add=买牛奶",
            "--due=2026-11-25 09:00",
            "--provider=doubao",
        ]))
        .unwrap()
        .unwrap();
        assert_eq!(parsed.text, "买牛奶");
        assert_eq!(parsed.due.as_deref(), Some("2026-11-25 09:00"));
        assert_eq!(parsed.provider, "doubao");
    }

    #[test]
    fn ignores_non_cli_launch() {
        assert!(parse_args(&args(&["desktop-todo.exe"])).unwrap().is_none());
    }

    #[test]
    fn rejects_empty_text() {
        assert!(parse_args(&args(&["desktop-todo.exe", "--add", "  "])).is_err());
        assert!(parse_args(&args(&["desktop-todo.exe", "--add"])).is_err());
    }
}

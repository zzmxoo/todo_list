use std::fs;
use std::path::{Path, PathBuf};

use serde_json::{json, Value};

use super::write_json_atomic;

const PLUGIN_NAME: &str = "desktop-todo";
const PLUGIN_DESCRIPTION: &str =
    "待办事项：通过 MCP 把待办、提醒和会议写入桌面待办小组件。";

pub fn generic_config(exe: &Path) -> String {
    let value = json!({
        "mcpServers": {
            PLUGIN_NAME: {
                "type": "stdio",
                "command": exe.to_string_lossy(),
                "args": ["--mcp"]
            }
        }
    });
    serde_json::to_string_pretty(&value).unwrap_or_default()
}

/// 设置页「AI 接入」用的动态内容：路径跟随当前 exe，避免安装目录变化后文案过期。
pub fn setup_info(exe: &Path) -> Value {
    let quoted = format!("\"{}\"", exe.to_string_lossy());
    json!({
        "exe": exe.to_string_lossy(),
        "mcpJson": generic_config(exe),
        "dshCommand": format!("{quoted} --install-mcp dsh"),
        "dshYaml": dsh_config(exe),
        "cliExample": format!(
            "{quoted} --add \"方案评审\" --start \"2026-11-27T10:30\" --duration \"1小时\" --provider doubao"
        )
    })
}

fn write_plugin(exe: &Path, plugin_dir: &Path) -> Result<(), String> {
    let manifest_dir = plugin_dir.join(".codebuddy-plugin");
    fs::create_dir_all(&manifest_dir).map_err(|e| e.to_string())?;
    let manifest = json!({
        "name": PLUGIN_NAME,
        "version": env!("CARGO_PKG_VERSION"),
        "description": PLUGIN_DESCRIPTION,
        "author": { "name": "desktop-todo" },
        "license": "MIT",
        "keywords": ["todo", "mcp", "待办", "提醒", "会议"],
        "category": "mcp-app"
    });
    write_json_atomic(&manifest_dir.join("plugin.json"), &manifest)?;

    let mcp = json!({
        "mcpServers": {
            PLUGIN_NAME: {
                "type": "stdio",
                "command": exe.to_string_lossy(),
                "args": ["--mcp"],
                "defer_loading": false
            }
        }
    });
    write_json_atomic(&plugin_dir.join(".mcp.json"), &mcp)?;
    Ok(())
}

fn upsert_marketplace(manifest_path: &Path, plugin_dir_name: &str) -> Result<(), String> {
    let mut root: Value = if manifest_path.exists() {
        let backup = manifest_path.with_extension("json.bak-todo");
        let _ = fs::copy(manifest_path, &backup);
        let text = fs::read_to_string(manifest_path).map_err(|e| e.to_string())?;
        serde_json::from_str(&text).unwrap_or_else(|_| json!({ "plugins": [] }))
    } else {
        json!({ "plugins": [] })
    };
    if !root.is_object() {
        root = json!({ "plugins": [] });
    }
    let object = root.as_object_mut().expect("object");
    let list = object.entry("plugins").or_insert_with(|| json!([]));
    if !list.is_array() {
        *list = json!([]);
    }
    let plugins = list.as_array_mut().expect("array");
    plugins.retain(|item| item.get("name").and_then(Value::as_str) != Some(PLUGIN_NAME));
    plugins.push(json!({
        "name": PLUGIN_NAME,
        "description": PLUGIN_DESCRIPTION,
        "version": env!("CARGO_PKG_VERSION"),
        "source": format!("./plugins/{plugin_dir_name}"),
        "license": "MIT",
        "keywords": ["todo", "mcp", "待办", "提醒", "会议"],
        "category": "效率"
    }));
    write_json_atomic(manifest_path, &root)
}

/// 把 MCP 服务注册到 WorkBuddy 的本地插件市场。插件仍需用户在
/// WorkBuddy 里点一次“安装/启用”——MCP 客户端不应静默安装外部进程。
pub fn install_workbuddy(home: &Path, exe: &Path) -> Result<String, String> {
    let local = home
        .join(".workbuddy")
        .join("plugins")
        .join("marketplaces")
        .join("local");
    if !local.exists() {
        return Err("未找到 WorkBuddy 本地插件市场（~/.workbuddy/plugins/marketplaces/local）".into());
    }
    let plugin_dir = local.join("plugins").join(PLUGIN_NAME);
    fs::create_dir_all(&plugin_dir).map_err(|e| e.to_string())?;
    write_plugin(exe, &plugin_dir)?;
    upsert_marketplace(&local.join(".codebuddy-plugin").join("marketplace.json"), PLUGIN_NAME)?;
    Ok(format!(
        "已写入 WorkBuddy 本地插件市场：{}\n请在 WorkBuddy → 插件市场 → 本地 中安装/启用「待办事项」，然后重开会话。",
        plugin_dir.display()
    ))
}

fn yaml_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

pub fn dsh_config(exe: &Path) -> String {
    let command = yaml_quote(&exe.to_string_lossy());
    format!(
        "# 由 desktop-todo --install-mcp dsh 生成；把下面这一项合并进 ~/.dsh/profiles/web/cordis.patch.yml\n\
- name: '@deepseek-ai/dsh-mcp-client'\n\
  config:\n\
    serverName: desktop-todo\n\
    transport: stdio\n\
    command: {command}\n\
    args: ['--mcp']\n\
    toolCallTimeoutMs: 15000\n\
    failOnStartupError: true\n"
    )
}

pub fn install_dsh(home: &Path, exe: &Path) -> Result<String, String> {
    let dsh = home.join(".dsh");
    let text = dsh_config(exe);
    if !dsh.exists() {
        return Ok(format!(
            "未检测到 ~/.dsh（DeepSeek Harness 未安装或未初始化）。配置片段：\n{text}"
        ));
    }
    let target = dsh.join("desktop-todo.mcp.yml");
    fs::write(&target, text).map_err(|e| e.to_string())?;
    Ok(format!(
        "已生成 {}\n请把文件中的条目合并到 ~/.dsh/profiles/web/cordis.patch.yml，然后重启 dsh。",
        target.display()
    ))
}

fn take_value(args: &[String], index: usize, flag: &str) -> Option<(String, usize)> {
    let arg = &args[index];
    if let Some(value) = arg.strip_prefix(&format!("{flag}=")) {
        return Some((value.to_string(), index + 1));
    }
    args.get(index + 1).map(|value| (value.clone(), index + 2))
}

/// 返回 Some(exit_code) 表示这是安装命令，不启动 GUI。
pub fn run(args: &[String]) -> Option<i32> {
    let mut client = None;
    let mut exe = None;
    let mut index = 0;
    let mut found = false;
    while index < args.len() {
        let arg = &args[index];
        if arg == "--install-mcp" || arg.starts_with("--install-mcp=") {
            found = true;
            if let Some((value, next)) = take_value(args, index, "--install-mcp") {
                client = Some(value);
                index = next;
            } else {
                eprintln!("desktop-todo: --install-mcp 需要客户端名称（workbuddy / dsh / generic）");
                return Some(2);
            }
        } else if arg == "--exe" || arg.starts_with("--exe=") {
            if let Some((value, next)) = take_value(args, index, "--exe") {
                exe = Some(value);
                index = next;
            } else {
                eprintln!("desktop-todo: --exe 需要程序路径");
                return Some(2);
            }
        } else {
            index += 1;
        }
    }
    if !found {
        return None;
    }
    let client = client.unwrap_or_default().to_ascii_lowercase();
    let exe = match exe {
        Some(path) => PathBuf::from(path),
        None => std::env::current_exe().unwrap_or_else(|_| PathBuf::from("desktop-todo.exe")),
    };
    let home = match std::env::var_os("USERPROFILE") {
        Some(value) => PathBuf::from(value),
        None => {
            eprintln!("desktop-todo: USERPROFILE 未设置");
            return Some(1);
        }
    };
    let result = match client.as_str() {
        "workbuddy" | "wb" => install_workbuddy(&home, &exe),
        "dsh" | "deepseek-harness" => install_dsh(&home, &exe),
        "generic" | "json" => {
            println!("{}", generic_config(&exe));
            return Some(0);
        }
        _ => Err("客户端只支持 workbuddy / dsh / generic".to_string()),
    };
    match result {
        Ok(message) => {
            println!("{message}");
            Some(0)
        }
        Err(err) => {
            eprintln!("desktop-todo: {err}");
            Some(2)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::test_dir;

    #[test]
    fn workbuddy_plugin_is_idempotent_and_keeps_existing_plugins() {
        let home = test_dir("wb-install");
        let local = home
            .join(".workbuddy")
            .join("plugins")
            .join("marketplaces")
            .join("local");
        fs::create_dir_all(local.join(".codebuddy-plugin")).unwrap();
        fs::write(
            local.join(".codebuddy-plugin").join("marketplace.json"),
            r#"{"name":"local","plugins":[{"name":"other","source":"./plugins/other"}]}"#,
        )
        .unwrap();
        let exe = PathBuf::from(r"C:\Apps\desktop-todo.exe");
        install_workbuddy(&home, &exe).unwrap();
        install_workbuddy(&home, &exe).unwrap();

        let manifest: Value = serde_json::from_str(
            &fs::read_to_string(local.join(".codebuddy-plugin").join("marketplace.json")).unwrap(),
        )
        .unwrap();
        let plugins = manifest["plugins"].as_array().unwrap();
        assert_eq!(plugins.len(), 2, "existing plugin kept, no duplicate");
        assert_eq!(plugins.iter().filter(|p| p["name"] == "desktop-todo").count(), 1);
        assert!(local.join("plugins").join("desktop-todo").join(".mcp.json").exists());
        let mcp = fs::read_to_string(
            local.join("plugins").join("desktop-todo").join(".mcp.json"),
        )
        .unwrap();
        assert!(mcp.contains("--mcp"));
        assert!(mcp.contains("desktop-todo.exe"));
        let _ = fs::remove_dir_all(home);
    }

    #[test]
    fn generic_config_contains_stdio_command() {
        let text = generic_config(Path::new(r"D:\Tools\Todos\desktop-todo.exe"));
        assert!(text.contains("mcpServers"));
        assert!(text.contains("--mcp"));
        assert!(text.contains("desktop-todo.exe"));
    }

    #[test]
    fn setup_info_uses_current_exe_path() {
        let info = setup_info(Path::new(r"D:\Apps\desktop-todo.exe"));
        assert!(info["mcpJson"].as_str().unwrap().contains("--mcp"));
        assert!(info["dshYaml"].as_str().unwrap().contains("cordis.patch.yml"));
        assert!(info["cliExample"].as_str().unwrap().contains("--provider doubao"));
        assert_eq!(info["exe"], r"D:\Apps\desktop-todo.exe");
    }

    #[test]
    fn dsh_without_install_prints_snippet() {
        let home = test_dir("dsh-missing");
        let message = install_dsh(&home, Path::new(r"C:\Apps\desktop-todo.exe")).unwrap();
        assert!(message.contains("cordis.patch.yml"));
        assert!(message.contains("desktop-todo"));
        let _ = fs::remove_dir_all(home);
    }

    #[test]
    fn dsh_installed_writes_snippet_file() {
        let home = test_dir("dsh-install");
        fs::create_dir_all(home.join(".dsh")).unwrap();
        install_dsh(&home, Path::new(r"C:\Apps\desktop-todo.exe")).unwrap();
        let text = fs::read_to_string(home.join(".dsh").join("desktop-todo.mcp.yml")).unwrap();
        assert!(text.contains("serverName: desktop-todo"));
        assert!(text.contains("--mcp"));
        let _ = fs::remove_dir_all(home);
    }
}

use std::collections::HashSet;
use std::io::{self, BufRead, Write};
use std::path::Path;

use serde_json::{json, Value};

use super::inbox;
use super::inbox::enqueue;
use super::providers::{normalize, AiTodo};
use super::data_dir;

const PROTOCOL_VERSION: &str = "2024-11-05";
const SERVER_NAME: &str = "desktop-todo";

fn tool_result(text: impl Into<String>, is_error: bool) -> Value {
    json!({
        "content": [{ "type": "text", "text": text.into() }],
        "isError": is_error
    })
}

fn tools() -> Value {
    json!([
        {
            "name": "add_todo",
            "description": "向桌面待办小组件添加一条待办。普通截止用 due；会议/事件用 start + duration_minutes（或 time + duration），会自动算结束时间。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "text": { "type": "string", "description": "待办内容/会议名称，必填" },
                    "due": { "type": "string", "description": "截止时间，YYYY-MM-DD 或 ISO 8601" },
                    "start": { "type": "string", "description": "会议/事件开始时间，YYYY-MM-DDTHH:MM 或 YYYY-MM-DD HH:MM" },
                    "time": { "type": "string", "description": "会议开始时间的别名；配合 duration 使用" },
                    "duration_minutes": { "type": "integer", "description": "时长（分钟）。会议示例：start 10:30 + 60 => 10:30–11:30" },
                    "duration": { "type": "string", "description": "时长文本，如 1小时 / 90分钟；与 duration_minutes 二选一" },
                    "pinned": { "type": "boolean", "description": "是否置顶" },
                    "provider": { "type": "string", "description": "来源 id，如 deepseek-harness / workbuddy / doubao" },
                    "source": { "type": "string", "description": "来源显示名称，如 DeepSeek Harness" }
                },
                "required": ["text"]
            }
        },
        {
            "name": "add_todos",
            "description": "批量添加待办。todos 内每一项支持 text/due/start/duration_minutes/pinned，外层可统一指定 provider/source。",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "todos": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "text": { "type": "string" },
                                "due": { "type": "string" },
                                "start": { "type": "string" },
                                "duration_minutes": { "type": "integer" },
                                "pinned": { "type": "boolean" }
                            },
                            "required": ["text"]
                        }
                    },
                    "provider": { "type": "string" },
                    "source": { "type": "string" }
                },
                "required": ["todos"]
            }
        },
        {
            "name": "list_todos",
            "description": "列出当前未完成的待办，便于 AI 查看已有事项、避免重复添加。",
            "inputSchema": { "type": "object", "properties": {} }
        }
    ])
}

fn outer_str<'a>(args: &'a Value, key: &str) -> Option<&'a str> {
    args.get(key).and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty())
}

fn enrich(item: &Value, outer_provider: Option<&str>, outer_source: Option<&str>) -> Value {
    let mut value = item.clone();
    if let Some(object) = value.as_object_mut() {
        if !object.contains_key("provider") {
            if let Some(provider) = outer_provider {
                object.insert("provider".into(), json!(provider));
            }
        }
        if !object.contains_key("source") {
            if let Some(source) = outer_source {
                object.insert("source".into(), json!(source));
            }
        }
    }
    value
}

fn add_todo(args: &Value, dir: &Path) -> Result<Value, String> {
    let provider = outer_str(args, "provider").unwrap_or("mcp");
    let mut input = args.clone();
    if let Some(object) = input.as_object_mut() {
        object.remove("todos");
    }
    let todo = normalize(provider, &input)?;
    enqueue(dir, &todo)?;
    Ok(tool_result(
        format!("已添加待办：{}", todo.text),
        false,
    ))
}

fn add_todos(args: &Value, dir: &Path) -> Result<Value, String> {
    let items = args
        .get("todos")
        .and_then(Value::as_array)
        .ok_or_else(|| "todos 必须是数组".to_string())?;
    if items.is_empty() {
        return Err("todos 不能为空".into());
    }
    if items.len() > 50 {
        return Err("一次最多添加 50 条".into());
    }
    let provider = outer_str(args, "provider").unwrap_or("mcp");
    let source = outer_str(args, "source");
    let mut normalized: Vec<AiTodo> = Vec::with_capacity(items.len());
    for (index, item) in items.iter().enumerate() {
        let value = enrich(item, Some(provider), source);
        let todo = normalize(provider, &value)
            .map_err(|err| format!("第 {} 条：{err}", index + 1))?;
        normalized.push(todo);
    }
    for todo in &normalized {
        enqueue(dir, todo)?;
    }
    Ok(tool_result(
        format!("已添加 {} 条待办", normalized.len()),
        false,
    ))
}

fn list_open_todos(dir: &Path) -> Result<Value, String> {
    let mut seen = HashSet::new();
    let mut items = Vec::new();
    for todo in inbox::read_todos(dir) {
        let Some(id) = todo.get("id").and_then(Value::as_str) else {
            continue;
        };
        if todo.get("done").and_then(Value::as_bool).unwrap_or(false) {
            continue;
        }
        if !seen.insert(id.to_string()) {
            continue;
        }
        items.push(json!({
            "id": id,
            "text": todo.get("text").cloned().unwrap_or(json!("")),
            "due": todo.get("due").cloned().unwrap_or(Value::Null),
            "pinned": todo.get("pinned").cloned().unwrap_or(json!(false)),
            "source": todo.get("source").cloned().unwrap_or(json!("")),
            "provider": todo.get("provider").cloned().unwrap_or(json!(""))
        }));
    }
    for todo in inbox::pending(dir) {
        if seen.insert(todo.id.clone()) {
            items.push(json!({
                "id": todo.id,
                "text": todo.text,
                "due": todo.due,
                "pinned": todo.pinned,
                "source": todo.source,
                "provider": todo.provider
            }));
        }
    }
    let payload = json!({ "count": items.len(), "todos": items });
    Ok(tool_result(
        serde_json::to_string_pretty(&payload).map_err(|e| e.to_string())?,
        false,
    ))
}

fn call_tool(params: Option<&Value>, dir: &Path) -> Result<Value, (i64, String)> {
    let params = params.ok_or((-32602, "缺少 params".to_string()))?;
    let name = params
        .get("name")
        .and_then(Value::as_str)
        .ok_or((-32602, "缺少工具名".to_string()))?;
    let args = params.get("arguments").cloned().unwrap_or_else(|| json!({}));
    match name {
        // 工具执行失败用 isError 返回，便于客户端把错误交给模型处理；
        // 只有协议级问题（未知工具/缺参数）才用 JSON-RPC error。
        "add_todo" => Ok(add_todo(&args, dir)
            .unwrap_or_else(|err| tool_result(format!("添加失败：{err}"), true))),
        "add_todos" => Ok(add_todos(&args, dir)
            .unwrap_or_else(|err| tool_result(format!("添加失败：{err}"), true))),
        "list_todos" => Ok(list_open_todos(dir)
            .unwrap_or_else(|err| tool_result(format!("读取失败：{err}"), true))),
        _ => Err((-32602, format!("未知工具：{name}"))),
    }
}

/// 处理一条 JSON-RPC 消息；通知（无 id）返回 None。
pub fn handle(request: &Value, dir: &Path) -> Option<Value> {
    let id = request.get("id").cloned();
    let method = request.get("method").and_then(Value::as_str).unwrap_or("");
    if method.starts_with("notifications/") {
        return None;
    }
    let result = match method {
        "initialize" => Ok(json!({
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": { "tools": {} },
            "serverInfo": { "name": SERVER_NAME, "version": env!("CARGO_PKG_VERSION") },
            "instructions": "把待办写入桌面待办小组件。添加用 add_todo / add_todos，查看用 list_todos。"
        })),
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({ "tools": tools() })),
        "tools/call" => call_tool(request.get("params"), dir),
        _ => Err((-32601, format!("未知方法：{method}"))),
    };
    if id.is_none() {
        return None;
    }
    Some(match result {
        Ok(value) => json!({ "jsonrpc": "2.0", "id": id, "result": value }),
        Err((code, message)) => json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": { "code": code, "message": message }
        }),
    })
}

fn parse_error() -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": Value::Null,
        "error": { "code": -32700, "message": "JSON 解析失败" }
    })
}

/// stdio MCP 服务：每条消息一行 JSON，stdout 只输出协议消息，日志走 stderr。
pub fn run() -> i32 {
    let dir = match data_dir() {
        Ok(dir) => dir,
        Err(err) => {
            eprintln!("desktop-todo mcp: {err}");
            return 1;
        }
    };
    eprintln!("desktop-todo mcp ready for {SERVER_NAME}");
    let stdin = io::stdin();
    let mut stdout = io::stdout();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let request: Value = match serde_json::from_str(&line) {
            Ok(value) => value,
            Err(err) => {
                eprintln!("desktop-todo mcp: parse error: {err}");
                let _ = writeln!(stdout, "{}", parse_error());
                let _ = stdout.flush();
                continue;
            }
        };
        if let Some(response) = handle(&request, &dir) {
            match serde_json::to_string(&response) {
                Ok(text) => {
                    let _ = writeln!(stdout, "{text}");
                    let _ = stdout.flush();
                }
                Err(err) => eprintln!("desktop-todo mcp: encode error: {err}"),
            }
        }
    }
    0
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::test_dir;

    #[test]
    fn initialize_and_tools_list() {
        let dir = test_dir("mcp-init");
        let init = handle(
            &json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}),
            &dir,
        )
        .unwrap();
        assert_eq!(init["result"]["protocolVersion"], PROTOCOL_VERSION);
        assert_eq!(init["result"]["serverInfo"]["name"], SERVER_NAME);
        let list = handle(
            &json!({"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}),
            &dir,
        )
        .unwrap();
        let names: Vec<&str> = list["result"]["tools"]
            .as_array()
            .unwrap()
            .iter()
            .map(|tool| tool["name"].as_str().unwrap())
            .collect();
        assert!(names.contains(&"add_todo"));
        assert!(names.contains(&"add_todos"));
        assert!(names.contains(&"list_todos"));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn tools_call_adds_and_lists() {
        let dir = test_dir("mcp-call");
        let response = handle(
            &json!({
                "jsonrpc":"2.0","id":3,"method":"tools/call",
                "params": {
                    "name":"add_todo",
                    "arguments": {
                        "text":"来自 MCP 的待办",
                        "due":"2026-11-25",
                        "provider":"workbuddy",
                        "source":"WorkBuddy"
                    }
                }
            }),
            &dir,
        )
        .unwrap();
        assert_eq!(response["result"]["isError"], false);
        let pending = inbox::pending(&dir);
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].provider, "workbuddy");
        assert_eq!(pending[0].due.as_deref(), Some("2026-11-25T18:00:00"));

        let listed = handle(
            &json!({"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"list_todos","arguments":{}}}),
            &dir,
        )
        .unwrap();
        let text = listed["result"]["content"][0]["text"].as_str().unwrap();
        assert!(text.contains("来自 MCP 的待办"));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn notifications_get_no_response() {
        let dir = test_dir("mcp-note");
        let response = handle(
            &json!({"jsonrpc":"2.0","method":"notifications/initialized"}),
            &dir,
        );
        assert!(response.is_none());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn tool_errors_are_returned_as_is_error() {
        let dir = test_dir("mcp-error");
        let response = handle(
            &json!({
                "jsonrpc":"2.0","id":5,"method":"tools/call",
                "params": {"name":"add_todo","arguments": {"text":"  "}}
            }),
            &dir,
        )
        .unwrap();
        assert_eq!(response["result"]["isError"], true);
        let text = response["result"]["content"][0]["text"].as_str().unwrap();
        assert!(text.contains("添加失败"), "unexpected: {text}");
        let _ = std::fs::remove_dir_all(dir);
    }
}

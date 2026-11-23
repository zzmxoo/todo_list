use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::{new_id, now_iso};

/// 写入收件箱和 data.json 的 AI 待办。字段名保持 snake_case，与现有 todos 一致。
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct AiTodo {
    pub id: String,
    pub text: String,
    pub created: String,
    #[serde(default)]
    pub due: Option<String>,
    #[serde(default)]
    pub pinned: bool,
    /// 展示给用户的来源名称，例如 "DeepSeek Harness"
    #[serde(default)]
    pub source: String,
    /// 规范化后的 provider id，例如 "deepseek-harness"
    #[serde(default)]
    pub provider: String,
}

/// 一个 AI 客户端的字段适配规则。新增客户端时在这里加一条即可，
/// MCP / CLI / 收件箱链路不需要改。
pub struct ProviderSpec {
    pub id: &'static str,
    pub label: &'static str,
    pub aliases: &'static [&'static str],
    pub text_fields: &'static [&'static str],
    pub due_fields: &'static [&'static str],
}

const TEXT_FIELDS: &[&str] = &[
    "text",
    "title",
    "task",
    "content",
    "summary",
    "description",
];

const DUE_FIELDS: &[&str] = &[
    "due",
    "deadline",
    "due_at",
    "dueAt",
    "due_date",
    "dueDate",
    "time",
    "remind_at",
    "remindAt",
];

pub const GENERIC: ProviderSpec = ProviderSpec {
    id: "generic",
    label: "AI",
    aliases: &["generic", "mcp", "cli", "api", "ai"],
    text_fields: TEXT_FIELDS,
    due_fields: DUE_FIELDS,
};

pub const DEEPSEEK_HARNESS: ProviderSpec = ProviderSpec {
    id: "deepseek-harness",
    label: "DeepSeek Harness",
    aliases: &["deepseek-harness", "deepseek", "dsh"],
    text_fields: TEXT_FIELDS,
    due_fields: DUE_FIELDS,
};

pub const WORKBUDDY: ProviderSpec = ProviderSpec {
    id: "workbuddy",
    label: "WorkBuddy",
    aliases: &["workbuddy", "work-buddy", "wb"],
    text_fields: TEXT_FIELDS,
    due_fields: DUE_FIELDS,
};

pub const DOUBAO: ProviderSpec = ProviderSpec {
    id: "doubao",
    label: "豆包",
    aliases: &["doubao", "豆包"],
    text_fields: &["task", "text", "title", "content", "description"],
    due_fields: DUE_FIELDS,
};

pub const PROVIDERS: &[ProviderSpec] = &[DEEPSEEK_HARNESS, WORKBUDDY, DOUBAO, GENERIC];

pub fn resolve(provider_id: &str) -> &'static ProviderSpec {
    let key = provider_id.trim().to_ascii_lowercase();
    PROVIDERS
        .iter()
        .find(|spec| {
            spec.id.eq_ignore_ascii_case(&key)
                || spec.aliases.iter().any(|alias| alias.eq_ignore_ascii_case(&key))
        })
        .unwrap_or(&GENERIC)
}

fn trimmed(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(ToOwned::to_owned)
}

fn cap_chars(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_string();
    }
    let mut out: String = text.chars().take(max.saturating_sub(1)).collect();
    out.push('…');
    out
}

fn is_digits(bytes: &[u8]) -> bool {
    bytes.iter().all(u8::is_ascii_digit)
}

/// 接受 `YYYY-MM-DD`（默认当天 18:00）或 `YYYY-MM-DDTHH:MM[:SS][时区]`。
pub fn normalize_due(raw: &str) -> Result<String, String> {
    let text = raw.trim();
    let bytes = text.as_bytes();
    if bytes.len() == 10
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && is_digits(&bytes[0..4])
        && is_digits(&bytes[5..7])
        && is_digits(&bytes[8..10])
    {
        return Ok(format!("{text}T18:00:00"));
    }
    let text = text.replacen(' ', "T", 1);
    let bytes = text.as_bytes();
    let shape_ok = bytes.len() >= 16
        && bytes.len() <= 35
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes[10] == b'T'
        && bytes[13] == b':'
        && is_digits(&bytes[0..4])
        && is_digits(&bytes[5..7])
        && is_digits(&bytes[8..10])
        && is_digits(&bytes[11..13])
        && is_digits(&bytes[14..16]);
    if !shape_ok {
        return Err(format!("due 不是合法时间：{raw}"));
    }
    if bytes.len() == 16 {
        return Ok(format!("{text}:00"));
    }
    Ok(text)
}

/// 把外部工具传来的 JSON 归一成 AiTodo。
///
/// 未知 provider 不报错，按 generic 字段规则解析，并把原始 id 作为 provider，
/// 这样新客户端不改代码也能先用起来。
pub fn normalize(provider_hint: &str, input: &Value) -> Result<AiTodo, String> {
    let hint = provider_hint.trim();
    let spec = resolve(if hint.is_empty() { "generic" } else { hint });

    let mut text = String::new();
    for field in spec.text_fields {
        if let Some(value) = trimmed(input.get(*field)) {
            text = value;
            break;
        }
    }
    if text.is_empty() {
        return Err("缺少待办内容（支持 text/title/task/content/summary）".into());
    }

    let mut due = None;
    for field in spec.due_fields {
        match input.get(*field) {
            None | Some(Value::Null) => {}
            Some(Value::String(value)) if value.trim().is_empty() => {}
            Some(Value::String(value)) => {
                due = Some(normalize_due(value)?);
                break;
            }
            Some(_) => return Err(format!("{field} 必须是字符串")),
        }
    }

    let pinned = input
        .get("pinned")
        .and_then(Value::as_bool)
        .or_else(|| input.get("important").and_then(Value::as_bool))
        .unwrap_or(false);

    let canonical = if std::ptr::eq(spec, &GENERIC) && !hint.is_empty() {
        cap_chars(&hint.to_ascii_lowercase(), 40)
    } else {
        spec.id.to_string()
    };
    let source = trimmed(input.get("source"))
        .or_else(|| trimmed(input.get("client")))
        .unwrap_or_else(|| spec.label.to_string());

    Ok(AiTodo {
        id: new_id(),
        text: cap_chars(&text, 500),
        created: now_iso(),
        due,
        pinned,
        source: cap_chars(&source, 60),
        provider: canonical,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn resolves_provider_aliases() {
        assert_eq!(resolve("dsh").id, "deepseek-harness");
        assert_eq!(resolve("DeepSeek-Harness").id, "deepseek-harness");
        assert_eq!(resolve("work-buddy").id, "workbuddy");
        assert_eq!(resolve("豆包").id, "doubao");
        assert_eq!(resolve("something-new").id, "generic");
    }

    #[test]
    fn normalizes_title_and_deadline() {
        let todo = normalize(
            "dsh",
            &json!({"title": "写周报", "deadline": "2026-11-24T18:30", "pinned": true}),
        )
        .unwrap();
        assert_eq!(todo.text, "写周报");
        assert_eq!(todo.due.as_deref(), Some("2026-11-24T18:30:00"));
        assert!(todo.pinned);
        assert_eq!(todo.provider, "deepseek-harness");
        assert_eq!(todo.source, "DeepSeek Harness");
    }

    #[test]
    fn date_only_due_defaults_to_eighteen() {
        assert_eq!(
            normalize_due("2026-11-24").unwrap(),
            "2026-11-24T18:00:00"
        );
        assert_eq!(
            normalize_due("2026-11-24 09:05").unwrap(),
            "2026-11-24T09:05:00"
        );
    }

    #[test]
    fn rejects_empty_text_and_bad_due() {
        assert!(normalize("generic", &json!({"title": "  "})).is_err());
        assert!(normalize("generic", &json!({"text": "x", "due": "明天"})).is_err());
    }

    #[test]
    fn unknown_provider_falls_back_to_generic_fields() {
        let todo = normalize(
            "future-client",
            &json!({"task": "买牛奶", "due": "2026-11-25", "source": "Future"}),
        )
        .unwrap();
        assert_eq!(todo.text, "买牛奶");
        assert_eq!(todo.provider, "future-client");
        assert_eq!(todo.source, "Future");
        assert_eq!(todo.due.as_deref(), Some("2026-11-25T18:00:00"));
    }
}

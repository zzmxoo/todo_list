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
    /// 会议/事件的开始时间；普通截止待办为空
    #[serde(default)]
    pub start: Option<String>,
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
    pub start_fields: &'static [&'static str],
    pub duration_fields: &'static [&'static str],
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

const START_FIELDS: &[&str] = &[
    "start",
    "start_at",
    "startAt",
    "begin",
    "begin_at",
    "beginAt",
    "from",
];

const DURATION_FIELDS: &[&str] = &[
    "duration_minutes",
    "durationMinutes",
    "duration",
    "length_minutes",
    "lengthMinutes",
    "minutes",
];

pub const GENERIC: ProviderSpec = ProviderSpec {
    id: "generic",
    label: "AI",
    aliases: &["generic", "mcp", "cli", "api", "ai"],
    text_fields: TEXT_FIELDS,
    due_fields: DUE_FIELDS,
    start_fields: START_FIELDS,
    duration_fields: DURATION_FIELDS,
};

pub const DEEPSEEK_HARNESS: ProviderSpec = ProviderSpec {
    id: "deepseek-harness",
    label: "DeepSeek Harness",
    aliases: &["deepseek-harness", "deepseek", "dsh"],
    text_fields: TEXT_FIELDS,
    due_fields: DUE_FIELDS,
    start_fields: START_FIELDS,
    duration_fields: DURATION_FIELDS,
};

pub const WORKBUDDY: ProviderSpec = ProviderSpec {
    id: "workbuddy",
    label: "WorkBuddy",
    aliases: &["workbuddy", "work-buddy", "wb"],
    text_fields: TEXT_FIELDS,
    due_fields: DUE_FIELDS,
    start_fields: START_FIELDS,
    duration_fields: DURATION_FIELDS,
};

pub const DOUBAO: ProviderSpec = ProviderSpec {
    id: "doubao",
    label: "豆包",
    aliases: &["doubao", "豆包"],
    text_fields: &["task", "text", "title", "content", "description"],
    due_fields: DUE_FIELDS,
    start_fields: START_FIELDS,
    duration_fields: DURATION_FIELDS,
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

fn days_in_month(year: i32, month: u32) -> u32 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            if (year % 4 == 0 && year % 100 != 0) || year % 400 == 0 {
                29
            } else {
                28
            }
        }
        _ => 30,
    }
}

fn parse_minutes_piece(text: &str) -> Result<f64, String> {
    let value: f64 = text
        .trim()
        .parse()
        .map_err(|_| format!("无法解析时长：{text}"))?;
    if !value.is_finite() || value <= 0.0 {
        return Err(format!("无法解析时长：{text}"));
    }
    Ok(value)
}

/// 支持 "60" / "60分钟" / "1小时" / "1.5h" / "1:30" / "1小时30分钟"。
pub fn parse_duration(raw: &str) -> Result<i64, String> {
    let text = raw.trim().to_lowercase().replace(' ', "");
    if text.is_empty() {
        return Err("duration 不能为空".into());
    }
    let minutes = if let Some((hours, rest)) = text.split_once("小时") {
        let mut value = parse_minutes_piece(hours)? * 60.0;
        let rest = rest.trim_end_matches("分钟").trim_end_matches('分');
        if !rest.is_empty() {
            value += parse_minutes_piece(rest)?;
        }
        value
    } else if text.contains(':') {
        let (hours, mins) = text
            .split_once(':')
            .ok_or_else(|| format!("无法解析时长：{raw}"))?;
        parse_minutes_piece(hours)? * 60.0 + parse_minutes_piece(mins)?
    } else if let Some(value) = text
        .strip_suffix("分钟")
        .or_else(|| text.strip_suffix('分'))
        .or_else(|| text.strip_suffix("mins"))
        .or_else(|| text.strip_suffix("min"))
        .or_else(|| text.strip_suffix('m'))
    {
        parse_minutes_piece(value)?
    } else if let Some(value) = text
        .strip_suffix("hours")
        .or_else(|| text.strip_suffix("hour"))
        .or_else(|| text.strip_suffix("hrs"))
        .or_else(|| text.strip_suffix("hr"))
        .or_else(|| text.strip_suffix('h'))
    {
        parse_minutes_piece(value)? * 60.0
    } else {
        parse_minutes_piece(&text)?
    };
    let rounded = minutes.round() as i64;
    if !(1..=1440).contains(&rounded) {
        return Err("时长必须在 1 分钟到 24 小时之间".into());
    }
    Ok(rounded)
}

fn parse_naive(iso: &str) -> Option<(i32, u32, u32, u32, u32)> {
    if iso.len() < 16 || iso.len() > 19 {
        return None;
    }
    let bytes = iso.as_bytes();
    if bytes[4] != b'-' || bytes[7] != b'-' || bytes[10] != b'T' || bytes[13] != b':' {
        return None;
    }
    let number = |start: usize, end: usize| -> Option<u32> {
        iso.get(start..end)?.parse::<u32>().ok()
    };
    Some((
        number(0, 4)? as i32,
        number(5, 7)?,
        number(8, 10)?,
        number(11, 13)?,
        number(14, 16)?,
    ))
}

/// 在本地 ISO 时间上增加分钟；暂不支持带时区的时间（AI 通常传本地时间）。
pub fn add_minutes(iso: &str, minutes: i64) -> Result<String, String> {
    let (mut year, mut month, mut day, mut hour, mut minute) =
        parse_naive(iso).ok_or_else(|| format!("时间格式不支持时长计算：{iso}"))?;
    let total = hour as i64 * 60 + minute as i64 + minutes;
    let day_delta = total.div_euclid(1440);
    let sod = total.rem_euclid(1440);
    hour = (sod / 60) as u32;
    minute = (sod % 60) as u32;

    let mut delta = day_delta;
    while delta != 0 {
        if delta > 0 {
            let dim = days_in_month(year, month);
            if day < dim {
                day += 1;
            } else {
                day = 1;
                if month == 12 {
                    month = 1;
                    year += 1;
                } else {
                    month += 1;
                }
            }
            delta -= 1;
        } else {
            if day > 1 {
                day -= 1;
            } else {
                if month == 1 {
                    month = 12;
                    year -= 1;
                } else {
                    month -= 1;
                }
                day = days_in_month(year, month);
            }
            delta += 1;
        }
    }
    Ok(format!(
        "{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:00"
    ))
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

    let mut start = None;
    for field in spec.start_fields {
        match input.get(*field) {
            None | Some(Value::Null) => {}
            Some(Value::String(value)) if value.trim().is_empty() => {}
            Some(Value::String(value)) => {
                start = Some(normalize_due(value)?);
                break;
            }
            Some(_) => return Err(format!("{field} 必须是字符串")),
        }
    }

    let mut duration = None;
    for field in spec.duration_fields {
        match input.get(*field) {
            None | Some(Value::Null) => {}
            Some(Value::Number(value)) => {
                duration = Some(value.as_i64().ok_or_else(|| format!("{field} 必须是整数分钟"))?);
                break;
            }
            Some(Value::String(value)) if value.trim().is_empty() => {}
            Some(Value::String(value)) => {
                duration = Some(parse_duration(value)?);
                break;
            }
            Some(_) => return Err(format!("{field} 必须是分钟数或时长文本")),
        }
    }

    // 会议场景：时长可以把开始时间换算成结束时间。
    // 只给一个时间 + 时长时，把它当作开始；同时给 start/due 则保留两者。
    if let Some(minutes) = duration {
        match (start.clone(), due.clone()) {
            (Some(begin), None) => {
                due = Some(add_minutes(&begin, minutes)?);
            }
            (None, Some(end)) => {
                start = Some(end.clone());
                due = Some(add_minutes(&end, minutes)?);
            }
            (Some(begin), Some(end)) => {
                if end <= begin {
                    return Err("due 必须晚于 start".into());
                }
            }
            (None, None) => {
                return Err("提供 duration 时需要同时提供 start 或时间（按开始时间计算）".into())
            }
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
        start,
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

    #[test]
    fn meeting_start_plus_duration_sets_end() {
        let todo = normalize(
            "workbuddy",
            &json!({
                "title": "方案评审",
                "start": "2026-11-27T10:30",
                "duration_minutes": 60
            }),
        )
        .unwrap();
        assert_eq!(todo.start.as_deref(), Some("2026-11-27T10:30:00"));
        assert_eq!(todo.due.as_deref(), Some("2026-11-27T11:30:00"));
    }

    #[test]
    fn meeting_time_plus_duration_treats_time_as_start() {
        let todo = normalize(
            "workbuddy",
            &json!({
                "text": "方案评审",
                "time": "2026-11-27 10:30",
                "duration": "1小时"
            }),
        )
        .unwrap();
        assert_eq!(todo.start.as_deref(), Some("2026-11-27T10:30:00"));
        assert_eq!(todo.due.as_deref(), Some("2026-11-27T11:30:00"));
    }

    #[test]
    fn duration_rolls_over_midnight() {
        let todo = normalize(
            "generic",
            &json!({
                "text": "夜间发布",
                "start": "2026-11-27T23:30:00",
                "duration": 90
            }),
        )
        .unwrap();
        assert_eq!(todo.due.as_deref(), Some("2026-11-28T01:00:00"));
    }

    #[test]
    fn duration_requires_a_base_time() {
        assert!(normalize("generic", &json!({"text": "x", "duration": 30})).is_err());
        assert!(parse_duration("0分钟").is_err());
        assert!(parse_duration("25小时").is_err());
    }
}

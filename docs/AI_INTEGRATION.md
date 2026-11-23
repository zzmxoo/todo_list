# AI 接入

外部 AI 工具（DeepSeek Harness、WorkBuddy、豆包 CLI 等）通过 **MCP** 或 **命令行** 把待办写入桌面待办小组件。链路是本地文件收件箱，不监听端口、不联网、不需要账号。

## 工作方式

```
AI 客户端
  ├─ MCP stdio:  desktop-todo.exe --mcp      ─┐
  └─ CLI:        desktop-todo.exe --add ...   ─┤
                                             ▼
                 %APPDATA%\com.desktoptodo.widget\ai-inbox\<id>.json
                                             ▼  桌面端每秒 drain
                      合并进 data.json（按 id 去重）→ 列表出现待办
```

- 桌面端没运行时，收件箱文件会保留，下次启动自动合并，不会丢。
- 每个条目单独一个文件，写入使用临时文件 + rename，避免读到半截 JSON。
- 列表中的 AI 待办会显示来源小标签（DeepSeek / WorkBuddy / 豆包 / AI）。

## MCP 工具

以 `--mcp` 启动后提供三个工具：

| 工具 | 参数 | 说明 |
| --- | --- | --- |
| `add_todo` | `text`（必填）、`due`、`pinned`、`provider`、`source` | 添加一条待办 |
| `add_todos` | `todos` 数组，外层可统一给 `provider` / `source` | 批量添加，最多 50 条 |
| `list_todos` | 无 | 列出未完成待办，便于 AI 去重 |

`due` 支持：

- `YYYY-MM-DD`：默认当天 18:00
- `YYYY-MM-DDTHH:MM` / 带秒 / 带时区的 ISO 8601
- `YYYY-MM-DD HH:MM`（空格会转成 T）

`provider` 可用值（别名自动归一）：

- `deepseek-harness` / `deepseek` / `dsh`
- `workbuddy` / `work-buddy` / `wb`
- `doubao` / `豆包`
- 其他任意 id：按通用字段解析，方便先接入再补适配

## DeepSeek Harness（dsh）

dsh 通过 `@deepseek-ai/dsh-mcp-client` 插件接 MCP，一个插件实例对应一个 MCP server。在 `~/.dsh/profiles/web/cordis.patch.yml` 中增加 stdio 实例：

```yaml
- name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: desktop-todo
    transport: stdio
    command: 'D:\Tools\Todos\src-tauri\target\release\desktop-todo.exe'
    args: ['--mcp']
    toolCallTimeoutMs: 15000
    failOnStartupError: true
```

重启 dsh 后，工具应出现在 `mcp__desktop-todo__add_todo` 之类的命名空间下。可以让 dsh 把任务直接记为待办，例如：

> 把「整理周报」加入桌面待办，截止周五 18:00。

## WorkBuddy

WorkBuddy 支持自定义 MCP 连接器（stdio 或 HTTP）。新增一个 stdio 连接器：

- 名称：`desktop-todo`
- 命令：`D:\Tools\Todos\src-tauri\target\release\desktop-todo.exe`
- 参数：`--mcp`
- 传输：`stdio`

保存并验证连接后，WorkBuddy 会自动发现 `add_todo` / `add_todos` / `list_todos`。如果是在其内置的 Agent/Skill 中调用，直接让 Agent 使用这些工具即可。

## 豆包

豆包 CLI 支持本地工具调用。优先按 MCP 连接器配置（同上，stdio + `--mcp`）；如果当前版本的豆包工作台没有 MCP 入口，则用命令行/skill 调 CLI：

```powershell
& "D:\Tools\Todos\src-tauri\target\release\desktop-todo.exe" `
  --add "整理周报" `
  --due "2026-11-28" `
  --provider doubao `
  --source "豆包"
```

可以在 `AGENTS.md` 或本地 skill 里写一条规则：

> 当用户要求“记到待办/提醒我/加入清单”时，调用
> `desktop-todo.exe --add "<内容>" --due "<YYYY-MM-DD>" --provider doubao`。

CLI 只写收件箱，不要求桌面端正在运行；命令返回后待办会出现在下一次桌面端刷新时。

## 通用 MCP 配置

任何支持 MCP stdio 的客户端都可以用：

```json
{
  "mcpServers": {
    "desktop-todo": {
      "command": "D:\\Tools\\Todos\\src-tauri\\target\\release\\desktop-todo.exe",
      "args": ["--mcp"]
    }
  }
}
```

## 命令行

```text
desktop-todo.exe --add <内容> [--due <时间>] [--provider <id>] [--source <名称>] [--pinned]
```

示例：

```powershell
# 普通添加
desktop-todo.exe --add "买牛奶"

# 带截止时间
desktop-todo.exe --add "交房租" --due 2026-11-30

# 指定来源（会显示在待办标签上）
desktop-todo.exe --add "整理会议纪要" --provider workbuddy --source "WorkBuddy"
```

## 新增一个 AI 客户端

不需要改 MCP / CLI / 收件箱链路，只需在 `src-tauri/src/ai/providers.rs` 的 `PROVIDERS` 里加一条：

```rust
pub const MY_CLIENT: ProviderSpec = ProviderSpec {
    id: "my-client",
    label: "MyClient",
    aliases: &["my-client", "myclient"],
    text_fields: TEXT_FIELDS,
    due_fields: DUE_FIELDS,
};
```

如果它的字段名特殊（例如 `todo_title`、`remind_time`），只需调整该条目的 `text_fields` / `due_fields`。
未登记的 provider 也会按通用字段解析，不会报错。

## 测试

- Rust 单元测试覆盖 provider 归一、收件箱去重、MCP initialize/tools/list/tools/call。
- 集成回归 `[REG-34]`：测试脚本先用 `--add` 写入一条待办，应用启动后断言列表出现该条并带来源标签。
- 手动验证 MCP：

```powershell
# 用管道喂 initialize + add_todo，检查 stdout 与 ai-inbox
```

## 安全与限制

- 收件箱位于当前用户 AppData，仅本机进程可写；没有监听端口。
- 单条内容最多 500 字符，批量最多 50 条。
- MCP 服务只依赖 stdio，不要把它暴露到网络。
- AI 待办和手动待办一样保存在 `data.json`，导出、日历、删除逻辑完全一致。

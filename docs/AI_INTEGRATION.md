# AI 接入

外部 AI 工具（DeepSeek Harness、WorkBuddy、豆包 CLI 等）通过 **MCP** 或 **命令行** 把待办写入桌面待办小组件。链路是本地文件收件箱，不监听端口、不联网、不需要账号。

## 工作方式

```
AI 客户端
  ├─ MCP stdio:  desktop-todo.exe --mcp      ─┐
  └─ CLI:        desktop-todo.exe --add ...   ─┤
                                             ▼
                 %USERPROFILE%\.desktoptodo\ai-inbox\<id>.json
                                             ▼  桌面端每秒 drain
                      合并进 data.json（按 id 去重）→ 列表出现待办
```

- 桌面端没运行时，收件箱文件会保留，下次启动自动合并，不会丢。
- 每个条目单独一个文件，写入使用临时文件 + rename，避免读到半截 JSON。
- 列表中的 AI 待办会显示来源小标签（DeepSeek / WorkBuddy / 豆包 / AI）。

## 一键注册（减少手工配置）

MCP 没有“给一个 exe 路径就自动装进客户端”的标准协议；WorkBuddy / DSH 都需要在各自的配置或插件市场里登记服务。为了减少手工步骤，程序内置了注册命令：

```powershell
# WorkBuddy：写入它的本地插件市场，之后在 WorkBuddy 里点一次“安装/启用”
desktop-todo.exe --install-mcp workbuddy

# DeepSeek Harness：生成 cordis.patch.yml 片段
desktop-todo.exe --install-mcp dsh

# 通用 MCP 客户端：直接输出 JSON 配置
desktop-todo.exe --install-mcp generic

# 如果 exe 不在当前路径，可显式指定；注册的 command 会指向这个路径
desktop-todo.exe --install-mcp workbuddy --exe "D:\Tools\Todos\src-tauri\target\release\desktop-todo.exe"
```

说明：

- WorkBuddy：会创建 `~/.workbuddy/plugins/marketplaces/local/plugins/desktop-todo/`，并把条目加入本地市场的 `marketplace.json`（原文件备份为 `.bak-todo`）。插件仍需在 WorkBuddy 的“插件市场 → 本地”里点一次安装/启用，这是 MCP 客户端的安全边界，不建议静默安装外部进程。
- DSH：如果检测到 `~/.dsh`，会生成 `~/.dsh/desktop-todo.mcp.yml`；把其中条目合并进 `~/.dsh/profiles/web/cordis.patch.yml` 后重启 dsh。未安装 DSH 时只打印片段。
- 通用客户端：把输出的 `mcpServers` JSON 粘到对应配置文件即可。

## 应用内查看配置

设置 → **AI 接入** 页会按 WorkBuddy / DeepSeek Harness / 豆包 三张卡片展开显示接入方式，并根据当前 exe 路径动态生成 MCP JSON、DSH 配置和豆包 CLI 示例，可直接复制使用。

## MCP 工具

以 `--mcp` 启动后提供三个工具：

| 工具 | 参数 | 说明 |
| --- | --- | --- |
| `add_todo` | `text`（必填）、`due`、`start`、`duration_minutes`、`pinned`、`provider`、`source` | 添加一条待办或会议 |
| `add_todos` | `todos` 数组，外层可统一给 `provider` / `source` | 批量添加，最多 50 条 |
| `list_todos` | 无 | 列出未完成待办，便于 AI 去重 |

`due` 支持：

- `YYYY-MM-DD`：默认当天 18:00
- `YYYY-MM-DDTHH:MM` / 带秒 / 带时区的 ISO 8601
- `YYYY-MM-DD HH:MM`（空格会转成 T）

会议/事件：

- 用 `start`（开始时间）+ `duration_minutes`（分钟）表达，服务端自动算 `due`（结束时间）。
- 也可以把开始时间放在 `time` / `due` 里再配 `duration`，服务端会把该时间当作开始。
- `duration` 支持分钟数、`1小时`、`90分钟`、`1.5h`、`1:30`。
- 列表会显示「今天 10:30–11:30」，日历色条按开始到结束绘制。

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
- 命令：`desktop-todo.exe`（PATH 中可用；否则填实际安装路径）
- 参数：`--mcp`
- 传输：`stdio`

保存并验证连接后，WorkBuddy 会自动发现 `add_todo` / `add_todos` / `list_todos`。如果是在其内置的 Agent/Skill 中调用，直接让 Agent 使用这些工具即可。

自定义连接器 JSON 中的 `command` 可以只写 `desktop-todo.exe`（前提是程序目录在 PATH 中）；否则请替换成实际安装路径。设置页「AI 接入」展示的是不写死路径的通用版本。

### WorkBuddy 里怎样“按名字找到待办事项”

MCP 没有“扫描本机应用名自动发现服务”的机制，WorkBuddy 只能看到**已经配置好的连接器**。所以：

1. 先按上面的步骤添加 stdio 连接器，这一步不能省。
2. 连接器的**显示名称建议填「待办事项」**；如果 WorkBuddy 用连接器名称做工具命名空间，模型会看到类似 `mcp__待办事项__add_todo` 的名字。
3. 我们的工具描述和 `serverInfo.title` 已经写入「待办事项 / 待办 / 提醒 / 会议 / 日程」等关键词，模型按语义选工具时更容易命中。
4. 如果模型仍然不调用，在 WorkBuddy 的技能/规则里加一条：

```text
当用户说“添加到待办事项 / 提醒我 / 记一下 / 安排会议 / 加个日程”时，
使用已连接的「待办事项」MCP 服务的 add_todo 工具。
会议：text=会议名称，start=开始时间，duration_minutes=时长分钟；
相对日期（周五、明天）先换算成具体日期。
```

这样即使用户只说「添加到待办事项」，也能稳定路由到本服务；仅靠应用名字本身不会自动发现。

对下面这句话：

> 添加周五会议提醒，时间早上 10:30，时长 1 小时，会议名称：方案评审

Agent 应解析为：

```json
{
  "name": "add_todo",
  "arguments": {
    "text": "方案评审",
    "start": "2026-11-27T10:30:00",
    "duration_minutes": 60,
    "provider": "workbuddy",
    "source": "WorkBuddy"
  }
}
```

服务端会存成开始 `10:30`、结束 `11:30`，列表显示「今天 10:30–11:30」，日历色条覆盖这一小时。

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
desktop-todo.exe --add <内容> [--due <时间>] [--start <开始时间>] [--duration <时长>] [--provider <id>] [--source <名称>] [--pinned]
```

示例：

```powershell
# 普通添加
desktop-todo.exe --add "买牛奶"

# 带截止时间
desktop-todo.exe --add "交房租" --due 2026-11-30

# 会议：开始 10:30，时长 1 小时
desktop-todo.exe --add "方案评审" --start "2026-11-27T10:30" --duration "1小时" --provider workbuddy

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

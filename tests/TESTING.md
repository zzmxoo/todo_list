# 测试策略（按当前架构裁剪）

原则：**测试跟着风险走，不跟着语言走。** 这个项目的业务逻辑在 JS，系统交互在 WebView + Tauri，Rust 只是薄胶水层，所以测试重心不在 Rust。

## 分层与比例

| 层 | 测什么 | 工具 | 数量 | 频率 |
| --- | --- | --- | --- | --- |
| Rust 单元测试 | 纯函数：动画缓动/插值、注册表命令参数、AI provider 归一、时长计算、收件箱、损坏数据保留、MCP 协议、客户端注册 | `cargo test` | 39 | 每次提交 |
| 脚本自测 | 备份守卫：残留备份（含跨脚本 `.itest`）中止、空 / 损坏 data.json 不覆盖用户数据 | PowerShell | 6 | 每次回归 |
| JS 纯逻辑单元测试 | 待办状态、排序、日历布局、+n 分配、跨月裁剪、导出、天气解析、节假日/名言、待办归一 | WebView + CDP | 47 | 每次提交 |
| 名言数据校验 | 1313 条、无重复、字段完整 | CDP | 1 | 每次提交 |
| UI 集成测试 | 设置、模式切换、日历交互、天气布局、边缘隐藏、托盘、吸附、AI 插入、损坏数据保护、编辑态保护、只读解除 | CDP 驱动真实应用 | 46 | 每次提交 / 打 tag 前 |
| 人工抽查 | 托盘图标位置、任务栏按钮、重启后自启动、动画观感、原生选图 | 手动 | 4 项 | 发布前 |

统一入口：

```powershell
powershell -ExecutionPolicy Bypass -File tests\regression.ps1
```

`-SkipUnits` 只跑 Rust + UI；`-SkipRust` 跳过 `cargo test`。

## 单元测试还是集成测试？

按“问题能不能脱离界面复现”来选：

- **纯规则、计算、格式** → 单元测试（`tests/unit-*.js`、`src-tauri/src/main.rs` 的 `mod tests`）。
- **依赖 DOM 结构、CSS、窗口位置、注册表、托盘、原生对话框** → UI 集成测试（`tests/integration-page.js`）。
- **既涉及规则又涉及界面** → 规则部分写单元测试，界面部分写一条集成用例，不重复覆盖。
- 不要为了覆盖率给每个 DOM 节点写测试；一条集成用例只断言用户能感知的结果。

例子：

- `+n` 数字取每天隐藏条数的最大值 → `unit-core.js`。
- `+n` 实际渲染在周日列、滚轮后出现 `above` 徽标 → `REG-15` 集成用例。
- 开机启动注册表命令参数 → Rust 单测；点击开关的即时视觉反馈与最终写入 → `REG-23`。

## 回归怎么做

不单独维护“回归脚本集”。每个修过的 bug 都变成普通测试文件里的永久用例：

1. 先加一条能复现旧问题的用例（单元或集成）；
2. 在 `tests/REGRESSION.md` 登记问题、提交、用例位置；
3. 修到用例通过；
4. **日常小改动只跑相关用例**；合入 master / 打 tag 前跑全量 `regression.ps1`。

`REGRESSION.md` 只是索引和维护清单，不是第二套测试实现。

## 明确不引入的东西

| 方案 | 现在不用 | 什么时候再考虑 |
| --- | --- | --- |
| Vitest / Node 测试链 | 项目刻意保持无 Node 构建；现有 WebView 单测与生产同引擎 | 前端开始用打包器/框架时 |
| WebDriverIO E2E | CDP 集成已经驱动真实应用，维护成本更低 | 交互复杂到 CDP 难以稳定表达时 |
| mockall / wiremock | Rust 没有 trait 编排层，HTTP 只在 `fetch_json` 转发 | Rust 侧出现 Provider、同步、鉴权、token 刷新时 |
| Tauri mock runtime | 命令都是窗口/注册表/原生对话框，mock 后测不到真实行为 | 新增大量纯 IPC 参数校验命令时 |
| 远程 CI | 本地 Windows 工具，发布前本地门禁足够 | 仓库推到 GitHub 且需要多人协作时（Windows runner + WebView2） |

## 什么时候升级策略

出现下面任一情况，测试重心再往 Rust 移：

- Rust 侧新增 SQLite / 云同步 / 鉴权 / token 刷新；
- Rust 侧出现可替换的 Provider trait；
- 前端开始拆组件或引入构建工具。

到那时再引入 `mockall` + `wiremock` + `cargo test` 的分层，不用推翻现有的 JS 单测和 UI 集成。

## 人工抽查清单

- 托盘图标是否进入系统托盘溢出区，任务栏按钮是否按设置隐藏；
- Windows 重新登录后是否自动启动；
- 边缘收起/弹出动画是否顺滑、无回弹；
- 原生选图对话框与背景图填充效果。

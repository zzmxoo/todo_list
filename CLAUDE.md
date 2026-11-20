# 桌面待办（D:\Tools\Todos）

Tauri v2 + WebView2 的 Windows 桌面待办小组件。前端是 `ui/` 下的纯 HTML/CSS/JS（无 Node 构建），Rust 命令在 `src-tauri/src/main.rs`。

后续会话先读 [docs/HANDOFF.md](docs/HANDOFF.md)：包含原始需求、设计规范、关键决策、已知限制和发布流程。

## 构建与运行

```powershell
cd src-tauri
cargo build --release
```

发布版：`src-tauri\target\release\desktop-todo.exe`。改前端后需重新 `cargo build --release` 才会打进程序资源。

## 测试

完整回归（Rust 单测 + JS 单元 + 数据 + UI 集成，自动备份/恢复用户数据）：

```powershell
powershell -ExecutionPolicy Bypass -File tests\regression.ps1
```

只跑某部分：

```powershell
powershell -ExecutionPolicy Bypass -File tests\regression.ps1 -SkipUnits -SkipRust
powershell -ExecutionPolicy Bypass -File tests\regression.ps1 -SkipRust
powershell -ExecutionPolicy Bypass -File tests\integration.ps1
```

测试借 WebView2 的 CDP 端口 9222 在真实应用里执行；`tests/integration-page.js` 是 UI 回归用例，`tests/unit-*.js` 是纯函数用例，`src-tauri/src/main.rs` 的 `mod tests` 测 Rust 纯逻辑（缓动、插值、自启动命令参数），`tests/REGRESSION.md` 是“历史问题 → 用例”的清单。分层原则见 [tests/TESTING.md](tests/TESTING.md)。

## 修改规则

- 修复任何 bug / 调整任何既有行为时，**必须先在 `tests/integration-page.js` 或对应 `unit-*.js` 增加能复现旧问题的用例**，再改代码，并在 `tests/REGRESSION.md` 登记（编号只增不改）。
- 提交前跑 `tests\regression.ps1`，失败用例不允许提交。
- 待办写操作统一走 `app.js` 的 `commitTodos()`；业务纯函数放 `ui/core.js` 与 `ui/domain/*`，不要塞回 DOM 代码。
- 用户数据在 `%APPDATA%\com.desktoptodo.widget\data.json`。测试会临时改动它，`regression.ps1` 负责恢复；手动调试时不要删除用户数据。

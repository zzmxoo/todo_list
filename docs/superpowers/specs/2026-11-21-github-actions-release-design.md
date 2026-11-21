# GitHub Actions 自动编译与发布设计

## 1. 目标

推送版本 tag 时，在 GitHub 托管的 Windows runner 上自动编译并打包桌面待办，产出可执行文件与两种安装包，随后自动创建公开的 GitHub Release。

## 2. 现状与约束

| 项目 | 现状 | 对 CI 的影响 |
| --- | --- | --- |
| 前端 | `ui/` 纯静态，无构建步骤 | CI 不需要 Node，只要 Rust |
| 构建入口 | `cargo build --release` | 只出裸 exe，不出安装包 |
| `bundle.active` | `false` | 必须改为 `true` 才能产出 MSI / NSIS |
| cargo 镜像 | `src-tauri/.cargo/config.toml` 指向 `rsproxy.cn` | 美国 runner 访问国内镜像会超时，CI 必须绕过 |
| `Cargo.lock` | 全部依赖源为标准 `crates.io` | 绕过镜像不会触发锁文件重写 |
| 版本号 | `Cargo.toml`、`tauri.conf.json` 均为 `0.0.5` | 需与 tag 校验 |
| 已有 tag | 本地 `0.0.1`~`0.0.5`，无前缀；远程为空 | 触发规则需兼容无前缀写法 |
| 测试 | PowerShell + WebView2 CDP + 真实窗口 | 无法在 CI 上跑，CI 只跑 Rust 单测 |
| `productName` | `桌面待办`（中文） | 产物文件名会是中文，需规范化 |

## 3. 方案选型

**采用 `tauri-apps/tauri-action@v1`。**

理由是它负责 NSIS/WiX 工具链准备、`tauri build` 调用、产物收集、Release 创建与上传，避免手写同等逻辑。不采用纯 `cargo build` 自建方案，因为打包安装包绕不开 Tauri CLI，等于把它重做一遍。不采用多平台 matrix，因为本项目只有 Windows 目标，其它平台产物无意义。

## 4. 设计

### 4.1 触发

```yaml
on:
  push:
    tags:
      - '*.*.*'
```

匹配现有无前缀 tag 习惯（`0.0.5`），同时兼容 `v0.0.6`。该 glob 也会命中 `nightly-2026.11.21` 这类含三个点段的非版本 tag，因此版本校验步骤用正则 `^v?\d+\.\d+\.\d+$` 兜底：不匹配则失败退出，不会误发 Release。

校验时剥掉可选的 `v` 前缀再与配置文件比对。

### 4.2 任务结构

单 job，`runs-on: windows-latest`，`permissions: contents: write`。

步骤：

1. `actions/checkout@v4`，`fetch-depth: 0`、`fetch-tags: true`
2. 版本一致性校验（PowerShell）
3. 生成变更说明（PowerShell，输出为 step output）
4. 删除 `src-tauri/.cargo/config.toml`
5. `dtolnay/rust-toolchain@stable`
6. `Swatinem/rust-cache@v2`，`workspaces: src-tauri -> target`
7. 下载并解压 Tauri CLI 预编译包到 `C:\tauri-cli`，加入 `PATH`
8. `cargo test --release`（仅 Rust 单测）
9. `tauri-apps/tauri-action@v1`

`checkout` 必须完整拉取历史与 tag，否则第 3 步取不到上一个版本 tag，`git log` 也拿不到区间提交。

### 4.3 版本一致性校验

从三个来源取版本，全部相等才继续：

- tag 名（剥掉可选 `v` 前缀）
- `src-tauri/Cargo.toml` 的 `[package].version`
- `src-tauri/tauri.conf.json` 的 `.version`

任一不等则报错退出。目的是杜绝「Release 标题 0.0.6、安装包内是 0.0.5」这类错版发布。

### 4.4 绕过国内镜像

在 `cargo` 执行前执行 `Remove-Item src-tauri/.cargo/config.toml`。

不能改用环境变量覆盖，因为 `source.crates-io` 的 `replace-with` 是 cargo 配置层概念，只有配置文件能表达。`Cargo.lock` 中的源已是标准 `crates.io`，删除配置后不会触发依赖重新解析。

代价是首次运行需要从 crates.io 完整下载依赖，`rust-cache` 会缓存后续运行。

### 4.5 Tauri CLI 获取

下载 `cargo-tauri-x86_64-pc-windows-msvc.zip`（对应 `tauri-cli-v2.12.6`），解压后把 `cargo-tauri.exe` 放进 `PATH`，并设置 `tauriScript: cargo tauri`。

不采用 `tauri-action` 的默认路径：无 `package.json` 时它会执行 `npm install -g @tauri-apps/cli@v2`，多一次全局安装，慢且依赖网络。也不在 CI 里 `cargo install tauri-cli`，那要现场编译，耗时数分钟；预编译包是秒级解压。

### 4.6 打包参数

`tauri-action` 关键输入：

| 输入 | 值 | 说明 |
| --- | --- | --- |
| `projectPath` | `src-tauri` | Tauri 项目根 |
| `tauriScript` | `cargo tauri` | 使用预编译 CLI |
| `args` | `--bundles nsis,msi` | 只要 Windows 两种安装包 |
| `tagName` | `${{ github.ref_name }}` | 用触发 tag 作 Release tag |
| `releaseName` | `桌面待办 ${{ github.ref_name }}` | Release 标题 |
| `releaseDraft` | `false` | 直接公开 |
| `prerelease` | `false` | 正式版 |
| `generateReleaseNotes` | `false` | 使用脚本生成的变更说明 |
| `releaseBody` | `${{ steps.changelog.outputs.body }}` | 由 4.10 节脚本生成 |
| `uploadPlainBinary` | `true` | 额外上传裸 exe |
| `releaseAssetNamePattern` | `[mainBinaryName]_[version]_[arch][setup].[ext]` | 资产名规范化为 ASCII |

`--bundles nsis,msi` 必须显式给出，因为 `bundle.targets` 为 `"all"` 会在 Windows 上连带尝试其它目标。

### 4.7 产物命名

`releaseAssetNamePattern` 使用 `[mainBinaryName]`（等于 Cargo 包名 `desktop-todo`）而不是 `[name]`（等于中文 `productName`），避免 Release 资产出现中文文件名。`[setup]` 用于区分裸 exe 与 NSIS 安装包：

| 产物 | 资产名 |
| --- | --- |
| 裸可执行文件 | `desktop-todo_0.0.5_x64.exe` |
| NSIS 安装包 | `desktop-todo_0.0.5_x64-setup.exe` |
| MSI 安装包 | `desktop-todo_0.0.5_x64.msi` |

安装包内部的应用名仍是中文 `桌面待办`（`productName` 不变），只规范下载文件名。

### 4.8 配置变更

`src-tauri/tauri.conf.json`：

```json
"bundle": {
  "active": true,
  "targets": "all",
  "icon": ["icons/icon.ico"]
}
```

`bundle.active` 由 `false` 改为 `true`。该字段只影响 Tauri CLI 的打包行为，本地 `cargo build --release` 不经过 CLI，现有本地发布流程不受影响。

`mainBinaryName` 不新增：默认已取 Cargo 包名 `desktop-todo`，符合需要。

### 4.9 测试策略

CI 运行 `cargo test --release`，覆盖 `main.rs` 的 `mod tests`（缓动函数、插值、注销表命令参数），这些是纯逻辑，不依赖窗口。

CI **不运行** `tests/regression.ps1`：它需要启动真实 WebView2 窗口并通过 CDP 9222 注入脚本，在无交互桌面的 runner 上不可靠。前端回归仍由本地提交前手动执行。

### 4.10 变更说明生成

Release 正文由 CI 根据提交历史自动归纳，**概括性描述，不逐条罗列提交**。

**步骤**

1. 用 `git describe --tags --abbrev=0 $env:GITHUB_REF_NAME^` 找上一个版本 tag。
2. 取区间 `上一个tag..本次tag` 的提交标题（`git log --no-merges --format=%s`）。
3. 过滤以下噪声：
   - `版本号更新为 x` / `版本号更新` 开头的提交
   - 合并提交（`--no-merges` 已排除）
4. 按提交标题里的关键词归类到三组，每组最多保留 5 条、每条截断到 40 字：
   - **新增**：含「新增」「添加」「支持」「增加」之一，或标题以「增加」开头
   - **修复**：含「修复」「修正」「解决」「问题」之一
   - **优化**：含「优化」「改进」「提升」「降低」「加快」「改为」「调整」之一
5. 未命中任何关键词的提交归入 **其它变更**，只保留前 3 条。
6. 若三个分组都为空（例如首次发布或区间内只有版本号提交），正文退化为一句「本次更新包含若干内部调整与稳定性改进。」，不输出空小节。
7. 拼装正文：固定头部（下载说明 + 数据目录位置）+ 变更小节。输出到 step output `body`。

**首次发布处理**：若找不到上一个 tag，则取该 tag 之前最近 20 条提交作为区间，并在正文头部注明「首个发布版本」。

**与提交风格的关系**：本仓提交标题是自然语言中文（如「修复开机启动开关点击后长时间无响应」），关键词归类正是基于这个事实设计的。若后续改用 `feat:` / `fix:` 前缀，归类规则需同步调整。

**为什么不直接给用户整段提交列表**：用户明确要求概括说明。逐条罗列会让 Release 页变成提交日志，且本项目提交粒度高，同一功能常有十余条提交。

**为什么不复用 GitHub 的 `generateReleaseNotes`**：它基于 PR 与 issue 生成，本仓直接向 `master` 提交、不走 PR，产出会是空或英文标题，且无法按中文语义归类。

## 5. 错误处理

| 场景 | 行为 |
| --- | --- |
| 版本不一致 | 校验步骤失败，不进入构建 |
| crates.io 下载失败 | 作业失败；`rust-cache` 命中后续重跑通常可恢复 |
| 打包失败 | 作业失败，不创建 Release |
| Release 已存在 | `tauri-action` 更新该 Release 的名称与正文并覆盖同名资产 |
| 重复推送同一 tag | GitHub 拒绝，不触发 |
| 找不到上一个 tag | 取最近 20 条提交，正文注明「首个发布版本」 |
| 区间内无提交 | 正文退化为一句概括，不输出空小节 |
| `productName` 中文导致打包失败 | 见第 7 节回退方案 |

## 6. 发版流程

```bash
# 1. 修改版本号（Cargo.toml、tauri.conf.json、ui 中的版本显示）
# 2. 提交
git commit -am "版本号更新为 0.0.6"
# 3. 打 tag 并推送
git tag -a 0.0.6 -m "0.0.6"
git push origin 0.0.6
```

推 tag 即触发，完成后 Release 页面出现三个资产与自动生成的变更说明。

## 6.1 变更说明样例

```
## 桌面待办 0.0.6

**下载**
- `desktop-todo_0.0.6_x64-setup.exe` —— 安装版（推荐）
- `desktop-todo_0.0.6_x64.exe` —— 免安装，直接双击运行
- `desktop-todo_0.0.6_x64.msi` —— 系统安装包

用户数据位于 `%APPDATA%\com.desktoptodo.widget\data.json`，升级不会丢失。

### 新增
- 新增 GitHub Actions 自动编译发布

### 修复
- 修复开机启动开关点击后长时间无响应

### 优化
- 优化边缘隐藏动画的衔接流畅度
```

该样例仅用于说明结构，实际正文由 CI 生成。

## 7. 已知风险与回退

**中文 `productName` 打包风险。** Tauri 在 Windows 上会用 `productName` 命名 MSI/NSIS 安装包与安装目录。中文在 WiX 与 NSIS 中通常可用，但尚未在本项目实测。若首次运行在打包阶段失败：

回退方案是在 `tauri.conf.json` 的 `bundle` 段显式设置 ASCII 名称，或给 `productName` 增加 ASCII 变体，保留中文用于窗口标题与托盘。该回退只改配置，不动代码。

**首次运行验证。** 推现有 `0.0.5` tag 即可做第一次端到端验证，不需要先改版本号。

## 8. 不在本次范围

- 代码签名（无证书）
- 自动更新（`updater` 未启用）
- macOS / Linux 构建
- 在 CI 上跑前端回归测试
- PR 阶段的编译检查

# GitHub Actions 自动编译发布实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 推送版本 tag 时在 GitHub Windows runner 上自动编译，产出裸 exe、NSIS 与 MSI 安装包，并以自动归纳的中文变更说明创建公开 Release。

**Architecture:** 单 job 工作流 `release.yml`。构建前先用 `changelog.ps1` 从 git 历史生成 Release 正文并写入 step output；随后删除国内镜像配置、安装 Rust 与预编译 Tauri CLI、跑 Rust 单测，最后交给 `tauri-apps/tauri-action@v1` 打包并创建 Release。

**Tech Stack:** GitHub Actions、PowerShell 7、Tauri v2.12.6、Rust stable、`tauri-apps/tauri-action@v1`、`Swatinem/rust-cache@v2`

## Global Constraints

- 目标平台只有 Windows（`windows-latest`），不构建 macOS / Linux。
- 前端为纯静态 `ui/`，CI 不安装 Node、不执行任何前端构建命令。
- CI 只运行 `cargo test --release`，不运行 `tests/regression.ps1`（依赖真实 WebView2 窗口与 CDP）。
- 构建前必须删除 `src-tauri/.cargo/config.toml`，避免美国 runner 访问 `rsproxy.cn`。
- Tauri CLI 固定 `tauri-cli-v2.12.6`，与 `Cargo.lock` 中 `tauri 2.12.6` 对齐；使用预编译包，不现场 `cargo install`。
- 版本号必须三方一致：tag（剥可选 `v` 前缀）、`src-tauri/Cargo.toml` 的 `[package].version`、`src-tauri/tauri.conf.json` 的 `.version`。不一致则失败退出。
- Release 资产名模式固定为 `[mainBinaryName]_[version][setup].[ext]`，产物为 `desktop-todo_<ver>.exe`、`desktop-todo_<ver>-setup.exe`、`desktop-todo_<ver>.msi`。
- Release 直接公开（`releaseDraft: false`、`prerelease: false`）。
- 变更说明是概括性三段式（新增 / 修复 / 优化），每组最多 5 条，不逐条罗列全部提交。
- 所有文档、注释、日志输出使用中文。
- 工作流中的 tag glob 为 `*.*.*`；版本校验用正则 `^v?\d+\.\d+\.\d+$` 兜底。

---

### Task 1: 变更说明生成脚本

**Files:**
- Create: `.github/scripts/changelog.ps1`
- Test: 手动在本机用 `pwsh` 对真实 tag 运行（本仓库历史已足够覆盖各分支）

**Interfaces:**
- Consumes: `git`（需要完整历史与 tag）、环境变量 `GITHUB_REF_NAME`、`GITHUB_OUTPUT`
- Produces: 参数 `-Tag <string>`（默认取 `$env:GITHUB_REF_NAME`）、`-RepoRoot <string>`（默认当前目录）、`-OutputFile <string>`（默认 `$env:GITHUB_OUTPUT`，为空时打印到 stdout）。成功时向 output 文件追加多行 `body`，进程退出码 0；版本不一致或 tag 非法时写 `::error::` 并 `exit 1`。

- [ ] **Step 1: 编写脚本**

创建 `.github/scripts/changelog.ps1`：

```powershell
[CmdletBinding()]
param(
  [string]$Tag = $env:GITHUB_REF_NAME,
  [string]$RepoRoot = '.',
  [string]$OutputFile = $env:GITHUB_OUTPUT
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $RepoRoot

function Fail([string]$message) {
  Write-Output "::error::$message"
  exit 1
}

# --- 版本来源 ---------------------------------------------------------------
if (-not $Tag) { Fail 'Tag 为空，无法生成变更说明' }
if ($Tag -notmatch '^v?(\d+\.\d+\.\d+)$') { Fail "Tag '$Tag' 不符合版本号格式 v?X.Y.Z" }
$version = $Matches[1]

$cargoToml = Get-Content -LiteralPath 'src-tauri/Cargo.toml' -Raw -Encoding UTF8
if ($cargoToml -notmatch '(?ms)^\s*\[package\]\s*$(.*?)(?=^\[|\z)') {
  Fail 'Cargo.toml 中找不到 [package] 段'
}
$packageSection = $Matches[1]
if ($packageSection -notmatch '(?m)^\s*version\s*=\s*"([^"]+)"') {
  Fail 'Cargo.toml 的 [package] 段中找不到 version'
}
$cargoVersion = $Matches[1]

$conf = Get-Content -LiteralPath 'src-tauri/tauri.conf.json' -Raw -Encoding UTF8 | ConvertFrom-Json
$confVersion = $conf.version

if ($cargoVersion -ne $version -or $confVersion -ne $version) {
  Fail "版本不一致：tag=$version Cargo.toml=$cargoVersion tauri.conf.json=$confVersion"
}

# --- 上一个版本 tag ---------------------------------------------------------
function ConvertTo-VersionKey([string]$name) {
  [version]($name -replace '^v', '')
}

$previous = $null
$candidates = @(git tag --merged "$Tag^" 2>$null) |
  Where-Object { $_ -match '^v?\d+\.\d+\.\d+$' } |
  Sort-Object { ConvertTo-VersionKey $_ }
if ($candidates.Count -gt 0) { $previous = $candidates[-1] }

$isFirst = $false
if ($previous) {
  $range = "$previous..$Tag"
  $subjects = @(git log --no-merges --format=%s $range)
} else {
  $isFirst = $true
  $subjects = @(git log --no-merges --format=%s -n 20 $Tag)
}

# --- 过滤与归类 -------------------------------------------------------------
$subjects = @($subjects |
  Where-Object { $_ } |
  ForEach-Object {
    # 版本号提交常与真实改动合并在一起，只剥掉版本号前缀保留其余描述
    ($_ -replace '^\s*版本号更新(?:为)?\s*[0-9][0-9A-Za-z.\-]*\s*[，,、]?\s*', '').Trim()
  } |
  Where-Object { $_ })

$groups = [ordered]@{ '新增' = @(); '修复' = @(); '优化' = @(); '其它变更' = @() }

$keywords = [ordered]@{
  '修复' = @('修复', '修正', '解决', '问题')
  '新增' = @('新增', '添加', '支持', '增加')
  '优化' = @('优化', '改进', '提升', '降低', '加快', '改为', '调整', '提速')
}

foreach ($subject in $subjects) {
  $bestGroup = $null
  $bestIndex = [int]::MaxValue
  foreach ($group in $keywords.Keys) {
    foreach ($word in $keywords[$group]) {
      $index = $subject.IndexOf($word, [StringComparison]::Ordinal)
      if ($index -ge 0 -and $index -lt $bestIndex) {
        $bestIndex = $index
        $bestGroup = $group
      }
    }
  }
  if (-not $bestGroup) { $bestGroup = '其它变更' }
  $groups[$bestGroup] += $subject
}

function Format-Item([string]$text) {
  if ($text.Length -gt 40) { $text = $text.Substring(0, 40) + '…' }
  "- $text"
}

# --- 拼装正文 ---------------------------------------------------------------
$lines = New-Object System.Collections.Generic.List[string]
$lines.Add("## 桌面待办 $version")
$lines.Add('')
if ($isFirst) {
  $lines.Add('> 首个发布版本')
  $lines.Add('')
}
$lines.Add('**下载**')
$lines.Add('- `desktop-todo_' + $version + '-setup.exe` —— 安装版（推荐）')
$lines.Add('- `desktop-todo_' + $version + '.exe` —— 免安装，直接双击运行')
$lines.Add('- `desktop-todo_' + $version + '.msi` —— 系统安装包')
$lines.Add('')
$lines.Add('用户数据位于 `%APPDATA%\com.desktoptodo.widget\data.json`，升级不会丢失。')

$limits = @{ '新增' = 5; '修复' = 5; '优化' = 5; '其它变更' = 3 }
$hasAny = $false
foreach ($group in $groups.Keys) {
  $items = $groups[$group]
  if ($items.Count -eq 0) { continue }
  $hasAny = $true
  $lines.Add('')
  $lines.Add("### $group")
  foreach ($item in ($items | Select-Object -First $limits[$group])) {
    $lines.Add((Format-Item $item))
  }
}

if (-not $hasAny) {
  $lines.Add('')
  $lines.Add('本次更新包含若干内部调整与稳定性改进。')
}

$body = ($lines -join "`n") + "`n"

if ($OutputFile) {
  $delimiter = "EOF_CHANGELOG"
  Add-Content -LiteralPath $OutputFile -Encoding UTF8 -Value "body<<$delimiter"
  Add-Content -LiteralPath $OutputFile -Encoding UTF8 -Value $body.TrimEnd()
  Add-Content -LiteralPath $OutputFile -Encoding UTF8 -Value $delimiter
} else {
  Write-Output $body
}
```

- [ ] **Step 2: 用真实历史验证正常路径（0.0.4 → 0.0.5）**

Run:
```bash
/tmp/pwsh/pwsh -NoLogo -NoProfile -File .github/scripts/changelog.ps1 -Tag 0.0.5 -RepoRoot .
```
Expected: 输出正文含 `## 桌面待办 0.0.5`、三行下载链接；`### 新增` 下出现「新增项目交接文档…」；**不出现**「版本号更新为 0.0.5」。

- [ ] **Step 3: 验证归类优先级（0.0.3 → 0.0.4）**

Run:
```bash
/tmp/pwsh/pwsh -NoLogo -NoProfile -File .github/scripts/changelog.ps1 -Tag 0.0.4 -RepoRoot .
```
Expected: 「新增回归测试集与 Rust 单测，修复色条间隙双击」归入 **### 新增**（「新增」出现在最前）；「修复开机启动开关点击后长时间无响应」归入 **### 修复**；「日历模式打开设置不再大幅放大窗口」不含任何关键词，归入 **### 其它变更**。

- [ ] **Step 4: 验证噪声剥离（0.0.2 → 0.0.3）**

Run:
```bash
/tmp/pwsh/pwsh -NoLogo -NoProfile -File .github/scripts/changelog.ps1 -Tag 0.0.3 -RepoRoot .
```
Expected: 「版本号更新为 0.0.3，并修复输入待办被后台刷新清空」被剥离前缀后变为「并修复输入待办被后台刷新清空」，归入 **### 修复**；正文中**不出现**字面量「版本号更新为」。

- [ ] **Step 5: 验证版本不一致时失败**

Run:
```bash
/tmp/pwsh/pwsh -NoLogo -NoProfile -File .github/scripts/changelog.ps1 -Tag 9.9.9 -RepoRoot .
```
Expected: 输出 `::error::版本不一致：tag=9.9.9 Cargo.toml=0.0.5 tauri.conf.json=0.0.5`，退出码 1。检查方式：`echo $?` 为 1。

- [ ] **Step 6: 验证非法 tag 时失败**

Run:
```bash
/tmp/pwsh/pwsh -NoLogo -NoProfile -File .github/scripts/changelog.ps1 -Tag nightly -RepoRoot . ; echo "exit=$?"
```
Expected: 输出含 `::error::Tag 'nightly' 不符合版本号格式`，`exit=1`。

- [ ] **Step 7: 验证首次发布分支**

Run（用一个不存在前置 tag 的对象验证：直接传最老的 tag，其 `^` 无已合并版本 tag）：
```bash
/tmp/pwsh/pwsh -NoLogo -NoProfile -File .github/scripts/changelog.ps1 -Tag 0.0.1 -RepoRoot .
```
Expected: 正文含 `> 首个发布版本`，且 `git tag --merged 0.0.1^` 返回空导致走 `-n 20` 分支。

- [ ] **Step 8: 提交**

```bash
git add .github/scripts/changelog.ps1
git commit -m "新增 Release 变更说明生成脚本"
```

---

### Task 2: 启用安装包打包

**Files:**
- Modify: `src-tauri/tauri.conf.json:15` (`bundle` 段)

**Interfaces:**
- Consumes: 无
- Produces: `bundle.active = true`，使 `cargo tauri build --bundles nsis,msi` 能产出安装包

- [ ] **Step 1: 修改配置**

把 `src-tauri/tauri.conf.json` 的 `bundle` 段由：

```json
  "bundle": {
    "active": false,
    "targets": "all",
    "icon": ["icons/icon.ico"]
  }
```

改为：

```json
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": ["icons/icon.ico"]
  }
```

- [ ] **Step 2: 验证 JSON 合法且字段生效**

Run:
```bash
python3 -c "import json;d=json.load(open('src-tauri/tauri.conf.json'));print(d['bundle']['active'], d['version'])"
```
Expected: 输出 `True 0.0.5`

- [ ] **Step 3: 确认不影响本地构建路径**

Run:
```bash
grep -rn 'bundle' src-tauri/src/main.rs src-tauri/build.rs || echo "构建脚本未读取 bundle 配置"
```
Expected: 输出「构建脚本未读取 bundle 配置」，说明 `cargo build --release` 行为不变。

- [ ] **Step 4: 提交**

```bash
git add src-tauri/tauri.conf.json
git commit -m "启用安装包打包，供 CI 产出 MSI 与 NSIS"
```

---

### Task 3: 发布工作流

**Files:**
- Create: `.github/workflows/release.yml`

**Interfaces:**
- Consumes: `.github/scripts/changelog.ps1`（Task 1）、`bundle.active=true`（Task 2）
- Produces: tag 推送触发，创建公开 Release 并上传三个资产

- [ ] **Step 1: 编写工作流**

创建 `.github/workflows/release.yml`：

```yaml
name: Release

on:
  push:
    tags:
      - '*.*.*'

permissions:
  contents: write

concurrency:
  group: release-${{ github.ref_name }}
  cancel-in-progress: false

jobs:
  build:
    runs-on: windows-latest
    steps:
      - name: 检出代码
        uses: actions/checkout@v4
        with:
          fetch-depth: 0
          fetch-tags: true

      - name: 生成变更说明
        id: changelog
        shell: pwsh
        run: ./.github/scripts/changelog.ps1 -Tag "$env:GITHUB_REF_NAME"

      - name: 移除国内镜像配置
        shell: pwsh
        run: Remove-Item -LiteralPath 'src-tauri/.cargo/config.toml' -Force

      - name: 安装 Rust
        uses: dtolnay/rust-toolchain@stable
        with:
          toolchain: stable

      - name: 缓存构建产物
        uses: Swatinem/rust-cache@v2
        with:
          workspaces: src-tauri -> target

      - name: 安装 Tauri CLI
        shell: pwsh
        run: |
          $cliVersion = 'v2.12.6'
          $dest = Join-Path $env:RUNNER_TEMP 'tauri-cli'
          New-Item -ItemType Directory -Force -Path $dest | Out-Null
          $zip = Join-Path $env:RUNNER_TEMP 'cargo-tauri.zip'
          $url = "https://github.com/tauri-apps/tauri/releases/download/tauri-cli-$cliVersion/cargo-tauri-x86_64-pc-windows-msvc.zip"
          Invoke-WebRequest -Uri $url -OutFile $zip
          Expand-Archive -LiteralPath $zip -DestinationPath $dest -Force
          $dest | Out-File -FilePath $env:GITHUB_PATH -Encoding utf8 -Append
          & (Join-Path $dest 'cargo-tauri.exe') --version

      - name: Rust 单元测试
        shell: pwsh
        working-directory: src-tauri
        run: cargo test --release

      - name: 打包并发布
        uses: tauri-apps/tauri-action@v1
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        with:
          projectPath: .
          tauriScript: cargo tauri
          args: --bundles nsis,msi
          tagName: ${{ github.ref_name }}
          releaseName: 桌面待办 ${{ github.ref_name }}
          releaseBody: ${{ steps.changelog.outputs.body }}
          releaseDraft: false
          prerelease: false
          generateReleaseNotes: false
          uploadPlainBinary: true
          releaseAssetNamePattern: '[mainBinaryName]_[version][setup].[ext]'
```

- [ ] **Step 2: 语法校验**

Run:
```bash
python3 -c "import yaml,sys;d=yaml.safe_load(open('.github/workflows/release.yml'));print('jobs:',list(d['jobs']));print('steps:',len(d['jobs']['build']['steps']))"
```
Expected: 输出 `jobs: ['build']` 与 `steps: 9`

- [ ] **Step 3: 校验关键约束**

Run:
```bash
python3 - <<'PY'
import yaml
d = yaml.safe_load(open('.github/workflows/release.yml'))
job = d['jobs']['build']
assert job['runs-on'] == 'windows-latest'
assert d['permissions']['contents'] == 'write'
assert d['on']['push']['tags'] == ['*.*.*']
steps = job['steps']
uses = [s.get('uses','') for s in steps]
assert 'actions/checkout@v4' in uses
assert 'dtolnay/rust-toolchain@stable' in uses
assert 'tauri-apps/tauri-action@v1' in uses
co = [s for s in steps if s.get('uses','').startswith('actions/checkout')][0]
assert co['with']['fetch-depth'] == 0 and co['with']['fetch-tags'] is True
action = [s for s in steps if s.get('uses','').startswith('tauri-apps/tauri-action')][0]
assert action['with']['args'] == '--bundles nsis,msi'
assert action['with']['releaseDraft'] is False
assert action['with']['prerelease'] is False
assert action['with']['uploadPlainBinary'] is True
assert action['with']['releaseBody'] == '${{ steps.changelog.outputs.body }}'
assert action['with']['releaseAssetNamePattern'] == '[mainBinaryName]_[version][setup].[ext]'
print('工作流约束校验通过')
PY
```
Expected: 输出 `工作流约束校验通过`

- [ ] **Step 4: 确认未引入 Node 依赖**

Run:
```bash
python3 -c "
import yaml
d=yaml.safe_load(open('.github/workflows/release.yml'))
text=str(d)
for word in ('setup-node','npm ','yarn','pnpm'):
    assert word not in text, word
print('无 Node 构建步骤')
"
```
Expected: 输出 `无 Node 构建步骤`

- [ ] **Step 5: 提交**

```bash
git add .github/workflows/release.yml
git commit -m "新增 tag 触发的自动编译发布工作流"
```

---

### Task 4: 更新交接文档

**Files:**
- Modify: `docs/HANDOFF.md:12-13`（发布版说明与远程说明）
- Modify: `docs/HANDOFF.md` 第 7 节「构建、版本与发布」

**Interfaces:**
- Consumes: 无
- Produces: 文档与实现一致，后续会话能按文档发版

- [ ] **Step 1: 更新第 1 节的过期陈述**

把 `docs/HANDOFF.md` 第 1 节底部两行：

```
- 发布版：`cargo build --release` 后运行 `src-tauri\target\release\desktop-todo.exe`，前端资源编译进 exe。
- 仓库当前没有配置远程，提交和 tag 都在本地。
```

改为：

```
- 本地调试：`cargo build --release` 后运行 `src-tauri\target\release\desktop-todo.exe`，前端资源编译进 exe。
- 正式发布：推版本 tag 由 GitHub Actions 自动编译打包并创建 Release，见第 7 节。
- 仓库远程：`git@github.com:zzmxoo/todo_list.git`（SSH）。
```

- [ ] **Step 2: 重写第 7 节的发布流程**

把 `docs/HANDOFF.md` 第 7 节的最后三行：

```
- 发布流程：改版本 → 构建 → 跑 `tests\regression.ps1` → 提交 → 打附注 tag。
- 当前 tag 命名：`0.0.x`；tag 说明用中文简述本次内容。
- `bundle.active` 为 `false`，目前没有生成安装包，直接运行 release exe。
```

改为：

```
- `bundle.active` 为 `true`，CI 据此产出 MSI 与 NSIS 安装包；本地仍可只用 `cargo build --release`。
- 发布流程：改版本（`Cargo.toml`、`Cargo.lock`、`tauri.conf.json`）→ 本地跑 `tests\regression.ps1` → 提交 → 打附注 tag → 推送 tag。
- tag 命名：`0.0.x`（不带 `v` 前缀），工作流同时兼容 `v0.0.x`。
- 工作流 `.github/workflows/release.yml`：推送 tag 后在 `windows-latest` 上编译，跑 `cargo test --release`，产出
  `desktop-todo_<ver>.exe`、`desktop-todo_<ver>-setup.exe`（NSIS）、`desktop-todo_<ver>.msi`，并创建公开 Release。
- Release 正文由 `.github/scripts/changelog.ps1` 从上一个 tag 到本次 tag 的提交标题归纳为「新增 / 修复 / 优化」三段，
  过滤「版本号更新」提交，每组最多 5 条。
- CI 不跑前端回归：`tests/regression.ps1` 依赖真实 WebView2 窗口与 CDP，只能在本地执行。
- CI 构建前会删除 `src-tauri/.cargo/config.toml`（国内镜像），避免美国 runner 访问 `rsproxy.cn`。
```

- [ ] **Step 3: 校验文档无残留矛盾**

Run:
```bash
grep -n '没有配置远程\|bundle.active` 为 `false`' docs/HANDOFF.md || echo "已无过期陈述"
```
Expected: 输出 `已无过期陈述`

- [ ] **Step 4: 提交**

```bash
git add docs/HANDOFF.md
git commit -m "更新交接文档的发布流程与远程说明"
```

---

### Task 5: 推送并端到端验证

**Files:**
- None（只执行外部操作与验证）

**Interfaces:**
- Consumes: Task 1-4 的全部产物
- Produces: 一次成功的 Release，证明整条链路可用

- [ ] **Step 1: 推送提交**

```bash
git push origin master
```
Expected: 推送成功。

- [ ] **Step 2: 推送用于验证的新 tag**

`0.0.5` 的提交里没有 `.github/`，而 GitHub 的 push 事件使用被推 ref 上的工作流文件，推旧 tag 不会触发。因此先升版本到 `0.0.6` 再打 tag。

依次修改三处版本号：

```bash
sed -i 's/^version = "0.0.5"/version = "0.0.6"/' src-tauri/Cargo.toml
sed -i 's/"version": "0.0.5"/"version": "0.0.6"/' src-tauri/tauri.conf.json
python3 - <<'PY'
import re, pathlib
p = pathlib.Path('src-tauri/Cargo.lock')
s = p.read_text(encoding='utf-8')
s = s.replace('name = "desktop-todo"\nversion = "0.0.5"', 'name = "desktop-todo"\nversion = "0.0.6"', 1)
p.write_text(s, encoding='utf-8')
PY
```

校验三处一致：

```bash
python3 -c "
import json,re
print(re.search(r'(?m)^version = \"(.*)\"', open('src-tauri/Cargo.toml').read()).group(1))
print(json.load(open('src-tauri/tauri.conf.json'))['version'])
print(re.search(r'name = \"desktop-todo\"\nversion = \"(.*)\"', open('src-tauri/Cargo.lock').read()).group(1))
"
```
Expected: 三行都是 `0.0.6`

提交并打 tag：

```bash
git add src-tauri/Cargo.toml src-tauri/tauri.conf.json src-tauri/Cargo.lock
git commit -m "版本号更新为 0.0.6"
git tag -a 0.0.6 -m "自动编译发布：首个 GitHub Release"
git push origin master
git push origin 0.0.6
```
Expected: 远程新增 `refs/tags/0.0.6`，Actions 中出现一次 `Release` 运行。

- [ ] **Step 3: 观察运行结果**

```bash
curl -s -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/zzmxoo/todo_list/actions/runs?per_page=1" \
  | python3 -c "
import json,sys
r=json.load(sys.stdin)['workflow_runs'][0]
print(r['name'], r['head_branch'], r['status'], r['conclusion'], r['html_url'])
"
```
Expected: `Release 0.0.6 completed success ...`。若 `conclusion` 为 `failure`，按以下顺序排查：

1. 日志中 `生成变更说明` 步骤失败 → 检查 tag 版本与配置文件是否一致。
2. 日志中 `移除国内镜像配置` 之后的依赖下载失败 → 属网络问题，重跑一次作业。
3. 日志中 `打包并发布` 步骤失败且错误含 `非 ASCII`、`productName`、`WiX` 或 `NSIS` → 触发第 7 节回退方案：在 `tauri.conf.json` 的 `bundle` 段加入 `"windows": { "wix": { "language": "zh-CN" } }`；若仍失败，则新增 ASCII 的 `mainBinaryName` 并把 `productName` 改为 ASCII，窗口标题保持中文。

- [ ] **Step 4: 校验 Release 资产**

```bash
curl -s -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/zzmxoo/todo_list/releases/tags/0.0.6" \
  | python3 -c "
import json,sys
d=json.load(sys.stdin)
print('draft:', d['draft'], 'prerelease:', d['prerelease'])
print('name:', d['name'])
for a in d['assets']:
    print(' asset:', a['name'], a['size'])
print('--- body ---')
print(d['body'])
"
```
Expected:
- `draft: False prerelease: False`
- `name: 桌面待办 0.0.6`
- 资产含 `desktop-todo_0.0.6.exe`、`desktop-todo_0.0.6-setup.exe`、`desktop-todo_0.0.6.msi`
- 正文含 `## 桌面待办 0.0.6`、三行下载链接，以及 `### 新增` 分组（内容为「新增 GitHub Actions 自动编译发布设计文档」）

- [ ] **Step 5: 记录结果**

若三步均符合预期，在本次会话总结中报告：工作流耗时、三个资产大小、正文实际内容。若与预期有偏差，记录偏差原因后再决定是否调整脚本规则。

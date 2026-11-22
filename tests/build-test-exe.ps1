# 构建带 CDP 调试端口的测试用 exe。
#
# 背景：以前测试靠 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS 环境变量把 --remote-debugging-port
# 传给 WebView2。Edge/WebView2 158 起这个变量不再生效（wry 会显式设置
# additionalBrowserArguments，覆盖了环境变量），集成测试因此无法连上 CDP。
#
# 改为编译期注入：用 TAURI_CONFIG 把调试端口合并进 tauri.conf.json 的窗口配置。
# 产物放在独立目录 src-tauri\target-test\，与发布版 target\release\ 物理隔离，
# 保证 tauri.conf.json 保持干净、CI 打出的发布包不可能带调试端口。
param(
  [int]$Port = 9222,
  [switch]$Force
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$crateDir = Join-Path $root 'src-tauri'
$targetDir = Join-Path $crateDir 'target-test'
$exe = Join-Path $targetDir 'release\desktop-todo.exe'

# 读取当前窗口配置，补上调试参数后整体写回（数组是替换语义，必须完整给出）。
$confPath = Join-Path $crateDir 'tauri.conf.json'
$conf = Get-Content $confPath -Raw -Encoding UTF8 | ConvertFrom-Json
$win = $conf.app.windows[0]
$win | Add-Member -NotePropertyName additionalBrowserArgs -NotePropertyValue (
  '--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --remote-debugging-port=' + $Port
) -Force

$override = @{ app = @{ windows = @($win) } } | ConvertTo-Json -Depth 12 -Compress

# 已存在且比配置新，就跳过重编（cargo 增量编译也很快，但能省则省）。
$confTime = (Get-Item $confPath).LastWriteTime
$uiTime = (Get-ChildItem (Join-Path $root 'ui') -Recurse -File |
           Sort-Object LastWriteTime -Descending | Select-Object -First 1).LastWriteTime
$srcTime = (Get-Item (Join-Path $crateDir 'src\main.rs')).LastWriteTime
$newer = @($confTime, $uiTime, $srcTime) | Sort-Object -Descending | Select-Object -First 1

if (-not $Force -and (Test-Path $exe) -and (Get-Item $exe).LastWriteTime -ge $newer) {
  Write-Host "test exe up-to-date: $exe"
  return $exe
}

Write-Host "building test exe (CDP port $Port) -> $targetDir"

$saved = @{
  TAURI_CONFIG     = $env:TAURI_CONFIG
  CARGO_TARGET_DIR = $env:CARGO_TARGET_DIR
}
$env:TAURI_CONFIG = $override
$env:CARGO_TARGET_DIR = $targetDir
try {
  Push-Location $crateDir
  try {
    # cargo 的进度信息走 stderr，PowerShell 会当成错误；用 cmd 包装并统一重定向
    $out = & cmd /c "cargo build --release 2>&1"
    $code = $LASTEXITCODE
  } finally {
    Pop-Location
  }
} finally {
  $env:TAURI_CONFIG = $saved.TAURI_CONFIG
  $env:CARGO_TARGET_DIR = $saved.CARGO_TARGET_DIR
}

if ($code -ne 0) {
  $out | Select-Object -Last 15 | ForEach-Object { Write-Host $_ }
  throw "cargo build failed (exit $code)"
}
if (-not (Test-Path $exe)) { throw "build succeeded but exe not found: $exe" }

Write-Host "ok: $exe"
return $exe

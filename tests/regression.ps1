# 完整回归套件：领域/核心单元测试 + 名言数据校验 + UI 集成回归。
# 一条命令跑完，失败时退出码为 1：
#   powershell -ExecutionPolicy Bypass -File tests\regression.ps1
param(
  [int]$Port = 9222,
  [switch]$SkipUnits,
  [switch]$SkipRust
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$cdp = Join-Path $root '_dev_cdp.ps1'
$prodExe = Join-Path $root 'src-tauri\target\release\desktop-todo.exe'
$data = Join-Path $env:APPDATA 'com.desktoptodo.widget\data.json'
$backup = "$data.regress"

# 测试用 exe：编译期注入调试端口，产物隔离在 src-tauri\target-test\。
# WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS 在 Edge/WebView2 158 起已失效，不能再依赖。
$exe = & (Join-Path $PSScriptRoot 'build-test-exe.ps1') -Port $Port
if (-not $exe -or -not (Test-Path $exe)) { throw "test exe not available: $exe" }

Copy-Item $data $backup -Force
$passed = 0
$failed = 0

function Eval-Expr([string]$expr) {
  # Windows 命令行上限约 32KB，集成脚本已超过，统一走临时文件传递。
  $tempPath = $env:TEMP
  if (-not $tempPath) { $tempPath = [System.IO.Path]::GetTempPath() }
  $name = 'todo-cdp-' + [guid]::NewGuid().ToString('N') + '.js'
  $tmp = Join-Path $tempPath $name
  [System.IO.File]::WriteAllText($tmp, $expr, (New-Object System.Text.UTF8Encoding($false)))
  try {
    $raw = & powershell -NoProfile -ExecutionPolicy Bypass -File $cdp -Port $Port -ExprFile $tmp
  } finally {
    Remove-Item $tmp -Force -ErrorAction SilentlyContinue
  }
  $obj = ($raw | Select-Object -Last 1) | ConvertFrom-Json
  if ($obj.result.result.value) { return $obj.result.result.value }
  throw (($obj.result.result.description) + ' ' + $obj.result.result.className)
}

function Report-Cases($result, [string]$prefix) {
  foreach ($case in $result.results) {
    if ($case.ok) {
      $script:passed += 1
      "PASS  $($case.name)" + $(if ($case.detail) { "  [$($case.detail)]" } else { '' })
    } else {
      $script:failed += 1
      "FAIL  $($case.name): $($case.error)"
    }
  }
  "$prefix pass=$($result.passed) fail=$($result.failed)"
}

try {
  # 先停掉常驻程序，避免 cargo test 链接时被运行中的 exe 锁住。
  Get-Process -Name desktop-todo -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep -Milliseconds 600

  if (-not $SkipRust) {
    # Rust 侧只测纯函数（缓动、插值、注册表命令参数），不启动窗口。
    Push-Location (Join-Path $root 'src-tauri')
    try {
      $rustOut = & cmd /c "cargo test --release 2>&1"
      $rustCode = $LASTEXITCODE
    } finally {
      Pop-Location
    }
    $rustOut | Where-Object { $_ -match '^(test |test result:|error)' } | ForEach-Object { $_ }
    $rustSummary = $rustOut | Select-String 'test result: [^.]+\. (\d+) passed; (\d+) failed'
    if ($rustSummary) {
      foreach ($match in $rustSummary.Matches) {
        $passed += [int]$match.Groups[1].Value
        $failed += [int]$match.Groups[2].Value
      }
    } elseif ($rustCode -ne 0) {
      $failed += 1
      'FAIL  RUST cargo test'
    }
  }

  Get-Process -Name desktop-todo -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep -Milliseconds 600
  Start-Process $exe
  # 等 CDP 端口就绪
  $ready = $false
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Milliseconds 500
    try { Invoke-RestMethod "http://127.0.0.1:$Port/json" | Out-Null; $ready = $true; break } catch { }
  }
  if (-not $ready) { throw "CDP port $Port not ready after 15s" }

  if (-not $SkipUnits) {
    foreach ($file in @('unit-core.js', 'unit-weather.js', 'unit-todo.js', 'unit-calendar.js', 'unit-domain.js')) {
      $expr = Get-Content (Join-Path $PSScriptRoot $file) -Raw -Encoding UTF8
      $result = (Eval-Expr $expr) | ConvertFrom-Json
      Report-Cases $result "UNIT[$file]"
    }

    $quotesExpr = @'
fetch('quotes.json')
  .then(r => r.json())
  .then(d => {
    const seen = new Set();
    let dup = 0, badLen = 0, badAuthor = 0;
    for (const q of d.quotes) {
      if (seen.has(q.t)) dup += 1;
      seen.add(q.t);
      if (typeof q.t !== 'string' || q.t.length < 6 || q.t.length > 40) badLen += 1;
      if (typeof q.f !== 'string' || !q.f) badAuthor += 1;
    }
    return JSON.stringify({ total: d.quotes.length, unique: seen.size, dup: dup, badLen: badLen, badAuthor: badAuthor });
  })
'@
    $quotes = (Eval-Expr $quotesExpr) | ConvertFrom-Json
    "QUOTES total=$($quotes.total) unique=$($quotes.unique) dup=$($quotes.dup) badLen=$($quotes.badLen) badAuthor=$($quotes.badAuthor)"
    if ($quotes.total -eq 1260 -and $quotes.dup -eq 0 -and $quotes.badLen -eq 0 -and $quotes.badAuthor -eq 0) {
      $passed += 1
    } else {
      $failed += 1
      "FAIL  QUOTES dataset"
    }
  }

  $expr = Get-Content (Join-Path $PSScriptRoot 'integration-page.js') -Raw -Encoding UTF8
  $value = Eval-Expr $expr
  if (-not $value) { throw 'integration script did not return results' }
  $result = $value | ConvertFrom-Json
  Report-Cases $result 'INTEGRATION'
}
finally {
  Get-Process -Name desktop-todo -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep -Milliseconds 600
  if (Test-Path $backup) {
    Copy-Item $backup $data -Force
    Remove-Item $backup -Force
  }
  # 恢复常驻程序用发布版，不带调试端口
  if (Test-Path $prodExe) { Start-Process $prodExe }
}

"REGRESSION pass=$passed fail=$failed"
if ($failed -gt 0) { exit 1 }

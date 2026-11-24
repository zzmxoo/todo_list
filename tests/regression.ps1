# 完整回归套件：领域/核心单元测试 + 名言数据校验 + UI 集成回归。
# 一条命令跑完，失败时退出码为 1：
#   powershell -ExecutionPolicy Bypass -File tests\regression.ps1
param(
  [int]$Port = 9222,
  [switch]$SkipUnits,
  [switch]$SkipRust
)
$ErrorActionPreference = 'Stop'

# 两套回归脚本共用命名互斥量，避免同时抢 CDP 端口和同一 data 目录。
$regressionMutex = New-Object System.Threading.Mutex($false, 'Local\TodoRegression')
$owned = $false
try { $owned = $regressionMutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $owned = $true }
if (-not $owned) { throw '另一个回归进程正在运行（integration.ps1 / regression.ps1），请等待其结束。' }

$root = Split-Path $PSScriptRoot -Parent
$cdp = Join-Path $root '_dev_cdp.ps1'
$prodExe = Join-Path $root 'src-tauri\target\release\desktop-todo.exe'
$data = Join-Path $env:APPDATA 'com.desktoptodo.widget\data.json'
$backup = "$data.regress"
. (Join-Path $PSScriptRoot 'regress-lib.ps1')

$passed = 0
$failed = 0
$skipped = 0

# 先验证备份守卫本身，再接触任何用户数据。
$libOut = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'test-regress-lib.ps1')
$libOut | ForEach-Object { $_ }
$passed += @($libOut | Where-Object { $_ -like 'PASS  *' }).Count
$failed += @($libOut | Where-Object { $_ -like 'FAIL  *' }).Count
if ($LASTEXITCODE -ne 0 -and $failed -eq 0) {
  $failed += 1
  'FAIL  regress-lib self-test'
}
# 子进程空跑 / 用例被注释但 exit 0 时，计数会是 0；必须要求最低条数。
if ($passed -lt 6) {
  $failed += 1
  "FAIL  regress-lib self-test only $passed cases, expected at least 6"
}
if ($failed -gt 0) {
  "REGRESSION pass=$passed fail=$failed skip=$skipped"
  exit 1
}

function Stop-App {
  # 测试版/发布版可能由管理员权限启动；失败时退回 WMI Terminate。
  $procs = Get-Process -Name desktop-todo -ErrorAction SilentlyContinue
  if ($procs) { $procs | Stop-Process -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Milliseconds 300
  $left = Get-CimInstance Win32_Process -Filter "Name='desktop-todo.exe'" -ErrorAction SilentlyContinue
  foreach ($proc in $left) {
    Invoke-CimMethod -InputObject $proc -MethodName Terminate -ErrorAction SilentlyContinue | Out-Null
  }
  Start-Sleep -Milliseconds 400
}

$exe = $null
$backupCreated = $false

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
    if ($case.skipped) {
      $script:skipped += 1
      "SKIP  $($case.name)" + $(if ($case.detail) { "  [$($case.detail)]" } else { '' })
    } elseif ($case.ok) {
      $script:passed += 1
      "PASS  $($case.name)" + $(if ($case.detail) { "  [$($case.detail)]" } else { '' })
    } else {
      $script:failed += 1
      "FAIL  $($case.name): $($case.error)"
    }
  }
  $skipCount = if ($null -eq $result.skipped) { 0 } else { $result.skipped }
  "$prefix pass=$($result.passed) fail=$($result.failed) skip=$skipCount"
}

try {
  # 守卫、构建、备份都放在 try 内：任何一步抛错，finally 仍会重启发布版。
  Stop-App
  $backupCreated = New-UserDataBackup $data $backup

  # 测试用 exe：编译期注入调试端口，产物隔离在 src-tauri\target-test\。
  # WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS 在 Edge/WebView2 158 起已失效，不能再依赖。
  $exe = & (Join-Path $PSScriptRoot 'build-test-exe.ps1') -Port $Port
  if (-not $exe -or -not (Test-Path $exe)) { throw "test exe not available: $exe" }

  # 先停掉常驻程序，避免 cargo test 链接时被运行中的 exe 锁住。
  Stop-App

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

  Stop-App
  # 预置一条 AI 待办，供 REG-34 验证 CLI -> ai-inbox -> UI 链路
  Start-Process -FilePath $exe -ArgumentList '--add','ITEST-AI-INSERT','--provider','dsh' -Wait
  Start-Sleep -Milliseconds 500
  Start-Process $exe
  # 等 CDP 端口就绪
  $ready = $false
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Milliseconds 500
    try { Invoke-RestMethod "http://127.0.0.1:$Port/json" | Out-Null; $ready = $true; break } catch { }
  }
  if (-not $ready) { throw "CDP port $Port not ready after 15s" }

  if (-not $SkipUnits) {
    # 自动发现 unit-*.js，避免新增文件只在一处登记、另一处静默漏跑。
    $unitFiles = @(Get-ChildItem -LiteralPath $PSScriptRoot -Filter 'unit-*.js' | Sort-Object Name)
    foreach ($file in $unitFiles) {
      $expr = Get-Content $file.FullName -Raw -Encoding UTF8
      $result = (Eval-Expr $expr) | ConvertFrom-Json
      Report-Cases $result "UNIT[$($file.Name)]"
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
    if ($quotes.total -eq 1313 -and $quotes.dup -eq 0 -and $quotes.badLen -eq 0 -and $quotes.badAuthor -eq 0) {
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
  if (@($result.results).Count -lt 46) {
    $failed += 1
    "FAIL  INTEGRATION only $((@($result.results)).Count) cases, expected at least 46"
  }

  # REG-46 端到端：损坏的 data.json 不能被静默写成空壳。
  # 用临时数据目录 + 预置 ai-inbox 条目，完全不碰用户真实数据；
  # 旧实现会在 drain 时写出只含 AI 条目的 data.json，判别力比等定时保存更强。
  Stop-App
  $probeDir = Join-Path ([System.IO.Path]::GetTempPath()) ('todo-corrupt-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $probeDir | Out-Null
  try {
    $env:DESKTOP_TODO_DATA_DIR = $probeDir
    Start-Process -FilePath $exe -ArgumentList '--add','ITEST-CORRUPT-PROBE','--provider','dsh' -Wait
    $probeData = Join-Path $probeDir 'data.json'
    [System.IO.File]::WriteAllText($probeData, '{ broken json', (New-Object System.Text.UTF8Encoding($false)))
    Start-Process $exe
    $ready = $false
    for ($i = 0; $i -lt 30; $i++) {
      Start-Sleep -Milliseconds 500
      try { Invoke-RestMethod "http://127.0.0.1:$Port/json" | Out-Null; $ready = $true; break } catch { }
    }
    if (-not $ready) { throw "CDP port $Port not ready for corrupt-data test" }
    $corruptExpr = @'
(async () => {
  const err = document.getElementById('loadError');
  const app = document.getElementById('app');
  return JSON.stringify({
    visible: !!err && !err.hidden,
    text: err ? err.textContent : '',
    ready: !!app && app.classList.contains('ready'),
  });
})()
'@
    $corruptUi = (Eval-Expr $corruptExpr) | ConvertFrom-Json
    Start-Sleep -Milliseconds 2600
    $recreated = Test-Path -LiteralPath $probeData
    $kept = @(Get-ChildItem -LiteralPath $probeDir -Filter 'data.json.corrupt-*' -ErrorAction SilentlyContinue).Count -gt 0
    $inboxKept = @(Get-ChildItem -LiteralPath (Join-Path $probeDir 'ai-inbox') -Filter '*.json' -ErrorAction SilentlyContinue).Count -gt 0
    if ($corruptUi.visible -and $corruptUi.ready -and $kept -and -not $recreated -and $inboxKept) {
      $passed += 1
      'PASS  [REG-46] data.json 损坏时显示告警、保留原文件且不写盘  [corrupt kept, inbox kept]'
    } else {
      $failed += 1
      "FAIL  [REG-46] data.json 损坏保护: visible=$($corruptUi.visible) ready=$($corruptUi.ready) kept=$kept recreated=$recreated inboxKept=$inboxKept text=$($corruptUi.text)"
    }
  } finally {
    Stop-App
    Remove-Item Env:DESKTOP_TODO_DATA_DIR -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $probeDir -Recurse -Force -ErrorAction SilentlyContinue
  }
}
finally {
  Stop-App
  # 只恢复本次实际创建的备份；New-UserDataBackup 失败时绝不碰用户数据。
  if ($backupCreated) {
    try {
      $null = Restore-UserDataBackup $data $backup
    } catch {
      $failed += 1
      "FAIL  恢复用户数据失败：$($_.Exception.Message)"
      "      备份保留在 $backup，请人工确认后再运行回归"
    }
  }
  $inbox = Join-Path $env:APPDATA 'com.desktoptodo.widget\ai-inbox'
  if (Test-Path $inbox) {
    Get-ChildItem $inbox -Filter '*.json' | ForEach-Object {
      try {
        if ((Get-Content $_.FullName -Raw -Encoding UTF8 | ConvertFrom-Json).text -eq 'ITEST-AI-INSERT') {
          Remove-Item $_.FullName -Force
        }
      } catch { }
    }
  }
  # 恢复常驻程序用发布版，不带调试端口
  if (Test-Path $prodExe) { Start-Process $prodExe }
  try { $regressionMutex.ReleaseMutex() } catch { }
  $regressionMutex.Dispose()
}

if ($skipped -gt 0) {
  "WARN  $skipped case(s) skipped（网络 / 显示器不满足），不计入失败，但本次全绿不代表这些用例已执行"
}
"REGRESSION pass=$passed fail=$failed skip=$skipped"
if ($failed -gt 0) { exit 1 }

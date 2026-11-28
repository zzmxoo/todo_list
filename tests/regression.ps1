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
$regressionMutex = New-Object System.Threading.Mutex($false, 'Global\TodoRegression')
$owned = $false
try { $owned = $regressionMutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $owned = $true }
if (-not $owned) { throw '另一个回归进程正在运行（integration.ps1 / regression.ps1），请等待其结束。' }

$root = Split-Path $PSScriptRoot -Parent
$cdp = Join-Path $root '_dev_cdp.ps1'
$prodExe = Join-Path $root 'src-tauri\target\release\desktop-todo.exe'
$data = Join-Path $env:LOCALAPPDATA 'desktoptodo\data.json'
$backup = "$data.regress"
. (Join-Path $PSScriptRoot 'regress-lib.ps1')

$passed = 0
$failed = 0
$skipped = 0
$extraCases = 0

# 先验证备份守卫本身，再接触任何用户数据。
$libOut = & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'test-regress-lib.ps1')
$libOut | ForEach-Object { $_ }
$passed += @($libOut | Where-Object { $_ -match '^PASS\s' }).Count
$failed += @($libOut | Where-Object { $_ -match '^FAIL\s' }).Count
if ($LASTEXITCODE -ne 0 -and $failed -eq 0) {
  $failed += 1
  'FAIL  regress-lib self-test'
}
# 子进程空跑 / 用例被注释但 exit 0 时，计数会是 0；必须要求最低条数。
if ($passed -lt $MIN_REGRESS_LIB_CASES) {
  $failed += 1
  "FAIL  regress-lib self-test only $passed cases, expected at least $MIN_REGRESS_LIB_CASES"
}
if ($failed -gt 0) {
  "REGRESSION pass=$passed fail=$failed skip=$skipped"
  exit 1
}

function Stop-App {
  # 先请求正常关窗，让前端 flush；2 秒不退再强制结束。
  $procs = Get-Process -Name desktop-todo -ErrorAction SilentlyContinue
  if ($procs) {
    foreach ($proc in $procs) { $null = $proc.CloseMainWindow() }
    foreach ($proc in $procs) {
      try { Wait-Process -Id $proc.Id -Timeout 2 -ErrorAction Stop } catch { }
    }
    $procs = Get-Process -Name desktop-todo -ErrorAction SilentlyContinue
    if ($procs) { $procs | Stop-Process -Force -ErrorAction SilentlyContinue }
  }
  Start-Sleep -Milliseconds 300
  # 测试版/发布版可能由管理员权限启动；失败时退回 WMI Terminate。
  $left = Get-CimInstance Win32_Process -Filter "Name='desktop-todo.exe'" -ErrorAction SilentlyContinue
  foreach ($proc in $left) {
    Invoke-CimMethod -InputObject $proc -MethodName Terminate -ErrorAction SilentlyContinue | Out-Null
  }
  Start-Sleep -Milliseconds 400
  # 杀不干净时绝不能继续：运行中的实例会在恢复后用内存状态覆盖用户数据。
  if (Get-Process -Name desktop-todo -ErrorAction SilentlyContinue) {
    throw 'desktop-todo 未能停止（可能由管理员启动或被安全软件拦截），已中止以免覆盖用户数据'
  }
}

$exe = $null
$backupCreated = $false
$dataExisted = $null
$appWasRunning = $false
$originalAppPath = $null
$inboxReal = Join-Path $env:LOCALAPPDATA 'desktoptodo\ai-inbox'
$inboxLegacy = Join-Path $env:APPDATA 'com.desktoptodo.widget\ai-inbox'
$inboxHold = $null
$legacyHold = $null
$inboxExisted = $false
$legacyExisted = $false
$testRunKey = 'HKCU:\Software\DesktopTodo.Test'

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
  $appWasRunning = [bool](Get-Process -Name desktop-todo -ErrorAction SilentlyContinue)
  if ($appWasRunning) {
    $originalAppPath = (Get-Process -Name desktop-todo -ErrorAction SilentlyContinue | Select-Object -First 1).Path
  }
  Stop-App
  # 测试构建把自启写到独立 Test 键，真实 Run 键不会被改动，无需快照。
  $dataExisted = Test-Path -LiteralPath $data
  $backupCreated = New-UserDataBackup $data $backup
  # data.json.bak 现在是恢复源，测试也必须原样保留它。
  $backupBak = "$backup.bak"
  if (Test-Path -LiteralPath $backupBak) {
    throw "发现残留快照备份 $backupBak，请先人工确认上一轮回归是否正常结束"
  }
  if (Test-Path -LiteralPath "$data.bak") {
    Copy-Item -LiteralPath "$data.bak" -Destination $backupBak -Force
  }
  # 测试版会 drain 真实收件箱并删除源文件；先整个挪走，结束后原样放回。
  $inboxExisted = Test-Path -LiteralPath $inboxReal
  if ($inboxExisted) {
    $hold = Join-Path ([System.IO.Path]::GetTempPath()) ('todo-inbox-' + [guid]::NewGuid().ToString('N'))
    Move-Item -LiteralPath $inboxReal -Destination $hold -Force -ErrorAction Stop
    $inboxHold = $hold
  }
  $legacyExisted = Test-Path -LiteralPath $inboxLegacy
  if ($legacyExisted) {
    $hold = Join-Path ([System.IO.Path]::GetTempPath()) ('todo-inbox-legacy-' + [guid]::NewGuid().ToString('N'))
    Move-Item -LiteralPath $inboxLegacy -Destination $hold -Force -ErrorAction Stop
    $legacyHold = $hold
  }

  # 测试用 exe：编译期注入调试端口，产物隔离在 src-tauri\target-test\。
  # WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS 在 Edge/WebView2 158 起已失效，不能再依赖。
  $exe = & (Join-Path $PSScriptRoot 'build-test-exe.ps1') -Port $Port
  if (-not $exe -or -not (Test-Path $exe)) { throw "test exe not available: $exe" }

  # 先停掉常驻程序，避免 cargo test 链接时被运行中的 exe 锁住。
  Stop-App

  if (-not $SkipRust) {
    $rustPassed = 0
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
        $rustPassed += [int]$match.Groups[1].Value
        $passed += [int]$match.Groups[1].Value
        $failed += [int]$match.Groups[2].Value
      }
    }
    if ($rustCode -ne 0) {
      $failed += 1
      "FAIL  RUST cargo test exit $rustCode"
    }
    if ($rustPassed -lt $MIN_RUST_CASES) {
      $failed += 1
      "FAIL  RUST only $rustPassed tests, expected at least $MIN_RUST_CASES"
    }
  }

  Stop-App
  # 预置一条 AI 待办，供 REG-34 验证 CLI -> ai-inbox -> UI 链路
  Start-Process -FilePath $exe -ArgumentList '--add','ITEST-AI-INSERT','--provider','dsh' -Wait
  Start-Sleep -Milliseconds 500
  Start-Process $exe
  # 等 CDP 端口就绪
  $ready = $false
  for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Milliseconds 500
    try { Invoke-RestMethod "http://127.0.0.1:$Port/json" | Out-Null; $ready = $true; break } catch { }
  }
  if (-not $ready) { throw "CDP port $Port not ready after 30s；若已有实例（含管理员启动）在跑，请先结束" }
  $appTarget = $false
  for ($i = 0; $i -lt 20 -and -not $appTarget; $i++) {
    Start-Sleep -Milliseconds 200
    $targets = Invoke-RestMethod "http://127.0.0.1:$Port/json"
    $appTarget = [bool]($targets | Where-Object { $_.url -match 'index\.html\?test=1' })
  }
  if (-not $appTarget) {
    throw "端口 $Port 被其它进程占用（未找到本应用的 ?test=1 页面）"
  }

  if (-not $SkipUnits) {
    # 自动发现 unit-*.js，避免新增文件只在一处登记、另一处静默漏跑。
    $unitFiles = @(Get-ChildItem -LiteralPath $PSScriptRoot -Filter 'unit-*.js' | Sort-Object Name)
    $unitPassed = 0
    foreach ($file in $unitFiles) {
      $expr = Get-Content $file.FullName -Raw -Encoding UTF8
      $result = (Eval-Expr $expr) | ConvertFrom-Json
      Report-Cases $result "UNIT[$($file.Name)]"
      $unitPassed += [int]$result.passed
    }
    if ($unitPassed -lt $MIN_UNIT_CASES) {
      $failed += 1
      "FAIL  UNIT only $unitPassed cases, expected at least $MIN_UNIT_CASES"
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
    if ($quotes.total -eq $QUOTE_COUNT -and $quotes.dup -eq 0 -and $quotes.badLen -eq 0 -and $quotes.badAuthor -eq 0) {
      $passed += 1
      $extraCases += 1
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
  if (@($result.results).Count -lt $MIN_INTEGRATION_CASES) {
    $failed += 1
    "FAIL  INTEGRATION only $((@($result.results)).Count) cases, expected at least $MIN_INTEGRATION_CASES"
  }
  $executed = @($result.results | Where-Object { -not $_.skipped }).Count
  $skippedCases = [int]$result.skipped
  if ($executed -lt $MIN_INTEGRATION_EXECUTED) {
    $failed += 1
    "FAIL  INTEGRATION only $executed cases actually executed, expected at least $MIN_INTEGRATION_EXECUTED"
  }
  if ($skippedCases -gt 3) {
    $failed += 1
    "FAIL  INTEGRATION skipped $skippedCases cases, expected at most 3"
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
    for ($i = 0; $i -lt 60; $i++) {
      Start-Sleep -Milliseconds 500
      try { Invoke-RestMethod "http://127.0.0.1:$Port/json" | Out-Null; $ready = $true; break } catch { }
    }
    if (-not $ready) { throw "CDP port $Port not ready for corrupt-data test" }
    $probeTarget = $false
    for ($i = 0; $i -lt 20 -and -not $probeTarget; $i++) {
      Start-Sleep -Milliseconds 200
      $targets = Invoke-RestMethod "http://127.0.0.1:$Port/json"
      $probeTarget = [bool]($targets | Where-Object { $_.url -match 'index\.html\?test=1' })
    }
    if (-not $probeTarget) { throw "端口 $Port 被其它进程占用（探针页面未就绪）" }
    $appReady = $false
    for ($i = 0; $i -lt 25 -and -not $appReady; $i++) {
      Start-Sleep -Milliseconds 200
      try { $appReady = (Eval-Expr "document.getElementById('app') ? 'ok' : ''") -eq 'ok' } catch { }
    }
    if (-not $appReady) { throw "探针页面 #app 未就绪" }
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
    $kept = $false
    for ($i = 0; $i -lt 20 -and -not $kept; $i++) {
      Start-Sleep -Milliseconds 200
      $kept = @(Get-ChildItem -LiteralPath $probeDir -Filter 'data.json.corrupt-*' -ErrorAction SilentlyContinue).Count -gt 0
    }
    # 再等两个保存周期，确认前端没有把默认空状态写回去。
    Start-Sleep -Milliseconds 600
    $recreated = Test-Path -LiteralPath $probeData
    $inboxKept = @(Get-ChildItem -LiteralPath (Join-Path $probeDir 'ai-inbox') -Filter '*.json' -ErrorAction SilentlyContinue).Count -gt 0
    $corruptFile = Get-ChildItem -LiteralPath $probeDir -Filter 'data.json.corrupt-*' -ErrorAction SilentlyContinue | Select-Object -First 1
    $corruptContentOk = $corruptFile -and ((Get-Content $corruptFile.FullName -Raw -Encoding UTF8) -eq '{ broken json')
    if ($corruptUi.visible -and $corruptUi.ready -and $kept -and $corruptContentOk -and -not $recreated -and $inboxKept) {
      $passed += 1
      $extraCases += 1
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
  $stillRunning = $false
  try {
    Stop-App
  } catch {
    $stillRunning = $true
    $failed += 1
    "FAIL  停止进程失败：$($_.Exception.Message)"
  }
  # 进程仍存活时绝不恢复：运行中的实例会用内存里的测试数据覆盖回去，
  # 而 Restore-UserDataBackup 会删掉唯一备份。保留一份 .keep 副本并让人工处理。
  if ($stillRunning) {
    if ($backupCreated) {
      Copy-Item -LiteralPath $backup -Destination "$backup.keep" -Force
      "      备份已另存为 $backup.keep；请先结束 desktop-todo 进程，再把备份改回 data.json"
    }
  } elseif ($backupCreated) {
    try {
      $null = Restore-UserDataBackup $data $backup
    } catch {
      $failed += 1
      "FAIL  恢复用户数据失败：$($_.Exception.Message)"
      "      备份保留在 $backup，请人工确认后再运行回归"
    }
    if (Test-Path -LiteralPath $backupBak) {
      Copy-Item -LiteralPath $backupBak -Destination "$data.bak" -Force
      Remove-Item -LiteralPath $backupBak -Force
    } else {
      Remove-Item -LiteralPath "$data.bak" -Force -ErrorAction SilentlyContinue
    }
  } elseif ($dataExisted -eq $false -and (Test-Path -LiteralPath $data)) {
    # 首次安装本来没有 data.json：测试新建的那份含测试设置，不能留给用户。
    Remove-Item -LiteralPath $data -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath "$data.bak" -Force -ErrorAction SilentlyContinue
  }
  # 测试构建写的是独立 Test 键，清理它即可；真实 Run 键从未被改动。
  Remove-Item -LiteralPath $testRunKey -Recurse -Force -ErrorAction SilentlyContinue
  # 清掉测试期间新建的收件箱，再把用户原收件箱放回。
  # 只有「确实搬走成功」才允许删除/恢复；搬走失败时用户目录原样保留。
  if ($inboxExisted) {
    if ($inboxHold) {
      try {
        Remove-Item -LiteralPath $inboxReal -Recurse -Force -ErrorAction SilentlyContinue
        New-Item -ItemType Directory -Force -Path (Split-Path $inboxReal -Parent) | Out-Null
        Move-Item -LiteralPath $inboxHold -Destination $inboxReal -Force -ErrorAction Stop
      } catch {
        $failed += 1
        "FAIL  收件箱恢复失败：用户原收件箱暂存在 $inboxHold，请手工移回 $inboxReal"
      }
    }
  } else {
    Remove-Item -LiteralPath $inboxReal -Recurse -Force -ErrorAction SilentlyContinue
  }
  if ($legacyExisted) {
    if ($legacyHold) {
      try {
        Remove-Item -LiteralPath $inboxLegacy -Recurse -Force -ErrorAction SilentlyContinue
        New-Item -ItemType Directory -Force -Path (Split-Path $inboxLegacy -Parent) | Out-Null
        Move-Item -LiteralPath $legacyHold -Destination $inboxLegacy -Force -ErrorAction Stop
      } catch {
        $failed += 1
        "FAIL  旧收件箱恢复失败：暂存在 $legacyHold，请手工移回 $inboxLegacy"
      }
    }
  } else {
    Remove-Item -LiteralPath $inboxLegacy -Recurse -Force -ErrorAction SilentlyContinue
  }
  # 只有测试前本来就在运行、且进程已停干净时才重启发布版。
  if ($appWasRunning -and -not $stillRunning) {
    $restart = if ($originalAppPath -and (Test-Path -LiteralPath $originalAppPath)) {
      $originalAppPath
    } elseif (Test-Path $prodExe) {
      $prodExe
    } else {
      $null
    }
    if ($restart) {
      Start-Process $restart
    } else {
      "WARN  测试前的实例路径不可用，未自动重启，请手动启动"
    }
  }
  try { $regressionMutex.ReleaseMutex() } catch { }
  $regressionMutex.Dispose()
}

if (-not $SkipUnits -and $extraCases -lt 2) {
  $failed += 1
  "FAIL  regression.ps1 内置用例只有 $extraCases 条，expected 2"
}
if ($skipped -gt 0) {
  "WARN  $skipped case(s) skipped（网络 / 显示器不满足），不计入失败，但本次全绿不代表这些用例已执行"
}
"REGRESSION pass=$passed fail=$failed skip=$skipped"
if ($failed -gt 0) { exit 1 }

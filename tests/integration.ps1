param([int]$Port = 9222)
$ErrorActionPreference = 'Stop'

# 与 regression.ps1 共用命名互斥量，避免同时抢 CDP 端口和同一 data 目录。
$regressionMutex = New-Object System.Threading.Mutex($false, 'Global\TodoRegression')
$owned = $false
try { $owned = $regressionMutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $owned = $true }
if (-not $owned) { throw '另一个回归进程正在运行（integration.ps1 / regression.ps1），请等待其结束。' }

$root = Split-Path $PSScriptRoot -Parent
$cdp = Join-Path $root '_dev_cdp.ps1'
$data = Join-Path $env:LOCALAPPDATA 'desktoptodo\data.json'
$backup = "$data.itest"
. (Join-Path $PSScriptRoot 'regress-lib.ps1')

function Stop-App {
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
  $left = Get-CimInstance Win32_Process -Filter "Name='desktop-todo.exe'" -ErrorAction SilentlyContinue
  foreach ($proc in $left) {
    Invoke-CimMethod -InputObject $proc -MethodName Terminate -ErrorAction SilentlyContinue | Out-Null
  }
  Start-Sleep -Milliseconds 400
  if (Get-Process -Name desktop-todo -ErrorAction SilentlyContinue) {
    throw 'desktop-todo 未能停止（可能由管理员启动或被安全软件拦截），已中止以免覆盖用户数据'
  }
}

$exe = $null
$backupCreated = $false
$restoreFailed = $false
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
try {
  # 守卫、构建、备份都放在 try 内：任何一步抛错，finally 仍会重启发布版。
  $appWasRunning = [bool](Get-Process -Name desktop-todo -ErrorAction SilentlyContinue)
  if ($appWasRunning) {
    $originalAppPath = (Get-Process -Name desktop-todo -ErrorAction SilentlyContinue | Select-Object -First 1).Path
  }
  Stop-App
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

  # 测试用 exe 由编译期注入调试端口生成，产物在 src-tauri\target-test\，
  # 不会污染发布版（见 build-test-exe.ps1 说明）。
  $exe = & (Join-Path $PSScriptRoot 'build-test-exe.ps1') -Port $Port
  if (-not $exe -or -not (Test-Path $exe)) { throw "test exe not available: $exe" }

  Stop-App
  # 预置一条 AI 待办，供 REG-34 验证 CLI -> ai-inbox -> UI 链路
  Start-Process -FilePath $exe -ArgumentList '--add','ITEST-AI-INSERT','--provider','dsh' -Wait
  Start-Sleep -Milliseconds 500
  # 启动测试 exe 后等待 CDP 端口就绪（比固定 sleep 更稳）
  Start-Process $exe
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

  $expr = Get-Content (Join-Path $PSScriptRoot 'integration-page.js') -Raw -Encoding UTF8
  $tempPath = $env:TEMP
  if (-not $tempPath) { $tempPath = [System.IO.Path]::GetTempPath() }
  $exprFile = Join-Path $tempPath ('todo-itest-' + [guid]::NewGuid().ToString('N') + '.js')
  [System.IO.File]::WriteAllText($exprFile, $expr, (New-Object System.Text.UTF8Encoding($false)))
  try {
    $raw = & powershell -NoProfile -ExecutionPolicy Bypass -File $cdp -Port $Port -ExprFile $exprFile
  } finally {
    Remove-Item $exprFile -Force -ErrorAction SilentlyContinue
  }
  $obj = ($raw | Select-Object -Last 1) | ConvertFrom-Json
  $value = $obj.result.result.value
  if (-not $value) {
    $obj | ConvertTo-Json -Depth 8
    throw 'integration script did not return results'
  }
  $result = $value | ConvertFrom-Json
  foreach ($case in $result.results) {
    if ($case.skipped) {
      "SKIP  $($case.name)" + $(if ($case.detail) { "  [$($case.detail)]" } else { '' })
    } elseif ($case.ok) {
      "PASS  $($case.name)" + $(if ($case.detail) { "  [$($case.detail)]" } else { '' })
    } else {
      "FAIL  $($case.name): $($case.error)"
    }
  }
  "INTEGRATION pass=$($result.passed) fail=$($result.failed) skip=$($result.skipped)"
  $failed = [int]$result.failed
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
  if ([int]$result.skipped -gt 0) {
    "WARN  $($result.skipped) case(s) skipped（网络 / 显示器不满足），本次全绿不代表这些用例已执行"
  }
  if ($failed -gt 0) { exit 1 }
} finally {
  $stillRunning = $false
  try {
    Stop-App
  } catch {
    $stillRunning = $true
    $failed += 1
    Write-Warning "停止进程失败：$($_.Exception.Message)"
  }
  # 进程仍存活时不恢复，保留独立副本供人工处理。
  if ($stillRunning) {
    if ($backupCreated) {
      Copy-Item -LiteralPath $backup -Destination "$backup.keep" -Force
      Write-Warning "数据未恢复；备份已另存为 $backup.keep，请先结束 desktop-todo 进程"
    }
  } elseif ($backupCreated) {
    try {
      $null = Restore-UserDataBackup $data $backup
    } catch {
      $restoreFailed = $true
      Write-Warning "恢复用户数据失败：$($_.Exception.Message)；备份保留在 $backup"
    }
    if (Test-Path -LiteralPath $backupBak) {
      Copy-Item -LiteralPath $backupBak -Destination "$data.bak" -Force
      Remove-Item -LiteralPath $backupBak -Force
    } else {
      Remove-Item -LiteralPath "$data.bak" -Force -ErrorAction SilentlyContinue
    }
  } elseif ($dataExisted -eq $false -and (Test-Path -LiteralPath $data)) {
    # 首次安装本来没有 data.json：测试新建的那份不能留给用户。
    Remove-Item -LiteralPath $data -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath "$data.bak" -Force -ErrorAction SilentlyContinue
  }
  # 测试构建写独立 Test 键，清理它即可；真实 Run 键从未被改动。
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
        $restoreFailed = $true
        Write-Warning "收件箱恢复失败：原收件箱暂存在 $inboxHold，请手工移回 $inboxReal"
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
        $restoreFailed = $true
        Write-Warning "旧收件箱恢复失败：暂存在 $legacyHold，请手工移回 $inboxLegacy"
      }
    }
  } else {
    Remove-Item -LiteralPath $inboxLegacy -Recurse -Force -ErrorAction SilentlyContinue
  }
  # 只有测试前本来就在运行、且进程已停干净时才重启发布版
  $prodExe = Join-Path $root 'src-tauri\target\release\desktop-todo.exe'
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
      Write-Warning "测试前的实例路径不可用，未自动重启，请手动启动"
    }
  }
  try { $regressionMutex.ReleaseMutex() } catch { }
  $regressionMutex.Dispose()
  if ($restoreFailed) { throw "恢复用户数据失败，备份保留在 $backup" }
  if ($stillRunning) { throw "desktop-todo 进程未停止，数据未恢复；备份见 $backup.keep" }
}

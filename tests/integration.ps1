param([int]$Port = 9222)
$ErrorActionPreference = 'Stop'

# 与 regression.ps1 共用命名互斥量，避免同时抢 CDP 端口和同一 data 目录。
$regressionMutex = New-Object System.Threading.Mutex($false, 'Local\TodoRegression')
$owned = $false
try { $owned = $regressionMutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $owned = $true }
if (-not $owned) { throw '另一个回归进程正在运行（integration.ps1 / regression.ps1），请等待其结束。' }

$root = Split-Path $PSScriptRoot -Parent
$cdp = Join-Path $root '_dev_cdp.ps1'
$data = Join-Path $env:APPDATA 'com.desktoptodo.widget\data.json'
$backup = "$data.itest"
. (Join-Path $PSScriptRoot 'regress-lib.ps1')

function Stop-App {
  $procs = Get-Process -Name desktop-todo -ErrorAction SilentlyContinue
  if ($procs) { $procs | Stop-Process -Force -ErrorAction SilentlyContinue }
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
$registryRestoreFailed = $false
$dataExisted = $null
$autostartExisted = $false
$autostartValue = $null
$autostartSnapshotTaken = $false
$appWasRunning = $false
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
try {
  # 守卫、构建、备份都放在 try 内：任何一步抛错，finally 仍会重启发布版。
  $appWasRunning = [bool](Get-Process -Name desktop-todo -ErrorAction SilentlyContinue)
  Stop-App
  try {
    $autostartProp = Get-ItemProperty -Path $runKey -Name 'DesktopTodo' -ErrorAction Stop
    $autostartExisted = $true
    $autostartValue = $autostartProp.DesktopTodo
    $autostartSnapshotTaken = $true
  } catch {
    if ($_.CategoryInfo.Category -in @('ObjectNotFound', 'InvalidArgument')) {
      $autostartExisted = $false
      $autostartSnapshotTaken = $true
    } else {
      throw "无法读取自启注册表，为避免留下测试自启项已中止：$($_.Exception.Message)"
    }
  }
  $dataExisted = Test-Path -LiteralPath $data
  $backupCreated = New-UserDataBackup $data $backup

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
  for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Milliseconds 500
    try { Invoke-RestMethod "http://127.0.0.1:$Port/json" | Out-Null; $ready = $true; break } catch { }
  }
  if (-not $ready) { throw "CDP port $Port not ready after 15s - test exe may not have debug port" }
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
  } elseif ($dataExisted -eq $false -and (Test-Path -LiteralPath $data)) {
    # 首次安装本来没有 data.json：测试新建的那份不能留给用户。
    Remove-Item -LiteralPath $data -Force -ErrorAction SilentlyContinue
  }
  # REG-23 会写入测试 exe 的路径；只有确实快照过才回填。
  if ($autostartSnapshotTaken) {
    try {
      if ($autostartExisted) {
        Set-ItemProperty -Path $runKey -Name 'DesktopTodo' -Value $autostartValue
      } else {
        Remove-ItemProperty -Path $runKey -Name 'DesktopTodo' -ErrorAction SilentlyContinue
      }
    } catch {
      $registryRestoreFailed = $true
      Write-Warning "恢复开机启动注册表失败：$($_.Exception.Message)"
    }
  }
  $inboxRoots = @(
    (Join-Path $env:USERPROFILE '.desktoptodo\ai-inbox'),
    (Join-Path $env:APPDATA 'com.desktoptodo.widget\ai-inbox')
  )
  foreach ($inbox in $inboxRoots) {
    if (-not (Test-Path $inbox)) { continue }
    Get-ChildItem $inbox -Filter '*.json' | ForEach-Object {
      try {
        if ((Get-Content $_.FullName -Raw -Encoding UTF8 | ConvertFrom-Json).text -match '^ITEST-(AI-INSERT|CORRUPT-PROBE)$') {
          Remove-Item $_.FullName -Force
        }
      } catch { }
    }
  }
  # 只有测试前本来就在运行、且进程已停干净时才重启发布版
  $prodExe = Join-Path $root 'src-tauri\target\release\desktop-todo.exe'
  if ($appWasRunning -and -not $stillRunning -and (Test-Path $prodExe)) { Start-Process $prodExe }
  try { $regressionMutex.ReleaseMutex() } catch { }
  $regressionMutex.Dispose()
  if ($restoreFailed) { throw "恢复用户数据失败，备份保留在 $backup" }
  if ($stillRunning) { throw "desktop-todo 进程未停止，数据未恢复；备份见 $backup.keep" }
  if ($registryRestoreFailed) { throw "恢复开机启动注册表失败，请检查 HKCU Run\DesktopTodo" }
}

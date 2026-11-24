param([int]$Port = 9222)
$ErrorActionPreference = 'Stop'
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
}

$exe = $null
$backupCreated = $false
$restoreFailed = $false
try {
  # 守卫、构建、备份都放在 try 内：任何一步抛错，finally 仍会重启发布版。
  Stop-App
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
  if (@($result.results).Count -lt 44) {
    $failed += 1
    "FAIL  INTEGRATION only $((@($result.results)).Count) cases, expected at least 44"
  }
  if ($failed -gt 0) { exit 1 }
} finally {
  Stop-App
  # 只恢复本次实际创建的备份；备份守卫失败时绝不碰用户数据。
  if ($backupCreated) {
    try {
      $null = Restore-UserDataBackup $data $backup
    } catch {
      $restoreFailed = $true
      Write-Warning "恢复用户数据失败：$($_.Exception.Message)；备份保留在 $backup"
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
  # 恢复常驻程序（用发布版 exe，不是测试版）
  $prodExe = Join-Path $root 'src-tauri\target\release\desktop-todo.exe'
  if (Test-Path $prodExe) { Start-Process $prodExe }
  if ($restoreFailed) { throw "恢复用户数据失败，备份保留在 $backup" }
}

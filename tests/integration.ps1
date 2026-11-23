param([int]$Port = 9222)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$cdp = Join-Path $root '_dev_cdp.ps1'
$data = Join-Path $env:APPDATA 'com.desktoptodo.widget\data.json'
$backup = "$data.itest"

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

# 构建测试 exe 前先停掉正在运行的程序，否则 exe 被占用无法链接。
Stop-App

# 测试用 exe 由编译期注入调试端口生成，产物在 src-tauri\target-test\，
# 不会污染发布版（见 build-test-exe.ps1 说明）。
$exe = & (Join-Path $PSScriptRoot 'build-test-exe.ps1') -Port $Port
if (-not $exe -or -not (Test-Path $exe)) { throw "test exe not available: $exe" }

Copy-Item $data $backup -Force
try {
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
    if ($case.ok) {
      "PASS  $($case.name)" + $(if ($case.detail) { "  [$($case.detail)]" } else { '' })
    } else {
      "FAIL  $($case.name): $($case.error)"
    }
  }
  "INTEGRATION pass=$($result.passed) fail=$($result.failed)"
  $failed = [int]$result.failed
  if ($failed -gt 0) { exit 1 }
} finally {
  Stop-App
  if (Test-Path $backup) {
    Copy-Item $backup $data -Force
    Remove-Item $backup -Force
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
}

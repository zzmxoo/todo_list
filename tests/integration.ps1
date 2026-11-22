param([int]$Port = 9222)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$cdp = Join-Path $root '_dev_cdp.ps1'
$data = Join-Path $env:APPDATA 'com.desktoptodo.widget\data.json'
$backup = "$data.itest"

# 测试用 exe 由编译期注入调试端口生成，产物在 src-tauri\target-test\，
# 不会污染发布版（见 build-test-exe.ps1 说明）。
$exe = & (Join-Path $PSScriptRoot 'build-test-exe.ps1') -Port $Port
if (-not $exe -or -not (Test-Path $exe)) { throw "test exe not available: $exe" }

Copy-Item $data $backup -Force
try {
  Get-Process -Name desktop-todo -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep -Milliseconds 600
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
  Get-Process -Name desktop-todo -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep -Milliseconds 600
  if (Test-Path $backup) {
    Copy-Item $backup $data -Force
    Remove-Item $backup -Force
  }
  # 恢复常驻程序（用发布版 exe，不是测试版）
  $prodExe = Join-Path $root 'src-tauri\target\release\desktop-todo.exe'
  if (Test-Path $prodExe) { Start-Process $prodExe }
}

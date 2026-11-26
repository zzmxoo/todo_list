param([int]$Port = 9222)
$ErrorActionPreference = 'Stop'

# 与 regression.ps1 / integration.ps1 共用互斥量，避免同抢 CDP 端口。
$regressionMutex = New-Object System.Threading.Mutex($false, 'Local\TodoRegression')
$owned = $false
try { $owned = $regressionMutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $owned = $true }
if (-not $owned) { throw '另一个回归进程正在运行（run.ps1 / integration.ps1 / regression.ps1）' }

$cdp = Join-Path (Split-Path $PSScriptRoot -Parent) '_dev_cdp.ps1'
. (Join-Path $PSScriptRoot 'regress-lib.ps1')

# 端口可能被别的 Chromium 调试页占用；必须确认是我们的 ?test=1 页面。
$targets = Invoke-RestMethod "http://127.0.0.1:$Port/json"
if (-not ($targets | Where-Object { $_.url -match 'index\.html\?test=1' })) {
  throw "端口 $Port 被其它进程占用（未找到本应用的 ?test=1 页面）"
}

function Eval-Expr([string]$expr) {
  # Windows 命令行上限约 32KB，统一走临时文件。
  $tempPath = $env:TEMP
  if (-not $tempPath) { $tempPath = [System.IO.Path]::GetTempPath() }
  $tmp = Join-Path $tempPath ('todo-run-' + [guid]::NewGuid().ToString('N') + '.js')
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

$failed = 0
$unitPassed = 0
$unitFiles = @(Get-ChildItem -LiteralPath $PSScriptRoot -Filter 'unit-*.js' | Sort-Object Name)
foreach ($file in $unitFiles) {
  $expr = Get-Content $file.FullName -Raw -Encoding UTF8
  $result = Eval-Expr $expr | ConvertFrom-Json
  foreach ($case in $result.results) {
    if ($case.skipped) { "SKIP  $($case.name)" }
    elseif ($case.ok) { "PASS  $($case.name)" }
    else { "FAIL  $($case.name): $($case.error)" }
  }
  "UNIT[$($file.Name)] pass=$($result.passed) fail=$($result.failed)"
  $unitPassed += [int]$result.passed
  $failed += [int]$result.failed
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
$quotes = Eval-Expr $quotesExpr | ConvertFrom-Json
"QUOTES total=$($quotes.total) unique=$($quotes.unique) dup=$($quotes.dup) badLen=$($quotes.badLen) badAuthor=$($quotes.badAuthor)"
$exitCode = 0
if ($unitPassed -lt $MIN_UNIT_CASES) {
  "FAIL  单元测试只有 $unitPassed 条，expected at least $MIN_UNIT_CASES"
  $exitCode = 1
}
if ($failed -gt 0 -or $quotes.total -ne $QUOTE_COUNT -or $quotes.dup -ne 0 -or $quotes.badLen -ne 0 -or $quotes.badAuthor -ne 0) {
  $exitCode = 1
}
try { $regressionMutex.ReleaseMutex() } catch { }
$regressionMutex.Dispose()
if ($exitCode -ne 0) { exit 1 }

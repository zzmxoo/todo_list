param([int]$Port = 9222)
$ErrorActionPreference = 'Stop'
$cdp = Join-Path (Split-Path $PSScriptRoot -Parent) '_dev_cdp.ps1'

function Eval-Expr([string]$expr) {
  $raw = & powershell -NoProfile -ExecutionPolicy Bypass -File $cdp -Port $Port -Expr $expr
  $obj = ($raw | Select-Object -Last 1) | ConvertFrom-Json
  if ($obj.result.result.value) { return $obj.result.result.value }
  throw (($obj.result.result.description) + ' ' + $obj.result.result.className)
}

$failed = 0
foreach ($file in @('unit-core.js', 'unit-weather.js')) {
  $expr = Get-Content (Join-Path $PSScriptRoot $file) -Raw -Encoding UTF8
  $result = Eval-Expr $expr | ConvertFrom-Json
  foreach ($case in $result.results) {
    if ($case.ok) { "PASS  $($case.name)" } else { "FAIL  $($case.name): $($case.error)" }
  }
  "UNIT[$file] pass=$($result.passed) fail=$($result.failed)"
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
if ($failed -gt 0 -or $quotes.total -ne 1460 -or $quotes.dup -ne 0 -or $quotes.badLen -ne 0 -or $quotes.badAuthor -ne 0) {
  exit 1
}

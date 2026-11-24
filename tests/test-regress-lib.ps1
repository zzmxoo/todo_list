# regress-lib.ps1 的自测：验证备份守卫不会拿测试数据覆盖用户数据。
# 由 regression.ps1 在接触用户数据之前调用，也可单独运行。
param()

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'regress-lib.ps1')

$passed = 0
$failed = 0

function Check([string]$name, [scriptblock]$body) {
  try {
    & $body
    $script:passed += 1
    "PASS  $name"
  } catch {
    $script:failed += 1
    "FAIL  ${name}: $($_.Exception.Message)"
  }
}

$work = Join-Path ([System.IO.Path]::GetTempPath()) ('todo-regress-lib-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work | Out-Null
$data = Join-Path $work 'data.json'
$backup = "$data.regress"
$otherBackup = "$data.itest"

function Clear-TestFiles {
  Remove-Item -LiteralPath $data, $backup, $otherBackup -Force -ErrorAction SilentlyContinue
}

try {
  Check '正常备份与恢复' {
    Clear-TestFiles
    Set-Content -LiteralPath $data -Value '{"todos":[{"text":"keep"}]}' -Encoding UTF8
    if (-not (New-UserDataBackup $data $backup)) { throw '应当创建备份' }
    if (-not (Test-Path -LiteralPath $backup)) { throw '备份文件缺失' }
    Set-Content -LiteralPath $data -Value '{"todos":[]}' -Encoding UTF8
    if (-not (Restore-UserDataBackup $data $backup)) { throw '应当执行恢复' }
    $restored = Get-Content -LiteralPath $data -Raw -Encoding UTF8
    if ($restored -notmatch 'keep') { throw '恢复内容不正确' }
    if (Test-Path -LiteralPath $backup) { throw '恢复后应删除备份' }
  }

  Check '残留备份时中止' {
    Clear-TestFiles
    Set-Content -LiteralPath $data -Value '{"todos":[]}' -Encoding UTF8
    Set-Content -LiteralPath $backup -Value '{"todos":[{"text":"old"}]}' -Encoding UTF8
    $threw = $false
    try { $null = New-UserDataBackup $data $backup } catch { $threw = $true }
    if (-not $threw) { throw '残留备份存在时必须中止，不能覆盖' }
    $still = Get-Content -LiteralPath $backup -Raw -Encoding UTF8
    if ($still -notmatch 'old') { throw '残留备份被改写了' }
  }

  Check '另一套回归的残留备份也阻止备份' {
    Clear-TestFiles
    Set-Content -LiteralPath $data -Value '{"todos":[{"text":"dirty"}]}' -Encoding UTF8
    Set-Content -LiteralPath $otherBackup -Value '{"todos":[{"text":"real"}]}' -Encoding UTF8
    $threw = $false
    try { $null = New-UserDataBackup $data $backup } catch { $threw = $true }
    if (-not $threw) { throw '存在 .itest 残留时必须中止，不能把脏数据再备份' }
    if (Test-Path -LiteralPath $backup) { throw '不应创建 .regress 备份' }
    $other = Get-Content -LiteralPath $otherBackup -Raw -Encoding UTF8
    if ($other -notmatch 'real') { throw '另一套备份被改写了' }
  }

  Check '损坏的 data.json 不备份' {
    Clear-TestFiles
    Set-Content -LiteralPath $data -Value '{broken' -Encoding UTF8
    $threw = $false
    try { $null = New-UserDataBackup $data $backup } catch { $threw = $true }
    if (-not $threw) { throw '损坏的 data.json 必须拒绝备份' }
    if (Test-Path -LiteralPath $backup) { throw '不能从损坏文件创建备份' }
  }

  Check '空 data.json 不备份' {
    Clear-TestFiles
    Set-Content -LiteralPath $data -Value '' -Encoding UTF8
    $threw = $false
    try { $null = New-UserDataBackup $data $backup } catch { $threw = $true }
    if (-not $threw) { throw '空 data.json 必须拒绝备份' }
    if (Test-Path -LiteralPath $backup) { throw '不能从空文件创建备份' }
  }

  Check '缺失的 data.json 不阻止运行' {
    Clear-TestFiles
    if (New-UserDataBackup $data $backup) { throw '没有用户数据时不应创建备份' }
    if (Test-Path -LiteralPath $backup) { throw '不应留下备份文件' }
    if (Restore-UserDataBackup $data $backup) { throw '没有备份时不应恢复' }
  }
} finally {
  Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}

"REGRESS-LIB pass=$passed fail=$failed"
if ($failed -gt 0) { exit 1 }

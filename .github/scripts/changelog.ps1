[CmdletBinding()]
param(
  [string]$Tag = $env:GITHUB_REF_NAME,
  [string]$RepoRoot = '.',
  [string]$OutputFile = $env:GITHUB_OUTPUT
)

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $RepoRoot

function Fail([string]$message) {
  Write-Output "::error::$message"
  exit 1
}

# --- 版本来源 ---------------------------------------------------------------
if (-not $Tag) { Fail 'Tag 为空，无法生成变更说明' }
if ($Tag -notmatch '^v?(\d+\.\d+\.\d+)$') { Fail "Tag '$Tag' 不符合版本号格式 v?X.Y.Z" }
$version = $Matches[1]

$cargoToml = Get-Content -LiteralPath 'src-tauri/Cargo.toml' -Raw -Encoding UTF8
if ($cargoToml -notmatch '(?ms)^\s*\[package\]\s*$(.*?)(?=^\[|\z)') {
  Fail 'Cargo.toml 中找不到 [package] 段'
}
$packageSection = $Matches[1]
if ($packageSection -notmatch '(?m)^\s*version\s*=\s*"([^"]+)"') {
  Fail 'Cargo.toml 的 [package] 段中找不到 version'
}
$cargoVersion = $Matches[1]

$conf = Get-Content -LiteralPath 'src-tauri/tauri.conf.json' -Raw -Encoding UTF8 | ConvertFrom-Json
$confVersion = $conf.version

if ($cargoVersion -ne $version -or $confVersion -ne $version) {
  Fail "版本不一致：tag=$version Cargo.toml=$cargoVersion tauri.conf.json=$confVersion"
}

# --- 上一个版本 tag ---------------------------------------------------------
function ConvertTo-VersionKey([string]$name) {
  [version]($name -replace '^v', '')
}

$previous = $null
$candidates = @(@(git tag --merged "$Tag^" 2>$null) |
  Where-Object { $_ -match '^v?\d+\.\d+\.\d+$' } |
  Sort-Object { ConvertTo-VersionKey $_ })
if ($candidates.Count -gt 0) { $previous = $candidates[-1] }

$isFirst = $false
if ($previous) {
  $range = "$previous..$Tag"
  $subjects = @(git log --no-merges --format=%s $range)
} else {
  $isFirst = $true
  $subjects = @(git log --no-merges --format=%s -n 20 $Tag)
}

# --- 过滤与归类 -------------------------------------------------------------
$subjects = @($subjects |
  Where-Object { $_ } |
  ForEach-Object {
    # 版本号提交常与真实改动合并在一起，只剥掉版本号前缀保留其余描述
    ($_ -replace '^\s*版本号更新(?:为)?\s*[0-9][0-9A-Za-z.\-]*\s*[，,、]?\s*', '').Trim()
  } |
  Where-Object { $_ })

$groups = [ordered]@{ '新增' = @(); '修复' = @(); '优化' = @(); '其它变更' = @() }

$keywords = [ordered]@{
  '修复' = @('修复', '修正', '解决', '问题')
  '新增' = @('新增', '添加', '支持', '增加')
  '优化' = @('优化', '改进', '提升', '降低', '加快', '改为', '调整', '提速')
}

foreach ($subject in $subjects) {
  $bestGroup = $null
  $bestIndex = [int]::MaxValue
  foreach ($group in $keywords.Keys) {
    foreach ($word in $keywords[$group]) {
      $index = $subject.IndexOf($word, [StringComparison]::Ordinal)
      if ($index -ge 0 -and $index -lt $bestIndex) {
        $bestIndex = $index
        $bestGroup = $group
      }
    }
  }
  if (-not $bestGroup) { $bestGroup = '其它变更' }
  $groups[$bestGroup] += $subject
}

function Format-Item([string]$text) {
  if ($text.Length -gt 40) { $text = $text.Substring(0, 40) + '…' }
  "- $text"
}

# --- 拼装正文 ---------------------------------------------------------------
$lines = New-Object System.Collections.Generic.List[string]
$lines.Add("## 桌面待办 $version")
$lines.Add('')
if ($isFirst) {
  $lines.Add('> 首个发布版本')
  $lines.Add('')
}
$lines.Add('**下载**')
$lines.Add('- `desktop-todo_' + $version + '-setup.exe` —— 安装版（推荐）')
$lines.Add('- `desktop-todo_' + $version + '.exe` —— 免安装，直接双击运行')
$lines.Add('')
$lines.Add('用户数据位于 `%APPDATA%\com.desktoptodo.widget\data.json`，升级不会丢失。')

$limits = @{ '新增' = 5; '修复' = 5; '优化' = 5; '其它变更' = 3 }
$hasAny = $false
foreach ($group in $groups.Keys) {
  $items = $groups[$group]
  if ($items.Count -eq 0) { continue }
  $hasAny = $true
  $lines.Add('')
  $lines.Add("### $group")
  foreach ($item in ($items | Select-Object -First $limits[$group])) {
    $lines.Add((Format-Item $item))
  }
}

if (-not $hasAny) {
  $lines.Add('')
  $lines.Add('本次更新包含若干内部调整与稳定性改进。')
}

$body = ($lines -join "`n") + "`n"

if ($OutputFile) {
  $delimiter = "EOF_CHANGELOG"
  Add-Content -LiteralPath $OutputFile -Encoding UTF8 -Value "body<<$delimiter"
  Add-Content -LiteralPath $OutputFile -Encoding UTF8 -Value $body.TrimEnd()
  Add-Content -LiteralPath $OutputFile -Encoding UTF8 -Value $delimiter
} else {
  Write-Output $body
}

# 用户数据备份/恢复的安全守卫，供 regression.ps1 与 integration.ps1 共用。
#
# 规则：
# 1. 备份文件必须唯一；发现残留备份说明上一次运行没有正常结束，
#    此时必须人工确认，不能直接用测试数据覆盖用户数据。
# 2. 备份前校验 data.json 非空且可解析。Stop-Process -Force 可能把正在写的
#    文件截断，把半截 JSON 备份下来等于毁掉唯一的恢复副本。
# 3. 恢复时同样校验备份本身，坏备份宁可保留现场也不覆盖 data.json。

# 用例数量下限集中定义，避免脚本与文档各写一份。
$MIN_REGRESS_LIB_CASES = 6
$MIN_INTEGRATION_CASES = 49
$MIN_UNIT_CASES = 49
$MIN_RUST_CASES = 50

function Assert-DataFileReadable([string]$path) {
  if (-not (Test-Path -LiteralPath $path)) { return $false }
  $raw = Get-Content -LiteralPath $path -Raw -Encoding UTF8
  if (-not $raw -or -not $raw.Trim()) {
    throw "数据文件为空，可能是上次写入被强制中断：$path"
  }
  try {
    $null = $raw | ConvertFrom-Json
  } catch {
    throw "数据文件不是合法 JSON，拒绝使用：$path（$($_.Exception.Message)）"
  }
  return $true
}

function New-UserDataBackup([string]$data, [string]$backup) {
  if (Test-Path -LiteralPath $backup) {
    throw "发现残留备份 $backup。上一次回归可能被强制中断，请先人工确认 data.json 与备份内容，处理掉备份后再运行。"
  }
  # 另一套脚本（integration）的残留备份同样说明数据可能已被写脏，
  # 不能把它当成用户数据再备份一次，否则真实副本会被「洗白」。
  $dir = Split-Path -Parent $data
  $leaf = Split-Path -Leaf $data
  $leftovers = @(Get-ChildItem -LiteralPath $dir -Filter "$leaf.*" -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -ne $backup -and $_.Name -match '\.(regress|itest)$' })
  if ($leftovers.Count -gt 0) {
    throw "发现另一套回归的残留备份 $($leftovers[0].FullName)。请先人工确认 data.json 与备份内容，处理掉备份后再运行。"
  }
  if (-not (Assert-DataFileReadable $data)) { return $false }
  Copy-Item -LiteralPath $data -Destination $backup -Force
  return $true
}

function Restore-UserDataBackup([string]$data, [string]$backup) {
  if (-not (Test-Path -LiteralPath $backup)) { return $false }
  $null = Assert-DataFileReadable $backup
  Copy-Item -LiteralPath $backup -Destination $data -Force
  Remove-Item -LiteralPath $backup -Force
  return $true
}

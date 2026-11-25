# 生成用于 Microsoft Store 上架的 MSIX 包。
#
# Tauri v2 的 bundle 目标只有 msi/nsis，没有 msix（见 tauri-utils 的 BundleType 枚举），
# 所以这里用 Windows SDK 的 makeappx + signtool 手工打包。
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File tests\build-msix.ps1
#   $env:MSIX_CERT_PASSWORD = '...'
#   powershell -ExecutionPolicy Bypass -File tests\build-msix.ps1 -Pfxn <证书.pfx>
#
# 口令优先读环境变量 MSIX_CERT_PASSWORD，避免出现在命令行参数里（同机可被 WMI 读到）。
# 不传证书也能打出未签名包（供 Partner Center 或本地 sideload 测试用）。
param(
  [string]$Exe,
  [string]$Pfxn,
  [string]$Password = $env:MSIX_CERT_PASSWORD,
  [string]$Publisher = 'CN=DesktopTodo',
  [string]$PublisherDisplayName = 'DesktopTodo',
  [string]$IdentityName = '',
  [string]$OutDir
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$crateDir = Join-Path $root 'src-tauri'

if (-not $Exe) { $Exe = Join-Path $crateDir 'target\release\desktop-todo.exe' }
if (-not (Test-Path $Exe)) { throw "exe not found: $Exe (先跑 cargo build --release)" }
if (-not $OutDir) { $OutDir = Join-Path $crateDir 'target\msix' }

# SDK 工具路径
$sdkBin = Get-ChildItem 'C:\Program Files (x86)\Windows Kits\10\bin' -Directory |
  Where-Object { $_.Name -match '^10\.' } |
  Sort-Object { [version]($_.Name -replace '\.0$','') } -Descending |
  ForEach-Object { Join-Path $_.FullName 'x64' } |
  Where-Object { Test-Path (Join-Path $_ 'makeappx.exe') } |
  Select-Object -First 1
if (-not $sdkBin) { throw 'makeappx.exe not found - 需要安装 Windows SDK' }
$makeappx = Join-Path $sdkBin 'makeappx.exe'
$signtool = Join-Path $sdkBin 'signtool.exe'

# 从 tauri.conf.json 读取产品信息，避免两处维护
$conf = Get-Content (Join-Path $crateDir 'tauri.conf.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$version = $conf.version
$displayName = $conf.productName
if (-not $IdentityName) { $IdentityName = $conf.identifier }
if (-not $PublisherDisplayName) { $PublisherDisplayName = $conf.productName }

# MSIX Version 必须是四段 (Major.Minor.Build.Revision)。商店规则：
#   - 第四段（revision）保留给商店使用，构建时必须为 0
#   - 其余段为 0–65535，但第一段不能为 0
# semver 的 0.0.7 不满足"第一段不能为 0"，因此映射为 1.<minor>.<patch>.0。
$parts = $version.Split('.')
if ($parts.Count -ne 3 -or $parts[0] -notmatch '^\d+$') {
  throw "不支持的版本号格式：$version（只接受 x.y.z，四段版本会丢 revision）"
}
foreach ($seg in $parts) {
  if ($seg -notmatch '^\d+$' -or [int]$seg -gt 65535) {
    throw "版本号每段必须是 0-65535 的整数：$version"
  }
}
$major = [int]$parts[0]
if ($major -eq 0) { $major = 1 }  # 商店要求第一段不能为 0
$msixVersion = '{0}.{1}.{2}.0' -f $major, [int]$parts[1], [int]$parts[2]
Write-Host "package version: $msixVersion (from $version; revision fixed to 0 for Store)"

# 准备暂存目录
$stage = Join-Path $OutDir 'stage'
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path (Join-Path $stage 'Assets') | Out-Null

# 主程序
Copy-Item $Exe (Join-Path $stage 'desktop-todo.exe') -Force
Write-Host "exe copied: $([math]::Round((Get-Item $Exe).Length/1MB,2)) MB"

# 资源：从 icons\msix 复制并补齐清单引用的其它尺寸
$iconSrc = Join-Path $crateDir 'icons\msix'
$need = @{
  'Square44x44Logo.png' = 44
  'Square150x150Logo.png' = 150
  'Square310x310Logo.png' = 310
  'StoreLogo.png' = 50
  'SplashScreen.png' = 620
  'Wide310x150Logo.png' = $null
}
Add-Type -AssemblyName System.Drawing
$square150 = Join-Path $iconSrc 'Square150x150Logo.png'
foreach ($name in $need.Keys) {
  $dest = Join-Path $stage "Assets\$name"
  if ($name -eq 'Wide310x150Logo.png') {
    # 宽图：310x150，用 150 方块居中铺在透明画布上
    $canvas = New-Object System.Drawing.Bitmap 310, 150
    $g = [System.Drawing.Graphics]::FromImage($canvas)
    $g.Clear([System.Drawing.Color]::Transparent)
    $g.InterpolationMode = 'HighQualityBicubic'
    $img = [System.Drawing.Image]::FromFile($square150)
    $g.DrawImage($img, 80, 0, 150, 150)
    $img.Dispose(); $g.Dispose()
    $canvas.Save($dest, [System.Drawing.Imaging.ImageFormat]::Png); $canvas.Dispose()
  } elseif ($name -eq 'SplashScreen.png') {
    $canvas = New-Object System.Drawing.Bitmap 620, 300
    $g = [System.Drawing.Graphics]::FromImage($canvas)
    $g.Clear([System.Drawing.Color]::Transparent)
    $g.InterpolationMode = 'HighQualityBicubic'
    $img = [System.Drawing.Image]::FromFile($square150)
    $g.DrawImage($img, 235, 75, 150, 150)
    $img.Dispose(); $g.Dispose()
    $canvas.Save($dest, [System.Drawing.Imaging.ImageFormat]::Png); $canvas.Dispose()
  } else {
    $srcName = if ($name -eq 'StoreLogo.png') { 'Square50x50Logo.png' } else { $name }
    Copy-Item (Join-Path $iconSrc $srcName) $dest -Force
  }
  Write-Host "  asset: $name"
}

# 清单
$tpl = Get-Content (Join-Path $crateDir 'msix\Package.appxmanifest.template.xml') -Raw -Encoding UTF8
# Tauri v2 的 bundle 配置里字段名是 shortDescription / longDescription，
# 没有 description（那个是 fileAssociations 下的）
$desc = if ($conf.bundle.shortDescription) { $conf.bundle.shortDescription } else { '桌面待办小工具' }

# 身份与名称校验：错误要在这里暴露，而不是等到 makeappx 报难懂的 XML 错误
if ($IdentityName -notmatch '^[-_.A-Za-z0-9]{3,50}$') {
  throw "IdentityName 只能包含字母、数字、. _ - 且长度 3-50：$IdentityName（中文名会被 makeappx 拒绝）"
}
if ($Publisher -notmatch '^(CN=)?[^,=&<>"]+$') {
  throw "Publisher 格式异常：$Publisher"
}

# XML 转义：产品名或 Publisher 含 & < > " 时，未转义会写出非法 XML
$esc = { param($v) [System.Security.SecurityElement]::Escape([string]$v) }
$manifest = $tpl.Replace('{{IDENTITY_NAME}}', (& $esc $IdentityName)).
  Replace('{{PUBLISHER}}', (& $esc $Publisher)).
  Replace('{{DISPLAY_NAME}}', (& $esc $displayName)).
  Replace('{{PUBLISHER_DISPLAY_NAME}}', (& $esc $PublisherDisplayName)).
  Replace('{{DESCRIPTION}}', (& $esc $desc)).
  Replace('{{VERSION}}', $msixVersion)
[System.IO.File]::WriteAllText((Join-Path $stage 'AppxManifest.xml'), $manifest, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "manifest: Identity=$IdentityName Publisher=$Publisher Version=$msixVersion"

# 打包
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$msix = Join-Path $OutDir "DesktopTodo_${version}_x64.msix"
if (Test-Path $msix) { Remove-Item $msix -Force }
try {
  & $makeappx pack /d $stage /p $msix /o 2>&1 | ForEach-Object { Write-Host $_ }
  if ($LASTEXITCODE -ne 0) { throw "makeappx failed ($LASTEXITCODE)" }
} catch {
  # 失败时清掉半成品，避免后续 Get-ChildItem *.msix 误当成品上传。
  if (Test-Path $msix) { Remove-Item $msix -Force -ErrorAction SilentlyContinue }
  Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
  throw
}
Write-Host "built: $msix"

# 签名（可选）
# 签名（可选）：用 Import-PfxCertificate 把口令留在进程内，
# signtool 只接收证书指纹，避免 /p <password> 出现在子进程命令行。
if ($Pfxn) {
  if (-not $Password) { throw '使用 -Pfxn 时必须通过 -Password 或 MSIX_CERT_PASSWORD 提供口令' }
  if (-not (Test-Path $signtool)) { throw 'signtool.exe not found' }
  $secure = ConvertTo-SecureString $Password -AsPlainText -Force
  $cert = Import-PfxCertificate -FilePath $Pfxn -Password $secure -CertStoreLocation Cert:\CurrentUser\My -ErrorAction Stop
  try {
    & $signtool sign /fd SHA256 /sha1 $cert.Thumbprint $msix 2>&1 | ForEach-Object { Write-Host $_ }
    if ($LASTEXITCODE -ne 0) { throw "signtool failed ($LASTEXITCODE)" }
    Write-Host 'signed'
  } finally {
    Remove-Item "Cert:\CurrentUser\My\$($cert.Thumbprint)" -Force -ErrorAction SilentlyContinue
  }
} else {
  Write-Host '未签名。上架前需要签名，或直接提交到 Partner Center 由微软签名。'
}

return $msix

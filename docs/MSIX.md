# Microsoft Store 上架说明

本文记录把「Tiny·待办事项」打包成 MSIX 并提交 Microsoft Store 的流程、代码合规情况，以及仍待处理的事项。

## 为什么不用 Tauri 自带打包

Tauri v2 的 `BundleType` 枚举只有 `deb / rpm / appimage / msi / nsis / app / dmg`，**没有 msix**（见 `tauri-utils` 的 `src/config.rs`）。
所以 `tauri build --bundles msix` 不可用，改用 Windows SDK 的 `makeappx` 手工打包，脚本是 `tests/build-msix.ps1`。

## 生成 MSIX

```powershell
# 先构建发布版 exe
cd src-tauri
cargo build --release

# 打包（未签名，供 Partner Center 提交）。默认不打包 WebView2，包体约 10MB；
# 清单里的 ExternalDependency 会让商店安装时自动部署 WebView2 运行时。
powershell -ExecutionPolicy Bypass -File tests\build-msix.ps1

# 需要离线分发时才把固定版 WebView2 打进包（约 +430MB）：
powershell -ExecutionPolicy Bypass -File tests\build-msix.ps1 -BundleWebView2

# 本地测试用：用自签证书签名后安装
powershell -ExecutionPolicy Bypass -File tests\build-msix.ps1 -Pfxn .\cert.pfx -Password <密码>
```

产物：`src-tauri/target/msix/DesktopTodo_<version>_x64.msix`

脚本会：
- 从 `tauri.conf.json` 读取版本号，转成商店要求格式：`0.0.7` → `1.0.7.0`
  - 商店规则：第四段（revision）保留给商店，**构建时必须为 0**；第一段**不能为 0**
  - semver 的 major=0 会提升为 1；`1.x.y` 及以上直接映射为 `major.minor.patch.0`，**不会跳过**
- 默认不打包 WebView2；`-BundleWebView2` 时才下载并解压固定版到 `stage\WebView2\`
- 从 `src-tauri/icons/msix/` 复制并补齐清单引用的全部资源尺寸
- 填充 `src-tauri/msix/Package.appxmanifest.template.xml`，并对所有值做 XML 转义
- 校验 `IdentityName` 只含 `A-Za-z0-9._-`（中文会被 makeappx 拒绝）

## 产品标识（构建时注入）

真实包身份（Publisher CN、IdentityName、PublisherDisplayName 等）**不写入仓库**，避免公开
开发者姓名与账号标识。构建时从 Partner Center「产品标识」页复制，通过参数或环境变量注入：

| 项 | 来源 |
| --- | --- |
| Package/Identity/Name | Partner Center 的 `Package/Identity/Name` |
| Package/Identity/Publisher | Partner Center 的 `Package/Identity/Publisher`（形如 `CN=<GUID>`） |
| Package/Properties/PublisherDisplayName | Partner Center 的开发者显示名称 |

```powershell
# 方式一：环境变量（推荐，避免出现在命令行历史里）
$env:MSIX_PUBLISHER          = 'CN=<PartnerCenter 下发的 GUID>'
$env:MSIX_PUBLISHER_DISPLAY_NAME = '<开发者显示名称>'
$env:MSIX_IDENTITY_NAME      = '<PublisherID.AppName>'
powershell -ExecutionPolicy Bypass -File tests\build-msix.ps1
```

```powershell
# 方式二：命令行参数
powershell -ExecutionPolicy Bypass -File tests\build-msix.ps1 `
  -Publisher "CN=<GUID>" `
  -PublisherDisplayName "<开发者显示名称>" `
  -IdentityName "<PublisherID.AppName>"
```

清单里的 `<Identity Publisher="...">` 必须与签名证书的 **Subject CN 完全一致**，否则安装报 `0x800B0100` 或证书不匹配——务必使用 Partner Center 下发的同一个 Publisher 值。

**提交 Partner Center 时一般不需要自签名**，微软会用商店证书重签。本脚本不传 `-Pfxn` 即可。

## 代码合规检查结果

### 已处理

| 项 | 处理方式 |
|---|---|
| **CSP** | 原先为 `null`（不限制）。现已设置为严格策略，禁止加载外部脚本与内联脚本 |
| **网络请求** | 原先前端有 4 处原生 `fetch` 直连第三方。现统一改为 Rust `fetch_json` 代发，CSP 因此可保持严格 |
| **Nominatim UA** | OpenStreetMap 使用政策要求可识别的 User-Agent。已改为带应用名与仓库地址 |
| **图标资源** | 原先只有单个 64×64 `.ico`。已生成 44/50/150/310 多尺寸 PNG 到 `src-tauri/icons/msix/` |
| **明文 HTTP** | 移除了仅提供 HTTP 端点的 `ip-api.com` 定位源，所有联网请求全部走 HTTPS |
| **隐私政策入口** | About 页新增「隐私政策 / GitHub 仓库 / MIT 协议」三个链接，用默认浏览器打开（`open_url` 命令只放行 http/https） |
| **MIT 声明** | 新增 `LICENSE`（MIT），`Cargo.toml` 标注 `license = "MIT"`，About 页可见 |
| **数据目录** | 统一放到 `%LOCALAPPDATA%\desktoptodo\`；MSIX 包身份下自动改用真实路径，避免与外部 AI 进程分裂；旧目录自动迁移 |
| **WebView2** | 见下文「Fixed Version WebView2」 |
| **版本映射** | `0.0.10` → `1.0.10.0`；`1.x.y` 不再被跳过，直接映射为 `1.x.y.0` |

### WebView2 运行时

MSIX 默认**不打包** WebView2（包体约 10MB）。清单里声明了官方外部依赖：

```xml
<win32dependencies:ExternalDependency
  Name="Microsoft.WebView2"
  Publisher="CN=Microsoft Windows, O=Microsoft Corporation, L=Redmond, S=Washington, C=US"
  MinVersion="1.1.1.1"
  Optional="true" />
```

- **商店 / Microsoft App Installer 安装时**会自动检查并部署 WebView2 运行时（这是微软允许的唯一外部依赖）。
- 该依赖只对 App Installer 安装路径生效；用 `Add-AppxPackage`、PowerShell、Intune 等方式安装时会被忽略。
- 因此应用启动时还有兜底检测（`webview2_available()`）：运行时缺失时弹窗提示并提供官方下载页链接，避免白屏。
- 需要离线分发时，可用 `-BundleWebView2` 把固定版运行时打进包（约 +430MB），Rust 侧会自动设置 `WEBVIEW2_BROWSER_EXECUTABLE_FOLDER` 指向包内 `WebView2\`。

参考：[win32dependencies:ExternalDependency 官方文档](https://learn.microsoft.com/en-us/uwp/schemas/appxpackage/uapmanifestschema/element-win32dependencies-externaldependency)

### 需要在 Partner Center 如实申报

| 项 | 说明 |
|---|---|
| **位置信息** | 代码使用 `navigator.geolocation` 获取经纬度用于天气。运行时由系统弹授权框。审核表须勾选"使用位置" |
| **网络访问** | 会连接 `api.open-meteo.com`、`geocoding-api.open-meteo.com`、`nominatim.openstreetmap.org`、`api.bigdatacloud.net`、`ipwho.is`、`cdn.jsdelivr.net`（全部 HTTPS） |
| **隐私政策 URL** | 已托管到 GitHub Pages：`https://zzmxoo.github.io/todo_list/PRIVACY.html`。提交时在「隐私政策」表单选择「**是，我的产品使用个人信息**」并填入该 URL（应用内有定位与 IP 请求，不能选否） |
| **runFullTrust** | 清单声明了该受限能力（桌面桥应用必需）。审核备注需说明：需要读写应用数据目录、写开机启动注册表项、常驻托盘 |
| **无遥测** | 代码中不含任何统计/分析 SDK，对审核有利，申报时说明即可 |

### 隐私政策托管（GitHub Pages）

仓库 → **Settings → Pages** → Source 选 **Deploy from a branch** → Branch `master`、目录 `/docs` → Save。
站内文件：`docs/index.md`（首页）、`docs/PRIVACY.md`（渲染为 `/todo_list/PRIVACY.html`）、`docs/_config.yml`（Jekyll 主题）。
首次启用后需等 1–2 分钟构建；改完 `PRIVACY.md` 推送即自动更新。

### 已知问题（不阻塞上架，但影响体验）

- `nominatim.openstreetmap.org` 在实际网络环境下经常超时，导致城市名停留在「当前位置」。建议后续换成更稳定的逆地理编码服务。

## 上架流程

1. ✅ 注册 [Microsoft Partner Center](https://partner.microsoft.com/dashboard) 开发者账号
2. ✅ 保留应用名称，并已获取产品标识（见上文「产品标识」）
3. 本地注入身份构建 MSIX（环境变量或参数，见上文）
4. 本地跑一遍 WACK（Windows App Certification Kit）：
   ```powershell
   # 安装 Windows SDK 后，appcert.exe 通常在：
   # C:\Program Files (x86)\Windows Kits\10\App Certification Kit\appcert.exe
   appcert.exe reset
   appcert.exe test -appxpackagepath "src-tauri\target\msix\DesktopTodo_<version>_x64.msix" -reportoutputpath "target\wack\report.xml"
   ```
   重点看：支持的 API、图标与资源尺寸、清单/签名有效性。
5. 填写上架表单：年龄分级、隐私政策 URL、系统要求、描述与截图
6. 提交审核

## 商店版的已知限制

**开机自启不可用。** MSIX 应用的写入会被虚拟化到每应用私有的注册表视图，
`HKCU\...\Run` 对系统登录启动机制不可见，因此注册表方案在包身份下静默失效。
目前 `set_autostart` 会检测包身份并直接返回错误提示，`get_autostart` 报告为关闭，
避免界面显示与实际不符。安装版（NSIS）不受影响。

若将来需要商店版支持，需接入 `Windows.ApplicationModel.StartupTask` API，
并在清单里补回 `windows.startupTask` 扩展声明。

## CI

`.github/workflows/release.yml` 只构建并发布 **exe 安装包/便携版**，源码由 GitHub Release 自动附带。
**MSIX 不随 GitHub Release 发布**：商店包在本地按需构建（注入身份 → 可选签名 → 提交 Partner Center）。
仓库 Variables 不是 CI 的必需品；本地构建可在 PowerShell 里临时设置环境变量
`MSIX_IDENTITY_NAME` / `MSIX_PUBLISHER` / `MSIX_PUBLISHER_DISPLAY_NAME`（真实身份不入库）。

# Microsoft Store 上架说明

本文记录把「桌面待办」打包成 MSIX 并提交 Microsoft Store 的流程、代码合规情况，以及仍待处理的事项。

## 为什么不用 Tauri 自带打包

Tauri v2 的 `BundleType` 枚举只有 `deb / rpm / appimage / msi / nsis / app / dmg`，**没有 msix**（见 `tauri-utils` 的 `src/config.rs`）。
所以 `tauri build --bundles msix` 不可用，改用 Windows SDK 的 `makeappx` 手工打包，脚本是 `tests/build-msix.ps1`。

## 生成 MSIX

```powershell
# 先构建发布版 exe
cd src-tauri
cargo build --release

# 打包（未签名，供 Partner Center 提交）
powershell -ExecutionPolicy Bypass -File tests\build-msix.ps1

# 本地测试用：用自签证书签名后安装
powershell -ExecutionPolicy Bypass -File tests\build-msix.ps1 -Pfxn .\cert.pfx -Password <密码>
```

产物：`src-tauri/target/msix/DesktopTodo_<version>_x64.msix`

脚本会：
- 从 `tauri.conf.json` 读取版本号，转成 MSIX 必需的四段格式（`0.0.7` → `0.0.7.1`，末段不能为 0）
- 从 `src-tauri/icons/msix/` 复制并补齐清单引用的全部资源尺寸
- 填充 `src-tauri/msix/Package.appxmanifest.template.xml`

## 必需参数：Publisher 必须与证书一致

清单里的 `<Identity Publisher="...">` 必须与签名证书的 **Subject CN 完全一致**，否则安装报 `0x800B0100` 或证书不匹配。

从 Partner Center 拿到保留名称后，会分配给一个 Publisher ID，格式类似：

```
CN=1A2B3C4D-5E6F-7A8B-9C0D-1E2F3A4B5C6D
```

届时这样构建：

```powershell
powershell -ExecutionPolicy Bypass -File tests\build-msix.ps1 `
  -Publisher "CN=1A2B3C4D-5E6F-7A8B-9C0D-1E2F3A4B5C6D" `
  -PublisherDisplayName "你的开发者名称" `
  -IdentityName "你的PublisherID.桌面待办"
```

**提交 Partner Center 时一般不需要自签名**，微软会用商店证书重签。本脚本不传 `-Pfxn` 即可。

## 代码合规检查结果

### 已处理

| 项 | 处理方式 |
|---|---|
| **CSP** | 原先为 `null`（不限制）。现已设置为严格策略，禁止加载外部脚本与内联脚本 |
| **网络请求** | 原先前端有 4 处原生 `fetch` 直连第三方。现统一改为 Rust `fetch_json` 代发，CSP 因此可保持严格 |
| **Nominatim UA** | OpenStreetMap 使用政策要求可识别的 User-Agent。已改为带应用名与仓库地址 |
| **图标资源** | 原先只有单个 64×64 `.ico`。已生成 44/50/150/310 多尺寸 PNG 到 `src-tauri/icons/msix/` |

### 需要在 Partner Center 如实申报

| 项 | 说明 |
|---|---|
| **位置信息** | 代码使用 `navigator.geolocation` 获取经纬度用于天气。运行时由系统弹授权框。审核表须勾选"使用位置" |
| **网络访问** | 会连接 `api.open-meteo.com`、`geocoding-api.open-meteo.com`、`nominatim.openstreetmap.org`、`cdn.jsdelivr.net` |
| **隐私政策 URL** | **必须提供**。含位置信息与网络请求的应用无法豁免 |
| **runFullTrust** | 清单声明了该受限能力（桌面桥应用必需）。审核备注需说明：需要读写应用数据目录、写开机启动注册表项、常驻托盘 |
| **无遥测** | 代码中不含任何统计/分析 SDK，对审核有利，申报时说明即可 |

### 已知问题（不阻塞上架，但影响体验）

- `nominatim.openstreetmap.org` 在实际网络环境下经常超时，导致城市名停留在「当前位置」。建议后续换成更稳定的逆地理编码服务。

## 上架流程

1. 注册 [Microsoft Partner Center](https://partner.microsoft.com/dashboard) 开发者账号（个人约 $19，一次性）
2. 在「应用和游戏」→「新建产品」→ 保留一个应用名称
3. 从「产品管理」→「产品标识」获取 **Package/Identity/Name**、**Publisher ID**、**Publisher Display Name**
4. 用上述值重新构建 MSIX（见上文参数说明）
5. 填写上架表单：年龄分级、隐私政策、系统要求、描述与截图
6. 提交审核

## CI

`.github/workflows/release.yml` 已加入 MSIX 构建与上传步骤。推 tag 后会自动生成 MSIX 并附到 Release 页面。

注意：CI 打出的是未签名包，仅用于提交 Partner Center 或本地 sideload（需手动签名）。

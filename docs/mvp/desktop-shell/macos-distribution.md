# macOS 本机试装、签名与公证

> 当前 `v0.1.0` MVP 默认生成未签名的 arm64/x64 独立 DMG，只用于开发者本机验证。对外发送前再启用本页后半部分的 Developer ID 流程。

## 1. 本机生成与试装

推荐使用仓库声明的偶数版本 Node.js LTS（当前推荐 Node.js 24）：

```bash
npm install
npm run preflight
npm run desktop:package:mac:arm64
npm run desktop:package:mac:x64
```

输出位置：

- `dist/desktop/open image generator-0.1.0-arm64.dmg`
- `dist/desktop/open image generator-0.1.0-x64.dmg`

Apple Silicon 机器选择 arm64，Intel 机器选择 x64。打开 DMG 后把 App 拖到 `/Applications`。未签名包会被 Gatekeeper 提醒；仅在确认产物来自自己的构建后，可在 Finder 中按住 Control 点击 App，选择“打开”并再次确认。不要把这条绕过方式当作公开发布方案。

桌面数据默认位于：

```text
~/Library/Application Support/open image generator/
  app.db
  images/
  config/
  logs/desktop.log
```

开发模式使用 `open image generator Development`，不会和安装版共用业务数据。安装版的新用户目录从空数据库开始，不自动迁移仓库 `data/` 或浏览器开发数据。

## 2. 申请 Developer ID

1. 加入 Apple Developer Program，并确定发布者的个人或组织法律主体。
2. 在 Apple Developer Certificates 中创建 `Developer ID Application` 证书；DMG 直接分发不需要 `Developer ID Installer` 证书。
3. 把证书及私钥保存在登录 Keychain；若用于 CI，再从 Keychain Access 导出带密码的 `.p12`，证书和密码只能放在本机安全存储或 CI Secret，不能提交到仓库。
4. 在 App Store Connect 创建 API Key，记录 Key ID 和 Issuer ID，并只下载一次 `.p8` 私钥；API Key 方式更适合自动化公证。

Apple 的 [Developer ID 说明](https://developer.apple.com/support/developer-id/) 和 [公证说明](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution) 是最终依据。

## 3. 启用签名与公证

当前构建配置只有在 `DESKTOP_SIGNING_ENABLED=1` 时才强制签名、开启 Hardened Runtime 并请求公证。使用 App Store Connect API Key 时，在本机 shell 或 CI Secret 注入下列值：

```bash
export DESKTOP_SIGNING_ENABLED=1
export CSC_LINK=/absolute/private/path/developer-id-application.p12
export CSC_KEY_PASSWORD='p12-password'
export APPLE_API_KEY=/absolute/private/path/AuthKey_KEYID.p8
export APPLE_API_KEY_ID='KEYID'
export APPLE_API_ISSUER='ISSUER-UUID'

npm run desktop:package:mac:arm64
npm run desktop:package:mac:x64
```

这些变量均不得写进 `.env` 或提交到 Git。electron-builder 也支持 Apple ID 专用密码和预存的 `notarytool` Keychain profile；项目首选 API Key。具体变量约束见 [electron-builder macOS 签名](https://www.electron.build/docs/features/code-signing/code-signing-mac/) 与 [公证文档](https://www.electron.build/docs/notarization/)。

## 4. 发布前验证

对两个架构分别检查签名、Gatekeeper 和 stapled ticket：

```bash
codesign --verify --deep --strict --verbose=2 \
  'dist/desktop/mac-arm64/open image generator.app'
spctl --assess --verbose --type exec \
  'dist/desktop/mac-arm64/open image generator.app'
xcrun stapler validate \
  'dist/desktop/open image generator-0.1.0-arm64.dmg'
```

然后在一台没有开发 Keychain、没有仓库环境变量的干净 Mac 用户账户上完成：首次启动、Keychain 保存与重启恢复 API Key、生成图片、下载目录、项目导出、打开数据目录、退出后无残留本机服务。x64 包还必须在真实 Intel Mac 或等价 CI 上完成启动验收。

正式发布时还需补齐项目图标、下载页的架构说明、SHA-256 校验值和隐私说明；自动更新仍属于后续版本。

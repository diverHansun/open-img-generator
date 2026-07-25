# Open Image Generator

多 Provider 文生图工作台。当前首批接入 fal.ai 与 ZenMux，前端会从后端读取已启用模型和能力约束，再提交并轮询真实生成任务。

## 本地开发

项目使用偶数版本 Node.js LTS；Windows 推荐安装 Node.js 24 LTS x64。Windows PowerShell 的唯一受支持启动路径是：

```powershell
Copy-Item .env.example .env.local
npm ci
npm run dev
```

macOS/Linux 可使用等价命令复制 `.env.example` 后执行 `npm ci && npm run dev`。`npm run dev` 会先自动迁移数据库，并固定监听 [http://localhost:3000](http://localhost:3000)；不要改用 `127.0.0.1`，两者属于不同浏览器 origin，会分裂 localStorage。Provider API Key 只配置在根目录 `.env.local`，不要写进前端代码。

至少配置一家 Provider：

```dotenv
FAL_KEY=
ZENMUX_API_KEY=
```

修改 `.env.local` 后需要重新启动开发服务。若未配置任何 Provider，页面会保持可访问并展示真实空状态，但不会允许提交生成任务。

未配置路径覆盖时，development 数据全部保留在仓库的 `./data/`：SQLite 为 `data/app.db`，图片为 `data/images/`，设置与加密凭据为 `data/config/`，日志为 `data/logs/`。Edge 与 Chrome 各自保存浏览器 localStorage，所以界面偏好不会互通；它们访问同一个本机服务时仍共享上述服务端数据。清理浏览器站点数据不会删除 `./data/`。

Web 端下载继续由浏览器管理，下载位置和提示行为以 Edge/Chrome 设置为准；普通浏览器页面不会获得 Electron 的原生目录选择能力。

### 网络可靠性与透明代理

ZenMux、SiliconFlow、智谱和豆包这类同步生图 API 的完整生成响应默认最多等待 3 分钟；环境变量 `SYNC_IMAGE_GENERATION_TIMEOUT_MS` 只能设为不超过 `180000` 的正整数毫秒，非法值会安全回退到 3 分钟。fal、Qwen 的异步 submit/poll 预算不受此项影响；已开始但超时的生图请求仍会进入“结果未知”，系统不会自动重投可能已收费的请求。

ZenMux 与豆包在官方响应允许时优先接收 Base64，并通过有界 staging 直接落入本地文件，减少一次临时 CDN 下载。fal、SiliconFlow、智谱、Qwen 仍按厂商契约返回 URL，job-engine 会在任务完成后立即执行 HTTPS/DNS/IP、大小、MIME 与 magic 校验并转存，不把临时 URL 当作历史资产。

若本机透明代理把确认过的外部图片 CDN 解析为 `198.18.0.0/15`，可配置精确 host 白名单，例如：

```dotenv
TRUSTED_PROXY_IMAGE_HOSTS=v3b.fal.media
```

该例外只接受 HTTPS、精确 hostname 且全部 DNS 结果均在该 `/15`；每次 redirect 会重新检查。代理关闭时保持为空即可。请勿以 `ALLOW_PRIVATE_IMAGE_URLS=true` 作为常规方案：它仅供本地 fake provider 开发使用，会放宽所有 private 地址检查。

保存失败时，任务详情只显示安全失败类别和可验证的下载 hostname，用于区分 DNS、fake-IP 未信任、下载超时、上游链接失效、内容校验和本地写入错误；不会显示签名 URL、Prompt、上游响应体或本机绝对路径。

### 图片保留与导出

图片字节默认保存在 development 的 `./data/images`，也可用 `LOCAL_STORAGE_DIR` 覆盖。SQLite 只保存 Generation/Job、图片元数据和清理墓碑。未收藏图片默认永不自动清理；在 Web 的“设置”中启用后，超过指定天数的既有和未来未收藏图片会在下一轮清理时删除。收藏图片持续保留，直到用户主动删除；文件若在应用外丢失，收藏意图仍保留并显示“图片已过期清理”。下载只导出一份副本，不延长应用内部副本的保留期；自动过期或单图删除后，历史仍保留并显示对应原因。

存储根目录通过 `.open-image-storage.json` 与当前数据库配对；不匹配时写入、删除和自动清理会安全拒绝，避免测试数据库或第二实例误删真实媒体。安全审计日志在 development 默认写入 `./data/logs`，采用 5 MiB 当前文件加 3 份轮转；设置 `APP_FILE_LOG_ENABLED=0` 可只保留 stderr。日志不记录 API Key、Prompt、签名 URL、原始异常或绝对路径。

## 生产运行

```bash
npm run build
npm start
```

`npm start` 的 `prestart` 会以 production 模式自动迁移生产数据库，无需提前手工执行默认 development 模式的 `npm run db:migrate`。

开发服务使用 `.next/`，生产构建与 `npm start` 使用 `.next-build/`。两者可同时存在，执行 `npm run build` 不会再覆盖正在运行的开发服务 chunk。

Windows Web production 未设置覆盖变量时，数据库、图片、配置和日志默认位于 `%LOCALAPPDATA%\Open Image Generator\`；若 `LOCALAPPDATA` 缺失，则回退当前用户的 `AppData\Local`。macOS/Linux Web production 保持既有数据库/图片/日志默认，用户配置仍在 `~/.config/open-image-generator`。四类路径都可通过 `DATABASE_URL`、`LOCAL_STORAGE_DIR`、`USER_CONFIG_DIR`、`APP_LOG_DIR` 显式覆盖，并应确保运行用户具有读写权限。移动数据库或存储目录前应一起备份，不要手工复制 marker 到另一套数据库；当前实现拒绝 UNC/网络共享路径。

## macOS 桌面版

桌面版显示名称为 `open image generator`，Bundle ID 为 `com.diverhansun.openimagegenerator`。它在 Electron 窗口内运行随包携带的本机 Next 服务，不会打开普通浏览器；新安装的数据位于当前用户的标准 Application Support 目录，不读取 Web 开发目录或项目 `.env` 中的 Provider Key。

```bash
# 开发模式（使用独立的 Development 用户数据目录）
npm run desktop:dev

# 当前机器架构的真实生产运行时 smoke
npm run build
node scripts/prepare-desktop-runtime.mjs arm64
npm run desktop:smoke -- arm64

# 分别生成 Apple Silicon / Intel DMG
npm run desktop:package:mac:arm64
npm run desktop:package:mac:x64
```

未签名测试产物输出到 `dist/desktop/`，不会进入 Git。API Key 正常情况下由 macOS Keychain 保护本地凭据主密钥；系统安全存储失败时只在当前 App 会话内使用，退出后需重新输入。签名、公证和试装步骤见 [macOS 分发指南](./docs/mvp/desktop-shell/macos-distribution.md)。

## 验证

```bash
npm run typecheck
npm test
npm run build
npm run desktop:compile
```

## 许可证

本项目使用 [Apache License 2.0](./LICENSE)。第三方 Provider 的服务条款、商标和生成内容权利不由本项目许可证授予。

## 发布与版本

当前 MVP 版本为 `0.1.0`。版本号以 `package.json` 为唯一来源，设置页和未来桌面包都会读取它；发布流程与校验见 [docs/releasing.md](./docs/releasing.md)。

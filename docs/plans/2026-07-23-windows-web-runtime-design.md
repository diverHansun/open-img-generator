# Windows Web Runtime 适配设计

> 日期：2026-07-23
>
> 状态：设计已实施，等待目标环境与人工验收
>
> 首批目标：Windows x64 上通过 `npm run dev` 启动 Next.js，并由 Edge/Chrome 访问

## 1. 目标

本批为现有本地优先 Web 应用补齐 Windows 开发运行时能力。开发数据继续保存在仓库 `./data/`；Windows production 模式预置用户级目录策略，但不在本批制作 Electron App 或 `.exe`。

核心成功标准：

- Windows x64、Node.js 24 LTS 下，开发者执行 `npm ci && npm run dev` 即可完成迁移并启动服务。
- 数据库、图片、配置和日志由同一运行时路径策略解析。
- 开发模式默认路径保持为项目根目录下的 `./data/`，现有开发数据不迁移。
- `predev` 迁移与 Next.js 使用相同的 `.env*` 加载顺序和同一数据库路径。
- Edge、Chrome 完成关键 Web 流程；Windows x64 CI 阻止路径、迁移、测试或构建回归。

## 2. 已确认设计

### 2.1 单一运行时路径策略

新增 server-only、可注入输入、无副作用的路径解析核心。解析输入至少包括：

```ts
resolveRuntimePaths({
  mode: 'development' | 'production' | 'test',
  platform,
  projectRoot,
  env,
  homeDirectory,
  localAppData,
})
```

优先级固定为：显式环境变量覆盖 > 模式默认值。

| 资源 | 环境变量 | development 默认 | Windows production 默认 |
| --- | --- | --- | --- |
| SQLite | `DATABASE_URL` | `<projectRoot>/data/app.db` | `%LOCALAPPDATA%/Open Image Generator/app.db` |
| 图片 | `LOCAL_STORAGE_DIR` | `<projectRoot>/data/images` | `%LOCALAPPDATA%/Open Image Generator/images` |
| 设置/凭据 | `USER_CONFIG_DIR` | `<projectRoot>/data/config` | `%LOCALAPPDATA%/Open Image Generator/config` |
| 日志 | `APP_LOG_DIR` | `<projectRoot>/data/logs` | `%LOCALAPPDATA%/Open Image Generator/logs` |

Windows 缺少 `LOCALAPPDATA` 时，production 模式回退到 `<homeDirectory>/AppData/Local/Open Image Generator`。本批不改变 macOS/Linux Web production 的既有逐资源默认行为；现有 Electron 仍通过显式环境变量拥有自己的 `userData` 映射。

数据库路径解析支持当前 `file:./data/app.db`、Windows 盘符绝对路径、空格、中文、反斜杠和 `:memory:`。本批只支持本机磁盘，拒绝 UNC/网络共享路径。

### 2.2 启动与环境加载闭环

`npm run dev` 不增加 Windows 专属分支。`predev` 显式采用 development 模式，迁移脚本使用官方 `@next/env` 从项目根加载与 Next.js 相同的 `.env*`，避免迁移与服务连接不同数据库。

```json
{
  "predev": "node scripts/migrate-db.mjs --mode=development",
  "dev": "next dev --hostname localhost",
  "prestart": "node scripts/migrate-db.mjs --mode=production",
  "start": "next start",
  "db:migrate": "node scripts/migrate-db.mjs"
}
```

CLI `--mode` 优先于 `NODE_ENV`；手动迁移默认 development。相对路径始终相对于项目根，而不是调用者的当前目录。Drizzle CLI 复用相同环境加载和解析策略。

唯一文档化入口为 `http://localhost:3000`。不混用 `127.0.0.1`，防止浏览器 `localStorage`、`sessionStorage` 因 origin 不同而分裂。

### 2.3 Windows 文件系统策略

- 启动前创建并验证数据库父目录、图片目录和配置目录；失败时带资源类别、路径和系统错误码终止。
- 日志目录继续保持 best-effort：失败告警但不阻止服务启动。
- 写入能力通过独占临时探针文件验证，随后清理；不只依赖 `fs.access()`。
- 图片记录只接受存储根下的相对路径，拒绝绝对路径、盘符、UNC 和越界 `..`。
- macOS/Linux 继续应用目录 `0700`、文件 `0600`；Windows 不断言不完整的 POSIX mode，继承当前用户 ACL。
- 配置和凭据继续使用同目录临时文件加 rename 的原子写入；首批不预设杀毒软件重试，只有稳定复现后才增加有界重试。
- 凭据继续使用现有 AES-256-GCM 加密。Windows DPAPI 属于后续 Electron 批次。

### 2.4 浏览器兼容

- 目标为 Next.js 15 支持的现代浏览器，不支持 IE 和旧版 Edge。
- Windows 主要验收最新版 Edge、Chrome；Firefox 做基础冒烟，Safari 延续 macOS 回归。
- 不引入 Chromium 专属 File System Access API。
- Web 下载继续交给浏览器默认下载目录；服务端数据保存在 `./data/`。
- Edge 与 Chrome 不共享浏览器本地状态，但共享同一服务端数据库和图片。

### 2.5 测试与 CI

沿用项目现有 Unit、Contract、Integration、Smoke 分类和命名；不引入 Playwright。新增 Windows 路径纯逻辑测试、真实临时目录集成测试、`npm run dev` 启动冒烟和人工浏览器清单。

新增 `.github/workflows/windows-x64.yml`，使用 Windows x64 runner 与 Node.js 24，至少执行：

```text
npm ci
npm run typecheck
npm run test:verify
npm run build
npm run test:smoke:windows
```

自动化测试不得调用真实 Provider 或读取真实用户凭据。

## 3. 范围边界

本批不实现 Electron Windows 生命周期、NSIS、`.exe`、代码签名、SmartScreen、DPAPI、自动更新、x86、ARM64、UNC 存储、开发数据迁移或浏览器自动化。它们留给后续 Windows Electron 批次。

## 4. 详细实施与验收契约

详细现状、文件级改动面和验收标准见：

- [`README`](../mvp/probelm-list/2026-07-23-windows-web-runtime/README.md)
- [`01-problem-analysis-and-current-state`](../mvp/probelm-list/2026-07-23-windows-web-runtime/improve-1/01-problem-analysis-and-current-state.md)
- [`02-optimization-plan-and-change-scope`](../mvp/probelm-list/2026-07-23-windows-web-runtime/improve-1/02-optimization-plan-and-change-scope.md)
- [`04-test-and-acceptance`](../mvp/probelm-list/2026-07-23-windows-web-runtime/improve-1/04-test-and-acceptance.md)

## 5. 官方依据

- [Next.js 15：在 Next Runtime 外使用 `@next/env`](https://nextjs.org/docs/15/app/guides/environment-variables)
- [Next.js 15：支持的现代浏览器](https://nextjs.org/docs/15/architecture/supported-browsers)
- [Node.js：Windows 文件权限位限制](https://nodejs.org/api/fs.html)

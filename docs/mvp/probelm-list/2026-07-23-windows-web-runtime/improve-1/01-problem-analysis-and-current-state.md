# 1. 问题分析与当前实施状态

> 分析时间：2026-07-23
>
> Git 基线：分支 `mvp`，HEAD `f05a8eb`（`docs(desktop): document macOS build and distribution`）
>
> 分析开始时工作树：干净
>
> 本文只描述当前基线与风险，不把目标方案写成已经实现。

## 1.1 问题陈述

### P1：运行时路径知识存在多份权威副本

数据库默认值和 `file:` 解析分别存在于：

- `src/lib/db/client.ts` 的 `getDatabasePath()`；
- `scripts/migrate-db.mjs` 顶层 `databasePath`；
- `drizzle.config.ts` 的 `dbCredentials.url`。

图片、配置、日志又分别在 `src/lib/storage/index.ts#getStorageRoot()`、`src/lib/user-config/paths.ts#getUserConfigDirectory()`、`src/lib/observability/local-log-sink.ts#getLocalLogDirectory()` 定义默认值。相同部署知识分散在六个位置，任何一次平台适配都可能只修改其中一部分。

风险不是单纯重复代码，而是同一项知识没有单一权威来源。特别是 `src/lib/storage/ownership.ts#verifyStorageOwnership()` 使用数据库绝对路径哈希绑定 storage；迁移与运行时若解析到不同数据库，会触发 fail-closed，或更早地在错误数据库上执行迁移。

### P2：`predev` 与 Next.js 的环境加载时序不一致

`package.json` 当前将 `predev` 指向 `npm run db:migrate`，随后才执行 `next dev`。`scripts/migrate-db.mjs` 直接读取 `process.env.DATABASE_URL`，没有加载根目录 `.env*`；Next.js 则会自行加载这些文件。

因此 `.env`/`.env.local` 中的 `DATABASE_URL` 可能只被 Next.js 看到：迁移脚本操作默认 `./data/app.db`，服务却连接覆盖后的数据库。这是启动链路上的高风险正确性问题。

### P3：用户配置默认路径和权限断言是 Unix 语义

`src/lib/user-config/paths.ts#getUserConfigDirectory()` 默认返回 `~/.config/open-image-generator`。该路径在 Windows 可创建，但不符合用户要求的 production `%LOCALAPPDATA%` 策略。

`src/lib/user-config/store.ts#writeEncryptedCredentials()` 与 `src/lib/app-settings/store.ts#writeAppSettings()` 无条件调用 `chmodSync(0700/0600)`；`docs/mvp/user-config/test.md` 也把精确 mode 作为统一断言。Node.js 在 Windows 只支持有限的权限位语义，继续用相同断言会产生虚假的安全保证或平台失败。

### P4：Windows 路径形式与本机磁盘边界没有明确契约

`src/lib/db/client.ts`、`scripts/migrate-db.mjs` 和 `drizzle.config.ts` 都用 `replace(/^file:/, '')` 处理 SQLite URL。它能覆盖当前相对形式，但没有显式区分 Windows 盘符、规范 file URL、UNC/网络共享和 `:memory:`。

`src/lib/storage/index.ts#resolveStoragePath()` 已用 `path.resolve()` 与 `path.relative()` 防止词法路径穿越，这是正确基础；但 Windows 的绝对盘符、UNC 输入和本批“仅本机磁盘”产品边界尚未形成独立、可测试的规则。

### P5：Windows 开发入口与浏览器 origin 尚未冻结

`package.json` 当前为 `next dev`，`README.md` 只有通用启动说明，并使用 Unix 风格环境文件复制方式。Windows PowerShell、Node x64 LTS、路径位置和常见错误没有文档化。

Web 客户端在 `src/components/generate/generate-screen.tsx`、`src/lib/web-client/submission-intent.ts`、`src/components/i18n/locale-provider.tsx` 使用 `localStorage`/`sessionStorage`。`localhost` 与 `127.0.0.1` 是不同 origin；如果启动输出和文档混用，两套浏览器状态会被误认为数据丢失。

现有下载实现总体符合 Web 边界：

- `src/lib/web-client/image-download.ts#triggerImageDownload()` 使用浏览器 `<a download>`；
- `src/app/api/images/[id]/download/route.ts` 返回 attachment；
- `src/lib/library/images.ts#imageDownloadFilename()` 生成 Windows 安全的 ASCII 文件名；
- `src/lib/project-export/index.ts#archiveSegment()` 清理 `\\/:*?\"<>|` 与控制字符。

因此本批需要验证而不是重写下载架构。

### P6：现有测试分类成熟，但没有 Windows x64 持续门禁

`docs/test-blueprint.md` 已定义 Unit、Contract、Integration、Backend E2E、Smoke，`vitest.config.ts` 和 `package.json` 也支持按后缀执行。现有测试覆盖迁移、DB push、build、storage、user-config 和桌面环境映射。

缺口在于：

- 没有统一路径解析模块及其 Windows 输入矩阵；
- POSIX mode 断言没有平台分支；
- 没有在含中文/空格的 Windows 临时目录中串联真实 SQLite 与文件系统；
- 没有真实 `npm run dev` 启动冒烟；
- 仓库没有 `.github/workflows/`，`docs/test-blueprint.md` 也明确记录 CI 尚未配置。

### P7：共享路径改造存在 macOS Electron 回归面

`electron/runtime/environment.ts#createDesktopRuntimeEnvironment()` 已显式注入 `DATABASE_URL`、`LOCAL_STORAGE_DIR`、`USER_CONFIG_DIR` 和 `APP_LOG_DIR`；`electron/runtime/local-server.ts` 和 `scripts/smoke-desktop-runtime.mjs` 使用这套环境启动 production Next Runtime。

统一默认路径策略原则上不应改变 Electron，因为显式覆盖优先。但迁移脚本将开始加载 `.env*` 并依赖共享解析核心，若没有回归测试，可能重新引入仓库开发凭据、漏打包共享文件或改变既有 userData 映射。

## 1.2 已确认的产品/技术分界

```text
Windows browser
  -> http://localhost:3000
  -> Next.js routes / services
  -> runtime path policy
       -> development: <projectRoot>/data/*
       -> win32 production: %LOCALAPPDATA%/Open Image Generator/*
       -> explicit env: always wins

Electron (本批不改)
  -> explicit userData-derived env
  -> same Next.js routes / services
```

浏览器只拥有 origin 级偏好和最终下载位置；SQLite、图片、设置、日志及凭据文件属于服务器运行时。Electron 只在桌面批次拥有系统目录和原生能力。

## 1.3 七维现状诊断

### 1.3.1 goals-duty

现有模块职责基本清楚：DB 管理业务持久化，storage 管理媒体，user-config 管理加密凭据，settings 管理非敏感偏好，desktop-shell 管理系统目录。缺口是“运行时路径默认值与平台策略”没有独立所有者，导致各模块被迫重复承担同一职责（P1）。

### 1.3.2 architecture

现有结构是单仓库 Next.js 单体，Electron 采用薄壳并通过环境变量注入路径。这个依赖方向合理：`electron -> Next Runtime`，而非业务模块导入 Electron。

当前问题属于横切配置重复，而不是需要新服务或插件框架。新增一个纯解析核心和窄 facade 足以隐藏平台路径决策；引入 DI 容器、平台 adapter 类层级或 `dev:win` 都会增加偶然复杂度。

### 1.3.3 data-model

本批不修改 SQLite schema、API DTO 或 storage marker 格式。唯一与数据身份相关的现状是 `src/lib/storage/ownership.ts` 将 canonical DB path 哈希写入 `.open-image-storage.json`。因此“同一启动链路解析出同一路径”是数据安全前置条件，而不只是开发体验。

### 1.3.4 dfd-interface

当前环境数据流为：

```text
shell/process env ---------------------> migrate-db.mjs
        |
        +---- Next.js loads .env* ----> db/storage/config/log modules
        |
        +-----------------------------> drizzle.config.ts
```

三条路径没有共享环境加载和解析截面（P1、P2）。此外大多数消费者直接读取 `process.env`，使依赖隐式且难以做跨平台纯测试。

### 1.3.5 use-case

关键用例“全新 Windows checkout -> 配置 key -> `npm run dev` -> 打开浏览器 -> 重启仍看到相同数据”目前缺少 Windows 文档和端到端启动证据。

既有图片下载和项目 ZIP 导出已经使用浏览器下载语义，不需要原生文件选择；这与用户确认的 Web/桌面边界一致。

### 1.3.6 non-functional

- **正确性**：迁移与运行时路径分叉是最高风险。
- **可靠性**：开发数据不能因平台适配被移动、覆盖或指向另一数据库。
- **安全**：storage 越界防护和所有权 marker 必须保持；浏览器不能获得绝对路径；CI 不得使用真实 key。
- **可维护性**：路径策略必须单一权威，消费者只获取解析结果。
- **可诊断性**：启动错误应标明资源类别、路径和 errno，但安全日志继续避免泄漏 key、Prompt、签名 URL。
- **兼容性**：Windows 不伪装 POSIX 权限保证；macOS/Linux 现有 mode 与 Electron userData 映射不回退。

### 1.3.7 test

现有测试层次和目录可继续使用，无需建立第二套测试体系。真实风险应分布在：纯解析 Unit、真实临时文件系统 Integration、启动/迁移 Smoke、Edge/Chrome 人工验收。没有证据支持本批引入 Playwright 或真实 Provider CI。

## 1.4 文档与实现对照

| 文档约束 | 当前代码 | Gap |
| --- | --- | --- |
| `docs/mvp/storage/dfd-interface.md`：storage path 相对根目录并 canonicalize | `src/lib/storage/index.ts#resolveStoragePath()` 已实现词法边界 | 缺少 Windows 盘符/UNC 明确测试 |
| `docs/mvp/user-config/architecture.md`：默认 `~/.config/...`、0700/0600 | `paths.ts`、`store.ts` 与文档一致 | 文档和代码都尚未表达 Windows production/权限语义 |
| `docs/mvp/settings/*`：Web 下载由浏览器管理 | image/ZIP 路由与 Web 下载 helper 已实现 | 只需 Windows 浏览器回归，不应引入原生选择器 |
| `docs/mvp/desktop-shell/architecture.md`：Electron 显式 userData 路径，Next 不依赖 Electron | `electron/runtime/environment.ts` 已实现 | 共享解析改造必须证明显式覆盖不回退 |
| `docs/test-blueprint.md`：CI 尚未配置 | 仓库没有 `.github/workflows` | 缺少 Windows x64 持续门禁 |
| README：本机浏览器访问 localhost | `dev` 未固定 hostname，Windows onboarding 缺失 | origin 与启动要求尚未成为可执行契约 |

## 1.5 改动影响面（现状视角）

| 区域 | 影响原因 |
| --- | --- |
| `src/lib/db/` | 数据库路径及 ownership hash 依赖 canonical 路径 |
| `src/lib/storage/` | 图片根目录、路径边界与真实 Windows FS |
| `src/lib/user-config/`、`src/lib/app-settings/` | production 默认目录、chmod 和原子写入 |
| `src/lib/observability/` | 日志默认目录与 best-effort 语义 |
| `scripts/migrate-db.mjs`、`drizzle.config.ts` | 环境加载、模式、项目根和 DB 路径 |
| `package.json`、lockfile | 启动命令、`@next/env`、Windows smoke 命令 |
| `.env.example`、`README.md` | 默认路径与 PowerShell onboarding |
| `tests/`、co-located tests | Windows path/FS/startup 回归 |
| `.github/workflows/` | 新增 Windows x64 CI |
| `electron/`、desktop smoke | 不改功能，但需要显式覆盖回归 |

## 1.6 风险地图

| ID | 问题 | 严重性 | 投入产出 | 主要锚点 |
| --- | --- | --- | --- | --- |
| P1 | 路径知识多份副本 | 架构级 | 战略投资 | `db/client.ts`、`storage/index.ts`、`migrate-db.mjs` |
| P2 | predev 与 Next env 分叉 | 架构级 | 低垂果实 | `package.json`、`migrate-db.mjs` |
| P3 | Unix 默认和权限断言 | 设计级 | 低垂果实 | `user-config/paths.ts`、两个 store |
| P4 | Windows 路径契约缺失 | 设计级 | 战略投资 | DB parser、storage resolver |
| P5 | Windows onboarding/origin 未冻结 | 设计级 | 低垂果实 | `package.json`、`README.md`、Web storage 使用点 |
| P6 | 无 Windows x64 CI | 工程实践级 | 战略投资 | `docs/test-blueprint.md`、缺失的 workflow |
| P7 | Electron 显式映射可能回退 | 设计级 | 低垂果实 | `electron/runtime/environment.ts`、desktop smoke |

## 1.7 SWE 原则审视摘要

- **单一知识来源（DRY）**：路径默认值代表同一部署知识，当前六处复制会真实分叉，应收口（P1）。
- **信息隐藏**：平台、模式、项目根和 file URL 解析应藏在路径模块中，DB/storage 等消费者不应了解这些细节。
- **显式胜过隐式**：迁移模式和项目根必须显式传递，不能依赖 `predev` 是否恰好设置 `NODE_ENV`（P2）。
- **KISS/YAGNI**：只新增纯解析核心与必要 facade；不为后续 Electron、Linux、网络盘建立插件框架，不在没有复现前加入文件锁重试。
- **测试是设计探针**：解析函数接受显式输入，说明平台决策已经从全局 `process.env` 中解耦，能在任意 CI 主机验证 win32 矩阵。

## 1.8 与既有文档的关系

- 本文扩展而不取代 `docs/mvp/db/`、`storage/`、`user-config/`、`settings/` 的业务职责。
- `docs/mvp/user-config/architecture.md` 和 `non-functional.md` 中无条件 Unix 路径/mode 表述在实施时需要补充平台条件。
- `docs/mvp/desktop-shell/*` 仍是 macOS Electron 权威设计；本批不得把它泛化成 Windows 桌面架构。
- `docs/test-blueprint.md` 继续是测试分类权威；本批只增加 Windows CI 和对应场景。

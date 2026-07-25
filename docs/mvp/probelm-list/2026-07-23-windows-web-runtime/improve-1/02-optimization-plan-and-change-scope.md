# 2. 优化方案与改动面

> 本文是后续实施会话/开发者的执行契约。规划会话不据此修改实现代码。问题编号引用 `01-problem-analysis-and-current-state.md`。

## 2.1 方案总览

新增一个小型、server-only 的运行时路径域：纯 JavaScript 核心负责模式、环境覆盖、SQLite URL 和跨平台默认路径；TypeScript facade 供 Next Runtime 使用；迁移和 Drizzle 直接复用同一核心。文件系统预检与私有权限策略也收口在该域，但不把数据库、storage、配置或日志业务逻辑搬进去。

```text
@next/env / process env / explicit test input
                  |
                  v
        runtime-paths/core.js (pure)
                  |
        +---------+----------+-----------+
        |                    |           |
        v                    v           v
 migrate / drizzle     Next TS facade   pure tests
        |                    |
        v                    v
 SQLite migration      db/storage/config/log consumers

runtime-paths/preflight.js
  -> required: DB parent + images + config
  -> best effort: logs
  -> POSIX chmod; Windows inherited ACL
```

路径核心必须无文件系统写入、无模块级环境快照、无 Electron 依赖。这样 win32 规则可以在任意主机做纯测试，真实 Windows 文件系统行为再由 Windows integration/smoke 验证。

## 2.2 设计决策表

| 决策项 | 选择 | 对应问题 | 放弃的选项与理由 | 代价 |
| --- | --- | --- | --- | --- |
| 平台适配 | 单一 runtime path policy | P1、P3、P4 | 各模块各自 `if win32` 会继续漂移 | 新增一个共享底层域 |
| 核心格式 | ESM `.js` + JSDoc/`.d.ts`，TS facade | P1、P2 | 用 `tsx` 执行迁移会增加运行依赖；复制 TS/JS 两份逻辑会重现 P1 | 需要维护窄声明文件 |
| env loader | 直接依赖官方 `@next/env` | P2 | 手写 dotenv 顺序容易与 Next 漂移 | 增加一个 runtime dependency |
| 开发入口 | `next dev --hostname localhost` | P5 | `dev:win` 分叉；`127.0.0.1` 与 localhost 分裂 origin | 不提供局域网监听 |
| 开发路径 | `<projectRoot>/data/*` | 用户确认、P5 | Windows 开发直接写 `%LOCALAPPDATA%` 会隐藏/迁移现有数据 | production 与 development 默认不同 |
| Windows production | `%LOCALAPPDATA%/Open Image Generator/*` | P3 | `~/.config` 不符合 Windows 习惯；Roaming 不适合较大的本机图片 | 需定义 LOCALAPPDATA 缺失回退 |
| 网络路径 | 首批拒绝 UNC | P4 | SQLite/rename 在网络共享上的语义和可靠性不在当前需求内 | 不能直接把数据根放 NAS |
| 权限 | POSIX chmod；Windows 继承 ACL | P3 | 在 Windows 断言 0600/0700 是虚假保证；本批手写 ACL 复杂且无明确收益 | 浏览器 production 不提供 DPAPI |
| 文件锁重试 | 有稳定复现后再加 | P3、P4 | 预先 busy-wait 会隐藏真实错误并增加复杂度 | 杀毒软件瞬时占用仍可能显式失败 |
| 浏览器下载 | 保留浏览器管理 | P5 | File System Access API 是 Chromium 专属且越过 Web 边界 | 用户不能从 Web 设置页选任意目录 |
| 自动化 | 复用 Vitest 分层 + Windows CI | P6 | 新增 Playwright 与本批路径风险不成比例 | 浏览器关键流程仍需人工清单 |

以上均为内部、可逆决策；不改数据库 schema、公开 API 或已持久化格式，不构成数据层单向门。

## 2.3 Phase 1：建立路径与启动单一事实源

### 目标

先解决 P1、P2、P4，使迁移、Drizzle 和 Next Runtime 对相同输入得到相同路径；保持现有 `./data` 可直接复用。

### 新增

- `src/lib/runtime-paths/core.js`
  - 导出纯函数 `resolveRuntimeMode()`、`resolveRuntimePaths()`、`parseSqliteDatabasePath()`。
  - 所有相对路径以显式 `projectRoot` 解析。
  - 空字符串/纯空白环境变量按“未设置”处理。
  - 环境变量覆盖优先于模式默认。
  - 支持 `file:./...`、raw local path、Windows drive、规范 local file URL、中文/空格、反斜杠、`:memory:`。
  - 拒绝非 file scheme、UNC 和网络 file URL。
- `src/lib/runtime-paths/core.d.ts`
  - 为 JavaScript 核心提供窄、显式类型契约。
- `src/lib/runtime-paths/index.ts`
  - `import 'server-only'`；向 Next 代码提供 `getRuntimePaths()` 和必要 re-export。
  - 不缓存模块首次读取的 env，避免测试和受控启动覆盖失效。
- `src/lib/runtime-paths/preflight.js`、`preflight.d.ts`
  - 创建/验证 runtime 目录、独占写探针、清理探针。
  - 必需资源失败抛结构化 `RuntimePathError`；日志失败返回 warning。
  - 导出平台感知的私有目录/文件权限加固函数。

### 修改

- `package.json`
  - 将 `@next/env` 加为直接 dependency。
  - `predev` 显式 `--mode=development`；`prestart` 显式 `--mode=production`。
  - `dev` 固定 `--hostname localhost`。
  - `db:migrate` 保留手动入口；未传 mode 时安全默认 development。
  - 本批以用户指定的 npm 命令为唯一安装/运行契约。
- `package-lock.json`
  - 由 npm 更新并作为 Windows CI 权威 lockfile；`pnpm-lock.yaml` 不在本批机械同步，README 不把 pnpm 列为受支持的 Windows 安装路径。
- `scripts/migrate-db.mjs`
  - 从脚本路径确定 project root。
  - 解析 CLI mode，使用 `loadEnvConfig(projectRoot, mode === 'development')`。
  - 从共享核心取得 DB 与其他 runtime 路径；在迁移前执行预检。
  - 现有 migration lock、备份、schema 校验、JSON 输出保持不变。
- `drizzle.config.ts`
  - 通过 `@next/env` 加载 development 环境。
  - 从共享核心取得 development 数据库路径；`db:push` 不再单独 strip `file:`。

### 完成定义

- `npm run dev` 的迁移与 Next 连接同一 DB。
- 未设置覆盖变量时仍使用仓库 `data/app.db` 等路径。
- 从不同 shell 调用迁移时，相对路径仍以项目根解析。
- 04 中 U01–U08、S01–S04 通过。

## 2.4 Phase 2：迁移所有消费者与 Windows 文件语义

### 目标

解决 P1、P3、P4，不让业务模块继续拥有平台默认值，同时保留现有 storage 与原子写安全边界。

### 修改

- `src/lib/db/client.ts`
  - `getDatabasePath()` 委托 `getRuntimePaths().databasePath`。
  - `getDatabasePathHash()` 继续哈希 canonical 结果；DB pragma 不变。
- `src/lib/storage/index.ts`
  - `getStorageRoot()` 委托统一路径。
  - `resolveStoragePath()` 在现有 canonicalize 基础上显式拒绝绝对路径、盘符、UNC 和越界路径。
  - 图片命名、临时目录、magic bytes、大小限制和下载流程不改。
- `src/lib/user-config/paths.ts`
  - `getUserConfigDirectory()` 委托统一路径；凭据文件名不变。
- `src/lib/user-config/store.ts`
  - 使用平台感知权限 helper；加密 envelope、scrypt、AES-GCM 和原子 rename 不变。
- `src/lib/app-settings/store.ts`
  - 使用相同权限 helper；设置 schema 和损坏回退不变。
- `src/lib/observability/local-log-sink.ts`
  - 默认日志目录委托统一路径；options.directory 仍最高优先。
  - 轮转、大小上限和 best-effort 返回值不变。
- `src/lib/storage/ownership.ts`
  - 仅按统一 canonical DB path 继续配对 marker；不改 marker schema。
- `docs/mvp/user-config/architecture.md`、`non-functional.md`、`test.md`
  - 把 Unix-only 默认和 mode 断言改为平台条件表述。

### 错误契约

- 启动预检错误包含 `resource`、`path`、`code` 和安全处理建议，输出到本机启动 stderr。
- 不把绝对路径加入持久化 safe logger、API DTO 或浏览器响应。
- DB parent、images、config 不可创建/写入时失败；logs 不可用时 warning 后继续。

### 完成定义

- 六个旧默认值位置都不再自行决定平台路径。
- Windows 实际临时目录中的 DB、图片、设置、凭据和日志行为符合 04 的 I01–I06。
- 04 中 U09–U10 通过。
- 现有 storage ownership、原子写、日志 best-effort 测试不回退。

## 2.5 Phase 3：Windows onboarding 与浏览器边界

### 目标

解决 P5，使普通 Windows 开发者只看到一条明确启动路径，并说明浏览器状态和服务端数据的区别。

### 修改

- `.env.example`
  - `DATABASE_URL`、`LOCAL_STORAGE_DIR`、`USER_CONFIG_DIR`、`APP_LOG_DIR` 改为注释的可选覆盖示例。
  - 默认情况下不再用空值或显式相对值遮蔽 runtime policy。
  - Provider key 和其他运行参数保持示例用途。
- `README.md`
  - 推荐 Node.js 24 LTS x64。
  - 增加 PowerShell：`Copy-Item .env.example .env.local`、`npm ci`、`npm run dev`。
  - 固定访问 `http://localhost:3000`。
  - 列明 development `./data` 四类路径和 Windows production 未来路径。
  - 说明 Edge/Chrome 不共享 localStorage，但共享服务端数据；清理浏览器数据不会删除 `./data`。
  - 说明 Web 下载由浏览器管理。
- `docs/test-blueprint.md`
  - 将“CI 尚未配置”更新为 Windows x64 workflow 已建立后的真实状态；不改变测试分类。

### 完成定义

- 全新 Windows 开发者无需 Unix 命令或手工设置存储路径即可启动。
- 文档中不混用 `localhost` 与 `127.0.0.1` 作为 Web 开发入口。
- 04 中 C01–C04 通过，普通 Web 环境不获得桌面原生能力。
- 04 的 M01–M07 可由不了解实现的测试者执行。

## 2.6 Phase 4：测试与 Windows x64 CI

### 目标

解决 P6、P7，让路径和启动行为在真实 Windows x64 runner 上持续验证，并防止 macOS Electron 显式映射回退。

### 新增

- `src/lib/runtime-paths/core.unit.test.ts`
  - 纯函数平台/模式/覆盖/SQLite URL 矩阵。
- `tests/integration/windows-runtime-paths.integration.test.ts`
  - 在含中文与空格的 Windows 临时目录中串联预检、SQLite、storage、设置、凭据和日志；非 Windows 明确 skip 实际 ACL/路径行为部分。
- `tests/smoke/windows-dev-runtime.smoke.test.ts`
  - Windows 才运行；使用临时四路径和随机可用端口启动 `npm run dev`。
  - 使用 `npm.cmd`，轮询页面与 `/api/health`，验证迁移路径，可靠终止进程树。
- `.github/workflows/windows-x64.yml`
  - `windows-latest`、Node.js 24、npm cache、合理 timeout。
  - 执行 `npm ci`、`npm run typecheck`、`npm run test:verify`、`npm run build`、`npm run test:smoke:windows`。

### 修改

- `package.json`
  - 新增可本地复现的 `test:smoke:windows` 脚本。
- `tests/smoke/db-migrate.smoke.test.ts`、`tests/smoke/db-push.smoke.test.ts`
  - 覆盖 `.env.local`/显式 mode 与共享路径解析；保持真实迁移和 Drizzle 行为。
- `src/lib/user-config/user-config.unit.test.ts` 及 app-settings 相关测试
  - POSIX 只断言精确 mode；Windows 断言行为和内容，不伪装 ACL 证明。
- `src/lib/storage/index.unit.test.ts`、`ownership.unit.test.ts`
  - 增加 Windows drive/UNC/越界和 DB/storage 配对矩阵。
- `electron/runtime/environment.unit.test.ts`、`scripts/smoke-desktop-runtime.mjs`
  - 证明四个显式 userData 路径仍优先，仓库 `.env*` 不重新注入桌面 Provider key。

### CI 约束

- 不注入真实 Provider key，不调用厂商服务。
- CI 产生的数据只位于 runner temp 或仓库被忽略的测试目录，并在结束时清理。
- startup smoke 必须有超时和 finally 清理；不得留下后台 Next/npm/Node 进程。
- workflow 失败阻断合入，不用自动重试掩盖 flaky。

### 完成定义

- 04 的 U、I、S、C 类自动化项全部通过。
- Edge/Chrome 人工验收完成。
- macOS/Linux 现有 suite 与 desktop smoke 不回退。

## 2.7 按包/目录的改动面

| 路径 | 新增 | 修改 | 删除 | 说明 |
| --- | --- | --- | --- | --- |
| `src/lib/runtime-paths/` | core、声明、facade、preflight、unit tests | — | 无 | 新的路径与 FS policy 权威源 |
| `src/lib/db/` | — | `client.ts` 与相关 tests | 无 | 委托路径解析 |
| `src/lib/storage/` | — | `index.ts`、ownership/tests | 无 | 保持业务，强化 Windows 边界 |
| `src/lib/user-config/` | — | paths/store/tests | 无 | Windows production 与权限分支 |
| `src/lib/app-settings/` | — | store/tests | 无 | 平台权限 helper |
| `src/lib/observability/` | — | local log sink/tests | 无 | 统一日志路径 |
| `scripts/` | — | migration、desktop smoke（仅回归） | 无 | env/路径闭环 |
| 根配置 | — | package、lock、Drizzle、env example、README | 无 | 启动和 onboarding |
| `tests/` | Windows integration/smoke | 既有 DB smoke/helpers | 无 | 真实 Windows 风险 |
| `.github/workflows/` | Windows x64 workflow | — | 无 | 新质量门禁 |
| `electron/` | — | 最多仅测试 | 无 | 不实现 Windows Electron |
| `docs/mvp/` | 本 problem-list | 相关权威模块文档、test blueprint | 无 | 保持文档与实现一致 |

## 2.8 兼容、数据与回滚

### 兼容

- 开发默认仍是仓库 `./data`；不得创建数据迁移步骤。
- 四个环境变量仍最高优先，空白值按未设置处理。
- DB schema、marker schema、设置格式、凭据 envelope、API DTO 均不变。
- Electron 显式绝对路径仍高于 production 默认。

### 回滚

- 实现以内部 facade 为边界，回滚时可以恢复旧消费者而不转换数据。
- CI workflow 可独立禁用，但测试失败应先判定实现还是环境问题，不能把删除门禁当默认修复。
- 若 production 默认路径发现问题，由于本批不发布 Windows Electron、不迁移数据，可在后续批次调整而无用户数据搬迁成本。

## 2.9 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| `.env*` 加载把仓库 key 带入 Electron | process env 优先；desktop 显式清空 Provider key；回归测试 |
| JavaScript 核心在 Next/Drizzle/迁移三处解析方式不同 | 同一导出 + 声明文件；测试直接比较结果 |
| Windows startup smoke 留后台进程 | 随机端口、超时、finally、进程树终止和端口复查 |
| 空环境变量解析到项目根 | normalize env helper 把空白视为 absent；unit test |
| Windows AV 暂时锁定 rename | 首批显式错误；只有稳定复现后增加有界重试 |
| 路径错误泄漏到 API/日志 | 详细路径只进入本机 startup stderr；safe logger/DTO 回归 |
| workflow 重复 build 造成过慢 | 独立 Windows smoke 只验证启动；build 只执行一次 |

## 2.10 与 00 边界对齐

- development 数据仍在 `./data`：是。
- Windows production 使用 `%LOCALAPPDATA%`：是，仅解析/测试。
- x64、Edge/Chrome 优先：是。
- Electron、`.exe`、签名、DPAPI 不在本批：是。
- UNC、Playwright、真实 Provider CI 不在本批：是。

## 2.11 不在本批

Windows Electron 主进程、NSIS、安装/卸载、代码签名、SmartScreen、DPAPI、自动更新、x86/ARM64、UNC、开发数据迁移、浏览器 E2E、真实 Provider 测试以及对 `docs/mvp/probelm-list` 的拼写整理均不实施。

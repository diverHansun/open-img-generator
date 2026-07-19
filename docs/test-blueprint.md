# 项目测试规则

> 适用范围：AI Image Generator MVP
> 最后确认：2026-07-18
> 目标：让测试准确表达风险边界；快速测试保持快，跨组件测试保持真实，外部厂商与浏览器自动化不抢占 MVP 开发节奏。

---

## 1. 测试分层

项目使用五类测试。每个测试文件只属于其中一类，并使用对应后缀。

| 类型 | 后缀 | 回答的问题 | 当前状态 |
| --- | --- | --- | --- |
| Unit | `.unit.test.ts` | 单个模块的局部逻辑是否正确？ | 已实施 |
| Contract | `.contract.test.ts` | HTTP API 的输入、输出和错误形态是否稳定？ | 已实施 |
| Integration | `.integration.test.ts` | 路由、任务引擎、数据库、存储协作时是否正确？ | 已实施，逐步迁移到 MSW |
| Backend E2E | `.e2e.test.ts` | 真实 Next HTTP 服务的关键路径是否可用？ | 后续按需实施 |
| Smoke | `.smoke.test.ts` | 构建、迁移、启动等部署前提是否可用？ | 已实施 |

浏览器 E2E 不属于当前自动化范围。重要界面通过人工验收；当交互稳定且收益足够时，再单独评估是否引入浏览器脚本。

### 1.1 Unit

- 测试与源码同目录（co-located）。
- 不访问真实网络、外部 API、外部进程或真实生产目录。
- 允许使用 typed fake、stub，或**内存 SQLite**验证单个 query/repository 的局部逻辑；这种情况仍属于 component unit，而不是 integration。
- Provider adapter 的请求拼装、响应解析可使用 typed `fetch` stub，避免将每一个纯适配器测试升级为网络集成测试。
- 应聚焦可定位的行为，整体目标小于 30 秒。

### 1.2 Contract

- 直接执行 route handler，验证状态码、JSON DTO、校验错误与消费者可见的语义。
- 可以用 fake job engine/provider 替换路由下方不属于本次契约的依赖；route handler 和请求构造保持真实。
- 重点覆盖生成提交、Generation detail 轮询边界、只读 list、Projects/Sessions、Favorites、Models、Providers、Health 等公开 API。

### 1.3 Integration

- 至少两个真实组件协作，典型组合为 route + job engine + Drizzle/SQLite + local storage。
- 数据库使用 `createIntegrationDb()` 创建的临时 SQLite 文件；存储使用 `createStorageDir()` 创建的临时目录。
- 一切厂商 HTTP（fal、ZenMux、DashScope、Kling 等）使用 **MSW** 拦截。新的或被修改的 integration 测试不得再直接覆盖 `global.fetch`。
- 不调用真实 vendor API、不读取用户的真实 key、不依赖网络可用性。
- 现有直接 `fetch` mock 的 integration 测试不做纯整理式大迁移；改到该文件时一并迁移为 MSW。

### 1.4 Backend E2E（后续）

- 通过真实的 Next 服务 HTTP 入口访问应用，不直接 import route handler。
- 厂商侧使用独立的本地 fake provider HTTP server，验证应用的 HTTP client、超时、重试/错误映射和完整运行时配置。
- 不访问真实 vendor API；不会因为缺少 `.env` key 而跳过核心 E2E。
- 当前只保留目录和 `test:e2e:backend` 命令约定，尚不添加空洞或“永远绿”的用例。

### 1.5 Smoke

- 验证 build、迁移、database push、健康检查等可部署前提。
- 不承担状态机和业务分支的深度验证。

---

## 2. 目录与命名

```text
src/
  ...
  feature.unit.test.ts                 # 单模块测试，紧邻源码

tests/
  contract/                            # HTTP contract
  integration/                         # 逐步按 domain 分目录
  e2e/
    backend/                           # 后续真实 Next HTTP E2E
  smoke/                               # build / migration / health
  helpers/                             # 临时 DB、storage、schema 等测试基础设施
  msw/                                 # MSW server、lifecycle、handlers
  factories.ts                         # 跨测试领域对象工厂
```

命名格式为 `<subject>.<type>.test.ts`，例如：

- `lifecycle.unit.test.ts`
- `generations-api.contract.test.ts`
- `sync-generation.integration.test.ts`
- `generation-flow.e2e.test.ts`
- `build.smoke.test.ts`

不为目录整洁进行批量移动。模块被实际改动时，再将与其相关的 integration/contract 测试迁到最贴近的 domain 目录。

测试名称描述用户可见或领域行为，而不是私有函数名，例如：

- `returns completed when a sync provider stores its image`
- `does not advance polling from a session generation list`
- `returns conflict when a second request owns the poll lease`

---

## 3. 依赖替换与数据隔离

| 测试类型 | 替换对象 | 必须真实执行的对象 |
| --- | --- | --- |
| Unit | 直接依赖；adapter 可 stub fetch | 被测模块 |
| Contract | 路由下游的非契约依赖可 fake | route handler、request/response DTO |
| Integration | 所有厂商 HTTP（MSW） | DB、storage、被组合的领域组件 |
| Backend E2E | vendor 改为 local fake HTTP server | Next server、HTTP client、DB/storage 配置 |
| Smoke | 尽量不替换 | build/migration/startup 前提 |

### 3.1 数据库与文件系统

- Unit 的内存 SQLite 仅用于单模块查询/仓储边界；不能借此跨越路由、任务引擎和 storage。
- Integration 及后续 Backend E2E 使用临时 SQLite 文件。每个测试文件创建自己的文件和初始 Project/Session 数据。
- `DATABASE_URL` 与 `LOCAL_STORAGE_DIR` 必须在 cleanup 时还原；临时文件/目录必须删除。
- 测试 schema 只维护在 `tests/helpers/db-schema.ts`，避免 unit 与 integration 的 raw SQL 逐步漂移。

### 3.2 HTTP 与凭据

- Integration 测试调用 `registerMswLifecycle()`，并通过 `server.use(...)` 声明每个测试所需的 vendor 响应。
- 未声明的外部请求应失败，避免测试在未察觉的情况下访问网络。
- CI 和默认本地测试均不使用真实厂商 key。未来如需 live check，必须是显式 opt-in、无凭据自动 skip 的独立命令，且不计入核心质量门禁。

### 3.3 Factory

跨领域默认数据集中维护在 `tests/factories.ts`。当前包括：

```ts
makeNormalizedRequest(overrides)
makeProviderImageRef(overrides)
makeJobHandle(overrides)
makeProviderCapabilities(overrides)
```

需要新增重复构造数据时，优先扩展 factory；一次性、贴近单个测试语义的数据可留在测试文件。工厂默认值应接近真实 DTO，但不得使用生产数据。

---

## 4. 编写规则

### 4.1 断言

- 使用 Vitest `expect`，断言输出、数据库状态、存储副作用和可见错误结构。
- 不以“没有抛错”、`toBeTruthy()` 或被测对象内部方法是否被调用作为主要断言。
- 错误路径至少断言 `code`、`message`、`retryable` 中对消费者承诺的字段。

### 4.2 状态与并发

对 Generation/job 的测试覆盖真实状态边界：

- `pending → running → completed`；
- `pending/running → failed`；
- cancel request 与最终状态；
- `GET /api/generations/:id` 是唯一允许推进 poll 的入口；Session/History 列表只读；
- 并发 GET 的 optimistic poll lease 只有一个赢家。

### 4.3 TDD 强度

以下变更要求先写失败测试，或与实现同一小步提交测试：

- job 状态机、fanout、poll lease、worker/cancel；
- API contract、权限/用户配置加密、输入校验；
- provider adapter 的请求转换、状态解析、失败映射；
- 图片存储、删除、生命周期清理。

纯 route forwarding、样式、文档、无业务语义的类型重命名无需机械执行 TDD，但改动后仍要运行相关测试。

### 4.4 禁止事项

- 默认测试调用真实厂商服务或泄漏 API key；
- 为方便测试给生产代码加入 test-only API；
- mock 被测对象自身；
- 用无类型万能 mock 掩盖 provider contract 错误；
- 共享可变 DB/storage 状态而不清理；
- 把跨模块测试伪装成 unit，或把纯逻辑堆进 integration。

---

## 5. 命令与质量门禁

```json
{
  "test": "vitest run",
  "test:unit": "vitest run .unit.test.ts",
  "test:contract": "vitest run .contract.test.ts",
  "test:integration": "vitest run .integration.test.ts",
  "test:e2e:backend": "vitest run .e2e.test.ts --passWithNoTests",
  "test:smoke": "vitest run .smoke.test.ts",
  "test:fast": "npm run test:unit && npm run test:contract",
  "preflight": "npm run typecheck && npm run test:fast",
  "test:verify": "npm run typecheck && npm run test:fast && npm run test:integration",
  "test:release": "npm run test:verify && npm run test:e2e:backend && npm run test:smoke"
}
```

CI 平台尚未配置；先将以下命令作为团队规则：

| 时机 | 命令 | 预期 |
| --- | --- | --- |
| 本地改动 | 相关测试文件或 `test:unit` | 修改前后快速反馈 |
| 提交前 | `npm run preflight` | typecheck + unit + contract 必须通过 |
| PR | `npm run test:verify` | 加上 integration，阻断合入 |
| 合并到主线 | `npm run test:verify && npm run build` | 验证可构建 |
| 发布前 | `npm run test:release` | 加 smoke 与未来 backend E2E |

目标时长：unit < 30s、contract < 60s、integration < 3min、backend E2E（启用后）< 5min、smoke < 5min。发现 flaky 测试后先隔离，再在一周内修复或删除；不得长期容忍随机失败。

---

## 6. 新测试自检清单

- [ ] 后缀、目录和分层是否匹配实际风险？
- [ ] 是否只在应该真实执行的边界使用 DB/storage/HTTP？
- [ ] Integration 是否使用 MSW，且无真实厂商请求？
- [ ] 临时 env、文件、目录是否恢复和清理？
- [ ] 断言是否覆盖结果和副作用，而非内部实现？
- [ ] 核心状态/契约/安全变更是否先有测试？
- [ ] 是否运行了与变更相称的命令？

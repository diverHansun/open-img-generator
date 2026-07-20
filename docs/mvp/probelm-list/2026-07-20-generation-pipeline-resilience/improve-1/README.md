# 图片生成链路鲁棒性改造 · improve-1

> 状态：实施中；Batch A–E 与 Batch F1 已完成并独立验证，Batch F2 端到端验收进行中
> 日期：2026-07-20
> 文档落点：`docs/mvp/probelm-list/2026-07-20-generation-pipeline-resilience/improve-1/`
> 触发事件：Generate 提交因运行中 SQLite schema 缺少 `generation_jobs.next_poll_at` 而返回 500；事务已回滚，Provider 未被调用。

## 1. 改造目标

本批面向现有图片生成纵向链路做棕场加固，覆盖浏览器提交、Next API、job-engine、SQLite 持久化、Provider adapter、后台推进、图片转存和错误反馈。目标不是让所有失败都“自动重试”，而是让每类失败具备明确且安全的行为：

1. 服务只有在数据库结构兼容时才报告 ready，避免请求进入后才暴露 schema drift。
2. 用户能区分参数、认证、配置、限流、服务暂不可用和结果未知等错误，并获得可执行的下一步。
3. 同一用户提交在响应丢失或重复请求时不会创建重复 Generation，也不会因浏览器盲目重试放大 Provider 费用。
4. 任务在进程重启、Provider 短暂故障、轮询失败和取消竞态后可以恢复，或进入明确、可诊断的终态；不允许永久无解释地停在 `pending`。
5. Provider submit、poll 与图片下载采用与副作用语义匹配的超时、重试和退避策略；不对结果不确定的非幂等提交做通用自动重试。
6. 单元、合同、集成、E2E/浏览器测试覆盖真实故障窗口；每个实施批次独立提交，并在最终验收前由子代理执行代码与契约复审。

## 2. 成功标准

| 维度 | 完成标准 |
|---|---|
| 当前故障恢复 | 旧 schema 数据库可以安全迁移；缺迁移时 readiness 明确失败，不能继续接受生成请求 |
| 数据一致性 | 相同 `clientRequestId` / Idempotency-Key 的重复或并发提交只对应一个 Generation |
| 副作用安全 | Provider 已接受但响应丢失时不盲目重投；系统保留可查询的结果未知/待恢复语义 |
| 崩溃恢复 | create、dispatch、handle 持久化、poll、cancel、图片转存等关键检查点均有确定恢复或补偿行为 |
| 瞬时故障 | 可安全重试的 poll/download/明确未受理请求使用有上限的退避与抖动；不可重试错误快速终结 |
| 用户体验 | Submit 与 Stage 使用稳定错误 code 的中英文文案和操作；不会只显示单一“提交失败” |
| 可观测性 | 日志可按 correlation/request/generation/job/provider/phase/attempt 串联，且不泄露密钥、Prompt 或签名 URL 查询参数 |
| 验证 | 相关 unit、contract、integration、E2E 与生产构建全部通过；子代理复审无未处理的阻断项 |

## 3. improve-1 范围

### 3.1 In scope

- `scripts/migrate-db.mjs`、DB schema 兼容检查、migration ledger/readiness 与启动前置条件。
- Generation 提交 API 的结构化错误、correlation ID、幂等键与兼容响应语义。
- Generation/Job 的不可变请求快照、dispatch phase、attempt、lease、next-attempt 与 stale-job 恢复边界。
- job-engine 的状态转换、提交/轮询/取消崩溃窗口、worker 公平性与拒绝静默 `Promise.allSettled` 失败。
- Provider HTTP 超时和错误分类一致性；按副作用安全性区分 submit、poll、cancel、download 重试策略。
- 图片返回值校验、下载边界、敏感 URL 脱敏、取消/租约失败后的文件与 image row 一致性。
- Generate Submit/Stage 的错误分类、结果未知恢复、轮询 deadline/退避、刷新恢复和中英文文案。
- 默认多模型 fan-out 与参数“共同能力/部分生效”语义的产品护栏复核。
- 与改动对应的权威 MVP 文档同步、分批 Git commit、自动化测试、浏览器 E2E 和子代理复审。

### 3.2 Out of scope

- 引入 Redis、BullMQ、Kafka、云消息队列或拆分微服务；本批优先在现有 Next.js + SQLite 模块化单体内建立持久化任务语义。
- 新增 Provider、新模型、图生图/视频等业务能力，或改变现有 Provider catalog。
- 与生成链路无关的页面视觉、Gallery 布局、locale switcher 样式和通用 CSS 重构。
- 多用户、组织、计费系统、云端部署拓扑和分布式多区域容灾。
- 追求抽象的“恰好一次”远端调用保证；Provider 不支持幂等时，只承诺本地去重、结果未知可见和不盲重试。
- 将所有错误都改为自动重试，或以无限队列、无限 attempt 掩盖真实故障。

## 4. 规划基线与架构约束

1. 保持现有模块化单体和 Provider adapter 边界，不为当前规模预付外部队列运维复杂度。
2. SQLite 继续作为 Generation/Job 状态的唯一事实来源；浏览器内存状态和进程内计数器不能承担恢复依据。
3. 先持久化可恢复意图，再执行外部副作用；但 Provider 是否支持提交幂等必须逐家明确，不能假设。
4. API 幂等、Provider dispatch 幂等和图片写入幂等是三个不同边界，分别设计、分别测试。
5. liveness 与 readiness 语义分开：数据库可连接不等于 schema 可服务。
6. 重试必须同时具备错误分类、幂等前提、最大 attempt/时间预算、指数退避和 jitter；缺少任一前提时宁可暴露明确状态。
7. 每次改动优先缩小故障窗口和反馈周期，不引入事件溯源、CQRS、通用工作流引擎或预测性抽象。

上述约束将在 `02-optimization-plan-and-change-scope.md` 中给出候选方案、取舍、兼容与回滚细节；README 只冻结方向和边界。

## 5. 实施批次

| 批次 | 主题 | 独立提交与验证目标 | 状态 |
|---|---|---|---|
| A | 数据库恢复与 readiness | 迁移旧库、schema preflight、健康契约与迁移回归测试 | 已完成（`e12bf09`） |
| B | 结构化错误与前端可行动反馈 | API error envelope、correlation ID、i18n 分类和提交错误测试 | 已完成（`311f01e`） |
| C | 幂等接纳 | clientRequestId、payload hash、唯一约束与重复/并发提交测试 | 已完成 |
| D | 持久化 lifecycle | 请求/结果快照、dispatch/poll/store/cancel phase、状态单调、worker、崩溃恢复与 poll/cancel 有界 retry | 已完成（D1/D2） |
| E | Provider 与 storage 韧性 | 副作用感知重试、队列上限、远端图片安全、脱敏与副作用补偿 | 已完成（E1/E2/E3） |
| F | 前端与端到端收口 | Generate/Stage 恢复、成本护栏、unit/integration/E2E/build、文档对齐和子代理复审 | F1 已完成；F2 进行中 |

具体提交边界以 `02` 为准；若某批无法保持可独立验证，应继续拆小，而不是把多种风险混入一个提交。

## 6. 文档地图与阅读顺序

| 顺序 | 文档 | 职责 | 当前状态 |
|---|---|---|---|
| 1 | `README.md` | 目标、范围、架构护栏、批次和实施交接 | 已确认 |
| 2 | `00-discussion.md` | 当前对话中已确认的事实、决策、边界和待确认项 | 已完成 |
| 3 | `01-problem-analysis-and-current-state.md` | 七维现状诊断、故障链、代码锚点、已有保护与风险地图 | 已完成 |
| 4 | `02-optimization-plan-and-change-scope.md` | 分阶段执行契约、文件/API/schema 改动面、兼容、迁移与回滚 | 已完成 |
| 5 | `04-test-and-acceptance.md` | 测试矩阵、故障注入场景、执行命令、验收和子代理审查门禁 | 已完成 |

本批暂不创建 `03-reference-projects.md`：当前结论来自本仓库故障证据与通用韧性约束，没有指定需要照搬的外部项目。后续若引入经确认的参考实现，再补该可选文档并更新本索引。

## 7. 与既有文档和工作树的关系

- `docs/mvp/job-engine/`、`docs/mvp/providers/`、`docs/mvp/db/`、`docs/mvp/api/`、`docs/mvp/web-client/` 与 Generate 页面文档仍描述当前/既定运行时，是本计划必须核对的权威来源。
- 现有 `docs/mvp/job-engine/architecture.md` 明确写有“不重试”和未持久化完整运行参数；若 improve-1 改变这些事实，实施批次必须同步更新，不允许只改代码。
- 本 problem-list 在实施前是改造契约，不静默覆盖既有权威文档；代码落地并通过 `04` 后，再把已实施行为回写到对应模块文档。
- 当前工作树已有 Gallery 紧凑筛选和无卡片语言切换等未提交修改。它们不属于本计划，实施与分批 commit 必须保持隔离，不能混入生成链路提交。

## 8. 规划、实施与验收闸门

1. 规划阶段已按 `README → 00 → 01 → 02 → 04` 顺序完成；用户已授权连续完成全部文档，下一阶段从 Batch A 开始实施。
2. `02` 是实施改动边界，`04` 是测试与验收门槛；规划文档本身不等于代码已修复。
3. 实施阶段按批次逐项修复，每批先做针对性测试，再形成单一逻辑目的的原子 commit。
4. 最终必须执行项目约定的 unit、contract、integration、E2E/smoke、typecheck 与 production build；真实 Provider 付费调用不作为默认自动化测试。
5. 子代理只做只读审查与发现反馈，主代理负责消歧、修复、验证和最终交付判断。
6. 完成后重新以 `plan-code-improvement` 验收模式对照 `02`/`04` 检查实施对齐；自检和子代理 transcript 不写入仓库。

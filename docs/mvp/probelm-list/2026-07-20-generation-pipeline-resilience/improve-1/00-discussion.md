# 讨论记录与已确认要点

> 2026-07-20 基于当前会话确认。正式现状诊断、实施契约和验收标准见本目录的 `01`、`02`、`04`。

## 1. 背景与动机

用户在 Generate 页面提交图片生成时看到红色提示：

> 提交失败，输入和上一项当前任务均已保留。

用户要求先详细分析，再系统优化图片生成链路的鲁棒性，而不是只替换提示文案。随后明确指定使用 `plan-code-improvement`，把问题文档放在 `docs/mvp/probelm-list/` 下；文档完成后逐个修复、分批 commit，最后执行单元、集成和 E2E 测试，并调用子代理审查。

本批将该事件视为一次纵向链路故障信号：直接修复 schema drift 只是恢复可用性的第一步，实施还要处理提交结果不确定、重复副作用、崩溃恢复、瞬时 Provider 故障和前端可行动反馈。

## 2. 已确认：本次故障事实

| 事实 | 已确认结论 |
|---|---|
| 失败位置 | `POST /api/generations` 在 `createGenerationWithJobs()` 的 SQLite 事务内失败 |
| 直接错误 | 运行库 `generation_jobs` 缺少代码要写入的 `next_poll_at`；同时也缺少 `cancel_requested_at` |
| 数据影响 | generation 与 jobs 创建位于同一事务，失败后完整回滚；检查时 `generations`、`generation_jobs`、`images` 均为 0 |
| Provider 影响 | 事务在 dispatch 前失败，fal/ZenMux 均未收到请求，没有本次 Provider 调用或费用 |
| 健康检查 | `/api/health` 只验证 `SELECT 1`，旧 schema 仍返回 200 与 `db: ok`，属于 readiness 假阳性 |
| 迁移能力 | 现有 `scripts/migrate-db.mjs` 已包含补列逻辑；在当前数据库副本上执行后字段齐全且 foreign-key check 通过 |
| 前端提示来源 | Generate submit 的无参 `catch` 丢弃了 `ApiClientError` 的 status/code/retryable/message，统一显示 `generate.submitError` |
| 当前运行状态 | 在实时库完成迁移或兼容修复前，继续提交仍会命中相同 500 |

## 3. 已确认：改造目标与质量属性排序

### 3.1 目标

1. 先恢复当前数据库和生成主路径，并防止未迁移服务被错误标记为 ready。
2. 建立重复提交不重复建单的本地幂等边界，优先防止不可见任务和重复 Provider 费用。
3. 让 Generation/Job 的关键中间状态可持久化、可重启恢复、可诊断，不依赖浏览器页面或单进程内存续命。
4. 按副作用安全性处理重试：安全读取和下载可有界重试；结果不确定的 Provider submit 不盲重试。
5. 把稳定错误 code 映射成中英文文案和明确动作，同时保留服务端详细诊断与 correlation ID。
6. 以自动化故障场景证明恢复行为，而不是只验证 happy path。

### 3.2 质量属性默认排序

| 顺序 | 质量属性 | 本批解释 |
|---|---|---|
| 1 | 正确性与副作用安全 | 不重复建单、不盲目重复 Provider 调用、不伪造成功 |
| 2 | 可恢复性 | 进程崩溃或瞬时故障后有确定恢复/终结路径 |
| 3 | 可诊断性 | 用户、开发者能区分失败阶段并关联日志 |
| 4 | 可维护性 | 错误、重试、状态转换策略集中且可测试，不散落在每个 adapter/UI 分支 |
| 5 | 响应速度 | 接纳后尽快返回任务标识，但不能用丢失一致性保证换取表面速度 |
| 6 | 扩展性 | 仅为当前七家 Provider 和单机 SQLite 所需扩展买单，不预建分布式平台 |

## 4. 已确认：架构与实现边界

| 决策项 | improve-1 结论 |
|---|---|
| 系统形态 | 保持 Next.js + SQLite 模块化单体，不引入 Redis/外部消息队列或拆微服务 |
| 状态事实来源 | SQLite 持久化状态为恢复依据；React state、URL 和进程内 limiter 只承担交互/运行时职责 |
| 接纳幂等 | 浏览器生成稳定 `clientRequestId` 或 Idempotency-Key，服务端以唯一约束保证同键只对应一个 Generation |
| 请求快照 | 为可恢复 dispatch 持久化不可变、经过校验的请求快照；不能只保存 prompt/provider/model 后假装可以重投 |
| Provider submit | 逐 Provider 明确幂等能力；不支持时必须表达“结果未知/需对账”，不能通用自动重试 |
| Poll/download | 只对 retryable 瞬时故障使用有界指数退避、jitter、Retry-After 和最大时间/attempt |
| 任务状态 | 终态不可逆；中间状态必须区分接纳、待派发、派发中、远端运行、转存、取消与结果未知等真实阶段，具体名称由 `02` 冻结 |
| 健康语义 | liveness 与 readiness 分开；数据库可连接不代表 schema 可服务 |
| 错误契约 | 生成相关 API 统一结构化错误，至少包含稳定 code、retryable 和 correlation/request 标识；500 仍必须写安全日志 |
| 前端恢复 | 已知 generation 的 Stage 不应依赖 Compose 的 Session/Provider/Preference 全部加载成功才能恢复 |
| 敏感信息 | 日志、API、持久化 job error、UI 不输出 API key、完整 Prompt 或签名 URL query |
| 复杂度护栏 | 不引入 CQRS、事件溯源、通用工作流引擎、预测性 adapter 抽象或“恰好一次”营销式承诺 |

## 5. 已确认：本批范围

### 5.1 In scope

- DB migration、schema version/compatibility、启动前置与 readiness。
- Generation POST 的幂等、错误契约、持久化 dispatch 和恢复语义。
- job-engine submit/poll/cancel/storage 状态机、lease、attempt 与 worker 扫描。
- Provider HTTP timeout/error/retryability 一致性及提交结果不确定边界。
- 图片响应/下载安全边界、转存幂等与失败补偿。
- Generate 前端错误分类、轮询 deadline/退避、刷新与结果未知恢复。
- 默认多 Provider fan-out 的费用提示，以及 Seed 等参数共同能力/部分生效语义复核。
- 相关 MVP 权威文档、分批 commit、完整测试和子代理审查。

### 5.2 Out of scope

| 项 | 本批不做 |
|---|---|
| 外部任务基础设施 | Redis/BullMQ/Kafka/云队列、独立 worker 服务或微服务拆分 |
| 新业务能力 | 新 Provider、新模型、图生图、视频或高级参数扩展 |
| 非生成 UI | Gallery/locale switcher 等已有视觉改动不混入本批 |
| SaaS 能力 | 多用户、组织、付费结算、云端部署拓扑、多区域容灾 |
| 自动真实付费测试 | 自动化只使用 fake/mock Provider；真实 Provider 验证必须显式授权并受控 |
| 无限恢复 | 无界重试、无界队列、永不终结的 pending 或无法证明的远端 exactly-once |

## 6. 已确认：交付与批次

1. 文档放在 `docs/mvp/probelm-list/2026-07-20-generation-pipeline-resilience/improve-1/`；`probelm-list` 按用户指定拼写保留。
2. 规划文档按 `README → 00 → 01 → 02 → 04` 完成；当前用户已要求连续完成全部文档。
3. 实施按数据库/readiness、错误契约、幂等 dispatch、生命周期韧性、E2E 收口分批；每批形成可独立理解、可独立验证的 commit。
4. 每个代码批次先跑与风险直接相关的测试；最终再跑 unit、contract、integration、E2E/smoke、typecheck 和 production build。
5. 实施完成后调用多个只读子代理分别审查后端生命周期、前端恢复/错误语义、Provider/storage 安全和文档/测试对齐；主代理负责修复反馈并再次验证。
6. 最终重新进入 `plan-code-improvement` 验收模式，对照 `02` 与 `04` 检查完成度。

## 7. 与既有文档和工作树的关系

- `docs/mvp/job-engine/architecture.md` 当前明确“不重试”且承认未持久化完整运行参数；实施若改变事实，必须同步更新。
- `docs/mvp/api/constraints.md`、`docs/mvp/db/data-model.md`、`docs/mvp/providers/*`、`docs/mvp/web-client/*` 与 Generate 页面数据/状态文档均需在 `02` 列出改动面。
- 本 problem-list 在实施前是改造契约；代码完成并通过验收后，关联模块文档才更新为新的运行时权威事实。
- 当前工作树中的 Gallery 紧凑筛选、无卡片语言切换及其文档修改属于前一批 UI 工作，必须保留且与生成链路 commit 隔离。

## 8. 待 `02` 冻结的实施选择

以下不是范围悬而未决，而是需要在方案文档中给出候选、代价和推荐后再冻结的实现细节：

1. 生成接纳成功使用 `201` 还是 `202`，以及重复 Idempotency-Key 的响应码/响应体。
2. schema compatibility 采用 `PRAGMA user_version`、迁移表还是显式 required-schema manifest，以及 dev/prod 自动迁移边界。
3. Generation 与 Job 新增字段、状态名称、lease 所有权和 request snapshot 的序列化格式。
4. fal、ZenMux、SiliconFlow、Zhipu、Doubao、Qwen、Kling 各自的 submit 幂等能力及结果未知策略。
5. poll、cancel、download 的默认 timeout、retry budget、最大 elapsed time 与 jitter 参数。
6. cancel 是先写本地终态再尽力远端取消，还是使用可恢复 cancelling phase。
7. 默认模型选择是“明确选择一个”还是“默认选择零个”，以及多模型预计调用数/费用提示形式。
8. Seed 等仅部分 Provider 支持的参数改为能力交集，还是保留部分生效但必须明确提示。

## 9. 用户确认记录

- 用户要求：“在生成时出现这样的提示，如图，详细分析后来优化图片生成链路的‘鲁棒性’”。
- 用户指定：使用 `plan-code-improvement`，问题放入 `docs/mvp/probelm-list/`。
- 用户明确交付顺序：“先落文档，然后来逐个修复，分批次commit”。
- 用户明确验证要求：“完成后进行单元测试/集成测试/e2e测试，同时调用子代理进行审查”。
- 用户在 README 闸门后继续要求：“继续完成全部文档然后来开始实施代码”，视为 README 范围已确认，并授权连续推进剩余规划文档。

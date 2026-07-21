# 2. 优化方案与改动面

> 本文件是后续实施会话的执行契约；本规划会话不据此修改业务代码。

## 2.1 方案总览

保持“单实例 Node.js + SQLite durable admission + 同进程 worker”的架构。取消本地 Provider semaphore 和用户可见 target 数量上限；将 Provider 明确限流转为持久化等待。为 History 增加 Generation 级删除，并以内部 phase 作为删除竞态的唯一裁决者。

```text
POST generation
  -> durable Generation + arbitrary unique targets
  -> single in-process worker drains due jobs by internal pages
  -> Provider submit directly (no local per-provider queue)
       |- accepted/async queued -> existing poll flow
       |- explicit retryable rate limit -> queued + pending + nextPollAt -> wait/retry until cancel
       |- timeout/5xx/unknown -> outcome_unknown; never replay

automatic retention / DELETE one image
  -> improve-3 removes managed bytes and keeps image tombstone
  -> Generation/Job/Prompt/Provider error remain in History

explicit History DELETE generation
  -> job-engine checks internal phase
  -> DB transaction captures only non-null/live storage paths
  -> hard-delete Generation aggregate, including image tombstones/favorites
  -> commit
  -> best-effort live file/staging cleanup + UI refresh
  -> user-downloaded external copies are outside app ownership and remain
```

## 2.2 设计决策

| 决策项 | 选择 | 理由 | 放弃的选项 / 代价 |
|---|---|---|---|
| worker 形态 | 单个常驻 in-process worker，生产设置 `JOB_WORKER_ENABLED=true` | 符合单实例、单用户约束，保留已有 lease/durable 状态机。 | 不引入 Celery/Redis；进程关闭期间任务暂停，但重启可恢复。 |
| Provider 并发 | 移除所有 `withProviderLimit()` 调用和本地 Provider queue 配置 | Provider 决定接纳、排队或拒绝。 | 厂商可能更多返回 429；由 durable wait 吸收。 |
| target 数 | 移除 `MAX_GENERATION_TARGETS` 业务硬上限 | 不限制用户多选模型。 | 仍保留请求 body 大小、重复 target、capability 和资源安全校验。 |
| worker 扫描 | 保留可配置 page size，但循环 drain due pages；其含义仅是内部资源分页 | 避免无界 Promise/socket，同时不拒绝或永久搁置已接纳 target。 | 不能承诺所有 job 同一微秒开始；在同一 tick 内按页推进。 |
| 明确 Provider 限流 | 新增无限等待分支，不复用 `decideRetry()` 的有界预算 | 用户确认等待直到成功或取消。 | 需新增持久化等待提示和长期 job 可观测性。 |
| 不确定 submit | 保持 `outcome_unknown`，不自动重投 | 正确性和防重复计费优先。 | 用户需自行确认厂商侧状态；删除时需额外确认。 |
| 图片 retention / 单图删除 | 采用关联 improve-3 的图片墓碑，不删除 Generation 历史 | 自动空间治理和单图操作不应改写“Provider 是否返回过图片”的历史事实 | DB 会长期保留轻量 image metadata；不提供回收站 |
| Generation 删除 | `DELETE /api/generations/:id`，仅由用户明确发起时硬删除 Generation 聚合 | 满足删除冗余整条历史的需求，同时与自动 retention scope 分离 | jobs、Prompt、Provider error、收藏、图片墓碑和仍存在的应用内文件均消失；不可恢复 |
| 收藏与下载 | 收藏阻止 retention，但整条 Generation 删除确认后仍删除收藏；外部下载副本不受影响 | “删除整条记录”是用户主动的更大 scope；应用不能删除已导出文件 | UI 必须明确列出影响，避免把取消收藏/单图删除与整条删除混淆 |

## 2.3 分阶段实施

### Phase 1：单实例 worker 与无上限 admission

目标：确保离开详情页后任务仍在后台推进，并允许任意数量的合法 targets durable admission。

改动：

- `src/lib/generation-constraints.ts`：删除 `MAX_GENERATION_TARGETS`。
- `src/lib/job-engine/validator.ts`、`src/components/generate/generate-screen.tsx`、`src/lib/web-client/capabilities.ts` 及关联测试：移除 target 长度校验和 UI 上限提示；保留非空、唯一、capability 校验。
- `src/lib/job-engine/worker.ts`：将 batch 的角色明确为 worker 内部页大小；实现“本 tick 内持续读取下一页直到无 due job 或全部剩余 job 已被推迟”的 drain 逻辑，禁止无界并行。
- `.env.example`、`README.md`、`docs/mvp/job-engine/{goals-duty,architecture,dfd-interface,test}.md`：将生产单实例 worker 设为启用，移除失效的 `MAX_INFLIGHT_GENERATIONS` 说明。
- `src/lib/job-engine/admission.ts` 和对应测试：删除未接入生产路径的内存 admission helper，避免误导。

完成定义：提交超过 8 个合法 targets 返回 `202` 并创建对应数目的 jobs；设置 `JOB_WORKER_ENABLED=true` 后，关闭详情浏览器订阅不影响 worker 推进。

### Phase 2：Provider 直接调用与无限等待

目标：本系统不再以 Provider semaphore/队列决定并发；明确限流时，任务可无限期等待到用户取消。

改动：

- `src/lib/job-engine/lifecycle.ts`：删除 dispatch/poll/cancel 对 `withProviderLimit()` 的包裹和 `ProviderQueueError` 分支。
- `src/lib/providers/limiter.ts`、`src/lib/providers/limiter.unit.test.ts`：删除本地 Provider limiter；移除无引用导出。
- `.env.example`：删除 `MAX_INFLIGHT_PER_PROVIDER`、`MAX_QUEUED_PER_PROVIDER`、`PROVIDER_QUEUE_TIMEOUT_MS`。
- `src/lib/job-engine/lifecycle.ts`：新增专用 `scheduleProviderRateLimitWait()`。仅当 Provider 返回 `retryable=true` 且 `disposition in ('not_started','rejected')` 且诊断/错误码确认是 `RATE_LIMITED` 时使用。写入：`status=pending`、`phase=queued`、安全 `RATE_LIMITED` error、`nextPollAt`；清空有界 retry state，不消耗/检查 3 次、30 秒预算。
- `src/lib/job-engine/retry-policy.ts`：保留给 poll/cancel/download 的有界重试；不要改成所有错误无限重试。
- `src/lib/providers/http-client.ts`：为 `Retry-After` 选择适合长期排队的上限与解析语义，且等待时间取厂商值和退避值中较大者；不得把厂商原始 body/message 持久化。
- `src/lib/job-engine/types.ts`、`src/lib/web-client/types.ts`、`src/lib/job-engine/orchestrator.ts`：在 JobView 暴露最小的等待信息（例如 `waitingForProvider`、`nextAttemptAt`），不泄露内部 phase、Provider body 或敏感 URL。
- `src/components/generation/generation-status.tsx`、`src/components/generation/job-error.ts`、`src/components/generate/generate-stage.tsx`、`src/components/dialogs/generation-detail-dialog.tsx`、i18n message 文件：将 pending + RATE_LIMITED 渲染为“服务商繁忙，正在等待并自动重试；可取消”的 notice，而非 terminal error。

完成定义：连续任意次数的明确 429 不会使 job failed；取消能停止后续 retry；timeout/5xx 仍进入 `outcome_unknown` 而非被无限重投。

### Phase 3：与图片墓碑对齐的 Generation 历史硬删除

前置：完成关联 [生成管线 improve-3](../../2026-07-20-generation-pipeline-resilience/improve-3/README.md) 的 schema v4、图片 availability/query 与 cleanup 墓碑后端契约，或与其作为同一可运行纵切实施。

目标：只在用户明确请求时安全删除已结束的整条 Generation，并清理从属数据库记录与仍由应用管理的本地文件；自动 retention 和单图删除继续保留历史。

改动：

- `src/lib/db/queries/generations.ts`：新增事务性 `deleteGenerationForHistory()`；在 transaction 内读取 generation/jobs/images 和 result snapshots，判定内部 phase，只收集 `availability=available` 且 `storage_path IS NOT NULL` 的管理内文件路径，然后硬删除 generation。DB cascade 删除 jobs、available/tombstone image rows 和 favorites。
- `src/lib/job-engine/orchestrator.ts`：新增 `deleteGeneration()`，调用 DB helper，提交后执行 `cleanupStagedResultSnapshot()` 和 `storage.removeStoredFile()`；文件失败不回滚已提交 DB，交给 orphan cleanup，并记录安全诊断。
- `src/app/api/generations/[id]/route.ts`：新增 `DELETE`。
- `src/lib/errors.ts`、API error mapping：新增明确的 `GENERATION_NOT_DELETABLE`（cancelling/active）和 `OUTCOME_UNKNOWN_DELETE_CONFIRMATION_REQUIRED`（需要二次确认）错误。
- `src/lib/web-client/api-client.ts`：新增 `deleteGeneration(id, { confirmUnknownOutcome })`。
- `src/components/history/history-screen.tsx`、`src/components/history/history-session-group.tsx`、`src/components/dialogs/generation-detail-dialog.tsx`：增加“删除整条生成记录”确认对话框、pending/error 状态、删除成功后关闭详情并重取 History；确认文案必须说明 Prompt、Job/Provider error、收藏、available/tombstone 图片记录和应用内文件都会删除且不可恢复，外部下载副本不会删除；重构历史行以避免 `<button>` 嵌套 `<button>`。
- `src/components/gallery/*`：删除后使本页收藏列表失效或重取，避免显示指向已删图片的 stale item。
- 不修改 improve-3 的 `DELETE /api/images/:id` 语义：单图删除仍留下 `user_deleted` tombstone；不能通过调用 N 次单图删除来代替 Generation 聚合删除。

删除协议：

| 内部状态 | DELETE 默认行为 |
|---|---|
| 全部 job `phase=terminal` | 删除，`204 No Content`。 |
| 任一 job `phase=cancelling` 或其他活跃 phase | `409 GENERATION_NOT_DELETABLE`。 |
| 任一 job `phase=outcome_unknown` | 未带 `confirmUnknownOutcome=true` 时返回 `409 OUTCOME_UNKNOWN_DELETE_CONFIRMATION_REQUIRED`；显式确认后仅删除本地记录。 |

完成定义：

- 自动 retention 后，Generation detail/History 仍存在并显示过期 tombstone，Generation/Job/Prompt/error 不变。
- 单图删除后，Generation detail/History 仍存在并显示 `user_deleted` tombstone。
- 明确 Generation 删除后，`GET /api/generations/:id` 为 404，历史 Generation/图片总数更新，available/tombstone 图片与收藏行不再存在；仅仍存在的应用内文件会被立即尽力删除或由 orphan cleanup 回收。
- 用户已下载/导出的外部副本不在删除范围。

## 2.4 按包/目录的改动面

| 目录 / 文件 | 新增 | 修改 | 删除 |
|---|---:|---:|---:|
| `src/lib/job-engine/` | provider-rate-limit wait、delete orchestrator | worker/lifecycle/types/retry 交界 | `admission.ts` |
| `src/lib/providers/` | — | HTTP retry-after 语义 | `limiter.ts` |
| `src/lib/db/queries/generations.ts` | Generation 聚合删除 helper | 适配 nullable live path / tombstone | — |
| `src/app/api/generations/[id]/route.ts` | DELETE handler | — | — |
| `src/lib/web-client/` | delete client / DTO 等待字段 | request types | target 上限导入 |
| `src/components/{generate,generation,history,dialogs,gallery}/` | 等待提示、删除交互 | 现有状态/UI | target 上限 UI |
| `.env.example`、`README.md`、`docs/mvp/job-engine/` | 单实例运行说明 | 配置与架构约束 | limiter / dead admission 说明 |
| 测试 | rate-wait/delete 相关测试 | admission/worker/UI 测试 | limiter/admission helper 测试 |

## 2.5 API、兼容与迁移

- `POST /api/generations`：不改变成功 DTO；去除 `targets.length <= 8` 的 400 校验，是兼容性放宽。
- `GET /api/generations/:id`：JobView 可增加可选等待字段，旧客户端忽略未知字段；不得暴露内部 phase。
- `DELETE /api/generations/:id`：新接口。默认无 body；对 outcome unknown 的显式确认可用 JSON body `{ "confirmUnknownOutcome": true }`。
- `DELETE /api/images/:id`（关联 improve-3）：是不同资源/范围；保留 Generation 和图片 tombstone，不能与 Generation DELETE 混用。
- 数据库：本批 Phase 1/2 不新增 schema migration；Phase 3 消费 improve-3 的 schema v4、nullable `storage_path`、`removed_at/removal_reason` 和现有 cascade。不得声称 Phase 3 可基于 v3 独立完成。
- 部署：更新 `.env.example` 为单实例 worker 启用。已有生产环境必须显式检查 `JOB_WORKER_ENABLED`，避免仅更新代码却继续关闭 worker。

## 2.6 风险与回滚

| 风险 | 防御 | 回滚 |
|---|---|---|
| 厂商长期 429 造成永远 pending | UI 提示、用户取消、持久化 next attempt、可观察日志。 | 恢复有界等待策略；不删除已排队 job。 |
| timeout/5xx 被误判为 429 | 仅依据安全 error code + disposition 进入无限等待。 | 保持 outcome_unknown 分支优先。 |
| 取消与无限等待竞态 | existing lease/cancel marker CAS；取消清空 nextPollAt。 | 恢复原 lifecycle，不改变已取消状态。 |
| 删除时 worker 写回 | 仅允许 terminal；cancelling/active 409；DB transaction 内再次判断。 | 无法回滚硬删除，故 UI 必须明确是整条记录而非单图删除。 |
| Generation 删除与 retention/单图删除竞态 | transaction 重新读取 image availability，只捕获 non-null live path；DB aggregate delete 作为最终线性化点。 | 文件系统与 SQLite 非同一事务，重复 remove 必须安全幂等并由 orphan cleanup 补偿。 |
| 数据行删了但 live 文件未删 | commit 后尽力删；既有 orphan scanner 回收。tombstone 没有 path，不执行伪删除。 | 不回滚 DB；手工运行 cleanup。 |
| 收藏或外部下载被误解 | 删除确认明确：收藏随 Generation 删除；外部导出副本不受应用控制。 | 用户主动硬删除不可恢复，收藏不是回收站。 |
| 无限 target 占用内存 | request-body 上限、唯一校验、worker 页式 drain，禁止无界 Promise。 | 仅调整内部 page size，不恢复产品 target 数硬上限。 |

## 2.7 与已确认边界对齐

- 不引入外部 broker、Celery 或多实例协调。
- 不恢复任何本地 Provider 并发/队列上限。
- 不把 worker page size 解释或实现为用户可见的 target 数限制。
- 不把 `outcome_unknown` 重投或静默当作正常 failed 删除。
- 不让自动 retention 或单图删除调用 Generation DELETE；只有用户明确选择“删除整条生成记录”才能硬删除聚合。
- 不把收藏解释为阻止用户主动删除整条 Generation；但确认对话必须列出收藏影响。
- 不尝试删除用户已下载/导出的外部文件。

## 2.8 不在本批

- Provider 级别的精确排队位置、预估时间或厂商内部并发指标。
- 多用户公平、抢占、优先级和费用预算。
- Session/Project 批量删除和回收站。
- Generation 的按时间自动清理、软删除/回收站、Prompt/Job/error 独立删除。
- 跨进程 worker 心跳、分布式 lease 或共享限流。

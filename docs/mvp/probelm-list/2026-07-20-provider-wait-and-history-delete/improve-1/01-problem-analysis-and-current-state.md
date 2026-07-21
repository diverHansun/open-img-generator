# 1. 问题基线与当前实施状态

> 时间口径：2026-07-20 工作区基线；本文件只描述现状，不把目标实现写成现状。

## 1.1 问题陈述

1. Generation admission 已是 durable 的，但后台推进依赖可被示例配置关闭的进程内 worker；用户离开详情页时，前端恢复轮询也会停止。
2. 同 Provider 的 submit、poll、cancel 被本地 semaphore 限制，且本地队列满/超时会产生本系统的 retry，而非交给厂商决定并发。
3. 厂商明确 `RATE_LIMITED` 时使用 submit 的有界重试（3 次、30 秒），不能实现“直到用户取消”的等待。
4. 一次 Generation 的 target 数量被共享常量限制为 8，属于产品硬限制，不符合未来多模型需求。
5. History 只有只读模型和详情入口；没有 Generation 删除 API，数据库级联也不会删除本地图片文件。与此同时，现有 retention 会物理删除 image 行，尚不能表达后续已确认的“图片过期留墓碑、Generation 历史继续保留”。

## 1.2 当前数据流

```text
Web/App POST /api/generations
  -> submitGeneration: 1 Generation + N generation_jobs durable admission
  -> ensureWorkerStarted()
  -> in-process timer: list due jobs -> advance(job) -> Provider / storage

Generation detail page
  -> Browser GenerationPollRegistry -> GET /api/generations/:id
  -> getGeneration() 也可按 due/lease 辅助 advance(job)

History
  -> GET /api/projects/:id/history 或 GET /api/generations
  -> 只读 DTO；不推进 job
```

## 1.3 job-engine 现状

### goals-duty

- `submitGeneration()` 在 Provider 调用前写入 Generation 和所有 targets 的 jobs，满足“第二个 Generation 可独立入队”的基础。[`src/lib/job-engine/orchestrator.ts:102-149`](../../../../../src/lib/job-engine/orchestrator.ts)
- `runWorkerOnce()` 跨所有 Generation 查询 due jobs，然后 `Promise.all` 推进当前扫描页；不是只处理当前页面任务。[`src/lib/job-engine/worker.ts:49-87`](../../../../../src/lib/job-engine/worker.ts)
- 旧的 `MAX_INFLIGHT_GENERATIONS` helper 没有进入生产路径，环境变量却仍被示例文件暴露，造成错误的并发认知。[`src/lib/job-engine/admission.ts:1-25`](../../../../../src/lib/job-engine/admission.ts)

### architecture

- worker 由 `globalThis` 单例和 `setInterval` 构成；这是本项目自定义的后台循环，不是 Celery 或外部 queue worker。[`src/lib/job-engine/worker.ts:28-39`](../../../../../src/lib/job-engine/worker.ts)
- `JOB_WORKER_ENABLED === 'false'` 时 worker 不启动。[`src/lib/job-engine/worker.ts:28-34`](../../../../../src/lib/job-engine/worker.ts)
- `.env.example` 恰好显式设置 `JOB_WORKER_ENABLED=false`，与既有 job-engine 文档的“默认 worker”叙述和本批用户用例冲突。[`.env.example:43-52`](../../../../../.env.example)
- 页面离开后 `GenerateStage` 取消 browser poll subscription；worker 被关闭时，第一条任务的本地 poll/转存会停到重新打开详情。[`src/components/generate/generate-stage.tsx:158-182`](../../../../../src/components/generate/generate-stage.tsx)

### data-model

- `generation_jobs` 已有 `phase`、`error`、`next_poll_at`、lease 与 retry 字段，足以表示 “queued + pending + RATE_LIMITED error + next_poll_at” 的 durable 等待，不必为了本批另建队列表。[`src/lib/db/schema.ts:71-109`](../../../../../src/lib/db/schema.ts)
- 现有 `attempt_count/retry_started_at` 的含义是有界 retry 窗口；把无限 Provider 等待硬塞进 `decideRetry()` 会违反其不变量和文档语义。[`src/lib/job-engine/retry-policy.ts:1-55`](../../../../../src/lib/job-engine/retry-policy.ts)
- `generation -> generation_jobs -> images -> favorites` 已具备数据库 `ON DELETE CASCADE`，但图片实际文件路径在本地存储，不会随数据库 cascade 删除。[`src/lib/db/schema.ts:71-137`](../../../../../src/lib/db/schema.ts)
- 当前 schema v3 的 `images.storage_path` 为 NOT NULL 且没有墓碑字段；关联 improve-3 规划将其升级为可表达 available/过期/主动删除/文件缺失的 schema v4。Generation 删除不能假设所有 image row 都仍有文件路径。

### dfd-interface / use-case

- dispatch、poll、cancel 都通过 `withProviderLimit()` 进入同一 Provider 的内存队列。[`src/lib/job-engine/lifecycle.ts:1135-1146`](../../../../../src/lib/job-engine/lifecycle.ts)、[`src/lib/job-engine/lifecycle.ts:1291-1295`](../../../../../src/lib/job-engine/lifecycle.ts)
- limiter 默认同 Provider 并发 2、队列 32、超时 30 秒；这正是本批要移除的产品策略。[`src/lib/providers/limiter.ts:1-83`](../../../../../src/lib/providers/limiter.ts)
- HTTP 429 已被统一映射为 `RATE_LIMITED`、retryable 且 `rejected`，具备安全重排的证据；但当前会进入有界 submit retry。[`src/lib/providers/http-client.ts:71-79`](../../../../../src/lib/providers/http-client.ts)、[`src/lib/job-engine/lifecycle.ts:1195-1227`](../../../../../src/lib/job-engine/lifecycle.ts)
- HTTP 超时/5xx 的 disposition 可能是 `unknown`，当前会进入 `outcome_unknown`；这是防止重复收费的必要边界，不能被“无限等待”需求覆盖。[`src/lib/providers/http-client.ts:75-79`](../../../../../src/lib/providers/http-client.ts)、[`src/lib/job-engine/lifecycle.ts:1161-1166`](../../../../../src/lib/job-engine/lifecycle.ts)

### non-functional

- `WORKER_BATCH_SIZE=16` 限制的是一次 SQL 扫描/Promise 批次，不是 admission 的 target 上限；它不拒绝任务，但大量 due job 会在后续 tick 才启动。[`src/lib/job-engine/worker.ts:60-75`](../../../../../src/lib/job-engine/worker.ts)
- 不能把 batch 分页也删除成无界 `Promise.all`：单个恶意或错误输入可占满进程的 socket、内存和文件系统。这是单实例的技术保护，不是用户可见的模型数量上限。
- 当前 limiter、worker 和 SQLite 均为单进程设计；用户已明确本批不支持多实例，因此不需要引入分布式基础设施。

### test

- 现有 unit 测试覆盖 worker 推进、Provider limiter 和有界 `RATE_LIMITED` submit retry，但没有“超过 8 targets 可 admission”“429 持续等待跨重启”“删除 Generation 与文件清理”的测试。[`src/lib/job-engine/worker.unit.test.ts:64-162`](../../../../../src/lib/job-engine/worker.unit.test.ts)、[`src/lib/job-engine/lifecycle.unit.test.ts:181-218`](../../../../../src/lib/job-engine/lifecycle.unit.test.ts)
- 项目已有明确的 Unit/Contract/Integration 分层和 MSW 规则，应复用而非新建测试体系。[`docs/test-blueprint.md`](../../../../test-blueprint.md)

## 1.4 History / library / web-client 现状

| 关注点 | 当前行为 | 风险 |
|---|---|---|
| History API | 仅 `GET /api/projects/:id/history`，按 Session 分组只读。 | 无删除能力。 |
| Generation API | `/api/generations/:id` 只有 `GET`；取消位于独立 POST 路由。 | 无资源删除契约。 |
| History UI | 每行是打开详情的 button。 | 不能直接嵌套删除 button，需调整可访问的行结构。 |
| 图片清理 | 保留期清理会先删 DB row、再删文件，失败留给 orphan scan。 | Generation 删除需复用相同的“DB 先提交、文件尽力清理”原则。 |

这里存在三个必须分开的领域动作：

| 动作 | 当前实现 | 已确认目标语义 |
|---|---|---|
| 自动 retention | 物理删除旧未收藏 image 行和文件 | 只移除文件，保留 `retention_expired` 图片墓碑与 Generation 历史 |
| 单图主动删除 | 尚无 API | 只移除该文件，保留 `user_deleted` 图片墓碑与 Generation 历史 |
| Generation 历史删除 | 尚无 API | 用户明确确认后硬删除整个 Generation 聚合及仍存在的应用内文件 |

因此，“复用 DB 先提交、文件尽力清理”只指跨 SQLite/文件系统的补偿顺序，不代表三种动作应复用同一数据库删除语义。

代码锚点：[`src/app/api/projects/[id]/history/route.ts:11-32`](../../../../../src/app/api/projects/[id]/history/route.ts)、[`src/app/api/generations/[id]/route.ts:7-19`](../../../../../src/app/api/generations/[id]/route.ts)、[`src/components/history/history-session-group.tsx:100-148`](../../../../../src/components/history/history-session-group.tsx)、[`src/lib/storage/cleanup.ts:78-141`](../../../../../src/lib/storage/cleanup.ts)。

## 1.5 文档与实现对照

| 既有文档说法 | 代码/配置事实 | gap |
|---|---|---|
| job-engine 默认 worker，仅显式 false 关闭 | `.env.example` 显式给出 false。 | 按示例部署会关闭后台推进。 |
| Provider limiter 为既有架构约束 | limiter 被 dispatch、poll、cancel 调用。 | 与用户确认的“厂商决定并发”冲突。 |
| submit 被安全地有界重排 | 429 也是最多 3 次 / 30 秒。 | 不能满足厂商持续忙时一直等待。 |
| targets 是合法且唯一的数组 | validator 额外限制长度 ≤ 8。 | 与不设模型数量硬上限冲突。 |
| 图片 retention 清理历史字节 | 当前同时删除 image 行。 | 与关联 improve-3 的墓碑/历史解释目标冲突，Phase 3 必须消费 schema v4。 |

## 1.6 SWE 原则审视摘要

- **复杂度管理 / KISS**：单实例继续使用 durable SQLite worker 是合理的；此时引入 Celery/Redis 只会增加偶然复杂度。
- **信息隐藏**：Provider 的并发策略应在 Provider 服务端；本地只保存可恢复等待的事实，不复制厂商队列。
- **正确性优先**：明确 429 可以重试与 timeout/5xx 不可盲重投必须分开，否则会把“无限等待”变成重复计费。
- **关注点分离**：删除的生命周期判定必须由 job-engine/DB 完成；History UI 只能发起请求，不能根据公开 `status=cancelled` 猜测内部 `cancelling` 已结束。
- **最小惊讶**：图片自动过期、用户删除一张图片、用户删除整条 Generation 是三种不同 destructive scope；API 与确认文案必须使用不同动词和结果说明。

## 1.7 与图片 retention / 墓碑方案的依赖

[生成管线 improve-3](../../2026-07-20-generation-pipeline-resilience/improve-3/README.md) 冻结了图片生命周期的目标模型：

- retention 与单图删除保留 image tombstone，因此 History 的 Generation、Job、Prompt、Provider error 不消失；
- tombstone 的 `storage_path` 为 NULL，available 图片才有本地路径；
- History 图片数包含 tombstone，首页封面/Gallery 只使用 available 图片；
- 下载副本位于应用管理目录之外，不受 Generation 删除影响。

本批 Phase 1/2 与该模型无依赖，可以独立实施。Phase 3 的 Generation 硬删除必须在 improve-3 schema v4/图片查询契约完成后实施，或与其作为同一可运行纵切交付；否则会先写一套基于 v3 `storage_path NOT NULL` 的删除逻辑，随后立即返工。

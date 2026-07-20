# db 模块 · data-model

> 模块路径: `src/lib/db/`
> 技术栈: Drizzle ORM + SQLite (better-sqlite3)
> 前置文档: 各模块 goals-duty / dfd-interface 中的数据需求
> 修订说明: 2026-07-16 新增 projects / favorites / model_preferences；Session 必属 Project；Generation 必属 Session（取消零散路径）
> 修订说明: 2026-07-20 improve-1 D1/D2：Generation durable admission/idempotency；GenerationJob snapshot、phase/lease、opaque staging 与持久化 retry state

---

## 1. Core Concepts（核心概念）

| 概念 | 一句话 | 分类 |
|------|--------|------|
| **Project** | 创作项目容器；Generate 工作台作用域 | Entity |
| **Session** | Project 内的创作会话；**必属**某 Project | Entity |
| **Generation** | 一次生成请求（对应用户点一次"生成"）；**必属**某 Session | Entity |
| **GenerationJob** | 一个 provider 的生成执行单元（扇出时一个 generation 多个 job） | Entity |
| **Image** | 一张已持久化的图片资产 | Entity |
| **Favorite** | 用户对单张 Image 的收藏 | Entity |
| **ModelPreference** | (provider, model) 是否进入工作台启用池 | Entity |

领域语义权威见 `docs/mvp/library/data-model.md`；本文为物理表。

---

## 2. Entity 定义与关键字段

### 2.0 projects（新）

| 字段 | 类型 | 含义 |
|------|------|------|
| id | TEXT PK | UUID |
| title | TEXT NOT NULL | 显示名 |
| created_at | TEXT | ISO 8601 |
| updated_at | TEXT | ISO 8601 |

生命周期: library/API 创建。MVP：非空（仍有 session）则禁止删除。

`updated_at` 更新时机: 创建；改 title；其下新建 Session 时（可选 touch）。

### 2.1 sessions

| 字段 | 类型 | 含义 |
|------|------|------|
| id | TEXT PK | UUID |
| project_id | TEXT NOT NULL FK→projects.id | **必填**；无零散 Session |
| title | TEXT NULL | 会话标题（可选） |
| created_at | TEXT | ISO 8601 |
| updated_at | TEXT | ISO 8601 |

生命周期: library/API 创建。可 `move` 变更 `project_id`。

`updated_at` 更新时机:
- 创建 session 时: 与 `created_at` 相同
- 修改 title 或 move 时
- 有新 generation 关联到该 session 时

索引建议: `project_id`, `(project_id, updated_at)`。

### 2.2 generations

| 字段 | 类型 | 含义 |
|------|------|------|
| id | TEXT PK | UUID |
| session_id | TEXT NOT NULL FK→sessions.id | **必填**；取消独立生成（null） |
| prompt | TEXT | 最终发送给 provider 的 prompt（已过 prompt 模块） |
| status | TEXT | `pending` / `running` / `completed` / `failed` / `cancelled` |
| client_request_id | TEXT NULL | 新 admission 的稳定用户意图 UUID；旧行可 NULL；非 NULL partial unique |
| request_hash | TEXT NULL | canonical payload SHA-256；同一 client_request_id 时判断 replay 或冲突 |
| created_at | TEXT | ISO 8601 |
| updated_at | TEXT | ISO 8601 |

生命周期: job-engine 创建，job-engine 更新 status。

`updated_at` 更新时机: 每次 `status` 变更时（与 job 聚合更新同步）。

接纳幂等: `UNIQUE(client_request_id) WHERE client_request_id IS NOT NULL`。新 POST 以 `client_request_id + request_hash` 判定：同 hash 复用既有 generation；异 hash 返回冲突，绝不新建第二条任务。

聚合规则: generation.status 由其下所有 job 状态推导。**权威定义见 `api/constraints.md` §8**（多 job 部分成功时 generation 可为 `completed`，失败 job 仍保留在视图中）。摘要:

| 优先级 | 条件 | generation.status |
|--------|------|-------------------|
| 1 | 存在 `running` | `running` |
| 2 | 存在 `pending`（无 running） | `pending` |
| 3 | 全部终态且至少一 `completed` | `completed` |
| 4 | 全部终态、无 completed、有 `cancelled` | `cancelled` |
| 5 | 全部终态 | `failed` |

### 2.3 generation_jobs

| 字段 | 类型 | 含义 |
|------|------|------|
| id | TEXT PK | UUID |
| generation_id | TEXT FK→generations.id | 所属 generation |
| provider | TEXT | ProviderId（如 "fal", "zenmux"） |
| model | TEXT | 模型 id |
| status | TEXT | `pending` / `running` / `completed` / `failed` / `cancelled` |
| provider_handle | TEXT NULL | JSON 序列化的 JobHandle（async 厂商） |
| error | TEXT NULL | JSON 序列化的 ProviderError |
| phase | TEXT NOT NULL | 内部恢复阶段：`queued` / `dispatching` / `polling` / `storing` / `cancelling` / `terminal` / `outcome_unknown`；不直接暴露给 API |
| request_snapshot | TEXT NULL | 已校验、版本化、target-specific `NormalizedRequest` JSON；仅供恢复 dispatch，终态清理 |
| request_snapshot_version | INTEGER NULL | request snapshot 格式版本；未知版本禁止 dispatch |
| result_snapshot | TEXT NULL | 短期图片 refs；仅有界远端 URL 或 opaque `staging:<uuid>`，终态/取消清理；禁止 raw data URL/Base64 |
| attempt_count | INTEGER NOT NULL | 当前 phase 已发生的 retryable failure 数；D2 仅用于 poll/cancel，成功/phase 切换/终态归零 |
| retry_started_at | TEXT NULL | 与 attempt_count 成对存在的 durable retry window 起点；半写或无效值安全收口为 `RETRY_EXHAUSTED` |
| poll_lease_until | TEXT NULL | **物理旧列名**；现在是当前 phase 的短期 lease 到期值与 CAS token，不表示厂商状态 |
| next_poll_at | TEXT NULL | **物理旧列名**；现在是当前 phase 的下一次 due 时间，worker 与详情辅助均须遵守 |
| cancel_requested_at | TEXT NULL | 本地取消 CAS 标记；非空后 public status 不可复活，worker 可在 `cancelling` phase 尽力远端 cancel |
| created_at | TEXT | ISO 8601 |
| updated_at | TEXT | ISO 8601 |

生命周期: admission 创建 `status=pending, phase=queued`。worker/详情 helper 以 phase、due、lease 与 cancel marker 条件 claim 后推进；`dispatching` lease 过期而没有 durable Provider 结果时标为 `status=failed, phase=outcome_unknown`，不猜测重投。async handle 在 dispatch 成功时写入；D2 对 typed-retryable poll/cancel 将 attempt/window/next due 一起写入，重启后继续同一预算；取消与晚到 handle 竞争时可保留 handle，仅用于后续远端 cancel，不能复活 public status。

`updated_at` 更新时机: 每次 `status`、`error`、`provider_handle`、`phase`、snapshot、`attempt_count`、`retry_started_at`、`poll_lease_until`、`next_poll_at`、`cancel_requested_at` 变更时。

扇出: 一个 generation_id 对应 N 行 job（N ≥ 1）。`POST /api/generations` 的 `targets[]` 长度决定创建行数。

调度索引: `generation_jobs_due_idx(phase, next_poll_at, poll_lease_until, updated_at, id)`，用于避免 worker 无序全表扫描。

### 2.4 images

| 字段 | 类型 | 含义 |
|------|------|------|
| id | TEXT PK | UUID |
| generation_job_id | TEXT FK→generation_jobs.id | 所属 job |
| index | INTEGER | 批次内序号（0-based），与 ProviderImageRef.index 对应 |
| storage_path | TEXT | 本地存储相对路径 |
| content_type | TEXT | MIME 类型（如 "image/png"） |
| width | INTEGER NULL | 输出图片宽度（非输入参数） |
| height | INTEGER NULL | 输出图片高度（非输入参数） |
| size_bytes | INTEGER NULL | 文件大小 |
| created_at | TEXT | ISO 8601 |

唯一约束: `UNIQUE(generation_job_id, index)` — 支撑转存幂等。

生命周期: job-engine 在转存完成后创建。不可变，无更新。

### 2.5 favorites（新）

| 字段 | 类型 | 含义 |
|------|------|------|
| id | TEXT PK | UUID |
| image_id | TEXT NOT NULL FK→images.id | 被收藏的图 |
| created_at | TEXT | 收藏时间（Gallery 排序） |

唯一约束: `UNIQUE(image_id)` — 支撑幂等收藏。

### 2.6 model_preferences（新）

| 字段 | 类型 | 含义 |
|------|------|------|
| provider | TEXT NOT NULL | ProviderId |
| model | TEXT NOT NULL | 模型 id |
| enabled | INTEGER NOT NULL | 0/1 |
| updated_at | TEXT | ISO 8601 |

主键或唯一约束: `UNIQUE(provider, model)`。

---

## 3. 输入/输出字段：定义方 vs 持久化方

「模型的输入和输出」在不同层由不同模块负责，不要与 db 表字段混为一谈。D1 的关键变化是：为了在进程重启后安全恢复已接纳的任务，db 会短期保存**每个 target 已校验且 capability 裁剪后的请求快照**；这不是把原始 POST body 或 Provider wire payload 入库。

### 3.0 运行时输入 vs db 持久化（对照表）

| 字段 | API / job-engine 入参 | NormalizedRequest | 写入 db |
|------|----------------------|-------------------|---------|
| `clientRequestId` | **必填** | — | 是 → `generations.client_request_id`（与 request hash 幂等配对） |
| `prompt` | 是 | 是 | 是 → `generations.prompt`；也在每个 request snapshot 中保存已处理值 |
| `targets[]` (`provider` + `model`) | 是 | —（submit 第二参数） | 是 → 每个 target 一行 `generation_jobs.provider/model` |
| `sessionId` | **必填** | — | 是 → `generations.session_id` NOT NULL；不进入 request snapshot |
| `mode` | 是 | 是 | 是 → 对应 job 的 request snapshot（非独立列） |
| `aspectRatio` | 是 | 是 | 是 → 对应 job 的 request snapshot（非独立列） |
| `count` | 是 | 是 | 是 → 对应 job 的 request snapshot（非独立列） |
| `negativePrompt` | 是 | 是 | 是 → 对应 job 的 request snapshot（非独立列） |
| `seed` | 是 | 是 | 是 → 仅支持该能力 target 的 request snapshot |
| `providerOptions` | 是 | 是 | 是 → 对应 job 的 request snapshot（有界白名单 JSON） |
| `referenceImages` | 是 | 是 | 是 → 对应 job 的 request snapshot（有界字符串数组） |

数据流（输入侧）：

```
POST /api/generations { clientRequestId, prompt, targets[], aspectRatio, count, seed, ... }
  → 校验参数与每 target capabilities，prompt.process
  → 构造每 target 的 NormalizedRequest，写入 versioned request_snapshot
  → 同一 admission transaction 写 generation / jobs / snapshots / Session touch
  → 202；事务外 worker 按 phase/lease 读取 snapshot 并 providers.submit
  → job 进入终态时清理 request_snapshot（而非把原始参数留给 History/UI）
```

**与输出字段 `images.width/height` 的区别**: 表 `images` 上的 width/height 是**生成结果**的像素尺寸（转存时写入），不是用户提交的输入参数。

### 3.1 Snapshot 与 Provider 类型边界

| 层次 | 结构 | 负责模块 | 持久化边界 |
|------|------|----------|------------|
| API 入参 | `SubmitGenerationParams` | job-engine | 不保存原始 body；只用作 admission/hash/校验 |
| 厂商无关请求 | `NormalizedRequest` | providers | 每 target 的 validated versioned snapshot 短期保存，供恢复 dispatch |
| 厂商无关响应 | `SubmitResult` / `PollResult` | providers | 解析后仅把 handle 或 result snapshot 所需白名单字段保存 |
| 单张临时图片 | `ProviderImageRef` | providers | storing 期间保存有界 URL 或 opaque staging ref，终态清理 |
| async 句柄 | `JobHandle` | providers | `generation_jobs.provider_handle`，任务进行中/远端取消需要 |
| 错误 | `ProviderError` | providers | `generation_jobs.error` 经安全 mapper 后对外 |
| API 出参 | `GenerationView` | job-engine | 不含任何 request/result snapshot |
| 能力声明 | `ProviderCapabilities` | providers | 不写入 generation job |

request snapshot 版本 1 只允许 `prompt/mode/width/height/aspectRatio/count/negativePrompt/seed/referenceImages/providerOptions`；有 JSON 深度、键数、数组、字符串和总字节上限。未知版本、非法字段或损坏内容不能触发 Provider dispatch，须安全终结 job。

### 3.2 厂商原生 wire format（HTTP 请求体/响应体）

| 结构 | 负责模块 | 是否持久化 |
|------|----------|------------|
| fal queue 请求体（`prompt`, `image_size`, `seed`...） | providers/adapters/fal | 否，adapter 内部 ephemeral |
| zenmux OpenAI Images 请求体（`prompt`, `size`, `n`...） | providers/adapters/zenmux | 否，adapter 内部 ephemeral |
| 厂商原始 JSON 响应 | providers adapter 解析后立即丢弃 | 否 |

adapter 负责 `NormalizedRequest` ↔ 厂商 JSON 的双向翻译；此层结构不暴露给 API/UI，也不直接写入 db。

### 3.3 db 持久化（恢复所需的最小子集）

| 数据 | 存哪张表 | 字段 | 说明 |
|------|----------|------|------|
| admission 身份 | generations | `client_request_id`, `request_hash` | 同一用户意图只接纳一次；同 key 异内容冲突 |
| 输入: prompt | generations | `prompt` | 已过 prompt 模块处理的最终 prompt |
| 输入: targets 中 provider + model | generation_jobs | `provider`, `model` | 每 target 一行 |
| 输入: 恢复 dispatch 所需参数 | generation_jobs | `request_snapshot`, `request_snapshot_version` | capability 裁剪后的 `NormalizedRequest`；不等同原始 body；终态清理 |
| 输出: async 句柄 | generation_jobs | `provider_handle` | JobHandle JSON，任务进行中及远端 cancel 需要 |
| 输出: 待转存图片 refs | generation_jobs | `result_snapshot` | 有界远端 ref 或 `staging:<uuid>`；禁止 raw data URL/Base64；终态清理 |
| 输出: 持久化图片 | images | `storage_path`, `width`, `height`, `content_type`, `size_bytes` | 转存后的本地资产 |
| 输出: 错误 | generation_jobs | `error` | Provider/存储安全诊断 |
| 内部恢复阶段 | generation_jobs | `phase` | 不暴露于 public status |
| phase lease / 调度 | generation_jobs | `poll_lease_until`, `next_poll_at` | 物理兼容列，分别承载当前 phase lease 与下一次 due |
| 本地取消 | generation_jobs | `cancel_requested_at` | cancel 与 dispatch/poll/store 的 CAS 标记 |

### 3.4 内联图片与 staging 边界

当 Provider 返回 Base64/data URL 时，storage 会分块解码至私有 `.staging/`，以每张 25 MiB 硬上限、Provider metadata content-type 与 PNG/JPEG/WebP magic-byte 一致性作为准入条件；`result_snapshot` 只写 `staging:<uuid>`。物化正式图片时先复制 staging 内容，直到 lease-guarded DB checkpoint 成功才删除 staging 源，避免“文件移动后、DB 写前”崩溃丢失唯一恢复来源。

不保存 raw Base64/data URL、Provider 原始响应或 credential 到 SQLite、日志、错误 DTO 或 UI。远端图片 URL 在下载时逐跳执行 HTTPS/DNS/IP/redirect 检查，响应以 25 MiB 流式临时文件处理；任何失败不会把原 URL 写入 job diagnostic。普通 Provider JSON 仍受 E2 的 2 MiB 上限；当前单图 sync Base64 endpoint 只通过不可调高的 36 MiB 专用 reader 进入，随后立即在 25 MiB decoded 边界内暂存。未来若放开 sync 多图，必须先重新设计 encoded 总预算或采用成熟 streaming parser，不能提升通用上限。

### 3.5 设计边界：snapshot 不等于历史回放 API

snapshot 的唯一目的，是让已经 `202` 接纳的 job 在进程退出后用当时已验证、按 capability 裁剪的输入继续执行；它不作为 History/Gallery 展示或“再生成”的公开数据源。再生成仍由 UI 以新的 `clientRequestId` 重新提交用户当前表单。这样既避免跨 Provider 把 adapter wire format 写进 schema，也避免把 reference URL、raw inline data 或任意 Provider options 暴露给客户端。

---

## 4. 关系图

```
projects 1 ──< sessions 1 ──< generations 1 ──< generation_jobs 1 ──< images
                 (project_id      (session_id       (generation_id       (generation_job_id
                  NOT NULL)         NOT NULL)          N ≥ 1)              可多个)
                                                                  images 1 ──< favorites
                                                                            (image_id UNIQUE)

model_preferences（独立，逻辑关联 providers registry，无 FK）
```

---

## 5. db 模块对外函数（建议）

| 函数 | 调用方 | 说明 |
|------|--------|------|
| createProject / listProjects / updateProject / deleteProjectIfEmpty | library | Project CRUD |
| createSession({ projectId, title? }) | library | project_id 必填 |
| updateSession / moveSession(sessionId, toProjectId) | library | move 改 project_id |
| touchSession(id) | job-engine | 新 generation 关联时 updated_at = now |
| sessionExists(id) | job-engine (validator) | 校验 sessionId 合法性 |
| getSession(id) | library / API | 含 project_id |
| listSessionsByProject(projectId) | library | |
| listRecentGenerations({ limit, projectId? }) | library | 首页最近 N 次 |
| listGenerationsBySession(sessionId) | library / API | History |
| addFavorite / removeFavorite / listFavorites | library | Gallery |
| get/setModelPreference / listEnabledModelPreferences | library | Models 启用池 |
| admitGenerationWithJobs(params, jobs[]) | job-engine | `client_request_id` + hash 幂等 admission；同一事务写 Generation、N jobs、snapshot 与 Session touch |
| getGenerationByClientRequestId(id) | job-engine | 读取同一用户意图，用于 replay/冲突判断 |
| createGenerationWithJobs(params, jobs[]) | 兼容 helper / 测试 | 不含新 admission 幂等语义的旧事务 helper；新 POST 不应使用 |
| updateGeneration(id, patch) | job-engine | patch 含 status, updatedAt |
| createGenerationJob(params) | job-engine | 与 createGeneration 同事务 |
| updateGenerationJob / updateGenerationJobIfLease / updateGenerationJobIfNotCancelled | job-engine lifecycle | phase、snapshot、lease、cancel marker 的普通/条件更新 |
| tryClaimQueuedJobForDispatch | job-engine lifecycle | claim `queued → dispatching` 的外部 submit lease |
| tryClaimPollLease | job-engine lifecycle | claim 有 handle 的 polling lease；兼容旧 queued+handle 行 |
| tryClaimStoringLease / tryClaimCancellingLease | job-engine lifecycle | claim storing/cancelling 当前 phase lease |
| listDueGenerationJobs | worker | 读取 phase/due/lease 合法的可恢复 job 批次 |
| requestGenerationCancellation | job-engine orchestrator | 一个 transaction 内批量取消 active jobs 并重聚合 generation |
| persistLateProviderHandleForCancellation | job-engine lifecycle | cancellation 赢得 dispatch 竞态后持久化晚到 handle，供远端 cancel |
| createImage(params) | job-engine | 见 job-engine/dfd-interface CreateImageParams |
| imageExists(jobId, index) | job-engine (lifecycle) | 转存幂等检查 |
| listGenerationJobResultSnapshots | storage cleanup | 保留仍被 durable staging snapshot 引用的文件 |
| getImage(id) | API 层 | |
| getGenerationWithJobsAndImages(id) | job-engine | 聚合查询 |

---

## 6. 文件布局

```
src/lib/db/
├── index.ts          # 导出所有查询函数
├── schema.ts         # Drizzle schema 定义
├── client.ts         # SQLite 连接单例
└── queries/
    ├── projects.ts      # 新
    ├── sessions.ts
    ├── generations.ts
    ├── images.ts
    ├── favorites.ts     # 新
    └── model-preferences.ts  # 新
```

---

## 自检（提交前）

- 表覆盖: projects / sessions / generations / jobs / images / favorites / model_preferences
- generation_jobs 支持 1:N 扇出（由 `targets[]` 决定行数）
- **project_id / session_id 均为 NOT NULL**（2026-07-16；旧「独立生成」作废）
- 每个 target 只短期持久化版本化、白名单 `NormalizedRequest` snapshot（可含 width/count/seed 等），不是原始 POST body；job 终态清理 snapshot
- `phase` / 物理 lease-due 列 / cancellation marker 支持默认 worker 与详情辅助的可恢复推进；公开 API 仍只暴露五种 status
- inline data 只以 25 MiB、MIME/magic-byte 校验后的 opaque staging ref 进入 result snapshot；远端 URL 在 storage 下载边界执行逐跳安全策略
- 字段与 library / job-engine dfd-interface 一致
- **迁移实现**: `npm run db:migrate` 将旧 Session 挂到迁移 Project；按用户确认删除无有效 Session 的 generation，再收紧约束并执行外键检查

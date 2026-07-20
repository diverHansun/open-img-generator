# job-engine 模块 · dfd-interface

> 模块路径: `src/lib/job-engine/`
> 前置文档: goals-duty.md, architecture.md
> 文档顺序: ④ dfd-interface(本文) → ⑤ use-case → ⑦ test
> 运行时约束: 见 `docs/mvp/api/constraints.md`
> 修订说明: 2026-07-15 `targets[]` 扇出；共享 aspectRatio；按 target 构造 NormalizedRequest
> 修订说明: 2026-07-20 improve-1 D1：POST 仅 durable admission 并返回 `202`；执行改由 phase/lease worker 推进，内联结果使用 opaque staging

---

## 1. Context & Scope（上下文与范围）

### 交互模块

| 方向 | 模块 | 交互内容 |
|------|------|----------|
| 上游调用方 | API 层 | 调用 submitGeneration / getGeneration |
| 上游调用方 | web-ui（经 API） | POST targets + 轮询 GET |
| 下游依赖 | providers | 每 target submit / poll / capabilities |
| 下游依赖 | prompt | process(prompt) |
| 下游依赖 | storage | downloadAndStore(url) |
| 下游依赖 | db | generation / job / image CRUD |

### 本文档范围

- submit / get 两条核心数据流（含扇出）
- 对外函数与 API 路由契约中与 generation 相关的部分

不描述: providers 内部映射表细节（见 providers/dfd-interface）、web-ui 控件交集算法、db schema DDL。

---

## 2. Data Flow Description（数据流描述）

### 2.1 Durable admission 流程（POST /api/generations）

```
API 层: POST /api/generations
  → 解析 body → SubmitGenerationParams
  → job-engine.submitGeneration(params)

  orchestrator（本步骤不调用 Provider）:
    1. validator.validate(params)
       → targets 非空；每个 (provider, model) 唯一
       → 对每个 target:
            registry.getById(provider) 启用
            capabilities(model) 存在
            mode ∈ modes
            count ≤ maxCount；若 protocol=sync 且 count>1 → 400
            若提交了 aspectRatio: 必须 ∈ supportedAspectRatios
            若提交了 width/height: 两者同有；由 adapter/校验规则处理（见 constraints）
            若 negativePrompt 有值且 !supportsNegativePrompt → 400
            seed: 不在校验阶段因「某 target 不支持」而整单 400；构造 NormalizedRequest 时对不支持的 target 省略 seed
       → sessionId **必填**: 缺失或 !sessionExists → 400
       → 任一 target 失败 → 整单 ValidationError，不写库

    2. prompt.process(prompt) → processedPrompt

    3. 每个 target 构造 capability 裁剪后的 NormalizedRequest：
         normalized = {
           prompt: processedPrompt,
           mode, width, height, aspectRatio, count,
           negativePrompt,
           seed: caps.supportsSeed ? seed : undefined,
           referenceImages,
           providerOptions
         }
         → createRequestSnapshot(normalized, version=1)
         → 只允许白名单 JSON、深度/键数/字符串/总字节上限；不得含 session、credential、Provider 原始对象

    4. db.transaction(IMMEDIATE, () => {
         按 clientRequestId + canonical request hash 去重
         createGeneration({ sessionId, prompt: processedPrompt, status: "pending",
                            clientRequestId, requestHash })
         for target in targets:
           createGenerationJob({ generationId, provider, model, status: "pending",
                                 phase: "queued", requestSnapshot, requestSnapshotVersion: 1,
                                 nextPollAt: now })
         touchSession(sessionId)
       })

       同一 clientRequestId + 同一 hash → 返回既有 generation（replayed）；同 key 异 hash → 409。

  → 返回 { generationId, status: "pending", replayed }
  → API 在 commit 后启动默认 worker（不 await）
  → API 202 + Location: /api/generations/:id
     { id, status, replayed, links: { self: "/api/generations/:id" } }
```

**`202` status 枚举**: `"pending"` | `"running"` | `"completed"` | `"failed"` | `"cancelled"`。
新接纳任务通常为 `pending`；重放同一 `clientRequestId` 时可返回既有的任一状态。

| 接纳结果 | status / 行为 |
|--------------|--------|
| 首次有效 POST | `pending`；所有 job 是 `queued`，尚未调用 Provider |
| 同 key、同 payload 重放 | 返回相同 generation，`replayed=true`；不创建 job、不重复 dispatch |
| 同 key、不同 payload | 409 `IDEMPOTENCY_KEY_REUSED` |
| 后续 worker/详情推进 | 公开状态按 job 结果变为 `running` / 终态；部分成功仍可聚合为 `completed` |

校验失败（步骤 1）→ 400，**不创建** generation。

### 2.2 Phase/lease 推进与详情读取（worker + GET /api/generations/:id）

```
默认 in-process worker:
  1. listDueGenerationJobs(now, batchSize)
     → 仅 phase ∈ {queued, dispatching, polling, storing, cancelling}
       且 due、lease 已过期/为空的 job
  2. 对每个 job 调用同一个 lifecycle.advance(job)
     queued      → claim dispatch lease → 从 versioned request snapshot 恢复 → provider.submit
     dispatching → lease 过期但无 durable result → outcome_unknown（不盲目 replay）
     polling     → claim lease → provider.poll
     storing     → claim lease → 每次处理一张 result snapshot 中尚未落库的图片
     cancelling  → claim lease → 若有 handle 则 provider.cancel（best effort）→ terminal
  3. 所有外部结果写回均以 phase + lease + cancel marker CAS；再聚合 generation.status

详情 GET:
  1. getGeneration 先读取 generation/jobs/images（无则 404）
  2. 可对其 jobs 调用同一个 advance，但 claim 条件仍要求 due 且无有效 lease
  3. 重新读取并返回 GenerationView
```

worker 默认启用；只有 `JOB_WORKER_ENABLED=false` 才关闭。关闭时详情 GET 是恢复辅助入口，**不是**绕过 `next_poll_at` 或有效 lease 的强制 poll。已全部终态的 generation 不触发外部工作。

### 2.3 Cancel 流程（POST /api/generations/:id/cancel）

```
API → orchestrator.cancelGeneration
  → 一个短 DB transaction 批量 CAS 所有 active jobs:
       status=cancelled, cancel_requested_at=now, phase=cancelling/terminal
       重新聚合 generation.status
  → 立即返回本地 GenerationView；不等待 Provider
  → worker 后续处理 phase=cancelling：有 durable handle 时尽力调用 provider.cancel(handle)
  → 将 job 收口为 terminal；远端失败/不支持仅记录安全诊断，不复活 public status
```

尚未 claim 的 queued job 直接 terminal；dispatch/storing 期间的 lease 与晚到 async handle 受 cancellation CAS 保护，晚到 handle 只可用于远端 cancel。取消先于图片 checkpoint 赢得事务时，不会出现新的 image row；已完成 checkpoint 的图片保持已持久化资产。

### 2.4 Session 关联（必填，2026-07-16）

每次 submit 必须带合法 `sessionId`：校验存在 → 写入 `generations.session_id` → `touchSession`。
**禁止** `session_id=null` 的独立生成。

Session / Project CRUD 由 **library + API** 负责，不经 job-engine。Session 必属某 Project（db 约束）。

### 2.5 GET session / project 树 — 只读聚合

`GET /api/sessions/:id?include=generations` 与 History 列表只经 library 读取已存状态，**不调用** job-engine。`GET /api/generations/:id` 可作 due/lease 允许时的恢复辅助，但不推进未 due 或有有效 lease 的 job。

### 2.6 图片访问

仍不经 job-engine：API → db.getImage → storage.getReadStream。

### 2.7 图片转存与 inline staging（lifecycle）

转存作用域为单个 job，使用 `phase=storing` 的 result snapshot 恢复：

- `imageExists(jobId, index)` 幂等
- 每张图片先物化文件，再以 lease-guarded 短事务插入 image row、更新 phase/status 与 generation 聚合；失败或取消失去 checkpoint 时删除本次尝试文件
- 单 job 内任一张失败 → 该 job failed；已成功 images 保留
- **不**将其他 job 标失败
- data URL/Base64 先经 25 MiB 上限和 Provider metadata content-type 一致性检查写入私有 staging；result snapshot 仅保存 `staging:<uuid>`，不保存 raw data URL/Base64。magic-byte 校验、远端 URL/redirect/私网策略、流式解码和完整 staging reconciliation 是 E3 范围。

### 2.8 Provider 列表

`GET /api/providers` 不经 job-engine；API → registry.listEnabled()。web-ui 用其驱动模型多选与参数显隐。

---

## 3. Interface Definition（接口定义）

### 3.1 submitGeneration(params)

| 属性 | 值 |
|------|-----|
| 输入 | `SubmitGenerationParams` |
| 输出 | `{ generationId: string; status: GenerationStatus; replayed: boolean }` |
| 成功语义 | durable admission 已 commit；不等待 Provider submit / poll / 下载 |
| 失败 | ValidationError → 不落库；同 key 异 payload → IdempotencyKeyReusedError（409）。Provider/存储失败在后续 JobView.error 中可见，不作为本次 POST 的同步结果 |

```
GenerationTarget {
  provider: ProviderId   // 必填
  model: string          // 必填
}

SubmitGenerationParams {
  clientRequestId: string         // 必填，RFC 4122 UUID；同一浏览器用户意图的稳定身份
  prompt: string                 // 必填
  targets: GenerationTarget[]    // 必填，长度 ≥ 1，(provider,model) 唯一
  sessionId: string  // 2026-07-16 必填；缺失 → ValidationError
  mode?: ProviderMode            // 默认 text-to-image
  width?: number
  height?: number
  aspectRatio?: string           // 公开宽高比，如 "1:1"；各 adapter 自行映射
  count?: number                 // 默认 1；对每个 target 分别校验
  negativePrompt?: string
  seed?: number                  // 可选。构造每 target 的 NormalizedRequest 时：
                                 //   supportsSeed → 传入 seed；否则省略。
                                 // web-ui：任一选中模型 supportsSeed 则展示 seed 控件。
  referenceImages?: string[]     // image-to-image 至少一张；按 adapter 限制裁剪/翻译
  providerOptions?: Record<string, unknown>
}
```

**Breaking change**: 移除顶层单字段 `provider` / `model`；改由 `targets[]` 表达。单模型请求为 `targets: [{ provider, model }]`。

**持久化边界**: 不是持久化原始 API body。admission 为每个 target 保存 capability 裁剪后的、版本化 `NormalizedRequest` snapshot（含相应的尺寸/count/seed/referenceImages 等白名单字段），仅供重启后安全恢复 dispatch；API/UI 不返回 snapshot，job 终态时清理。`provider`/`model` 仍分别写在 job 行；credential、session、Provider 原始对象和 raw Base64/data URL 不得进入 snapshot。

### 3.2 getGeneration(id)

| 属性 | 值 |
|------|-----|
| 输出 | `GenerationView` |
| 失败 | NotFoundError |

```
GenerationView {
  id, sessionId, projectId, prompt, status, createdAt, updatedAt,
  jobs: JobView[],      // 长度 = targets 数
  images: ImageView[]   // 跨 job 扁平列表；用 jobId 归属
}

JobView { id, provider, model, status, error? }
ImageView { id, jobId, index, url, width, height, favorited }
```

`getGeneration()` 读取后可以辅助调用 `advance()`，但 caller 不可据此假设同步完成：只有该 job 当前 due 且 lease 可 claim 时才可能发生一次生命周期动作。

### 3.3 API 路由契约（generation 相关）

#### POST /api/generations

| 属性 | 值 |
|------|-----|
| 请求体 | SubmitGenerationParams（JSON） |
| 请求大小 | 有界 JSON body；超过 API 上限返回 413 `PAYLOAD_TOO_LARGE` |
| 幂等 | `clientRequestId` 必填；可选 `Idempotency-Key` 若提供必须与 body 完全一致 |
| 成功 | `202 Accepted` `{ id, status, replayed, links: { self } }`，并带 `Location: /api/generations/:id` |
| 校验失败 | 400 |
| 同 key、异 payload | 409 `IDEMPOTENCY_KEY_REUSED` |
| targets 空 / 重复 | 400 |
| 某 target 不支持 aspectRatio | 400 |
| seed 对不支持的 target | 不 400；该 target 请求省略 seed |
| sync target count>1 | 400 |

#### GET /api/generations/:id

| 属性 | 值 |
|------|-----|
| 成功 | 200 GenerationView（含多 jobs） |
| 不存在 | 404 |

其余 sessions / providers / images / health 契约不变（见原文档与 constraints）；providers 响应中的 `supportedAspectRatios` 须为**公开比**（见 providers 文档）。

---

## 4. Data Ownership & Responsibility（数据归属与责任）

| 数据 | 创建 | 更新 | 责任 |
|------|------|------|------|
| generation | orchestrator | lifecycle / orchestrator 聚合 | db 存，job-engine 编排 |
| generation_jobs（N 行） | orchestrator | lifecycle 每 job | db 存，job-engine 编排 |
| images | lifecycle.storeImages | 不可变 | 归属 jobId |
| session | API | API + touchSession | job-engine 不 CRUD session |
| request snapshot | orchestrator 每 target 构造 | lifecycle 读取、终态清理 | versioned/validated `NormalizedRequest`，仅供恢复 dispatch，不进入 DTO |
| result snapshot | lifecycle 收到 completed refs | lifecycle storing、终态/取消清理 | 有界远端 ref 或 opaque `staging:<uuid>`；不存 raw inline data |
| 能力交集 | — | — | **web-ui**，非本模块 |

---

## 5. 与旧契约对齐说明

| 旧 | 新 |
|----|----|
| `provider` + `model` | `targets: [{ provider, model }, ...]` |
| 1 job | N jobs |
| 聚合规则按单 job | 多 job 聚合见 constraints §8（部分成功 → generation `completed`） |
| POST 内直接 provider.submit / 可能 201 completed | commit admission 后立即 `202`；worker/default phase lifecycle 再执行外部副作用 |
| GET 推进所有 async job | GET 只在 due/lease 可 claim 时辅助推进；worker 默认运行，`JOB_WORKER_ENABLED=false` 显式关闭 |
| 用 status 充当乐观锁 | 内部 phase + `pollLeaseUntil` CAS；物理 `next_poll_at` 是当前 phase 的 due 时间 |

---

## 自检（提交前）

- 扇出 submit/get 数据流完整；部分失败隔离明确
- seed / aspectRatio 校验规则与 web-ui 约定一致
- durable `202`、idempotency、snapshot 与 phase/lease 语义闭合

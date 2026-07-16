# job-engine 模块 · dfd-interface

> 模块路径: `src/lib/job-engine/`
> 前置文档: goals-duty.md, architecture.md
> 文档顺序: ④ dfd-interface(本文) → ⑤ use-case → ⑦ test
> 运行时约束: 见 `docs/mvp/api/constraints.md`
> 修订说明: 2026-07-15 `targets[]` 扇出；共享 aspectRatio；按 target 构造 NormalizedRequest

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

### 2.1 Submit 流程（POST /api/generations）

```
API 层: POST /api/generations
  → 解析 body → SubmitGenerationParams
  → job-engine.submitGeneration(params)

  orchestrator:
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

    3. db.transaction(() => {
         createGeneration({ sessionId, prompt: processedPrompt, status: "pending" })
         for target in targets:
           createGenerationJob({ generationId, provider, model, status: "pending" })
       })

    4. touchSession(sessionId)

    5. 对每个 job（顺序或有限并行）:
         caps = capabilities(model)
         normalized = {
           prompt: processedPrompt,
           mode, width, height, aspectRatio, count,
           negativePrompt,
           seed: caps.supportsSeed ? seed : undefined,
           referenceImages,
           providerOptions
         }  // 显式 pick，禁止 ...params 扩散；不含 provider/model/sessionId

         result = provider.submit(normalized, model)

         5a. sync + images → lifecycle.completeSync(jobId, images) → storeImages → job completed
         5b. failed → job failed + error
         5c. async + handle → 序列化 providerHandle，job 保持 pending

    6. aggregateGenerationStatus(all jobs) → updateGeneration.status
       （若仍有 pending/running → pending/running；规则见 constraints §8）

  → 返回 { generationId, status }
  → API 201 { id, status, links: { self: "/api/generations/:id" } }
```

**201 status 枚举**: `"pending"` | `"running"` | `"completed"` | `"failed"` | `"cancelled"`

| 典型扇出结果 | status |
|--------------|--------|
| 全 async 且 submit 成功 | `pending` |
| 全 sync 且均转存成功 | `completed` |
| 一 sync 成功 + 一 async pending | `pending`（或 `running`，若已有 running） |
| 全部 target submit/转存失败 | `failed` |
| 部分 job completed + 部分 failed（均已终态） | `completed`（部分成功；失败 job 仍在 `jobs[]`） |

校验失败（步骤 1）→ 400，**不创建** generation。

### 2.2 Get 流程（GET /api/generations/:id）— 多 job 惰性 poll

```
API 层: GET /api/generations/:id
  → job-engine.getGeneration(id)

  orchestrator:
    1. db.getGenerationWithJobsAndImages(id) → 无则 NotFoundError

    2. 若 generation 尚未全部终态:
       → 收集 status ∈ {pending, running} 的 jobs
       → Promise.all(jobs.map(job => lifecycle.advance(job)))
           advance:
             claim: UPDATE job SET poll_lease_until=?, next_poll_at=NULL WHERE id=?
                    AND status IN ('pending','running') AND provider_handle IS NOT NULL
                    AND cancel_requested_at IS NULL
                    AND (next_poll_at IS NULL OR next_poll_at<=now)
                    AND (poll_lease_until IS NULL OR poll_lease_until<=now)
             行数 0 → return（跳过）
             反序列化 handle → provider.poll
             按 PollResult 更新真实 status 并清空 lease；completed 则 storeImages
       → aggregateGenerationStatus → updateGeneration

    3. 重新读取并返回 GenerationView
```

已全部终态的 generation **不触发** poll。

### 2.3 Cancel 流程（POST /api/generations/:id/cancel）

```
API → orchestrator.cancelGeneration
  → 对 active jobs CAS 写 cancel_requested_at
  → 有 provider.cancel 且有 handle 时尽力调用
  → 统一写 cancelled、清理 lease/next_poll_at、同步 generation 聚合状态
```

没有远程取消端点的 provider（例如 Kling 标准图片 API）仍立即停止本地 poll，并在 job.error 写入 `CANCEL_UNSUPPORTED`。

### 2.3 Session 关联（必填，2026-07-16）

每次 submit 必须带合法 `sessionId`：校验存在 → 写入 `generations.session_id` → `touchSession`。
**禁止** `session_id=null` 的独立生成。

Session / Project CRUD 由 **library + API** 负责，不经 job-engine。Session 必属某 Project（db 约束）。

### 2.4 GET session / project 树 — 只读聚合

`GET /api/sessions/:id?include=generations` 与 History 列表只经 library 读取已存状态，**不调用** job-engine。只有 `GET /api/generations/:id` 会调用 `getGeneration` 并推进其下全部未终结 jobs。

### 2.5 图片访问

仍不经 job-engine：API → db.getImage → storage.getReadStream。

### 2.6 图片转存（lifecycle.storeImages）

逻辑同前版，**作用域为单个 job**:

- `imageExists(jobId, index)` 幂等
- 单 job 内任一张失败 → 该 job failed；已成功 images 保留
- **不**将其他 job 标失败

### 2.7 Provider 列表

`GET /api/providers` 不经 job-engine；API → registry.listEnabled()。web-ui 用其驱动模型多选与参数显隐。

---

## 3. Interface Definition（接口定义）

### 3.1 submitGeneration(params)

| 属性 | 值 |
|------|-----|
| 输入 | `SubmitGenerationParams` |
| 输出 | `{ generationId: string; status: GenerationStatus }` |
| 失败 | ValidationError → 不落库；单 job provider 失败不抛，写 job failed 后返回聚合 status |

```
GenerationTarget {
  provider: ProviderId   // 必填
  model: string          // 必填
}

SubmitGenerationParams {
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

**持久化边界**: 除 prompt、sessionId、provider/model（在 jobs 行）外，运行时尺寸/count/seed/referenceImages 等**不入库**。

### 3.2 getGeneration(id)

| 属性 | 值 |
|------|-----|
| 输出 | `GenerationView` |
| 失败 | NotFoundError |

```
GenerationView {
  id, sessionId, prompt, status, createdAt, updatedAt,
  jobs: JobView[],      // 长度 = targets 数
  images: ImageView[]   // 跨 job 扁平列表；用 jobId 归属
}

JobView { id, provider, model, status, error? }
ImageView { id, jobId, index, url, width, height }
```

### 3.3 API 路由契约（generation 相关）

#### POST /api/generations

| 属性 | 值 |
|------|-----|
| 请求体 | SubmitGenerationParams（JSON） |
| 成功 | 201 `{ id, status, links: { self } }` |
| 校验失败 | 400 |
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
| NormalizedRequest | orchestrator 每 target 构造 | 不可变 | 不入库 |
| 能力交集 | — | — | **web-ui**，非本模块 |

---

## 5. 与旧契约对齐说明

| 旧 | 新 |
|----|----|
| `provider` + `model` | `targets: [{ provider, model }, ...]` |
| 1 job | N jobs |
| 聚合规则按单 job | 多 job 聚合见 constraints §8（部分成功 → generation `completed`） |
| 用 status 充当乐观锁 | 独立 `pollLeaseUntil`；pending/running 均可在租约过期后 claim |

---

## 自检（提交前）

- 扇出 submit/get 数据流完整；部分失败隔离明确
- seed / aspectRatio 校验规则与 web-ui 约定一致
- Breaking change 与 API 201/400 语义闭合

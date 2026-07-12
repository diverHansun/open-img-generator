# job-engine 模块 · dfd-interface

> 模块路径: `src/lib/job-engine/`
> 前置文档: goals-duty.md, architecture.md
> 文档顺序: ④ dfd-interface(本文) → ⑦ test
> 运行时约束: 见 `docs/mvp/api/constraints.md`

---

## 1. Context & Scope（上下文与范围）

### 交互模块

| 方向 | 模块 | 交互内容 |
|------|------|----------|
| 上游调用方 | API 层 | 调用 submitGeneration / getGeneration |
| 下游依赖 | providers | submit / poll / capabilities 查询 |
| 下游依赖 | prompt | process(prompt) → 处理后的 prompt |
| 下游依赖 | storage | downloadAndStore(url) → storagePath |
| 下游依赖 | db | generation / job / image 的 CRUD |

### 本文档范围

- job-engine 的两条核心数据流（submit 和 get）
- 对外函数接口定义
- API 层路由契约（作为 job-engine 的 HTTP 暴露层附载于此）

不描述: providers 内部协议翻译、storage 文件写入细节、db schema 定义。

---

## 2. Data Flow Description（数据流描述）

### 2.1 Submit 流程（POST /api/generations）

```
API 层: POST /api/generations
  → 解析 body: SubmitGenerationParams（JSON）
  → job-engine.submitGeneration(params)

  orchestrator:
    1. validator.validate(params)
       → registry.getById(provider) — 确认启用
       → provider.capabilities(model) — 确认 model 存在
       → 校验 count <= maxCount, mode 在 modes 中, 尺寸合法
       → 若 seed 有值且 capabilities.supportsSeed === false → 400
       → 若 negativePrompt 有值且 capabilities.supportsNegativePrompt === false → 400
       → 若 sessionId 有值: db.sessionExists(sessionId) 为 false → 400
       → sync provider（protocol === "sync"）且 count > 1 → 400（MVP sync 限制 count=1，见 constraints.md）

    2. prompt.process(prompt) → processedPrompt

    3. db.transaction(() => {
         createGeneration({ sessionId, prompt: processedPrompt, status: "pending" })
         createGenerationJob({ generationId, provider, model, status: "pending" })
       })
       → generationId, jobId

    4. 若 sessionId 非空: db.touchSession(sessionId)

    5. 构造 NormalizedRequest（显式 pick，不含 provider/model/sessionId）:
         {
           prompt: processedPrompt,
           mode, width, height, aspectRatio, count,
           negativePrompt, seed, providerOptions
         }

    6. provider.submit(normalizedRequest, model) → SubmitResult

    7a. [sync 路径] SubmitResult.kind === "sync":
        → lifecycle.completeSync(jobId, submitResult.images)
          → lifecycle.storeImages(jobId, images)  // 见 §2.6
          → db.updateJob(jobId, { status: "completed", updatedAt: now })
          → db.updateGeneration(generationId, { status: "completed", updatedAt: now })

    7b. [sync 失败] SubmitResult.kind === "failed":
        → db.updateJob(jobId, { status: "failed", error, updatedAt: now })
        → db.updateGeneration(generationId, { status: "failed", updatedAt: now })

    7c. [async 路径] SubmitResult.kind === "async":
        → db.updateJob(jobId, {
             status: "pending",
             providerHandle: serialize(handle),
             updatedAt: now
           })
        → generation 保持 pending

  → 返回 { generationId, status } 给 API 层
  → API 层返回 201 { id, status, links: { self: "/api/generations/:id" } }
```

**201 响应 status 枚举**: `"pending"` | `"completed"` | `"failed"`

| 路径 | status |
|------|--------|
| async submit 成功 | `pending` |
| sync submit 成功且转存完成 | `completed` |
| provider submit 失败 | `failed` |

校验失败（步骤 1）抛 ValidationError，API 层返回 400，**不创建** generation 记录。

### 2.2 Get 流程（GET /api/generations/:id）— 含惰性 poll

```
API 层: GET /api/generations/:id
  → job-engine.getGeneration(id)

  orchestrator:
    1. db.getGenerationWithJobsAndImages(id) → 不存在则 NotFoundError

    2. 若 generation.status 为 "pending" 或 "running":
       → 对每个 status 为 pending/running 的 job:
         → lifecycle.advance(job)  // 含乐观锁，见 architecture.md §4.5
           → 反序列化 providerHandle
           → provider.poll(handle) → PollResult
           → 按 PollResult.status 更新:
             - pending → job 保持 pending
             - running → db.updateJob({ status: "running", updatedAt: now })
             - completed → lifecycle.storeImages(jobId, images) → updateJob(completed)
             - failed → db.updateJob({ status: "failed", error, updatedAt: now })
             - cancelled → db.updateJob({ status: "cancelled", updatedAt: now })
           → db.updateGeneration 聚合 status + updatedAt

    3. 重新读取 db.getGenerationWithJobsAndImages(id)

  → 返回 GenerationView 给 API 层
  → API 层返回 200 JSON
```

已完成（`completed` / `failed` / `cancelled`）的 generation **不触发** poll。

### 2.3 Session 关联（可选）

```
POST /api/generations { sessionId: "xxx", ... }
  → validator 确认 session 存在
  → db.createGeneration({ sessionId: "xxx", ... })
  → submit 成功后 db.touchSession(sessionId)
  → 正常走 provider 流程

POST /api/generations { ... }  // 无 sessionId
  → db.createGeneration({ sessionId: null, ... })
  → 不调用 touchSession
```

session 的 CRUD 由 API 层直接调 db 模块，不经过 job-engine。

### 2.4 GET /api/sessions/:id — 含嵌套 generation 推进

```
API 层: GET /api/sessions/:id
  → db.getSession(id) → 不存在则 404
  → db.listGenerationsBySession(id)
  → 对每个 status 为 pending/running 的 generation:
       → job-engine.getGeneration(gen.id)  // 复用惰性 poll + 转存逻辑
  → 重新 db.listGenerationsBySession(id)
  → 返回 { id, title, createdAt, updatedAt, generations: GenerationView[] }
```

session 详情页必须与单条 `GET /api/generations/:id` 行为一致，避免 async 任务在 session 视图下永远 pending。

### 2.5 图片访问（GET /api/images/:id）

```
API 层: GET /api/images/:id
  → db.getImage(id) → { storagePath, contentType, ... }
  → storage.getReadStream(storagePath)  // MVP 仅二进制流，无重定向
  → 返回 HTTP 200 + Content-Type + 二进制 body
```

此路由不经过 job-engine，API 层直接调 db + storage。

### 2.6 图片转存（lifecycle.storeImages）

对 `ProviderImageRef[]` 逐张处理，sync/async 路径共用:

```
对每张 ref（按 index 顺序）:
  1. 若 db.imageExists(jobId, index) → 跳过（幂等，防并发 GET 重复转存）
  2. storage.downloadAndStore(ref.url) → { storagePath, contentType, sizeBytes }
  3. db.createImage({
       jobId,
       index,
       storagePath,
       contentType,          // 以 storage 返回值为准
       width: ref.width,     // 优先 ProviderImageRef，缺失则 NULL
       height: ref.height,
       sizeBytes
     })
  4. 任一张 downloadAndStore 失败:
       → 已成功的 image 记录保留（不 rollback 文件）
       → db.updateJob(jobId, { status: "failed", error: StorageError, updatedAt: now })
       → db.updateGeneration 聚合为 failed
       → 中止剩余张数，不再继续
```

**部分转存规则（MVP）**: 任一张失败 → job 与 generation 均为 `failed`；已成功入库的 images 保留在响应中；不自动重试剩余张数。客户端需发起新 generation。

### 2.7 Provider 列表（GET /api/providers）

```
API 层: GET /api/providers
  → providers.registry.listEnabled()
  → 返回 ProviderInfo[]
```

此路由不经过 job-engine，API 层直接调 providers。

---

## 3. Interface Definition（接口定义）

### 3.1 job-engine 对外函数

#### submitGeneration(params)

| 属性 | 值 |
|------|-----|
| 输入 | `SubmitGenerationParams`（见下方） |
| 输出 | `{ generationId: string; status: GenerationStatus }` |
| 同步/异步 | 同步（sync 路径可能阻塞较久，见 constraints.md） |
| 失败 | 校验失败抛 ValidationError；provider 失败不抛，写入 db 后返回 status=`failed` |

```
SubmitGenerationParams {
  provider: ProviderId       // 必填
  model: string              // 必填
  prompt: string             // 必填
  sessionId?: string         // 可选；须已存在
  mode?: ProviderMode        // 默认 "text-to-image"
  width?: number
  height?: number
  aspectRatio?: string
  count?: number             // 默认 1
  negativePrompt?: string
  seed?: number
  providerOptions?: Record<string, unknown>
}
```

**持久化边界**: 上列除 `provider`、`model`、`prompt`、`sessionId` 外，其余字段仅存在于单次请求运行时（校验 → `NormalizedRequest` → adapter），**不写入 db**。详见 `db/data-model.md` §3.0。

**NormalizedRequest 构造**（步骤 5 显式字段，禁止 `...params` 扩散）:

```
pick(params, [
  "mode", "width", "height", "aspectRatio", "count",
  "negativePrompt", "seed", "providerOptions"
]) + { prompt: processedPrompt }
```

#### getGeneration(id)

| 属性 | 值 |
|------|-----|
| 输入 | generation id 字符串 |
| 输出 | `GenerationView`（见下方） |
| 同步/异步 | 同步（内部可能触发 poll HTTP 调用） |
| 失败 | 不存在抛 NotFoundError |

```
GenerationStatus = "pending" | "running" | "completed" | "failed" | "cancelled"

GenerationView {
  id: string
  sessionId: string | null
  prompt: string
  status: GenerationStatus
  createdAt: string          // ISO 8601
  updatedAt: string
  jobs: JobView[]
  images: ImageView[]
}

JobView {
  id: string
  provider: ProviderId
  model: string
  status: GenerationStatus
  error?: ProviderError
}

ImageView {
  id: string
  jobId: string
  index: number              // 批次内序号，与 ProviderImageRef.index 对应
  url: string                // 本地访问 URL: /api/images/:id
  width: number | null
  height: number | null
}
```

#### createImage 写入契约（db 层，job-engine 调用）

```
CreateImageParams {
  jobId: string
  index: number              // 0-based，(jobId, index) 唯一
  storagePath: string
  contentType: string        // 来自 storage.downloadAndStore
  width: number | null       // 来自 ProviderImageRef，缺失则 null
  height: number | null
  sizeBytes: number          // 来自 storage.downloadAndStore
}
```

### 3.2 API 路由契约

#### POST /api/generations

| 属性 | 值 |
|------|-----|
| 请求体 | SubmitGenerationParams（JSON） |
| 成功响应 | 201 `{ id, status, links: { self: "/api/generations/:id" } }` |
| status | `"pending"` \| `"completed"` \| `"failed"` |
| 校验失败 | 400 `{ error: string }` |
| provider 未启用 | 400 `{ error: "Provider not enabled" }` |
| sessionId 不存在 | 400 `{ error: "Session not found" }` |
| sync provider count > 1 | 400 `{ error: "Sync provider supports count=1 only in MVP" }` |

#### GET /api/generations/:id

| 属性 | 值 |
|------|-----|
| 路径参数 | generation id |
| 成功响应 | 200 `GenerationView` |
| 不存在 | 404 `{ error: "Not found" }` |

#### GET /api/providers

| 属性 | 值 |
|------|-----|
| 成功响应 | 200 `ProviderInfo[]` |

#### GET /api/images/:id

| 属性 | 值 |
|------|-----|
| 路径参数 | image id |
| 成功响应 | 200 图片二进制（Content-Type 来自 `images.content_type`） |
| 不存在 | 404 |

#### POST /api/sessions

| 属性 | 值 |
|------|-----|
| 请求体 | `{ title?: string }` |
| 成功响应 | 201 `{ id, title, createdAt, updatedAt }` |

#### GET /api/sessions/:id

| 属性 | 值 |
|------|-----|
| 成功响应 | 200 `{ id, title, createdAt, updatedAt, generations: GenerationView[] }` |
| 不存在 | 404 |
| 行为 | 对 pending/running 的嵌套 generation 触发惰性 poll（同 §2.4） |

#### GET /api/health（MVP 建议）

| 属性 | 值 |
|------|-----|
| 成功响应 | 200 `{ status: "ok", enabledProviders: string[], db: "ok" }` |
| 无 provider 启用 | 仍 200，但 `enabledProviders: []`；启动日志应 WARNING |

---

## 4. Data Ownership & Responsibility（数据归属与责任）

| 数据 | 创建 | 更新 | 查询 | 责任模块 |
|------|------|------|------|----------|
| generation 记录 | job-engine (orchestrator) | job-engine (lifecycle) | job-engine + API 层 | db 存储，job-engine 编排 |
| generation_job 记录 | job-engine | job-engine (lifecycle) | job-engine | db 存储，job-engine 编排 |
| image 记录 | job-engine（转存后） | 不可变 | API 层 + job-engine | db 存储，job-engine 创建 |
| session 记录 | API 层（直接调 db） | API 层 | API 层 | db 存储，job-engine 不感知 session CRUD |
| session.updated_at | job-engine (touchSession) | API 层 (updateSession) | API 层 | 见 db/data-model §2.1 |
| 图片文件 | storage（job-engine 触发） | 不可变 | storage | storage 模块 |
| ProviderImageRef（临时 URL） | providers | - | - | providers 创建，job-engine 消费后立即转存 |

---

## 5. API 路由与代码骨架对齐

MVP **唯一**生成入口:

- `POST /api/generations`（`sessionId` 可选）

以下骨架路径**废弃**，编码时不实现:

- `src/app/api/sessions/[id]/gen/` — 早期占位，已由统一端点取代

编码时应创建:

- `src/app/api/generations/route.ts`（POST）
- `src/app/api/generations/[id]/route.ts`（GET）
- `src/app/api/sessions/route.ts`（POST）
- `src/app/api/sessions/[id]/route.ts`（GET）

---

## 自检（提交前）

- submit 和 get 两条数据流完整描述，含 sync/async 分支
- touchSession、createImage 完整字段、NormalizedRequest 显式 pick 已闭合
- POST 201 status 含 failed；无效 sessionId → 400
- GET sessions 触发嵌套 poll；图片访问仅 getReadStream
- 部分转存失败与并发幂等语义已定义

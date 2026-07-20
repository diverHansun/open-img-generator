# MVP API 运行时约束

> 适用范围: MVP API + Generate workbench
> 关联文档: job-engine/dfd-interface.md, providers/data-model.md, db/data-model.md, web-ui/dfd-interface.md
> 修订说明: 2026-07-15 扇出 targets[]、多 job 聚合、poll lease、公开宽高比
> 修订说明: 2026-07-16 sessionId 必填；Project/Favorite/ModelPrefs 路由；取消零散 Session
> 修订说明: 2026-07-16 §14–§16 页面矩阵、DTO、prefs 默认全开、迁移（后端契约锁定）
> 修订说明: 2026-07-16 Kling 独立 adapter、加密 user-config、取消/worker/限流、可选单用户 auth、图片清理
> 修订说明: 2026-07-20 D1/D2 durable admission、phase/lease lifecycle、默认 worker、原子取消、inline staging 与持久化 poll/cancel retry

本文档闭合并行审查中发现的运行时语义缺口。编码时必须遵守。

---

## 1. 部署与安全前提

| 约束 | 说明 |
|------|------|
| **localhost-only（MVP 默认）** | 服务应绑定 `127.0.0.1` 或仅在受信网络内访问。设置 `APP_AUTH_TOKEN` 可开启单用户 Bearer/HttpOnly-cookie 认证；durable admission 由 SQLite 事务保证，Provider 调用仍使用进程内并发 limiter。暴露公网仍不建议。 |
| 启动诊断 | 若 `registry.listEnabled()` 返回空数组，启动时打印 `WARNING: no providers enabled`。`GET /api/health` 返回 `enabledProviders: []`。 |
| API key | 优先级为 `env > USER_CONFIG_DIR/credentials.enc.json`；user-config 使用 AES-256-GCM + scrypt，永不通过 API 响应返回明文。 |

---

## 2. 客户端 poll 契约（含扇出）

**所有** target（包含 sync Provider）均不会在 POST 后同步等待完成。POST 只在同一 transaction 内完成 durable admission，返回 `202 Accepted`；Provider submit、poll、图片转存和远端 cancel 由 phase/lease lifecycle 推进。详情 `GET /api/generations/:id` 是 worker 被明确关闭时的恢复触发器，但仍严格遵守已持久化的 due time 与 lease；History/Session/Generation 列表全部只读。后台 worker 默认启动，只有 `JOB_WORKER_ENABLED=false` 才关闭。

| 项 | 建议值 |
|----|--------|
| 首次推进 | POST 返回 `202` 后 worker 尽快扫描；worker 关闭时 Stage 可立即请求一次详情 |
| 轮询间隔 | Provider `pending/running` 的正常 due 为 5s；retryable poll failure 使用 D2 持久化 full-jitter（2s base、60s cap、最多 6 次/10 分钟） |
| 放弃条件 | 连续 poll 超过 10 分钟仍有 pending/running → 客户端停止；服务端状态保留，稍后 GET 可继续推进 |
| 厂商 URL 过期 | 必须在过期前完成 poll + 转存 |
| POST 响应 | `202`、`Location`、`X-Request-Id` 与 `links.self` → `GET /api/generations/:id` |
| 终态判断 | `view.status ∈ {completed, failed, cancelled}` **或**（更稳妥）所有 `jobs[].status` 均已终态 |

```
POST /api/generations { prompt, targets, aspectRatio, ... } → { id, status, links }
loop:
  GET links.self → view
  if all jobs terminal: break
  sleep(backoff)
```

---

## 3. Sync Provider 验证与 count 限制

sync Provider 与 async Provider 共享 admission → dispatch → storing 生命周期；差异仅是 submit 结果直接进入 `storing`，而非先持久化 async handle 再 `polling`。它不再延长 POST。

| 约束 | 值 |
|------|-----|
| MVP sync target count 上限 | **1**（该 target 的 count>1 → 400） |
| provider submit 超时 | 当前 adapter 语义不变；统一 deadline/retry 分类由 Batch E 收口 |
| 单张 storage 下载超时 | 当前 storage 默认 60s；完整流式/remote URL 安全由 Batch E 收口 |
| 多 sync target | 各 job 独立排队/claim；POST 始终只等待 admission transaction |
| async target | 不受 sync count=1 限制，仍受 capabilities.maxCount |

---

## 4. 并发推进与幂等（独立 lifecycle lease）

多个 worker 或客户端详情 GET 同时推进同一 generation 时:

| 机制 | 说明 |
|------|------|
| phase claim | phase 是 `queued / dispatching / polling / storing / cancelling / terminal / outcome_unknown`；每个外部动作以 `phase + next_poll_at + poll_lease_until + cancel marker` 的条件 UPDATE claim，影响行数 0 则跳过 |
| 租约时长 | 300 秒；覆盖单次 dispatch/poll/store/cancel。dispatch lease 过期且无结果/handle 时转 `outcome_unknown`，绝不重投 |
| 状态与锁 | claim 只改内部 phase/lease，不把公开 status 从 running 回退为 pending；外部结果写回带原 lease + phase CAS，失去租约的旧 worker 不能覆盖新结果 |
| 转存幂等 | `(jobId,index)` 唯一；下载后的 image row、phase 和 Generation 聚合在一个短 transaction 内提交，取消先线性化时不出现新 image row |
| 已终态 | `terminal` / `outcome_unknown` 不再 advance；Generation 全部 job 终态时详情 GET 不触发外部动作 |

---

## 5. 部分转存失败（单 job 内）

- 逐张 `downloadAndStore`；**任一张失败** → 停止该 job 剩余张数
- 已成功的 `images` **保留**
- **仅该 job** → `failed`；其他 jobs 不受影响
- generation 聚合见 §8
- D2 不重试 storage/download；客户端可发起新 generation。仅已有 handle 的 poll/cancel 使用其各自的有界 retry，不能据此推断 submit 可重放。

---

## 6. 数据库事务

| 操作 | 事务要求 |
|------|----------|
| admission: Generation + 全部 Jobs + snapshots + Session touch | **同一** SQLite immediate transaction |
| 单次 lifecycle Job update + Generation 聚合 | 同一 transaction |
| 单张转存 checkpoint | 条件 lease/cancel claim → image row → Job/Generation 聚合在同一短 transaction；文件先写入，DB 未接纳时立即清理 |

HTTP dispatch（provider.submit）在创建事务**提交之后**。

---

## 7. 时间戳更新规则

| 表 | updated_at 更新时机 |
|----|---------------------|
| projects | 创建；改 title；其下新建 session（可选 touch） |
| sessions | 创建；updateSession(title)；moveSession；touchSession |
| generations | 每次聚合 status 变更 |
| generation_jobs | 每次 status / error / provider_handle / poll_lease_until / next_poll_at / cancel_requested_at 变更 |
| images | 不更新（不可变） |
| favorites | 不更新（不可变关系行；取消即删除） |
| model_preferences | 每次 enabled 变更 |

---

## 8. generation 状态聚合规则（多 job）

由 generation 下**全部** job 状态推导:

| 优先级 | 条件 | generation.status |
|--------|------|-------------------|
| 1 | 存在 job `running` | `running` |
| 2 | 存在 job `pending`（且无 running） | `pending` |
| 3 | 全部已终态，且至少一 job `completed` | `completed`（**允许**同时存在 failed jobs；失败详情在 `jobs[]`） |
| 4 | 全部已终态，无 completed，存在 `cancelled` | `cancelled` |
| 5 | 全部已终态，其余 | `failed` |

说明:
- **部分成功优先显示 completed**，便于 workbench 展示「有模型出图」；失败模型仍可在 UI 按 job 行展示 error。
- 单 job 时退化为与旧行为一致（failed → failed；completed → completed）。

---

## 9. storage 安全

`getReadStream(storagePath)` 必须 canonicalize 并断言落在 `LOCAL_STORAGE_DIR` 下；不存在则 NotFoundError。

---

## 10. 错误 HTTP 映射（API 层）

| 错误类型 | HTTP | body 示例 |
|----------|------|-----------|
| ValidationError（含非法 targets / 不支持的 aspectRatio） | 400 | `{ "error": "..." }` |
| NotFoundError | 404 | `{ "error": "Not found" }` |
| 单/多 job provider 失败（已落库） | 201 | `{ "id", "status": <聚合>, "links" }` |
| StorageError（某 job 转存） | GET 200 | 该 job failed；聚合见 §8 |

---

## 11. POST /api/generations 请求形状（扇出）

```json
{
  "prompt": "string",
  "targets": [{ "provider": "fal", "model": "fal-ai/flux/schnell" }],
  "sessionId": "required-uuid",
  "width": null,
  "height": null,
  "aspectRatio": "1:1",
  "count": 1,
  "seed": null,
  "negativePrompt": null,
  "referenceImages": null
}
```

- **Breaking**: 不再接受顶层单独的 `provider` / `model`（实施时可短暂兼容单字段并内部转为 `targets`，但文档契约以 `targets` 为准）。
- **Breaking (2026-07-16)**: `sessionId` **必填**；缺失或指向不存在 session → 400。Session 必须已属于某 Project（由 library 创建时保证）。
- `aspectRatio` 为公开比；必须被**每一个** target 的 `supportedAspectRatios` 包含，否则 400。
- `width` 与 `height` 必须同时提供，且必须是正整数；两者优先于 `aspectRatio` 交给各 adapter 翻译。
- 可选字段显式传 `null` 时按未设置处理；客户端也可以直接省略这些字段。
- `seed`：对不支持的 target 在 NormalizedRequest 中省略，不因此 400。
- `mode: "image-to-image"` 时必须提供至少一张 `referenceImages`；adapter 再按各厂商协议翻译（Kling 标准端点最多一张）。

---

## 12. 资产与偏好路由（library，2026-07-16）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET/POST | `/api/projects` | 列表 / 创建 |
| GET | `/api/projects/:id` | 单条 Project |
| PATCH/DELETE | `/api/projects/:id` | 更新 title；删除**仅允许无 Session 的空 Project**（否则 409） |
| GET/POST | `/api/projects/:id/sessions` | 列出 / 在该 Project 下创建 Session |
| GET | `/api/sessions/:id` | Session 元数据；`?include=generations` 时附带该 session 下 generations（**只读，不推进 poll**） |
| PATCH | `/api/sessions/:id` | 更新 title |
| POST | `/api/sessions/:id/move` | body `{ "toProjectId": "..." }`；Session **MVP 不提供 DELETE** |
| GET | `/api/generations` | **列表**；query 见 §14.2；**默认不推进 poll** |
| GET | `/api/generations/:id` | 详情（完整 GenerationView）+ 尝试推进当前 due 且未被有效 lease 占用的 lifecycle job；worker 关闭时作为恢复触发器 |
| GET/POST | `/api/favorites` | 列表 / 收藏；形状见 §15 |
| DELETE | `/api/favorites/:imageId` | 取消收藏 |
| GET/PUT | `/api/model-preferences` | 启用池；形状与默认策略见 §15.4 |
| GET | `/api/providers` | 已启用厂商 + capabilities（既有） |
| GET | `/api/health` | 健康与配置摘要（既有） |
| GET | `/api/images/:id` | 读图（既有） |
| POST | `/api/generations/:id/cancel` | 请求取消；单个 transaction 内批量写入本地取消标记/聚合，随后 worker 对已持久化 handle 尽力调用 `provider.cancel`；Kling/Qwen 无远程端点时保留 `CANCEL_UNSUPPORTED` 警告 |
| POST/DELETE | `/api/auth/session` | `APP_AUTH_TOKEN` 配置时建立/清除 HttpOnly cookie；未配置时 POST 直接返回 authenticated |

**废弃**: `POST /api/sessions`（无 project）→ **400**，并提示改用 `POST /api/projects/:id/sessions`。

**不做（本轮）**: 通过浏览器 API 明文写 API key、Session 删除、树形一次性聚合 API、Settings 路由。取消、worker、限流、认证和图片清理已实现为后端控制能力；7 条无 session 历史记录删除沿用 library 的删除语义。

权威页面矩阵与 DTO：**§14–§15**。

---

## 13. 客户端状态可见性（web-ui 必须遵守）

| 阶段 | UI 应展示 |
|------|-----------|
| POST 返回后 | generation 与各 job 的 `pending`/`running`/`completed`/`failed`（不得空白「未知」） |
| 轮询中 | 按 job 分行更新 status；已完成 job 可先出图 |
| 终态 | 停止 poll；保留 error 文案 |

状态枚举不扩展；问题在展示与轮询，不在新状态机。

---

## 14. 页面 → API 矩阵（后端契约，已锁定）

> UI 视觉后置；本表是后端实现与合同测试的依据。

### 14.1 Generate

| 能力 | 方法 | 路径 |
|------|------|------|
| 列/建 Project | GET/POST | `/api/projects` |
| 列/建 Session | GET/POST | `/api/projects/:id/sessions` |
| 启用池 ∩ 能力 | GET | `/api/providers` + `/api/model-preferences` |
| 最近 N 次（当前 session） | GET | `/api/generations?sessionId=&limit=10` |
| 提交生成 | POST | `/api/generations`（`sessionId` 必填） |
| 轮询推进 | GET | `/api/generations/:id` |
| 取消任务 | POST | `/api/generations/:id/cancel` |
| 展图 | GET | `/api/images/:id` |
| 收藏 | POST/DELETE | `/api/favorites` |

POST 只校验 **session 存在**（`sessionExists`）；**不要求** body 带 `projectId`（project 由 session 反查）。进行中的 generation **必须**出现在 list 中。

### 14.2 History

| 能力 | 方法 | 路径 |
|------|------|------|
| Project 树第一层 | GET | `/api/projects`、`GET /api/projects/:id` |
| 改名 / 删空壳 | PATCH/DELETE | `/api/projects/:id` |
| Session 层 | GET/POST | `/api/projects/:id/sessions` |
| Session 改名 / 搬家 | PATCH / POST move | `/api/sessions/:id`、`/api/sessions/:id/move` |
| Generation 列表 | GET | `/api/generations?sessionId=` 或 `?projectId=`（**不 poll**） |
| 单条详情（worker 关闭时的恢复入口） | GET | `/api/generations/:id` |
| Session 聚合列表（只读） | GET | `/api/sessions/:id?include=generations` |
| 看图 / 收藏 | GET images；POST/DELETE favorites | 同 Generate |

**无**「一次返回整棵 Project 树」的聚合端点（MVP 多次请求）。

### 14.3 Gallery

| 能力 | 方法 | 路径 |
|------|------|------|
| 收藏网格 | GET | `/api/favorites?limit=&cursor=` |
| 取消收藏 | DELETE | `/api/favorites/:imageId` |
| 大图 | GET | `/api/images/:id` |
| 回溯到那次生成 | 用 GalleryItem 中的 `generationId` → | `GET /api/generations/:id` |

**无**单独的 favorite 详情路由；列表项即含回溯字段（§15.3）。

### 14.4 Models

| 能力 | 方法 | 路径 |
|------|------|------|
| 目录（能力） | GET | `/api/providers` |
| 启用偏好 | GET/PUT | `/api/model-preferences` |

工作台可选池 = registry 已启用模型中，**排除** prefs 里 `enabled === false` 的项（无 prefs 行 = 默认启用，§15.4）。

### 14.5 Providers

| 能力 | 方法 | 路径 |
|------|------|------|
| 已配置厂商与模型能力 | GET | `/api/providers` |
| 连接/配置摘要 | GET | `/api/health` |

本轮 **无** 写 key 路由（见 `user-config`）。

---

## 15. DTO 与查询语义（已锁定）

### 15.1 公共小对象

```ts
// Project
{ id: string, title: string, createdAt: string, updatedAt: string }

// Session
{ id: string, projectId: string, title: string | null, createdAt: string, updatedAt: string }
```

`POST /api/projects` body: `{ "title": string }` → 201 Project
`POST /api/projects/:id/sessions` body: `{ "title"?: string }` → 201 Session
`PATCH` 两类资源 body: `{ "title": string }`
`POST /api/sessions/:id/move` body: `{ "toProjectId": string }` → 200 Session

### 15.2 Generation 列表 vs 详情

**`GET /api/generations` query**

| 参数 | 规则 |
|------|------|
| `limit` | 默认 `10`；上限建议 `50` |
| `sessionId` | 可选；若有则只返回该 session |
| `projectId` | 可选；若有则返回该 project 下**全部 session** 的 generations |
| `sessionId` + `projectId` 同时出现 | **400**（歧义） |
| 二者皆无 | 返回全局最近（仍按 `createdAt` desc）；Generate 工作台应**总是带 sessionId** |
| `cursor` | 可选；不透明字符串（实现可用 `createdAt + id`）；省略则第一页 |

**排序**: `createdAt DESC`（含 pending/running）。

**列表项 `GenerationSummary`（瘦）** — **不**触发 poll：

```ts
{
  id: string
  sessionId: string
  prompt: string
  status: "pending" | "running" | "completed" | "failed" | "cancelled"
  createdAt: string
  updatedAt: string
  jobs: Array<{
    id: string
    provider: string
    model: string
    status: string
    error: unknown | null  // 列表可带简短 error；允许 null
  }>
  images: Array<{
    id: string
    jobId: string
    url: string            // "/api/images/{id}"
    width: number | null
    height: number | null
  }>
}

// 200 响应
{ items: GenerationSummary[], nextCursor: string | null }
```

**`GET /api/generations/:id`** — 完整既有 `GenerationView`（含 links 等）+ 尝试推进 due lifecycle job；形状以 job-engine dfd 为准。

### 15.3 Favorites / GalleryItem

`POST /api/favorites` body: `{ "imageId": string }` → 200/201 **GalleryItem**（重复收藏幂等，仍 200 + 同一 item）

`GET /api/favorites?limit=&cursor=`

| 参数 | 规则 |
|------|------|
| `limit` | 默认 `48`；上限建议 `100` |
| `cursor` | 可选；按 `favoritedAt DESC` |

```ts
// GalleryItem
{
  favoriteId: string
  imageId: string
  url: string
  width: number | null
  height: number | null
  favoritedAt: string
  jobId: string
  provider: string
  model: string
  generationId: string
  prompt: string
  sessionId: string
  projectId: string
  projectTitle: string | null
}

// 200
{ items: GalleryItem[], nextCursor: string | null }
```

无单独 favorite 详情 API。图片实体 MVP 不可删；若未来删图，收藏行应级联删除或 list 跳过坏引用（实现时再定，本轮无删图 API）。

### 15.4 Model preferences

**默认策略（锁定）**: 某 `(provider, model)` **没有** prefs 行 ⇒ 视为 **enabled**。仅当存在行且 `enabled === false` 时从工作台可选池剔除。

`GET /api/model-preferences` →

```ts
{ items: Array<{ provider: string, model: string, enabled: boolean, updatedAt: string }> }
```

只返回**已写入**的行（可为 `[]`）。

`PUT /api/model-preferences` — **增量 upsert**（单条）：

```ts
// body
{ provider: string, model: string, enabled: boolean }
// 200
{ provider: string, model: string, enabled: boolean, updatedAt: string }
```

- `(provider, model)` 必须出现在当前 registry 已启用模型中，否则 **400**。
- 可选后续扩展：body `{ items: [...] }` 批量；非本轮必须。

**工作台可选池算法（服务端可不提供专用 API，由客户端算；或后续加 convenience endpoint）**:

```
pool = registry.enabledModels
       .filter(m => !prefs.has(m) || prefs.get(m).enabled !== false)
```

### 15.5 错误码补充（资产域）

| 情况 | HTTP |
|------|------|
| 缺 sessionId / session 不存在 | 400 |
| project / session / image / favorite 目标不存在 | 404 |
| 删除非空 Project | **409** |
| move 目标 project 不存在 | 404 |
| model pref 指向未启用/未知模型 | 400 |
| generations list 同时传 sessionId 与 projectId | 400 |
| 废弃的 POST /api/sessions | 400 |

---

## 16. 实现期迁移（后端必须做）

已有 SQLite 若存在 `generations.session_id IS NULL` 或无 `projects` 表：

1. 创建表 `projects` / `favorites` / `model_preferences`；`sessions` 增加 `project_id`。
2. Backfill：若存在旧 Session，插入 Project（title=`Migrated project`）并将旧 Session 挂上；**无 Session 或指向无效 Session 的 generation 直接删除**（本地 MVP 数据已确认可丢弃）。其 jobs/images 随迁移过滤删除。
3. 再收紧 `NOT NULL` 与废弃旧 `POST /api/sessions`。

执行入口：`npm run db:migrate`。脚本可重复执行，并在结束前运行 SQLite foreign-key check。

迁移脚本归属实现任务，不在运行时隐式乱建（测试 helper 可自动建）。

## 17. 运行时控制（2026-07-16）

- `POST /api/generations/:id/cancel` 是幂等的本地取消入口。一个短 transaction 批量写取消标记、phase 与 Generation 聚合，并清除此前 poll retry/error；worker 之后才对已有 handle 尽力调用 provider cancel。retryable remote cancel 最多 3 次、总窗口 30 秒，穷尽后仍保持本地 `cancelled` 并写 `RETRY_EXHAUSTED`；Kling 标准图片 API 没有远程取消端点，因此保留 `CANCEL_UNSUPPORTED` 诊断而不伪造成功。
- `MAX_INFLIGHT_PER_PROVIDER` 限制同一 provider 的 submit/poll/cancel 并发；`MAX_QUEUED_PER_PROVIDER`（默认 32）限制每个 provider 的**进程内等待队列**，`PROVIDER_QUEUE_TIMEOUT_MS`（默认 30 秒）限制尚未开始的等待。满队、排队超时或排队 abort 都不会发出 Provider HTTP，worker 将其作为 `not_started` 的有界 submit retry；它们不是 POST admission 的同步 429，也不提供跨进程 backpressure。`MAX_INFLIGHT_GENERATIONS` 的旧内存 admission helper 仍不在 durable POST 路径使用。
- Node worker 默认启动；只有 `JOB_WORKER_ENABLED=false` 才关闭。它在 generation **POST** durable admission 后首次进入 Node 进程时 bootstrap（不依赖 Next instrumentation 的 Edge bundle），generation/session/history 列表 GET 不因读取而启动 worker。`WORKER_INTERVAL_MS`、`WORKER_BATCH_SIZE` 控制扫描，`IMAGE_CLEANUP_INTERVAL_MS` 触发清理。关闭 worker 时仍可由详情 GET 按 due/lease 规则辅助推进。
- `IMAGE_RETENTION_DAYS=30`（设为 `0` 禁用）删除过期且未收藏图片；文件缺失会被视为已清理。孤儿文件需超过 `IMAGE_ORPHAN_GRACE_MS` 才删除，收藏永不因保留期被删除。
- `APP_AUTH_TOKEN` 未配置时保持本地开发兼容；配置后 API middleware 要求 Bearer 或 `/api/auth/session` 建立的 HttpOnly cookie，health 与 session bootstrap 路由公开。

---

## 自检

- 与 job-engine / library / db / web-ui 文档无矛盾
- 编码者无需猜测：页面路由矩阵、list 瘦 DTO、GalleryItem、prefs 默认全开、session 必填、list 不 poll / 详情 poll

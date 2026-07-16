# db 模块 · data-model

> 模块路径: `src/lib/db/`
> 技术栈: Drizzle ORM + SQLite (better-sqlite3)
> 前置文档: 各模块 goals-duty / dfd-interface 中的数据需求
> 修订说明: 2026-07-16 新增 projects / favorites / model_preferences；Session 必属 Project；Generation 必属 Session（取消零散路径）

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
| created_at | TEXT | ISO 8601 |
| updated_at | TEXT | ISO 8601 |

生命周期: job-engine 创建，job-engine 更新 status。

`updated_at` 更新时机: 每次 `status` 变更时（与 job 聚合更新同步）。

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
| poll_lease_until | TEXT NULL | 轮询短期租约到期时间；仅用于并发 GET 排他，不表示厂商状态 |
| created_at | TEXT | ISO 8601 |
| updated_at | TEXT | ISO 8601 |

生命周期: job-engine 创建和更新。provider_handle 在 async submit 时写入；`completed` / `failed` / `cancelled` 后不再更新 handle（可选：completed 后清空 provider_handle 以减小 db 体积，MVP 可保留）。

`updated_at` 更新时机: 每次 `status`、`error`、`provider_handle`、`poll_lease_until` 变更时。

扇出: 一个 generation_id 对应 N 行 job（N ≥ 1）。`POST /api/generations` 的 `targets[]` 长度决定创建行数。

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

「模型的输入和输出」在不同层由不同模块负责，不要与 db 表字段混为一谈。

**关键区分**: `targets[]`、aspectRatio / count / seed / providerOptions 等是**合法的运行时输入参数**（API 接受、job-engine 校验、providers 消费），只是在任务完成后**不写入 db**。「不入库」不等于「不是输入」。

### 3.0 运行时输入 vs db 持久化（对照表）

| 字段 | API / job-engine 入参 | NormalizedRequest | 写入 db |
|------|----------------------|-------------------|---------|
| `prompt` | 是 | 是 | 是 → `generations.prompt` |
| `targets[]` (`provider` + `model`) | 是 | —（submit 第二参数） | 是 → 每个 target 一行 `generation_jobs.provider/model` |
| `sessionId` | **必填** | — | 是 → `generations.session_id` NOT NULL |
| `mode` | 是 | 是 | 否 |
| `aspectRatio` | 是 | 是 | 否 |
| `count` | 是 | 是 | 否 |
| `negativePrompt` | 是 | 是 | 否 |
| `seed` | 是 | 是 | 否 |
| `providerOptions` | 是 | 是 | 否 |
| `referenceImages` | 是（后续） | 是 | 否 |

数据流（仅示意输入侧）:

```
POST /api/generations { prompt, targets[], aspectRatio, count, seed, ... }
  → job-engine 校验参数（capabilities）
  → db 只写入 prompt / 每 target 的 provider + model / session_id
  → job-engine 构造每 target 的 NormalizedRequest（含 aspectRatio, count, seed, ...）
  → providers.submit(NormalizedRequest) → adapter 翻译为厂商 JSON
  → 请求结束，width/count/seed 等随进程释放，db 中无对应列
```

**与输出字段 `images.width/height` 的区别**: 表 `images` 上的 width/height 是**生成结果**的像素尺寸（转存时写入），不是用户提交的输入参数。

### 3.1 类型定义（运行时数据结构）

| 层次 | 结构 | 负责模块 | 文档位置 |
|------|------|----------|----------|
| API 入参 | `SubmitGenerationParams` | job-engine | job-engine/dfd-interface |
| 厂商无关请求 | `NormalizedRequest` | providers | providers/data-model |
| 厂商无关响应 | `SubmitResult` / `PollResult` | providers | providers/data-model |
| 单张临时图片 | `ProviderImageRef` | providers | providers/data-model |
| async 句柄 | `JobHandle` | providers | providers/data-model |
| 错误 | `ProviderError` | providers | providers/data-model |
| API 出参 | `GenerationView` | job-engine | job-engine/dfd-interface |
| 能力声明 | `ProviderCapabilities` | providers | providers/data-model |

**原则**: 凡跨模块传递的厂商相关类型，统一在 `providers/data-model.md` 定义；job-engine 和 API 层引用，不自行定义平行结构。

### 3.2 厂商原生 wire format（HTTP 请求体/响应体）

| 结构 | 负责模块 | 是否持久化 |
|------|----------|------------|
| fal queue 请求体（`prompt`, `image_size`, `seed`...） | providers/adapters/fal | 否，adapter 内部 ephemeral |
| zenmux OpenAI Images 请求体（`prompt`, `size`, `n`...） | providers/adapters/zenmux | 否，adapter 内部 ephemeral |
| 厂商原始 JSON 响应 | providers adapter 解析后立即丢弃 | 否 |

adapter 负责 `NormalizedRequest` ↔ 厂商 JSON 的双向翻译；此层结构不暴露给 job-engine，也不写入 db。

### 3.3 db 持久化（仅存业务需要回溯的子集）

| 数据 | 存哪张表 | 字段 | 说明 |
|------|----------|------|------|
| 输入: prompt | generations | `prompt` | 已过 prompt 模块处理的最终 prompt |
| 输入: targets 中 provider + model | generation_jobs | `provider`, `model` | 每 target 一行 |
| 输入: 其余参数（aspectRatio, count, seed, providerOptions...） | **不存** | — | 见 3.4 设计决策 |
| 输出: 持久化图片 | images | `storage_path`, `width`, `height`, `content_type`, `size_bytes` | 转存后的本地资产 |
| 输出: async 句柄 | generation_jobs | `provider_handle` | JobHandle JSON，任务进行中需要 |
| 输出: 错误 | generation_jobs | `error` | ProviderError JSON |
| 运行时协调: poll 租约 | generation_jobs | `poll_lease_until` | 轮询期间短暂存在；不用于状态展示 |

### 3.4 设计决策：不持久化生成输入参数（运行时仍接受）

**结论**: db **不存储** aspectRatio / count / seed / negativePrompt / providerOptions / mode 等生成参数。这些字段**仍然是** `POST /api/generations` 与 `NormalizedRequest` 的合法输入，在单次请求生命周期内全程参与校验与 adapter 翻译；任务落库后仅保留 `generations.prompt` 与 `generation_jobs.provider` + `model` 以及 **必填** `session_id` 作为输入侧最小回溯信息。

**理由**:

1. **跨 provider 适配成本高**: 各厂商对尺寸、张数、seed 的字段名、枚举值、默认值差异大（如 fal 的 `image_size` 枚举 vs zenmux 的 `1024x1024` 字符串）。若持久化一份"通用 input JSON"，读回时仍需按 (provider, model) 重新翻译，等于在 db 层复制 adapter 逻辑。
2. **扇出场景**: 一次 generation 多 job 时，每个 job 可能对应不同 provider，统一的 input_params 无法表达 per-job 差异（当前扇出共享运行时参数，仍不入库）。
3. **「重新生成」的正确做法**: 前端交互模式下的"再生成"应由 UI 重新提交当前表单参数（或 sensible defaults），而不是从 db 回放历史参数——用户往往会在 prompt 或选项上微调。

**若未来需要历史参数展示**（只读、非回放）: 可在 API 响应 `GenerationView` 中按需附带当时请求的 snapshot，但不写入 db；或仅在前端 localStorage / 会话状态中保留。不在 db schema 中为跨 provider 参数做持久化设计。

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
| createGenerationWithJobs(params, jobs[]) | job-engine | 1 generation + N jobs 的同一事务 |
| updateGeneration(id, patch) | job-engine | patch 含 status, updatedAt |
| createGenerationJob(params) | job-engine | 与 createGeneration 同事务 |
| updateGenerationJob(id, patch) | job-engine | patch 含 status, error, providerHandle, updatedAt |
| tryClaimPollLease(id, now, leaseUntil) | job-engine lifecycle | 原子租约 claim；不修改 job.status |
| createImage(params) | job-engine | 见 job-engine/dfd-interface CreateImageParams |
| imageExists(jobId, index) | job-engine (lifecycle) | 转存幂等检查 |
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
- 不持久化 width/count/seed 等生成输入参数（设计决策，见 3.4）
- 字段与 library / job-engine dfd-interface 一致
- **迁移实现**: `npm run db:migrate` 将旧 Session 挂到迁移 Project；按用户确认删除无有效 Session 的 generation，再收紧约束并执行外键检查

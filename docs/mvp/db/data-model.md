# db 模块 · data-model

> 模块路径: `src/lib/db/`
> 技术栈: Drizzle ORM + SQLite (better-sqlite3)
> 前置文档: 各模块 goals-duty / dfd-interface 中的数据需求

---

## 1. Core Concepts（核心概念）

| 概念 | 一句话 | 分类 |
|------|--------|------|
| **Session** | 一次创作会话，组织多次生成 | Entity |
| **Generation** | 一次生成请求（对应用户点一次"生成"） | Entity |
| **GenerationJob** | 一个 provider 的生成执行单元（扇出时一个 generation 多个 job） | Entity |
| **Image** | 一张已持久化的图片资产 | Entity |

---

## 2. Entity 定义与关键字段

### 2.1 sessions

| 字段 | 类型 | 含义 |
|------|------|------|
| id | TEXT PK | UUID |
| title | TEXT NULL | 会话标题（可选） |
| created_at | TEXT | ISO 8601 |
| updated_at | TEXT | ISO 8601 |

生命周期: API 层创建，长期存在。MVP 无删除。

`updated_at` 更新时机:
- 创建 session 时: 与 `created_at` 相同
- 修改 title 时
- 有新 generation 关联到该 session 时（`generations.session_id` 指向本 session）

用途: 前端 session 列表按最近活跃排序；MVP 虽不做 UI，但 API 返回 session 时应带此字段。

### 2.2 generations

| 字段 | 类型 | 含义 |
|------|------|------|
| id | TEXT PK | UUID |
| session_id | TEXT NULL FK→sessions.id | 关联会话，null 表示独立生成 |
| prompt | TEXT | 最终发送给 provider 的 prompt（已过 prompt 模块） |
| status | TEXT | `pending` / `running` / `completed` / `failed` / `cancelled` |
| created_at | TEXT | ISO 8601 |
| updated_at | TEXT | ISO 8601 |

生命周期: job-engine 创建，job-engine 更新 status。

`updated_at` 更新时机: 每次 `status` 变更时（与 job 聚合更新同步）。

聚合规则: generation.status 由其下所有 job 状态推导（MVP 仅 1 job 时等价于 job.status）:
- 任一 job `failed` → generation `failed`
- 任一 job `cancelled`（且无 failed）→ generation `cancelled`
- 所有 job `completed` → generation `completed`
- 任一 job `running`（且无 failed/cancelled）→ generation `running`
- 其余 → `pending`

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
| created_at | TEXT | ISO 8601 |
| updated_at | TEXT | ISO 8601 |

生命周期: job-engine 创建和更新。provider_handle 在 async submit 时写入；`completed` / `failed` / `cancelled` 后不再更新 handle（可选：completed 后清空 provider_handle 以减小 db 体积，MVP 可保留）。

`updated_at` 更新时机: 每次 `status`、`error`、`provider_handle` 变更时。

扇出预留: 一个 generation_id 可对应多行 job。MVP 每次只写一行。

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

---

## 3. 输入/输出字段：定义方 vs 持久化方

「模型的输入和输出」在不同层由不同模块负责，不要与 db 表字段混为一谈。

**关键区分**: width / height / count / seed / providerOptions 等是**合法的运行时输入参数**（API 接受、job-engine 校验、providers 消费），只是在任务完成后**不写入 db**。「不入库」不等于「不是输入」。

### 3.0 运行时输入 vs db 持久化（对照表）

| 字段 | API / job-engine 入参 | NormalizedRequest | 写入 db |
|------|----------------------|-------------------|---------|
| `prompt` | 是 | 是 | 是 → `generations.prompt` |
| `provider` | 是 | —（单独传 model） | 是 → `generation_jobs.provider` |
| `model` | 是 | —（submit 第二参数） | 是 → `generation_jobs.model` |
| `sessionId` | 是 | — | 是 → `generations.session_id` |
| `mode` | 是 | 是 | 否 |
| `width` / `height` | 是 | 是 | 否 |
| `aspectRatio` | 是 | 是 | 否 |
| `count` | 是 | 是 | 否 |
| `negativePrompt` | 是 | 是 | 否 |
| `seed` | 是 | 是 | 否 |
| `providerOptions` | 是 | 是 | 否 |
| `referenceImages` | 是（后续） | 是 | 否 |

数据流（仅示意输入侧）:

```
POST /api/generations { prompt, width, count, seed, ... }
  → job-engine 校验参数（capabilities）
  → db 只写入 prompt / provider / model / session_id
  → job-engine 构造 NormalizedRequest（含 width, count, seed, ...）
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
| 输入: provider + model | generation_jobs | `provider`, `model` | |
| 输入: 其余参数（width, height, count, seed, providerOptions...） | **不存** | — | 见 3.4 设计决策 |
| 输出: 持久化图片 | images | `storage_path`, `width`, `height`, `content_type`, `size_bytes` | 转存后的本地资产 |
| 输出: async 句柄 | generation_jobs | `provider_handle` | JobHandle JSON，任务进行中需要 |
| 输出: 错误 | generation_jobs | `error` | ProviderError JSON |

### 3.4 设计决策：不持久化生成输入参数（运行时仍接受）

**结论**: db **不存储** width / height / aspectRatio / count / seed / negativePrompt / providerOptions / mode 等生成参数。这些字段**仍然是** `POST /api/generations` 与 `NormalizedRequest` 的合法输入，在单次请求生命周期内全程参与校验与 adapter 翻译；任务落库后仅保留 `generations.prompt` 与 `generation_jobs.provider` + `model`（及可选 `session_id`）作为输入侧最小回溯信息。

**理由**:

1. **跨 provider 适配成本高**: 各厂商对尺寸、张数、seed 的字段名、枚举值、默认值差异大（如 fal 的 `image_size` 枚举 vs zenmux 的 `1024x1024` 字符串）。若持久化一份"通用 input JSON"，读回时仍需按 (provider, model) 重新翻译，等于在 db 层复制 adapter 逻辑。
2. **扇出场景更复杂**: 未来一次 generation 多 job 时，每个 job 可能对应不同 provider，统一的 input_params 无法表达 per-job 差异。
3. **「重新生成」的正确做法**: 前端交互模式下的"再生成"应由 UI 重新提交当前表单参数（或 sensible defaults），而不是从 db 回放历史参数——用户往往会在 prompt 或选项上微调。

**若未来需要历史参数展示**（只读、非回放）: 可在 API 响应 `GenerationView` 中按需附带当时请求的 snapshot，但不写入 db；或仅在前端 localStorage / 会话状态中保留。不在 db schema 中为跨 provider 参数做持久化设计。

---

## 4. 关系图

```
sessions 1 ──< generations 1 ──< generation_jobs 1 ──< images
                  (session_id       (generation_id       (generation_job_id
                   nullable)          可多个, MVP 1个)     可多个)
```

---

## 5. db 模块对外函数（建议）

| 函数 | 调用方 | 说明 |
|------|--------|------|
| createSession(title?) | API 层 | created_at = updated_at = now |
| updateSession(id, patch) | API 层 | 更新 title 时同步 updated_at |
| touchSession(id) | job-engine | 新 generation 关联时 updated_at = now |
| sessionExists(id) | job-engine (validator) | 校验 sessionId 合法性 |
| getSession(id) | API 层 | 含关联 generations |
| listGenerationsBySession(sessionId) | API 层 | GET /api/sessions/:id 用 |
| createGeneration(params) | job-engine | 与 createGenerationJob 同事务 |
| updateGeneration(id, patch) | job-engine | patch 含 status, updatedAt |
| createGenerationJob(params) | job-engine | 与 createGeneration 同事务 |
| updateGenerationJob(id, patch) | job-engine | patch 含 status, error, providerHandle, updatedAt |
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
    ├── sessions.ts
    ├── generations.ts
    └── images.ts
```

---

## 自检（提交前）

- 4 张表覆盖 MVP 全部数据需求
- generation_jobs 支持 1:N 扇出预留
- session_id nullable 支持独立生成端点
- 不持久化 width/count/seed 等生成输入参数（设计决策，见 3.4）
- 字段与各模块 dfd-interface 中的数据流一致

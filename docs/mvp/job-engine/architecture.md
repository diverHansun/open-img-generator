# job-engine 模块 · architecture

> 模块路径: `src/lib/job-engine/`
> 前置文档: goals-duty.md (已确认)
> 文档顺序: ① goals-duty → ② architecture(本文) → ④ dfd-interface → ⑤ use-case → ⑦ test
> 修订说明: 2026-07-20 D1/D2 durable admission、phase/lease lifecycle、默认 worker、inline staging 与持久化 poll/cancel retry

---

## 1. Architecture Overview（总体架构）

job-engine 以 durable admission 与每个 Job 的可恢复生命周期为中心。POST 只写入用户意图；worker（默认）或详情 GET 再推进一个已到期的 Job。

```
API POST ──→ orchestrator ──→ validator / request-snapshot / DB admission
worker or detail GET ─────────→ lifecycle ──→ provider / storage / DB checkpoint
```

| 子组件 | 职责 |
|--------|------|
| **orchestrator** | 模块对外入口。`submitGeneration` 执行校验、prompt 处理与单一 SQLite admission transaction，写入 1 个 Generation、N 个 queued Job 与每 Job 请求快照后返回；`getGeneration` 仅尝试推进 due Job；`cancelGeneration` 原子写本地取消状态。 |
| **lifecycle** | 管理**单个** generation_job 的 phase/lease 状态推进：dispatch、poll、storing、cancelling。所有外部结果以 phase + lease + cancel marker 条件写回；图片 row 与状态聚合采用短 transaction checkpoint。 |
| **validator** | submit 前校验: targets 非空且唯一；每个 target 的 provider/model/capabilities；共享参数对该 target 是否合法；session 是否存在。 |
| **worker** | 默认启动的进程内 due-job 扫描器；与详情 GET 复用同一 `advance(job)`，不拥有第二套状态逻辑。 |
| **request-snapshot / state-machine / retry-policy** | 分别约束持久化派发输入、内部 phase 的合法枚举与 poll/cancel 有界重试，避免进程重启时从 UI/body 猜测参数、状态或重试预算。 |

**外部依赖**（job-engine 调用但不拥有）:

| 模块 | 调用内容 |
|------|----------|
| providers | registry.getById, provider.submit, provider.poll, capabilities |
| prompt | prompt.process() |
| storage | `stageInlineImage()`、`downloadAndStore()`、attempt/scavenger cleanup |
| db | generation / job / image CRUD + transaction |

**依赖规则**:
- orchestrator 依赖 lifecycle、validator、request-snapshot 与 db/prompt/providers
- lifecycle 依赖 providers、storage、db
- validator 依赖 providers（capabilities）与 db（sessionExists）
- job-engine 不被 providers、storage、db、web-ui 反向依赖

---

## 2. Design Pattern & Rationale（设计模式与理由）

### 2.1 Durable Orchestrator 模式

orchestrator 是 API 的薄业务入口，但不在 POST 内完成 Provider 调用。它先将可恢复的、多 target 用户意图写入数据库；副作用只能由 lifecycle 在 transaction 之后执行。

- **支撑目标**: Design Goal #1、#4
- **理由**: 扇出后仍以 `submitGeneration` / `getGeneration` / `cancelGeneration` 三个明确入口完成编排，避免 API 层复制事务或生命周期循环

### 2.2 每 Job 独立 phase 状态机（lifecycle）

对用户仍只公开 `pending / running / completed / failed / cancelled`；内部 phase 表达可恢复动作：

```
queued → dispatching → polling → storing → terminal
  │           │            │          │
  └───────────┴────────────┴──────────┴→ cancelling → terminal
dispatching ──(远端结果未知)──→ outcome_unknown
```

- **支撑目标**: Design Goal #2、#4、Duty #7（部分失败隔离）
- sync Provider 的 submit 结果直接进入 `storing`，async Provider 的 handle 先进入 `polling`；两者都不延长 POST。
- `terminal` 与 `outcome_unknown` 均不可被 worker 自动复活；后者优先避免不确定 submit 的重复计费。

generation 状态由全部 job **聚合**（`api/constraints.md` §8），不单独跑第二套状态机。

### 2.3 默认 worker 与受限的详情恢复

`JOB_WORKER_ENABLED` 未设置时启动 in-process worker；只有显式为 `false` 才关闭。`runWorkerOnce()` 读取 due 的 `phase / next_poll_at / poll_lease_until` Job 并复用同一 lease/CAS lifecycle。详情 `getGeneration()` 也可调用 `advance`，但只能推进到期且未被有效 lease 占用的 Job；列表 GET 始终只读。

- **支撑目标**: Design Goal #2
- **理由**: Next.js MVP 无独立 worker 进程；generation POST durable admission 后首次 bootstrap 即可恢复推进，同时保留 worker 被明确关闭时的详情恢复路径。

### 2.4 校验与交集分离

validator 只做「每 target 是否接受共享参数」；不计算选中模型的能力交集。

- **支撑目标**: Design Goal #5、Non-Duty #6
- **理由**: 交集是 UI 可用性规则；服务端保持可组合的单 target 校验，避免双份真理

### 2.5 未使用的模式

| 模式 | 不采用原因 |
|------|-----------|
| Event Sourcing | MVP 状态简单 |
| Saga / 跨 job 补偿 | 部分失败保留成功 job 即可；不回滚已转存图 |
| 分布式 Queue/Worker | MVP 只提供单进程默认 worker，未引入外部队列 |
| Command Bus | 仍仅有少量明确的模块函数，无需额外命令分发层 |

---

## 3. Module Structure & File Layout（模块结构与文件组织）

```
src/lib/job-engine/
├── index.ts              # 对外导出: submit/get/cancel + worker lifecycle
├── orchestrator.ts       # durable admission、多 job detail/cancel 编排
├── lifecycle.ts          # 单 Job phase 推进、lease/CAS、image checkpoint
├── validator.ts          # targets[] + 每 target capabilities 校验
├── request-snapshot.ts   # versioned/allowlisted NormalizedRequest snapshot
├── state-machine.ts      # phase 枚举与 public-status 边界
├── retry-policy.ts       # poll/cancel 的 attempt、elapsed 与 full-jitter 决策
├── worker.ts             # 默认后台 due scan + 生命周期清理
└── types.ts              # SubmitGenerationParams, GenerationView 等
```

`admission.ts` 仍保留为旧的内存 helper 与单测，但不在 durable POST 请求路径使用；不能把它当作当前的 queue/backpressure 实现。

**稳定对外接口**:
- `submitGeneration(params): Promise<{ generationId: string; status: GenerationStatus; replayed: boolean }>`
- `getGeneration(id): Promise<GenerationView>`
- `cancelGeneration(id): Promise<GenerationView>`
- `runWorkerOnce(): Promise<WorkerRunResult>`（受控运行/测试入口）

**建议内部辅助**（可同文件或拆分，不强制新文件）:
- `aggregateGenerationStatus(jobs): GenerationStatus`
- `buildNormalizedRequestForTarget(shared, caps): NormalizedRequest`（按 capabilities 省略 seed 等）
- `createRequestSnapshot(request)` / `parseRequestSnapshot(job)`（禁止秘密与未知版本派发）

---

## 4. Architectural Constraints & Trade-offs（约束与权衡）

### 4.1 扇出粒度：1 generation + N jobs（已锁定）

| 方案 | 代价 | 收益 |
|------|------|------|
| **当前: Plan B** | generation 聚合规则变复杂 | 一次 prompt、一次轮询入口；与现有 schema 一致 |
| 放弃: N 个独立 generation | 客户端要管多个 id | 聚合简单但 UX 差 |

### 4.2 先全量校验，再 durable admission，后续才 dispatch

校验失败 → 400，**不创建**任何 generation/job。校验成功后，同一 SQLite transaction 创建 Generation、全部 Job、每 Job 的版本化请求快照并 touch Session，提交后返回 `202`。worker/detail 才会逐 target dispatch；一个 target 的失败只影响其自身 Job。

| 方案 | 代价 | 收益 |
|------|------|------|
| **当前** | POST 不再告诉调用方 Provider 已接受 | 响应丢失、进程重启与幂等重放仍有唯一可恢复的用户意图 |
| 放弃: POST 内 dispatch 后再落库 | Provider 副作用可能成功而本地没有记录 | 不可接受 |

### 4.3 默认 Worker + 详情辅助恢复

默认 worker 使用 due index 扫描 Job；详情 GET 仅作为 worker 被关闭、进程恢复后的辅助触发。两条路径都必须复用 `advance(job)`，绝不能各自实现 dispatch/poll/store 状态机。

### 4.4 Sync 路径也在 lifecycle 内完成

sync target 被 claim 后才调用 `provider.submit()`；其返回的 image refs 先写 `result_snapshot` 并切为 `storing`。async target 则持久化 handle 并切为 `polling`。因此两种 Provider 均满足 POST 只进行 admission 的语义。

| 约束 | 说明 |
|------|------|
| sync count | 仍强制该 target `count=1`（MVP） |
| POST 耗时 | 与 Provider/图片下载无关；只受校验和 SQLite transaction 影响 |

### 4.5 phase lease、取消线性化与图片 checkpoint

公开 `status` 不能承担互斥职责；同一 Job 的 dispatch/poll/store/cancel 都使用物理 `poll_lease_until`（兼容列名）作为当前 phase lease。

**修订规则**:
1. phase、due time、lease 与 cancel marker 形成条件 UPDATE；影响行数为 0 时另一 worker 已拥有结果，当前调用跳过。
2. 每个外部结果写回必须携带 claim 得到的 lease 与预期 phase。lease 过期后新的 owner 不能被旧 worker 覆盖；无 handle 的过期 dispatch 不盲重投，而是 `outcome_unknown`。
3. 每次 storing 最多处理一张缺失 image。文件先落磁盘；同一短 transaction 以 lease + 未取消条件完成 image row、Job phase 与 Generation 聚合。取消先线性化时不出现新的 image row；checkpoint 先成功时保留该图片并停止后续处理。
4. `(generation_job_id, index)` 仍是幂等键；CAS loser 和取消 winner 的 attempt 文件立即清理。对 inline Base64，staging source 直到 checkpoint accepted 才删除，以保留崩溃恢复来源。

详见 `api/constraints.md` §4。

### 4.6 部分转存失败（单 job 内）

与前版相同：单 job 内任一张 download 失败 → 该 job failed；已成功 images 保留；**不**因此失败其他 jobs。generation 聚合见 §8。

### 4.7 创建事务

`createGeneration` + **全部** `createGenerationJob` + request snapshots + Session touch 必须在同一 SQLite transaction 中；dispatch（HTTP）只能在事务提交之后。数据库唯一键与 canonical payload hash 决定 replay 或冲突，不能用内存 admission 代替。

### 4.8 取消与竞态

`POST /api/generations/:id/cancel` 在一个 transaction 内批量写 `cancel_requested_at`、取消 phase 与 Generation 聚合：未 claim 的 queued Job 可直接 terminal；带活跃 lease 的 dispatch/store Job 保持 `cancelling`，以便处理晚到 handle 或清理 attempt 文件。submit/poll/store 的晚到结果不得恢复公开 status。worker 仅在持久化 handle 后尽力远程取消；无端点时保留本地 cancelled 与 `CANCEL_UNSUPPORTED` 诊断。

### 4.9 并发控制

provider limiter 当前限制同一 provider 的 submit/poll/cancel 并发，不把不同 provider 串行化。全局内存 admission helper 不在 durable POST 路径；有界队列、deadline 与多实例 backpressure 是后续强化项。

### 4.10 D2：有界 poll/cancel retry，不重放 submit

不确定的 submit 仍绝不自动重放：发送后超时/断线进入 `outcome_unknown`，避免重复计费。D2 只重试已持久化 `JobHandle` 上的安全动作：poll 与 remote cancel。

| 动作 | 最大外部调用次数 | 基础/上限 delay | 总 elapsed 窗口 | 穷尽结果 |
|------|------------------|-----------------|----------------|----------|
| poll | 6 | 2s（当前 6-call budget 的最大实际 delay 为 32s；60s 为预留 policy ceiling） | 10 分钟 | `failed + terminal + RETRY_EXHAUSTED` |
| cancel | 3 | 1s（当前 3-call budget 的最大实际 delay 为 2s；10s 为预留 policy ceiling） | 30 秒 | `cancelled + terminal + RETRY_EXHAUSTED` |

- `attempt_count` 是当前 phase 已发生的 retryable failure 数；`retry_started_at` 是同一窗口的起点。二者必须同时存在或同时为空；损坏/半写状态安全收口，不能重新授予预算。
- delay 使用带 250ms 下限的 full jitter；worker/detail 都只按持久化 `next_poll_at` 继续，不依赖进程内 timer。
- typed `ProviderError.retryable === true` 或 poll/cancel 调用异常才进入 retry；成功 pending/running 与进入 storing 会清空 transient error 和 retry state，任何终态/取消切换都会清空 retry state，而终态会保留对应的**安全**诊断（如 `RETRY_EXHAUSTED`）。
- Provider adapter 的运行时返回会先安全归一化为 plain snapshot；`null`、未知 status 或 poll 的不可读 completed result 以有界 `PROVIDER_ERROR` retry checkpoint 收口。cancel 的不可读附加字段也不会让 lease 悬挂或复活本地状态。
- 外部错误的原始 message/body/prompt/URL 不写入 job row；持久化与 DTO 只使用 allowlisted code、固定安全文案和已验证的 retryable 布尔值。
- D2 不改变 adapter 的 HTTP disposition/Retry-After 判定，也不对 storage/download 重试；这些与 limiter queue deadline 一并属于 Batch E。

---

## 自检（提交前）

- 子组件均可追溯到 goals-duty
- 扇出、部分失败隔离、锁收紧、校验与 UI 交集分离均有约束
- 取消、限流和 worker 边界与 goals-duty、api constraints 对齐；width/count/seed 等实际派发参数已按 target 写入版本化 request snapshot，终态后清理

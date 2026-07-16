# 问题基线与当前实施状态

> 分析口径：2026-07-15，未包含本目录计划之后的实现改动。
> 目标态依据：`docs/mvp/` 的 fan-out / web-ui 变更与 [00-discussion.md](./00-discussion.md)。

## 1. 问题陈述

1. 设计文档已改为多 target，但运行时的 `SubmitGenerationParams`、数据库写入和 orchestrator 仍只处理一条 `provider + model`，无法表达演示图中的多模型提交。
2. 现有轮询将 `running` 同时当作真实厂商进度与互斥锁；变更区若收紧为只 claim `pending → running`，真实 `running` job 反而再也不会被轮询。
3. Fal 声明没有公开宽高比，adapter 也忽略传入 `aspectRatio`，导致 API/UI 所选比例与厂商请求不一致。
4. API 尚无 React 消费层；前端若直接知道 provider 或拼装 DTO，会复制服务端能力规则并使之后五家接入变得脆弱。

## 2. 文档与实现对照

| 目标文档 | 代码基线 | 缺口 / 风险 |
|---|---|---|
| `api/constraints.md` §11：`targets[]` | `src/lib/job-engine/types.ts` 只有 `provider`、`model` | 路由虽能反序列化 JSON，不能接受新契约 |
| `db/data-model.md`：1:N jobs | `src/lib/db/queries/generations.ts#createGenerationAndJob` 只插入一个 job | 无法原子创建完整 fan-out |
| `api/constraints.md` §8：部分成功为 completed | `aggregateGenerationStatus()` 首先返回 failed/cancelled | 总状态与目标行为冲突 |
| `job-engine/architecture.md`：并发 GET 不重复 poll | `lifecycle.ts#advance` 用 `status IN ('pending','running')` claim | 两个请求可同时 claim；若只改为 pending 又会卡死 running job |
| `providers/data-model.md`：公开比由 capabilities 声明 | `capabilities/fal.ts` 的 `supportedAspectRatios` 为空，`adapters/fal.ts#resolveSize` 固定 `square_hd` | Fal 的公共能力失真 |
| `web-ui/*`：基于 capabilities 选 target/参数并轮询 | `src/app/` 仅有 API routes，无客户端数据模块 | UI 实施前缺少稳定、可测试的接线边界 |

## 3. 模块现状

### 3.1 Providers

`src/lib/providers/types.ts` 已有稳定的 `ImageProvider`、`NormalizedRequest`、`ProviderCapabilities` 和预留的七个 `ProviderId`，这是合理的扩展边界。`registry.ts` 仅按环境变量启用 Fal / ZenMux，符合本批范围。

但 `FalProvider` 的 `resolveSize()` 忽略公共比例；`ZenmuxProvider` 已有比例映射，二者的行为不一致。Provider adapter 应只负责厂商字段映射，不能由路由或 React 客户端承担该工作。

### 3.2 数据与任务引擎

`generation_jobs` 已有独立 status、handle、error，schema 具备 1:N 的基本形状；但 `src/lib/db/schema.ts` 缺少轮询租约字段，`generations.ts` 的写入 helper 与聚合函数仍按单 job 语义实现。

`src/lib/job-engine/orchestrator.ts#submitGeneration` 创建一条 job 并串行提交一个 Provider；`getGeneration()` 逐个调用 `advance()`。`lifecycle.ts#advance` 的 update 将真实状态写成 `running` 来占锁，随后才轮询，因此状态与锁职责混合。`completeSync()` 与 `updateJobAndGeneration()` 已有事务内聚合的雏形，可在不引入队列的条件下扩展。

### 3.3 API 与 React 接线

`src/app/api/generations/route.ts` 直接将请求 JSON 断言为内部参数类型，运行时没有单独 DTO 边界；路由本身保持薄是正确方向，但需要由 validator 兜住目标数组、重复 target 和公共参数。

`src/app/api/providers/route.ts` 已能返回可用模型能力。这正好可作为 React 纯数据模块的输入：客户端只选择模型、求能力交集、构造公开 DTO、轮询 `links.self`；它不读取 `.env`，也不直接调用 Provider。

### 3.4 测试基线

项目已有 Vitest 四类测试规则（`docs/test-blueprint.md`），并已有 provider adapter、job engine、API contract、sync/async integration 覆盖。测试仍断言单 target 结构和“任一失败即 generation 失败”，并未覆盖 lease 竞争、租约过期、partial success 或 React 数据层的纯函数与轮询控制。

## 4. 跨模块数据流风险

```mermaid
flowchart LR
  A[React API data layer] --> B[POST /api/generations targets[]]
  B --> C[validator: per-target capabilities]
  C --> D[SQLite: generation + N jobs]
  D --> E[provider adapters]
  A --> F[GET generation]
  F --> G[poll lease claim]
  G --> E
  E --> H[per-job images/error]
  H --> I[aggregate generation view]
  I --> A
```

当前最大风险在 D→G：用 status 充当锁会破坏 E 的真实状态机。第二大风险在 B→C：若允许前端自行判断 capabilities，恶意或过期客户端仍能提交不被所有 target 支持的组合，因此服务端校验必须是最终裁决。

## 5. 改动影响面

- 修改：`src/lib/db/schema.ts`、`src/lib/db/queries/generations.ts`、`src/lib/job-engine/{types,validator,orchestrator,lifecycle}.ts`、Fal capabilities/adapter、API contract tests 与既有单元/集成测试。
- 新增：React API 类型、client、capability derivation、polling controller 及其单元测试。
- 文档：本目录 00–04，以及受 `pollLeaseUntil` 影响的 `docs/mvp/{api,db,job-engine}` 契约。
- 不改变：Provider registry 的当前启用范围、图片存储、Session API、真实密钥管理。

## 6. SWE 原则审视摘要

- **高优先级：信息隐藏。** `status` 和互斥租约是不同概念；合并它们会让调用者无法判断真实进度，必须拆为显式字段。
- **高优先级：KISS/YAGNI。** 当前本地 MVP 不需要队列、事件总线或通用工作流引擎；SQLite 原子更新 + 有限租约足以解决并发 GET。
- **中优先级：依赖方向。** React 层只消费 API DTO 与 capability 纯函数；不依赖 adapter 或环境变量。Provider 特有映射留在 adapter。
- **中优先级：可测试性。** lease claim、聚合和参数交集必须是可控的纯逻辑或临时 SQLite 集成，以防异步厂商调用掩盖状态机回归。

## 7. 与既有文档关系

`docs/mvp/` 描述的 fan-out 目标仍然有效。本批不采纳其“只从 pending claim”的锁实现表述，而改为“pending/running 均可 claim，前提是 `pollLeaseUntil` 为空或过期”，这是对同一并发目标的必要修正，而非改变公开行为。

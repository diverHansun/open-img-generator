# job-engine 模块 · architecture

> 模块路径: `src/lib/job-engine/`
> 前置文档: goals-duty.md (已确认)
> 文档顺序: ① goals-duty → ② architecture(本文) → ④ dfd-interface → ⑤ use-case → ⑦ test
> 修订说明: 2026-07-15 扇出编排；独立 poll lease

---

## 1. Architecture Overview（总体架构）

job-engine 由三个子组件组成:

```
orchestrator ──→ lifecycle
      │
      └──→ validator
```

| 子组件 | 职责 |
|--------|------|
| **orchestrator** | 模块对外入口。编排 submit（多 target）与 get（推进全部未终结 job）: 校验 → prompt → db 事务写 1 gen + N jobs → 逐 target provider 调用 → storage 转存 → 状态聚合。 |
| **lifecycle** | 管理**单个** generation_job 的状态推进。封装 sync（submit 即完成）与 async（submit → poll → 完成）；含 `storeImages` 与幂等；含乐观锁 claim。 |
| **validator** | submit 前校验: targets 非空且唯一；每个 target 的 provider/model/capabilities；共享参数对该 target 是否合法；session 是否存在。 |

**外部依赖**（job-engine 调用但不拥有）:

| 模块 | 调用内容 |
|------|----------|
| providers | registry.getById, provider.submit, provider.poll, capabilities |
| prompt | prompt.process() |
| storage | storage.downloadAndStore(url) |
| db | generation / job / image CRUD + transaction |

**依赖规则**:
- orchestrator 依赖 lifecycle、validator、以及全部外部模块
- lifecycle 依赖 providers、storage、db
- validator 依赖 providers（capabilities）与 db（sessionExists）
- job-engine 不被 providers、storage、db、web-ui 反向依赖

---

## 2. Design Pattern & Rationale（设计模式与理由）

### 2.1 Orchestrator 模式

orchestrator 作为唯一对外入口，编排多模块完成一次（可扇出）生成。

- **支撑目标**: Design Goal #1、#4
- **理由**: 扇出后仍只需 `submitGeneration` / `getGeneration` 两个入口，避免 API 层写循环

### 2.2 每 job 独立状态机（lifecycle）

每个 generation_job 独立推进:

```
pending → running → completed
                  → failed
                  → cancelled (预留)
```

- **支撑目标**: Design Goal #2、#4、Duty #7（部分失败隔离）
- sync: submit 后可直接 pending → completed（或 failed）
- async: submit 后 pending →（poll）running → completed / failed

generation 状态由全部 job **聚合**（`api/constraints.md` §8），不单独跑第二套状态机。

### 2.3 惰性推进（Lazy Polling）

async job 不在 submit 时阻塞等待；在 `getGeneration()` 时对**每一个**未终结 async job 触发 advance。

- **支撑目标**: Design Goal #2
- **理由**: Next.js 无独立 worker；扇出后 N 个 async job 可在同一次 GET 内并行 advance（Promise.all），互不共用同一 providerHandle

### 2.4 校验与交集分离

validator 只做「每 target 是否接受共享参数」；不计算选中模型的能力交集。

- **支撑目标**: Design Goal #5、Non-Duty #6
- **理由**: 交集是 UI 可用性规则；服务端保持可组合的单 target 校验，避免双份真理

### 2.5 未使用的模式

| 模式 | 不采用原因 |
|------|-----------|
| Event Sourcing | MVP 状态简单 |
| Saga / 跨 job 补偿 | 部分失败保留成功 job 即可；不回滚已转存图 |
| Queue/Worker | 惰性推进足够 |
| Command Bus | 仍仅 2 个对外函数 |

---

## 3. Module Structure & File Layout（模块结构与文件组织）

```
src/lib/job-engine/
├── index.ts              # 对外导出: submitGeneration, getGeneration
├── orchestrator.ts       # 多 target submit / 多 job get 编排
├── lifecycle.ts          # 单 job 状态推进 + storeImages + claim 锁
├── validator.ts          # targets[] + 每 target capabilities 校验
└── types.ts              # SubmitGenerationParams, GenerationView 等
```

**稳定对外接口**:
- `submitGeneration(params): Promise<{ generationId: string; status: GenerationStatus }>`
- `getGeneration(id): Promise<GenerationView>`

**建议内部辅助**（可同文件或拆分，不强制新文件）:
- `aggregateGenerationStatus(jobs): GenerationStatus`
- `buildNormalizedRequestForTarget(shared, caps): NormalizedRequest`（按 capabilities 省略 seed 等）

---

## 4. Architectural Constraints & Trade-offs（约束与权衡）

### 4.1 扇出粒度：1 generation + N jobs（已锁定）

| 方案 | 代价 | 收益 |
|------|------|------|
| **当前: Plan B** | generation 聚合规则变复杂 | 一次 prompt、一次轮询入口；与现有 schema 一致 |
| 放弃: N 个独立 generation | 客户端要管多个 id | 聚合简单但 UX 差 |

### 4.2 先全量校验，再落库，再逐 target dispatch

校验失败 → 400，**不创建**任何 generation/job。落库后某 target submit 失败 → 仅该 job failed，其他继续。

| 方案 | 代价 | 收益 |
|------|------|------|
| **当前** | submit 阶段部分失败时 generation 可能短暂「有成功有失败」 | 符合 Duty #7；避免脏数据来自非法请求 |
| 放弃: 全部 submit 成功才 commit | 需两阶段或临时表 | MVP 过重 |

### 4.3 惰性推进 vs 后台 Worker

同前版：GET 时 poll；客户端必须轮询。扇出后一次 GET 推进该 generation 下全部未终结 job。

### 4.4 同步路径在 submit 内完成转存

含 sync target 的扇出请求：POST 线程内依次（或有限并行）完成各 sync job 的转存；async target 仍返回 pending。

| 约束 | 说明 |
|------|------|
| sync count | 仍强制该 target `count=1`（MVP） |
| POST 耗时 | 多 sync target 会拉长 POST；MVP 假定 localhost long-running |

### 4.5 并发 GET：独立 poll lease

`status` 是厂商真实状态，不能承担互斥职责；否则已进入 `running` 的任务会失去后续 poll 机会。

**修订规则**:
1. `poll_lease_until` 为空或过期时，`pending` / `running` job 均可原子 claim；claim 只写租约与 `updated_at`，不修改 status。
2. 影响行数 0：另一请求正在租约期内推进，当前请求跳过。进程异常后租约（35 秒）到期，下一次 GET 可恢复。
3. poll 结果、解析失败、provider 不可用和转存结束都会清空租约；转存仍靠 `imageExists(jobId, index)` 幂等。

详见 `api/constraints.md` §4。

### 4.6 部分转存失败（单 job 内）

与前版相同：单 job 内任一张 download 失败 → 该 job failed；已成功 images 保留；**不**因此失败其他 jobs。generation 聚合见 §8。

### 4.7 创建事务

`createGeneration` + **全部** `createGenerationJob` 必须在同一 SQLite transaction 中；dispatch（HTTP）在事务提交之后。

### 4.8 不重试

单次 submit/poll 失败即该 job failed；用户发起新 generation。

---

## 自检（提交前）

- 子组件均可追溯到 goals-duty
- 扇出、部分失败隔离、锁收紧、校验与 UI 交集分离均有约束
- 未引入 Non-Duties（取消 API、限流、持久化运行时参数等）

# job-engine 模块 · architecture

> 模块路径: `src/lib/job-engine/`
> 前置文档: goals-duty.md (已确认)
> 文档顺序: ① goals-duty → ② architecture(本文) → ④ dfd-interface → ⑦ test

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
| **orchestrator** | 模块对外入口。编排 submit 和 get 的完整流程: 校验 → prompt 处理 → db 写入 → provider 调用 → storage 转存 → 状态更新。 |
| **lifecycle** | 管理单个 generation_job 的状态推进。封装 sync 路径（submit 即完成）和 async 路径（submit → poll → 完成）的状态机转移；含 `storeImages` 转存与幂等逻辑。 |
| **validator** | submit 前的参数校验: provider 是否启用、model 是否存在、session 是否存在、请求参数是否在 capabilities 范围内。 |

**外部依赖**（job-engine 调用但不拥有）:

| 模块 | 调用内容 |
|------|----------|
| providers | registry.getById, provider.submit, provider.poll |
| prompt | prompt.process() |
| storage | storage.downloadAndStore(url) |
| db | generation/job/image 的 CRUD 函数 |

**依赖规则**:
- orchestrator 依赖 lifecycle、validator、以及全部外部模块
- lifecycle 依赖 providers、storage、db
- validator 依赖 providers（capabilities 查询）与 db（sessionExists）
- job-engine 不被 providers、storage、db 反向依赖

---

## 2. Design Pattern & Rationale（设计模式与理由）

### 2.1 Orchestrator 模式

orchestrator 作为唯一对外入口，编排多个模块完成一次生成。

- **支撑目标**: Design Goal #1（API 层只需调两个函数）
- **理由**: 生成流程跨越 4 个模块（prompt → providers → storage → db），需要统一的编排点

### 2.2 状态机（lifecycle 内部）

generation_job 的状态按有限状态机推进:

```
pending → running → completed
                  → failed
                  → cancelled (预留)
```

- **支撑目标**: Design Goal #2（统一 sync/async 状态语义）
- sync 路径: submit 后直接从 pending 跳到 completed（或 failed），不经过 running
- async 路径: submit 后 pending → poll 时可能 running → poll completed 后 completed

generation 状态由 job 聚合（见 `api/constraints.md` §8）。

### 2.3 惰性推进（Lazy Polling）

async 任务不在 submit 时阻塞等待，而是在 getGeneration() 时触发 poll。

- **支撑目标**: Design Goal #2（对 API 层透明）
- **理由**: Next.js 无独立 worker 进程，惰性推进避免 HTTP 超时，无需额外基础设施
- **客户端责任**: 必须轮询 GET；见 `api/constraints.md` §2

### 2.4 未使用的模式

| 模式 | 不采用原因 |
|------|-----------|
| Event Sourcing | MVP 状态简单，关系型表足够 |
| Saga | 文件写入与 DB 不做分布式事务；部分失败用明确 failed 语义处理 |
| Queue/Worker | Next.js 部署模型下引入队列过重；惰性推进满足 MVP |
| Command Bus | 仅 2 个对外函数（submit/get），不需要命令分发 |

---

## 3. Module Structure & File Layout（模块结构与文件组织）

```
src/lib/job-engine/
├── index.ts              # 对外导出: submitGeneration, getGeneration
├── orchestrator.ts       # submit/get 流程编排
├── lifecycle.ts          # 单 job 状态推进（sync + async + storeImages）
├── validator.ts          # 参数校验
└── types.ts              # 模块内类型（GenerationView 等对外返回结构）
```

**稳定对外接口**:
- `submitGeneration(params): Promise<{ generationId: string; status: GenerationStatus }>`
- `getGeneration(id): Promise<GenerationView>`

**内部实现**:
- `orchestrator.ts`、`lifecycle.ts`、`validator.ts`

---

## 4. Architectural Constraints & Trade-offs（约束与权衡）

### 4.1 惰性推进 vs 后台 Worker

| 方案 | 代价 | 收益 |
|------|------|------|
| **当前: GET 时 poll** | 客户端需轮询 GET；poll 逻辑在请求线程内 | 零额外基础设施；实现简单 |
| 放弃: 后台定时器 | 需要 setInterval 或外部 cron | 客户端可一次 GET 拿到结果；但 Next.js serverless 下定时器不可靠 |

### 4.2 同步路径在 submit 内完成转存

zenmux 等 sync provider 的 submit 当场返回图片，orchestrator 在 submit 函数内同步完成 storage 转存。

| 方案 | 代价 | 收益 |
|------|------|------|
| **当前: submit 内转存 + sync count=1** | sync POST 响应时间较长 | 逻辑简单；GET 时状态已是 completed |
| 放弃: 统一走 async 状态机 | 所有请求都 pending → poll | 增加无意义的中间状态 |

### 4.3 generation_job 表预留扇出，MVP 只写一行

| 方案 | 代价 | 收益 |
|------|------|------|
| **当前: 表结构支持 1:N，代码只写 1 行** | schema 略宽 | 后续扇出不改表；符合 Goal #4 |
| 放弃: MVP 不加 job 表 | schema 更简单 | 加扇出时需改表、改代码 |

### 4.4 不重试

| 方案 | 代价 | 收益 |
|------|------|------|
| **当前: 失败即 failed** | 瞬时网络错误也标记失败 | 实现简单；用户可手动重试（新 generation） |
| 放弃: 自动重试 3 次 | 更健壮 | MVP 复杂度上升 |

### 4.5 并发 GET：乐观锁 + 转存幂等

| 方案 | 代价 | 收益 |
|------|------|------|
| **当前: UPDATE ... WHERE status IN (pending,running) + imageExists(jobId,index)** | 实现略复杂 | 防双 tab / 重试导致重复 poll 与重复图片 |
| 放弃: 无锁 | 简单 | 高概率 duplicate images |

详见 `api/constraints.md` §4。

### 4.6 部分转存失败：fail-fast，保留已成功图

| 方案 | 代价 | 收益 |
|------|------|------|
| **当前: 任一张 storage 失败 → job/generation failed，已写入 images 保留** | 可能出现「failed 但有部分图」 | 语义明确；不引入 Saga |
| 放弃: 全有或全无 | 需删除已下载文件 | MVP 复杂度高 |

详见 `dfd-interface.md` §2.6 与 `api/constraints.md` §5。

### 4.7 generation + job 创建：SQLite 事务

createGeneration 与 createGenerationJob 必须在同一 transaction 中执行，避免 crash 后孤儿 generation。

与「单 job 无 Saga」不矛盾——这是**单库内**原子性，不是跨服务事务。

---

## 自检（提交前）

- 三个子组件均能追溯到 goals-duty 的 Design Goal 或 Duty
- 惰性推进、并发幂等、部分失败语义有明确约束
- 未引入 goals-duty Non-Duties 中的能力

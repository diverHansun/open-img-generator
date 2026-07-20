# job-engine 模块 · test

> 模块路径: `src/lib/job-engine/`
> 前置文档: goals-duty.md, architecture.md, dfd-interface.md, use-case.md
> 文档顺序: ⑦ test(本文)
> 项目级规则: 遵循 `docs/test-blueprint.md`（若有）；本文件只补充扇出相关场景
> 修订说明: 2026-07-20 improve-1 D1/D2：覆盖 durable admission、snapshot、phase/lease、原子取消/转存竞态与跨重启 retry 预算

---

## 1. Test Scope（测试范围）

### 覆盖

- durable admission：单 target 与多 target 在一个 transaction 写 N jobs、`phase=queued`、request snapshot 与 Session touch；POST 不调用 Provider。
- `clientRequestId`：同 key 同 payload replay、同 key 异 payload 409、并发 admission 只保留一条 generation。
- 每 target 校验（aspectRatio、sync count=1、negativePrompt、image-to-image/referenceImages）。
- request snapshot：按 capability 裁剪后的显式 pick、版本/字段/深度/字节上限；未知版本或损坏 snapshot 不得 dispatch。
- seed：不支持的 target 省略；支持的 target 传入并被 snapshot 恢复。
- phase state machine：合法迁移、public status 单调、dispatch 崩溃窗口进入 `outcome_unknown` 而非 replay。
- worker/getGeneration：worker 默认可启动；worker 与详情复用 `advance`；详情只辅助 due 且无有效 lease 的 job。
- 部分失败隔离（一 job failed 不影响另一 job completed）。
- phase lease：queued dispatch、polling、storing、cancelling 均以 phase + lease + cancellation marker CAS；并发 loser 跳过。
- 转存：`(jobId,index)` 幂等、单 job 部分转存失败、lease-guarded image checkpoint 与取消串行化。
- inline result：Base64/data URL 在 25 MiB 上限内先写私有 staging，SQLite/result snapshot 只出现 opaque `staging:<uuid>`，终态/取消清理 staging。
- cancelGeneration：扇出任务在一个 transaction 本地取消；worker best-effort provider.cancel；晚到 submit handle / poll / store 不得复活 cancelled job。
- `runWorkerOnce`：读取 due jobs、推进一条 durable phase、统计 `advanced/retried/completed/failed/unknown/cancelled/skipped`；worker cleanup 使用传入 DbClient。
- retry-policy：poll（6 次/10 分钟）与 cancel（3 次/30 秒）使用 full jitter、持久化 attempt/window/due；成功、终态和取消均清空 retry state；dispatch 不得 replay。
- Provider runtime result guard：poll/cancel 返回 `null`、未知 status 或畸形对象时安全归一化；需要 retry 的情形写有界 `PROVIDER_ERROR` checkpoint，任何情形都不得只等 lease 过期后无限重调。

### 不覆盖

- providers 内 aspectRatio→厂商 size 映射表（归属 providers test）。
- web-ui 交集算法（归属 web-ui test）。
- 真实厂商 E2E（手工 / 可选集成）。
- E3 的 magic-byte、远端 URL/redirect/私网防护、流式解码和跨进程 worker 协调（D1 文档只能明确边界，不以当前测试替代）。

---

## 2. Critical Scenarios（关键场景）

### 2.1 Admission — 单 target 与幂等

| 场景 | 预期 |
|------|------|
| 有效 zenmux 或 fal 提交 | `202` 对应的 `pending` generation + 1 条 `queued` job；Provider mock 尚未调用 |
| 同 clientRequestId、同 payload | 返回同一 generation、`replayed=true`；不新增 job，不重复 dispatch |
| 同 clientRequestId、异 payload | 409 `IDEMPOTENCY_KEY_REUSED`；既有 job 不变 |
| session 不存在 | ValidationError；无 generation |
| sync count=2 | ValidationError |

### 2.2 Admission — 扇出与 snapshot

| 场景 | 预期 |
|------|------|
| targets=[fal, zenmux]，aspectRatio=1:1 | 1 gen + 2 queued jobs；每 job 有独立 version=1 snapshot；公开状态 pending |
| targets 为空 | ValidationError |
| targets 重复 (provider,model) | ValidationError |
| aspectRatio=16:9（zenmux 不支持） | ValidationError；无库记录 |
| snapshot 未知版本 / 非白名单字段 / 超过边界 | job 不 dispatch，安全写 failed；不得猜测原请求 |
| snapshot 在 request hash 一致的重复 POST | 复用既有 job；不创建第二份 intent |

### 2.3 Seed 裁剪

| 场景 | 预期 |
|------|------|
| seed=42，targets 含 fal+zenmux | fal 的 snapshot/dispatch request 含 seed；zenmux 的不含 seed；整单不 400 |

### 2.4 Worker / detail — 多 job 推进

| 场景 | 预期 |
|------|------|
| 默认 worker 启动 | 未设置 `JOB_WORKER_ENABLED` 时启动；设为 `false` 时不启动 |
| 两个 due async polling job，mock 均 completed | 各自切 storing、完成转存，聚合 completed |
| queued job | worker 先记录 dispatch lease，才调用 provider.submit；sync ref 进入 storing，async handle 进入 polling |
| job 尚未 due 或有有效 lease | worker 和详情 GET 均跳过，不发 Provider 调用 |
| worker disabled 后详情 GET | 仅当 due/lease 可 claim 才可辅助推进，不 force poll |
| generation 已全部终态 | 不调用外部工作 |

### 2.5 Phase、lease 与崩溃窗口

| 场景 | 预期 |
|------|------|
| 并发两次 advance 同一 job | 仅一个 phase claim 成功；另一个跳过 |
| polling job 有 handle、lease 已过期 | 下一次 due worker/详情可取得新 lease 并 poll；public status 不被 lease 改写 |
| dispatching lease 过期且无 durable result | 进入 `outcome_unknown` + `PROVIDER_OUTCOME_UNKNOWN`；不得重发 billable submit |
| provider 回报 pending 于已 running job | public status 仍为 running（单调） |

### 2.6 转存与 opaque staging

| 场景 | 预期 |
|------|------|
| 单 job 第 2 张 download 失败 | 该 job failed；index0 保留；其他 job 不变 |
| imageExists 为 true | 跳过 download |
| 取消与 storing checkpoint 竞争 | 取消先提交时不插入 image row、删除本次输出文件；checkpoint 先提交时保留已持久化 image |
| ZenMux `b64_json` / data URL | 最多 25 MiB 写入私有 staging；DB snapshot 不含 `data:` 或 Base64，仅含 `staging:<uuid>`；后续恢复可完成图片落库 |
| staging 终态/取消/失败 | 删除不再被 snapshot 引用的 staging 文件；清理任务不删仍被 durable result snapshot 引用的文件 |

### 2.7 取消事务与晚到 Provider 结果

| 场景 | 验证 |
|------|------|
| createGeneration + N createGenerationJob + snapshot + session touch | 同一 admission transaction；失败则全部回滚 |
| fan-out cancel | 单一 transaction 更新所有 active jobs 和 generation 聚合；中途 DB 异常不得半取消 |
| cancel 与 provider limiter 队列 | cancel 先赢则 provider.submit 不开始 |
| cancel 与晚到 async handle | 仅持久化 handle 供 worker remote cancel；public status 仍 cancelled |
| retryable poll failure | 写 retry checkpoint；未 due 时 worker/详情均不再调 Provider；重启后在 due 继续同一预算，成功后清零 |
| retryable remote cancel | public status 始终 cancelled；file-backed SQLite 关闭/重开后仍按 due 延续同一预算，最多 3 次后以 `RETRY_EXHAUSTED` 收口，不转 failed |
| remote cancel 返回 pending/running/completed | pending/running 继续取消重试；completed 不写 image、不复活公开状态，而以 `CANCEL_UNCONFIRMED` 安全诊断收口 |
| Provider 返回畸形 poll/cancel result | 写 `PROVIDER_ERROR` retry checkpoint、释放 lease、消耗同一有界预算 |

---

## 3. Integration Points（集成点测试）

| 验证点 | 方式 |
|--------|------|
| `POST /api/generations` | 合同测试断言 `202`、Location、`X-Request-Id`、replayed 与无同步 Provider 调用 |
| 每 target 收到正确 model + 从 snapshot 恢复的裁剪后 NormalizedRequest | 先 admission，再 mock worker provider.submit 断言 |
| 聚合函数与 constraints §8 一致 | 单元表驱动测试 |
| GET detail 的 due/lease 辅助语义 | API/合同 + integration：未 due/有 lease 时不调用 Provider |
| GET session/history 只读，不调用 getGeneration 推进 | API/合同测试 |
| route/SQLite + typed fake Provider | 当前 integration 覆盖 sync、async、fanout、idempotency、cancel、inline b64 staging，以及 file-backed SQLite 关闭/重开后的 poll 与 remote-cancel retry 恢复；不等同真实 Next HTTP server |

---

## 4. Verification Strategy（验证策略）

- 单元: mock providers/prompt/storage/db；覆盖 state machine、snapshot 边界、lease CAS 和取消竞态。
- 集成: SQLite + 真实 transaction + typed fake Provider/route 调用；覆盖 worker 重启/恢复、D2 retry budget 延续/成功归零与 staging 保留。
- 合同: POST `202`/Location/idempotency、GET 多 `jobs` 与错误 envelope。
- E2E（后续 F）: 真实 Next HTTP + local fake Provider 与浏览器流；D2 当前不把 typed fake retry integration 误报为 adapter/HTTP 或浏览器 E2E。
- 回归: 保留单模型路径（`targets` 长度为 1），但断言 admission 后由 worker/lifecycle 完成。

---

## 自检（提交前）

- durable `202`、扇出、部分成功、seed 裁剪、snapshot、phase/lease、取消和 staging 均有场景。
- 不测试 UI 交集或 adapter 映射表细节；不把 E3 远端图片安全策略误报为 D1 已验证。

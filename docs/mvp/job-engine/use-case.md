# job-engine 模块 · use-case

> 模块路径: `src/lib/job-engine/`
> 前置文档: goals-duty.md, architecture.md, dfd-interface.md
> 文档顺序: ⑤ use-case(本文) → ⑦ test
> 说明: 可选文档；因扇出含多步骤编排，供 Codex 实施时对照主路径

> 修订说明: 2026-07-16 sessionId 必填；Project 由 library 先创建
> 修订说明: 2026-07-20 improve-1 D1/D2：durable admission、phase/lease worker 与持久化 poll/cancel retry

---

## 1. 用例一览

| ID | 名称 | 触发 | 结果 |
|----|------|------|------|
| UC-1 | 单模型 durable admission | POST targets=[zenmux] + sessionId + clientRequestId | `202`；generation+1 queued job 已持久化，尚未承诺 Provider 已受理 |
| UC-2 | 单模型 async 生成 | POST targets=[fal]；默认 worker / due detail 推进 | `pending` → `completed`；不依赖每次 GET 强制 poll |
| UC-3 | 双模型扇出 | POST targets=[fal, zenmux] + 同一意图 ID | 1 gen + 2 queued jobs；worker 可分别进入 polling/storing，独立收口 |
| UC-4 | 扇出部分失败 | 某 target 在 worker dispatch/poll/store 阶段失败 | 该 job failed；另一 job 可 completed；generation 聚合为 completed（若有成功）或 failed（全败） |
| UC-5 | 非法共享宽高比 | aspectRatio 不被某 target 支持 | 400，无库记录 |
| UC-6 | 缺少 sessionId | POST 无 sessionId | 400，无库记录 |
| UC-7 | 同 key 重放 | 相同 clientRequestId + 相同 payload 重发 | `202` 返回同一 generation，`replayed=true`；不创建或 dispatch 第二个 job |
| UC-8 | 取消 | POST cancel | 本地一次事务取消所有 active jobs；worker 随后 best-effort 远端 cancel |
| UC-9 | Session 内查看 | GET session | 只读返回历史；不推进任何未终结 job |
| UC-10 | 瞬时 poll/cancel 故障 | typed retryable ProviderError 或调用异常 | 写入有界 retry checkpoint，重启后继续或明确收口 |

---

## 2. UC-3 双模型扇出（主路径，逐步）

**前置**: FAL_KEY、ZENMUX_API_KEY 均配置；已存在 Project 与 Session（经 library/API 创建）；worker 未以 `JOB_WORKER_ENABLED=false` 关闭。

1. 客户端 POST：
   ```json
   {
     "clientRequestId": "<new-rfc4122-uuid>",
     "prompt": "a red balloon",
     "aspectRatio": "1:1",
     "count": 1,
     "sessionId": "<existing-session-uuid>",
     "targets": [
       { "provider": "fal", "model": "fal-ai/flux/schnell" },
       { "provider": "zenmux", "model": "openai/gpt-image-2" }
     ]
   }
   ```
2. validator 确认 session 存在；两 target 均支持 `1:1`；count=1 满足 sync 限制。对每个 target 构造 capability 裁剪后的 `NormalizedRequest`，并生成 versioned request snapshot。
3. 单一 admission transaction 写入 1 generation + 2 个 `phase=queued` jobs、snapshot、`clientRequestId`/request hash，并 touch Session。
4. API 只在该 transaction commit 后返回 `202 Accepted` 与详情 Location；这时两 job 仍是 `pending/queued`，浏览器不得把 `202` 当成生成完成。
5. 默认 worker claim fal job 的 dispatch lease：`fal.submit` 返回 async handle，原子写 handle 后切为 `polling`；后续 due tick poll 到 completed 后写 result snapshot、切为 `storing`。
6. worker 独立 claim zenmux job：若 Provider 同步返回图片 refs，则直接切 `storing`；若返回 Base64/data URL，先在 25 MiB 边界内写入私有 staging，result snapshot 仅记 `staging:<uuid>`。
7. storing 阶段每次 lease 至多落一张图。图片 row、job phase/status 与 generation 聚合以短 transaction checkpoint；两 job 均终态后聚合为 `completed`。客户端的详情 GET 只能在 job due 且无有效 lease 时辅助推进，不能替代 worker 调度。
8. `GenerationView.jobs` 含两条；`images` 含两 job 的已本地持久化图片，用 `jobId` 区分。

---

## 3. UC-4 部分失败

1. 同 UC-3，但 zenmux 在 dispatch、poll 或 storing 的某一可恢复 phase 写入 failed。
2. fal 不受影响，仍可后续 completed。
3. 全部终态后：generation.status = `completed`（有成功 job）；zenmux JobView.error 可见。

---

## 4. UC-8 取消与晚到结果

1. 用户对仍有 active jobs 的 generation 调用 cancel。
2. `cancelGeneration` 在一个 transaction 中批量写入 `cancel_requested_at`、将 active job 的 public status 置为 `cancelled`，并重聚合 generation；API 立即返回，不等待 Provider。
3. 从未 claim 的 queued job 直接到 `terminal`。已有 handle 的 job 留在 `cancelling`，worker 后续尽力调用 `provider.cancel(handle)`；只有 remote `cancelled` 才确认成功，remote `pending/running` 也占用最多 3 次/30 秒的重试预算，remote `completed` 以 `CANCEL_UNCONFIRMED` 安全诊断收口。Provider 不支持或非 retryable failure 同样留下安全诊断，public status 不回退。
4. 若取消与 dispatch 竞争，晚到 async handle 仅能经 cancellation CAS 持久化为远端 cancel 的依据，不得复活 job。若取消与 storing checkpoint 竞争，取消先赢时不会新增 image row；已提交 checkpoint 的图片保持可见。

---

## 5. UC-10 瞬时 poll/cancel 故障

1. 已持久化 handle 的 polling job 收到 `retryable=true` 的失败，或 `provider.poll` 抛异常。
2. 当前 lease owner 在同一条件写入中保存 error、`attempt_count`、`retry_started_at` 与 full-jitter `next_poll_at`，并释放 lease；公开状态仍为 pending/running。
3. 进程退出后，新 worker 只会在该 due time 后继续同一预算。第 6 次 retryable poll failure 或 10 分钟窗口耗尽时写 `failed/terminal + RETRY_EXHAUSTED`；不会派发第二次 submit。
4. remote cancel 使用同样方式，但最多 3 次/30 秒；跨进程只按持久化 due time 继续同一预算，穷尽后保持 `cancelled/terminal + RETRY_EXHAUSTED`。
5. 一次 successful pending/running poll、进入 storing、任一终态或用户取消都会归零 retry state；前端不把 active retry diagnostic 误报为失败。

---

## 6. 与 web-ui 的衔接

- web-ui 负责：为一次用户意图生成并在刷新/重试时复用 `clientRequestId`；模型多选、aspectRatio 交集、seed 显隐（任一 supportsSeed 则显示）。
- job-engine 负责：接收已构造的 targets + 共享参数，durable admission 后执行 UC-1～UC-8 与 UC-10；UI 只能依据 GenerationView 的公开状态呈现进度。
- `staging:<uuid>`、request/result snapshot 只属于服务端恢复细节，不能显示、缓存或传回 web-ui。

---

## 自检

- 每个用例可映射到 goals-duty 的 Duties
- `202`、idempotency、默认 worker、due/lease、poll/cancel retry 和取消竞态均有可追踪主路径
- inline staging 以 25 MiB、metadata 与 magic-byte 边界落盘；远端 URL 下载由 storage 的 HTTPS/DNS/IP/redirect policy 收口

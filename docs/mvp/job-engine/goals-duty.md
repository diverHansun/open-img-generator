# job-engine 模块 · goals-duty

> 模块路径: `src/lib/job-engine/`
> 文档顺序: ① goals-duty(本文) → ② architecture → ④ dfd-interface → ⑤ use-case → ⑦ test
> 修订说明: 2026-07-15 启用扇出（1 generation + N jobs）；原「MVP 不扇出」作废
> 修订说明: 2026-07-16 `sessionId` **必填**；不负责 Project/History/Gallery（归 library）
> 修订说明: 2026-07-16 本地取消、next_poll_at worker、provider/generation 限流已实现
> 修订说明: 2026-07-20 improve-1 D1/D2：POST durable admission `202`、phase/lease 恢复与 opaque staging；poll/cancel 具备持久化有界重试

---

## 1. Design Goals（设计目标）

1. **让一次用户意图先成为可恢复的任务，再开始外部副作用**
   - 上层只调用 `submitGeneration()` 和 `getGeneration()`，不感知 sync/async 协议差异、不直接调 provider、不直接写文件。
   - `POST` 的成功仅表示 Generation、N 个 Job、每 Job 请求快照与 Session touch 已原子持久化；返回 `202 Accepted`，不表示 Provider 已受理或图片已生成。

2. **统一 sync 与 async 两种生成路径的状态与恢复语义**
   - 无论底层厂商是当场返回还是异步队列，上层看到的 generation / job 状态统一为: `pending` → `running` → `completed` / `failed` / `cancelled`。
   - 内部以 `queued` / `dispatching` / `polling` / `storing` / `cancelling` / `terminal` / `outcome_unknown` phase 和 lease 记录可恢复执行点；这些细节不扩散为 API 状态。
   - in-process worker 默认启用（仅 `JOB_WORKER_ENABLED=false` 显式关闭）。详情 GET 只在 job 已 due 且 lease 可取得时辅助推进，不能绕过调度时间或并发租约强制重放。

3. **确保厂商临时结果在过期前可安全转存**
   - 任一 job 进入 `completed` 时，该 job 的 ProviderImageRef 已下载并由 storage 持久化。
   - 衡量标准: `GET /api/images/:id` 返回的是本地存储路径，不是厂商 CDN URL。
   - Provider 返回 Base64/data URL 时，D1 先以 25 MiB 上限写入私有 staging，再在 DB 只保存 `staging:<uuid>`；不得把原始 data URL/Base64 写入 SQLite、日志或 API DTO。

4. **一次请求可扇出到多个 (provider, model)，结果可按 job 独立追踪**
   - 一个 generation 对应 N 个 `generation_jobs`（N ≥ 1）；共享 prompt 与共享运行时参数，各 job 独立 submit / poll / 转存 / 失败。
   - 衡量标准: `POST` 带 2 个 targets → DB 中 1 条 generation + 2 条 jobs；`GenerationView.jobs.length === 2`。

5. **扇出校验以 capabilities 为准，不发明厂商能力**
   - 每个 target 单独校验；共享 `aspectRatio` 必须对该 target 合法；seed 对不支持的 target 省略；negativePrompt 在不支持的 target 上导致整单 400（见 dfd-interface）。
   - 衡量标准: 对不支持 seed 的 target，NormalizedRequest 不含 seed；不向厂商发送 capabilities 未声明的参数。

6. **生成必须落在已有 Session 上（Session 已属 Project）**
   - 不接受无 session 的「孤儿 generation」；Project 门禁由 web-ui + library 保证，job-engine 强制 session 存在。

---

## 2. Duties（职责）

1. **接收并 durable admission 扇出请求**: 接收参数（`clientRequestId`、`targets[]`、prompt、**必填 sessionId**、共享运行时参数），经 prompt 模块处理后，为每个 target 构造 capability 裁剪后的、版本化 `NormalizedRequest` snapshot；在同一事务内写入 1 条 generation、N 条 `phase=queued` jobs、snapshot 和 Session touch。Provider 调用只能发生在该事务 commit 之后的生命周期推进中。
2. **按 target 校验与请求裁剪**: 每个 `(provider, model)` 必须已启用且存在于 capabilities；校验 mode、count（含 sync `count=1` MVP 限制）、尺寸/公开宽高比、negativePrompt 与 seed 的共同能力。`image-to-image` 必须带 `referenceImages`。seed 若有值但任一 target 不支持，整单 400，禁止静默部分生效。
3. **按 durable phase/lease 推进任务**: worker 按内部页扫描并 drain due 且无有效 lease 的 jobs；`getGeneration()` 可调用同一 `lifecycle.advance()` 作恢复辅助，但仍受 phase、due 和 lease CAS 约束。dispatch lease 过期而未记录 Provider 结果时，保守进入 `outcome_unknown`，不盲目重投。Provider 明确 `RATE_LIMITED` 时以持久化 `next_poll_at` 等待到成功或用户取消；其他 poll/cancel retry 保持有界。
4. **下载、staging 与原子转存图片**: Provider completed 后先持久化有界 result snapshot，逐图下载/物化；图片 row 的插入、lease 校验、job phase/status 与 Generation 聚合在短事务内 checkpoint。取消先赢时不得留下可见 image row；已成功 checkpoint 的图片可保留。
5. **统一状态查询与聚合**: 对外提供 `getGeneration(id)` 返回 `GenerationView`（含全部 jobs 与 images）；generation.status 由全部 job 状态聚合（见 `api/constraints.md` §8）。
6. **session 关联（必填）**: 校验 session 存在；写入 `generations.session_id`；关联成功后 `db.touchSession(sessionId)`。缺少 sessionId → 校验失败（400）。
7. **取消本地原子、远端尽力**: cancel 在一个短事务内批量标记全部 active jobs 并重聚合 generation，立即返回本地状态；worker 对有 durable handle 的 `cancelling` job 再尽力调用 provider.cancel。retryable remote cancel 以独立的 3 次/30 秒预算收口；晚到 submit handle 只能用于远端取消，绝不复活公开状态。
8. **部分失败隔离**: 某一 target 的 submit/poll/转存失败只将该 job 标为 failed，不回滚已成功的其他 jobs 及其 images；generation 聚合状态按 §8 规则更新。

---

## 3. Non-Duties（非职责）

1. **不翻译厂商协议**: 请求/响应的厂商格式翻译是 providers 的职责。job-engine 只使用 NormalizedRequest 和 SubmitResult/PollResult。
2. **不直接发起厂商 HTTP 请求**: 所有外部 HTTP 调用通过 providers 模块。
3. **不定义存储格式或路径规则**: 存储路径生成、文件写入是 storage 的职责。
4. **不定义 db schema**: schema 定义是 db 模块的职责。job-engine 通过 db 查询/写入函数操作数据。
5. **不处理 HTTP 路由**: API 层负责解析 HTTP 请求和返回 JSON。job-engine 不感知 Request/Response 对象。
6. **不计算「前端交集」**: 多模型宽高比交集是 web-ui 的职责。服务端只校验「每个 target 是否支持提交的 aspectRatio」。
7. **不重放不确定的 submit，也不把所有失败都重试**: 只有 adapter 明确标记 `RATE_LIMITED + retryable + not_started/rejected` 时，才无限期安全回写为等待；其他可安全重投的 rejected submit 仍使用 3 次/30 秒预算。已进入 fetch 后的 timeout/reset/5xx 为 `unknown`，以及租约过期都进入 `outcome_unknown`，绝不盲重投。已有 handle 的非限流 typed-retryable poll/cancel 仍分别最多 6 次/10 分钟和 3 次/30 秒；E2/E3 分别在 Provider HTTP 与 storage 边界收口 response-size、redirect、URL、MIME/magic-byte 与 staging 规则。
8. **不做本地 Provider 或跨进程限流/熔断/外部队列**: 当前依赖单进程 worker、SQLite lease 和内部扫描分页；Provider 决定其服务端并发，多实例共享调度仍不在 MVP 范围。
9. **不优化 prompt**: prompt 预处理是 prompt 模块的职责。
10. **不定义厂商取消协议**: 取消入口与本地状态机归 job-engine；providers 只负责在官方支持时实现 `cancel(handle)`。不支持时 job-engine 仍完成本地取消，不能承诺远端停止或不计费。
11. **不持久化原始 API body 或 Provider 原始响应**: 为恢复派发，job-engine 仅短期持久化每 target 的已校验、版本化 `NormalizedRequest` snapshot 与转存中的 result snapshot；snapshot 不暴露给 API/UI，并在终态清理。不会存 credential、任意对象或 raw Base64/data URL。
12. **不绕过 storage 的远端图片安全校验**: inline staging 已具备分块解码、25 MiB、Provider metadata 与 magic-byte 一致性；远端 URL/redirect/私网防护和流式写入统一归 storage，job-engine 不复制或放宽这些规则。
13. **不渲染 UI、不声明前端控件显隐**: capabilities 驱动的参数面板属于 web-ui。
14. **不管理 Project / History 列表 / Gallery 收藏 / 模型启用偏好**: 归属 library。
15. **不创建 Session**: Session 由 library/API 先创建；job-engine 只引用。

---

## 自检（提交前）

- **一句话存在意义**: job-engine 把「一次 prompt、多个模型」先接纳为可恢复的持久化意图，再按 phase/lease 编排为可追踪流水线，屏蔽 sync/async 差异并确保图片被持久化。
- **不该做什么**: 不翻译协议、不直接 HTTP、不定义 schema、不算 UI 交集、不做跨进程调度、不管 Project/Gallery。
- **职责重叠风险**: 与 providers——编排 vs 单次调用；与 web-ui——校验单 target vs 交集 UX；与 library——写 generation vs 组织资产；与 storage——触发转存 vs 执行写入。无重叠。

# job-engine 模块 · goals-duty

> 模块路径: `src/lib/job-engine/`
> 文档顺序: ① goals-duty(本文) → ② architecture → ④ dfd-interface → ⑤ use-case → ⑦ test
> 修订说明: 2026-07-15 启用扇出（1 generation + N jobs）；原「MVP 不扇出」作废
> 修订说明: 2026-07-16 `sessionId` **必填**；不负责 Project/History/Gallery（归 library）

---

## 1. Design Goals（设计目标）

1. **让"一次图片生成"从开始到可下载成为一条可追踪的流水线**
   - 上层（API 层）只需调用 `submitGeneration()` 和 `getGeneration()`，不感知 sync/async 协议差异、不直接调 provider、不直接写文件。
   - 衡量标准: API route handler 不超过 20 行逻辑。

2. **统一 sync 与 async 两种生成路径的状态语义**
   - 无论底层厂商是当场返回还是异步队列，上层看到的 generation / job 状态统一为: `pending` → `running` → `completed` / `failed`（`cancelled` 预留）。
   - async 厂商的惰性 poll 推进对 API 层透明: `GET /api/generations/:id` 触发推进，调用方无需区分协议。

3. **确保厂商临时 URL 在过期前被转存**
   - 任一 job 进入 `completed` 时，该 job 的 ProviderImageRef 已下载并由 storage 持久化。
   - 衡量标准: `GET /api/images/:id` 返回的是本地存储路径，不是厂商 CDN URL。

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

1. **接收扇出生成请求并创建任务记录**: 接收归一化参数（`targets[]`、prompt、**必填 sessionId**、共享运行时参数），经 prompt 模块处理 prompt，在同一事务内写入 db（1 generation + N generation_jobs），再逐 target 调用 provider.submit。
2. **按 target 校验与请求裁剪**: 每个 `(provider, model)` 必须已启用且存在于 capabilities；校验 mode、count（含 sync `count=1` MVP 限制）、尺寸/公开宽高比、negativePrompt。seed 若有值：仅写入 `supportsSeed===true` 的 target 的 NormalizedRequest，其余 target 省略（不因此整单 400）。
3. **推进所有未终结的 async job**: 在 `getGeneration()` 时，对 generation 下每个 `pending`/`running` 的 async job 调用 lifecycle.advance（含乐观锁），互不阻塞对方终态。
4. **下载并转存图片**: 当某 job 的 provider 返回 completed（sync 当场或 async poll 完成），调用 storage 下载并写入本地，在 db 创建属于该 job 的 image 记录。
5. **统一状态查询与聚合**: 对外提供 `getGeneration(id)` 返回 `GenerationView`（含全部 jobs 与 images）；generation.status 由全部 job 状态聚合（见 `api/constraints.md` §8）。
6. **session 关联（必填）**: 校验 session 存在；写入 `generations.session_id`；关联成功后 `db.touchSession(sessionId)`。缺少 sessionId → 校验失败（400）。
7. **部分失败隔离**: 某一 target 的 submit/poll/转存失败只将该 job 标为 failed，不回滚已成功的其他 jobs 及其 images；generation 聚合状态按 §8 规则更新。

---

## 3. Non-Duties（非职责）

1. **不翻译厂商协议**: 请求/响应的厂商格式翻译是 providers 的职责。job-engine 只使用 NormalizedRequest 和 SubmitResult/PollResult。
2. **不直接发起厂商 HTTP 请求**: 所有外部 HTTP 调用通过 providers 模块。
3. **不定义存储格式或路径规则**: 存储路径生成、文件写入是 storage 的职责。
4. **不定义 db schema**: schema 定义是 db 模块的职责。job-engine 通过 db 查询/写入函数操作数据。
5. **不处理 HTTP 路由**: API 层负责解析 HTTP 请求和返回 JSON。job-engine 不感知 Request/Response 对象。
6. **不计算「前端交集」**: 多模型宽高比交集是 web-ui 的职责。服务端只校验「每个 target 是否支持提交的 aspectRatio」。
7. **不重试失败的 provider 调用（MVP）**: 单次 submit/poll 失败即标记该 job failed，不做自动重试。
8. **不做限流/熔断（MVP）**: 并发控制是后续迭代职责。
9. **不优化 prompt**: prompt 预处理是 prompt 模块的职责。
10. **不实现取消 API（MVP）**: cancel 逻辑预留（可调 provider.cancel），但 MVP 不暴露取消端点。
11. **不持久化运行时参数**: width/height/aspectRatio/count/seed/providerOptions 仅运行时使用，不写入 db（与既有约定一致）。
12. **不渲染 UI、不声明前端控件显隐**: capabilities 驱动的参数面板属于 web-ui。
13. **不管理 Project / History 列表 / Gallery 收藏 / 模型启用偏好**: 归属 library。
14. **不创建 Session**: Session 由 library/API 先创建；job-engine 只引用。

---

## 自检（提交前）

- **一句话存在意义**: job-engine 把「一次 prompt、多个模型」编排为可追踪的流水线，屏蔽 sync/async 差异，确保每张图被持久化。
- **不该做什么**: 不翻译协议、不直接 HTTP、不定义 schema、不算 UI 交集、不重试、不限流、不管 Project/Gallery。
- **职责重叠风险**: 与 providers——编排 vs 单次调用；与 web-ui——校验单 target vs 交集 UX；与 library——写 generation vs 组织资产；与 storage——触发转存 vs 执行写入。无重叠。

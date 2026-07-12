# job-engine 模块 · goals-duty

> 模块路径: `src/lib/job-engine/`
> 文档顺序: ① goals-duty(本文) → ② architecture → ④ dfd-interface → ⑦ test

---

## 1. Design Goals（设计目标）

1. **让"一次图片生成"从开始到可下载成为一条可追踪的流水线**
   - 上层（API 层）只需调用 `submitGeneration()` 和 `getGeneration()`，不感知 sync/async 协议差异、不直接调 provider、不直接写文件。
   - 衡量标准: API route handler 不超过 20 行逻辑。

2. **统一 sync 与 async 两种生成路径的状态语义**
   - 无论底层厂商是当场返回还是异步队列，上层看到的 generation 状态统一为: `pending` → `running` → `completed` / `failed`（`cancelled` 预留）。
   - async 厂商的惰性 poll 推进对 API 层透明: `GET /api/generations/:id` 触发推进，调用方无需区分协议。

3. **确保厂商临时 URL 在过期前被转存**
   - generation 进入 `completed` 状态时，所有 ProviderImageRef 已下载并由 storage 模块持久化。
   - 衡量标准: `GET /api/images/:id` 返回的是本地存储路径，不是厂商 CDN URL。

4. **为扇出预留结构，MVP 不实现扇出逻辑**
   - 数据模型支持一个 generation 下多个 generation_job，但 MVP 每次只创建一个 job。
   - 衡量标准: 后续加扇出时，job-engine 的 submit 入口签名不变，只改内部扇出循环。

---

## 2. Duties（职责）

1. **接收生成请求并创建任务记录**: 接收归一化参数（provider、model、prompt、可选 session_id），经 prompt 模块处理 prompt，写入 db（generation + generation_job），调用 provider.submit。
2. **推进 async 任务**: 在 `getGeneration()` 时，对 status 为 pending/running 的 async job 调用 provider.poll，更新 job 状态。
3. **下载并转存图片**: 当 provider 返回 completed（sync 当场或 async poll 完成），调用 storage 下载 ProviderImageRef.url 并写入本地，在 db 创建 image 记录。
4. **统一状态查询**: 对外提供 `getGeneration(id)` 返回 generation 聚合状态（含 jobs 和 images）。
5. **session 关联**: 支持可选 session_id；校验 session 存在；关联成功后调用 `db.touchSession(sessionId)`。
6. **provider 校验**: submit 前校验 provider 已启用、model 存在、请求参数在 capabilities 范围内（尺寸、张数、模式、seed、negativePrompt）；sync provider MVP 限制 count=1。

---

## 3. Non-Duties（非职责）

1. **不翻译厂商协议**: 请求/响应的厂商格式翻译是 providers 的职责。job-engine 只使用 NormalizedRequest 和 SubmitResult/PollResult。
2. **不直接发起厂商 HTTP 请求**: 所有外部 HTTP 调用通过 providers 模块。
3. **不定义存储格式或路径规则**: 存储路径生成、文件写入是 storage 的职责。job-engine 调用 `storage.downloadAndStore(url)` 拿到 storagePath 与元数据。
4. **不定义 db schema**: schema 定义是 db 模块的职责。job-engine 通过 db 模块的查询/写入函数操作数据。
5. **不处理 HTTP 路由**: API 层负责解析 HTTP 请求和返回 JSON。job-engine 不感知 Request/Response 对象。
6. **不扇出（MVP）**: 一次 submit 只创建一个 generation_job。扇出循环是后续迭代职责，但数据模型已预留。
7. **不重试失败的 provider 调用（MVP）**: 单次 submit/poll 失败即标记 failed，不做自动重试。
8. **不做限流/熔断（MVP）**: 并发控制是后续迭代职责。
9. **不优化 prompt**: prompt 预处理是 prompt 模块的职责。job-engine 在 submit 前调用 prompt.process()，不自行改写。
10. **不实现取消 API（MVP）**: cancel 逻辑预留（可调 provider.cancel），但 MVP 不暴露取消端点。

---

## 自检（提交前）

- **一句话存在意义**: job-engine 把"生成一张图"编排为可追踪的流水线，屏蔽 sync/async 差异，确保图片被持久化。
- **不该做什么**: 不翻译协议、不直接 HTTP、不定义 schema、不扇出、不重试、不限流。
- **职责重叠风险**: 与 providers 的边界——job-engine 编排，providers 执行单次调用；与 storage 的边界——job-engine 触发转存，storage 执行写入；与 prompt 的边界——job-engine 调用 prompt.process()，不自行改写。无重叠。

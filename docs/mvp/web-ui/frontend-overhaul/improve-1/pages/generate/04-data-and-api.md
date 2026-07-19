# Generate · 数据与 API

## 1. 数据流

1. `GET /api/projects/:projectId/sessions`；为空时调用 `POST /api/projects/:projectId/sessions/initial`，获得幂等的默认 Session。
2. `GET /api/providers` 或 Provider configuration 的 capability 视图。
3. `GET /api/model-preferences`。
4. 客户端求 configured models 与 preference 交集。
5. Compose 调 `POST /api/generations`，payload 必带 sessionId、targets、prompt 和有效共同参数。
6. 成功后以响应 `id/links.self` 建立唯一 current task 并进入 Stage；Stage 可见时才订阅 `GET /api/generations/:id`。
7. 返回 Compose 时解除订阅但保留内存中的 id/最后快照；点击 `CurrentTaskEntry` 后重新进入 Stage 并恢复 GET。
8. 用户显式 Cancel 时调用 `POST /api/generations/:id/cancel`；返回编辑或页面离开只 abort 浏览器请求，绝不自动取消任务。
9. 结果图点击打开 shared `ImagePreviewDialog`；不因此打开 Generation Detail 弹层。

## 2. 现有 Job 契约足够的内容

当前 `GenerationView` 已提供：

```ts
type JobView = {
  id: string;
  provider: ProviderId;
  model: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  error?: { code: string; message: string; retryable: boolean };
};

type ImageView = {
  id: string;
  jobId: string;
  index: number;
  url: string;
  width: number | null;
  height: number | null;
};
```

前端可按 `image.jobId` 统计每个 Job 的**实际**图片数，并展示 Provider/model/status/error。这些“详细 Job 状态”不需要新增后端契约。

## 3. 本批不扩展的 Job 字段

当前生成参数除 prompt/session/provider/model 外不持久化，Job 的内部 `providerHandle/pollLeaseUntil/nextPollAt/cancelRequestedAt/createdAt/updatedAt` 也不属于浏览器 DTO。因此第一批不展示：

- 精确请求总张数或稳定 `returned/expected`；
- 真实百分比、队列位置、预计/实际耗时、费用；
- Provider 内部 handle、poll lease、next poll 时间；
- 可刷新恢复的“取消请求中”领域状态。

如果后续产品明确需要这些信息，应单独讨论持久化语义、公开字段和测试，而不是从提交时内存或时间差猜测。

## 4. 接口

复用 `listSessions/ensureInitialSession/createSession/updateSession/listProviders/listModelPreferences/submitGeneration/subscribeGeneration/cancelGeneration`。Provider configuration endpoint 若被用于 capabilities，前端只消费摘要，不需要 secret。本次 Stage 改造不新增后端 route 或数据库字段。

## 5. 所有权与 URL

- Session 由 library；模型偏好由 Models 页维护；当次 targets/params 由 Compose；generation 编排由 job-engine。
- `?generation=:id` 表示 Stage 当前打开，可刷新恢复；不写 active generation 到 localStorage。
- 无 query 的 Compose 只持有短生命周期 currentGenerationId/lastSnapshot；它不轮询，也不是 Session 历史来源。
- 页面不得调用 adapter 或通用 Generation list 来构造“当前任务”。

## 6. 竞态

- route Project 改变时取消所有旧加载和 Stage 订阅；Session 创建/切换有请求序列；submit 只接受当前 Project 下 Session。
- 新提交开始时增加 submission sequence：旧 POST/detail 响应不得覆盖新 current task。
- 从 Stage 返回 Compose 时，正在完成的 detail 响应必须被 abort 或因 sequence 失效而丢弃。
- 重进 Stage 的首个 GET 必须覆盖 lastSnapshot；服务端仍验证 Generation/Session/Project 归属和请求合法性。

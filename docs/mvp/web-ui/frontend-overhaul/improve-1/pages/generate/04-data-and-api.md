# Generate · 数据与 API

## 数据流

1. `GET /api/projects/:projectId/sessions`；为空时调用 `POST /api/projects/:projectId/sessions/initial`，获得幂等的默认 Session。
2. `GET /api/providers` 或 Provider configuration 的 capability 视图。
3. `GET /api/model-preferences`。
4. 客户端求 configured models 与 preference 交集。
5. `POST /api/generations`，payload 必带 sessionId、targets、prompt 和有效共同参数。
6. 用响应 `id/links.self` 驱动当前结果区；结果区仅对**当次提交**的 generation 在非终态时调用 `GET /api/generations/:id`（另一个 poll 持有方是 Detail 弹层，见 `shared/05` §6）。
7. 用户显式 Cancel 时调用 `POST /api/generations/:id/cancel`；页面离开只 abort 浏览器请求，绝不自动取消任务。
8. 结果图点击打开 shared `ImagePreviewDialog`；不因此打开 Detail 弹层。

## 接口

复用 `listSessions/ensureInitialSession/createSession/updateSession/listProviders/listModelPreferences/submitGeneration/subscribeGeneration/cancelGeneration`。Provider configuration endpoint 若被用于 capabilities，前端只消费摘要，不需要 secret。

## 所有权

Session 由 library；模型偏好由 Models 页维护；当次 targets/params 由 Generate；generation 编排由 job-engine。页面不得调用 adapter。

## 竞态

route Project 改变时取消所有旧加载；Session 创建/切换有请求序列；submit 只接受当前 Project 下 Session。服务端仍需验证 Session 存在和请求合法。

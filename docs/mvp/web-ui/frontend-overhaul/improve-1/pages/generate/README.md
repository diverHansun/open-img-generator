# Generate

## Design Goals

- 让当前 Workspace 内的创作主路径保持集中、快速，并支持多 Provider/Model fanout。
- 将 Session 作为 Generate 的局部上下文，移除重复 Workspace 选择，并压缩标题、说明与 Session chrome。
- 在同一 Generate 路由内明确分离 **Compose（编辑）** 与 **Stage（当前任务）**：编辑时只看输入，生成时让图片成为主界面。
- Stage 可见时才持有当前 Generation 的详情 poll；返回 Compose 后暂停，用户点击“当前任务”重新进入 Stage 并恢复。

## Duties

1. 选择、创建及重命名当前 Workspace 下的 Session；首次进入没有 Session 的 Workspace 时自动创建一个默认 Session。
2. 加载可用 Provider capabilities 与启用模型池。
3. 在 Compose 编辑 Prompt 与多模型共同支持的参数。
4. 提交带 `sessionId` 的 generation；成功后进入当前任务 Stage。
5. Stage 展示本次 generation 的图片、整体摘要与 Provider/Job 明细，并提供 Cancel。
6. 返回 Compose 后保留一个紧凑“当前任务”入口；再次进入才恢复详情轮询。
7. 新一次 POST 成功后原子替换上一次“当前任务”的页面状态与订阅，只展示新 generation；失败时保留旧入口。被替换任务仍由后台 worker 执行，并可从 History 找回。

## Non-Duties

- 不选择 Project；route 已确定 Workspace。
- 不在 Compose 或 Stage 展示 Session 之前的 Generation、Recent 10 或 Session 历史列表。
- 不配置 Provider key 或 Model Preference。
- 不把 Stage 建成独立全局页面，也不在 Compose 隐藏轮询旧 Generation。
- 不显示后端未提供的真实进度百分比、排队位置、Job 耗时或请求总张数。

路由：`/workspace/:projectId/generate`。可选 `?generation=:id` 只表示当前 Stage 正在打开，不建立新的 Generation 路由。

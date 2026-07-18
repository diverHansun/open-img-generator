# Generate

## Design Goals

- 让当前 Workspace 内的创作主路径保持集中、快速，并支持多 Provider/Model fanout。
- 将 Session 作为 Generate 的局部上下文，移除重复 Workspace 选择。
- 在提交结果区持有当次 Generation 的详情 poll；其他已离开页面的任务不在此轮询。

## Duties

1. 选择、创建及重命名当前 Workspace 下的 Session；首次进入没有 Session 的 Workspace 时自动创建一个默认 Session。
2. 加载可用 Provider capabilities 与启用模型池。
3. 编辑 Prompt 与多模型共同支持的参数。
4. 提交带 `sessionId` 的 generation。
5. 提交后在当前页面展示 job 状态与结果；生成期间主动作变为 Cancel。

## Non-Duties

- 不选择 Project；route 已确定 Workspace。
- 不展示完整 History/Gallery。
- 不配置 Provider key 或 Model Preference。
- 不导航到独立详情路由，也不在后台轮询旧 Generation。

路由：`/workspace/:projectId/generate`。

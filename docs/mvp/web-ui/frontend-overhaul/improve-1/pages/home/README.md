# Workspace Home

## Design Goals

- 让用户启动应用后先明确选择“在哪个 Workspace 工作”。
- 用一个轻量入口承载选择、创建和最近 Workspace，不把创作表单提前塞到首页。
- 首页与 Workspace 内完整导航形成清晰模式切换。

## Duties

1. 展示全部 Workspace 的最近活动摘要。
2. 创建 Workspace，并进入其 Generate 页面。
3. 选择已有 Workspace，并进入其 Generate 页面。
4. 提供真实的 loading、empty、error 状态。

## Non-Duties

- 不选择/创建 Session。
- 不提交 Generation，不展示 Provider/Model 配置。
- 不提供模板、Prompt composer、Home 菜单或 Workspace 内完整侧栏。
- 本批不负责重命名/删除 Workspace。

路由：`/`。共享约束见 `../../shared/`。

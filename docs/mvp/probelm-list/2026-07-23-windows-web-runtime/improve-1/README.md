# improve-1：Windows Web 开发运行时

## 范围

本批只改造本机 Web 开发运行时及其质量门禁：统一路径、环境加载、迁移启动、Windows 文件系统语义、浏览器说明、测试和 CI。

不包含 Electron Windows 实现、安装包、签名、DPAPI 或自动更新。`02` 已按 Phase 实施；目标环境 CI、浏览器人工流程和现有 macOS desktop smoke 仍按 `04` 完成最终验收。

## 阅读顺序

1. [`00-discussion.md`](./00-discussion.md)：先读不可违反的已确认结论。
2. [`01-problem-analysis-and-current-state.md`](./01-problem-analysis-and-current-state.md)：理解当前问题和代码锚点。
3. [`02-optimization-plan-and-change-scope.md`](./02-optimization-plan-and-change-scope.md)：按 Phase 实施。
4. [`04-test-and-acceptance.md`](./04-test-and-acceptance.md)：每个 Phase 按映射验收。

## 实施规则

- 保持开发数据位于仓库 `./data/`，不得自动移动或删除。
- 环境变量覆盖优先级不得降低。
- 路径策略必须只有一个权威来源；业务模块不得新增平台分支。
- Windows CI 与 macOS/Linux 回归同时通过才算完成。
- 实施完成后，应在独立验收会话中对照 `02` 和 `04` 检查，不以“代码已经写完”代替验收。

# Home · 用户用例

## Use Case Overview

1. Select Workspace。
2. Create Workspace。
3. Recover From Load Failure。

## Main Flows

### Select Workspace

加载 summaries → 用户识别 title/最近活动 → 激活卡片 → 进入 Generate。若目标在导航前已被删除，Workspace shell 负责 404，而 Home 不猜测替代项。

### Create Workspace

切换创建模式 → 输入 title → 客户端基本校验 → API 创建 → 进入新 Workspace。Session 创建留给首次打开的 Generate：它自动建立 `session-<id 前 8 位>`，用户可在 Generate 内重命名。

### Recover

summary 请求失败 → 显示错误与 Retry → 重试成功替换错误区，不刷新整页。

## Responsibility Boundaries

Home 负责入口编排；Project 规则和持久化归 library/API；路由壳负责后续 Project 有效性。

## Failure Points

重复提交、空 title、API 401/500、封面加载失败。表单防双击；封面失败使用占位，不阻断选择。

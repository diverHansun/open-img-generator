# Generate · 用户用例

## Use Case Overview

1. Prepare Session。
2. Compose Generation。
3. Submit And Enter Current Stage。
4. Return To Edit And Resume Current Task。

## Main Flows

### Prepare Session

加载当前 Project Sessions → 恢复有效 lastSession 或用户选择 → 无 Session 时自动创建默认 Session → Compose 解锁。用户可在与页名同一行的紧凑工具区重命名当前 Session。

### Compose Generation

读取 configured capabilities 与 preference → 展示可选模型 → 用户输入 Prompt、勾选多个 model、设置共同参数 → 页面不渲染空结果区或 Session 历史。

### Submit And Enter Current Stage

客户端即时校验 → 一次 POST → 后端 fanout → 返回 generation ID → 原子替换旧 current-task 前端状态 → 进入 Stage。Stage 隐藏 Inspector，以图片画布为主，持续显示当前 generation 的实际图片和可折叠 Job 明细；非终态可 Cancel。

### Return To Edit And Resume Current Task

用户点击返回编辑 → Stage 解除详情订阅 → 后台任务继续 → Compose 保留紧凑“当前任务”入口。用户点击入口 → Stage 立即获取最新详情 → 非终态恢复轮询。Compose 期间不查询或展示 Session 之前的任务。

### Submit Another Generation

用户从 Compose 再次提交 → 新 POST 成功后，上一次 current-task 的 id、快照和订阅被原子替换 → Stage 只显示新 generation。旧任务不被隐式取消，之后只能从 History/共享 Detail 找回。

## Responsibility Boundaries

Generate 负责编排输入、提交与唯一当前任务；Provider 并发、持久化和状态机归后端。当前任务 Job 明细只消费 `GenerationView` 真实字段。其它 Generation 的浏览归 History，档案查看归共享 Detail 弹层。

## Failure & Decision Points

- 无 Session/target、Provider 配置变化、偏好变化、参数交集为空：留在 Compose，保持可恢复输入。
- POST 失败：不进入 Stage；保留旧 current-task 入口和编辑输入，页面仍只维护一个当前任务。
- Stage detail 404/错误：保留返回编辑与 Retry；不读取 Session list 猜测替代任务。
- Job 部分失败：图片照常展示，摘要暴露失败数量，展开后显示对应安全错误；不自动重试。
- Cancel 失败：保留当前服务端快照并允许重试取消/详情，不本地伪造 cancelled。

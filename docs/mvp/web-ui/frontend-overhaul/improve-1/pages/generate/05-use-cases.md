# Generate · 用户用例

## Use Case Overview

1. Prepare Session。
2. Select Generation Targets。
3. Submit Multi-provider Generation。

## Main Flows

### Prepare Session

加载当前 Project Sessions → 恢复有效 lastSession 或用户选择 → 无 Session 时自动创建默认 Session → 表单解锁。用户可随时在 Session bar 重命名当前 Session。

### Select Targets

读取 configured capabilities 与 preference → 展示可选池 → 用户勾选多个 model → 计算共同参数 → 无效旧值被清除。

### Submit

输入 Prompt/参数 → 客户端即时校验 → 一次 POST → 后端 fanout → 返回 generation ID → 当前结果区显示 job 进度和图像。用户留在 Generate；生成中可 Cancel，离开页面不取消。

## Responsibility Boundaries

Generate 负责编排输入、提交与当次结果展示；Provider 并发、持久化和状态机归后端。其它 Generation 的详情查看归共享 Detail 弹层。

## Failure & Decision Points

无 Session/target、Provider 配置变化、偏好变化、参数交集为空、POST 失败。所有失败保留可恢复输入；成功后不重复提交。

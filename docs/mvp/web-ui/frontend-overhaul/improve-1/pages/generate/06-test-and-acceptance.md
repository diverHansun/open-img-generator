# Generate · 测试与验收

## Test Scope

遵循 `docs/test-blueprint.md`。覆盖 Session 自动建立、capability 交集、payload、Compose/Stage 状态转换、current-task 替换、Stage 可见轮询与取消；不重复测试 adapter 协议，不为纯视觉引入新的浏览器测试框架。

## Critical Scenarios

- route 已确定 Project，页面无 Project selector。
- 0/1/多 Session；首次 0 Session 自动创建默认名；lastSession 无效时不跨 Project 复用。
- 页名与 Session 位于紧凑工具行；无大副标题、全宽 Session 卡或 Prompt 外层卡套卡。
- configured provider 与 preference 交集为空/部分/多个；多模型只提交共同合法参数。
- POST 只发一次并带正确 sessionId/targets/count per model，不把后端 fanout 串行化。
- POST 成功进入同路由 Stage；Stage 隐藏 Inspector，图片占主区；POST 失败留在 Compose 并保留输入。
- Stage 是 Generate 唯一 poll 订阅入口；终态停止，返回 Compose 立即清理 timer/fetch 且不取消后台任务。
- Compose 的 `CurrentTaskEntry` 不轮询；点击后重进 Stage、立即 GET 最新详情并在非终态恢复轮询。
- 合法 `?generation=:id` 刷新后恢复 Stage；非法、已删除或跨 Project id 显示明确错误并可返回 Compose；无 query 的 Compose 不从 localStorage 恢复 active generation。
- 新 POST 成功时原子替换上一次 current-task id/snapshot/subscription，只显示本次 Generation；POST 失败保留旧入口；不渲染 Session Recent/History。
- Job 明细只包含当前 Generation，默认可折叠；状态、实际图片数和错误来自 DTO，不显示 duration/percent/queue/虚假 expected count。
- 部分完成（completed + failed/cancelled jobs）由 Job 集合派生，失败在摘要可见且不改变后端五态。
- 非终态 Cancel 只在 Stage 可见；取消走接口，返回编辑/路由切换不取消 job。
- 结果图点击打开 ImagePreviewDialog；不因结果图打开 Generation Detail 弹层。
- Session 可内联重命名（PATCH）；自动创建名为 `session-` + id 前 8 位。
- 桌面 Compose 为侧栏 + 主区 + inspector；Stage 为侧栏 + 全宽画布；非桌面正确收纳。

## Suggested Tests

- client unit：Compose/Stage reducer 或等价纯状态函数，覆盖 submit success 原子替换、failure 保留旧入口、back、resume、new submission sequence 与 stale response 丢弃。
- poll registry unit：Stage mount/unmount/reopen，最后订阅者释放；同 generationId 去重。
- contract：`GenerationView.jobs/error/images.jobId` 字段稳定，取消与 404 错误形态不退化。
- integration：fake adapter/MSW 下多 Job 部分完成、逐步出图、取消和后台 worker；只由 detail GET 推进 poll。
- 人工浏览器：1440/1024/390 下 Compose/Stage、键盘、折叠明细、图片预览和返回焦点。

## Acceptance

满足根级 C02–C13、F11；无重复参数区、Workspace 卡、Recent/Session 历史；Compose 与 Stage 不同时渲染；Stage 非终态只有一个可见 Cancel；Compose current-task 区域整行可点击且不持有隐藏轮询；键盘可完成 Session、model、Prompt、Generate、返回编辑、查看当前任务与展开 Job 明细全流程。

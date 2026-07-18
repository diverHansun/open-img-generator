# Generate · 测试与验收

## Test Scope

覆盖 Session 自动建立、capability 交集、payload、当次结果 poll 与取消；不重复测试 adapter 协议。

## Critical Scenarios

- route 已确定 Project，页面无 Project selector。
- 0/1/多 Session；首次 0 Session 自动创建默认名；lastSession 无效时不跨 Project 复用。
- configured provider 与 preference 交集为空/部分/多个。
- 多模型不同 capability 时只提交共同合法参数。
- POST 只发一次并带正确 sessionId/targets/count per model。
- 成功留在 Generate 并只轮询当次结果；失败保留 Prompt/targets。
- 非终态主按钮变为 Cancel；取消走接口，页面离开/路由切换不取消 job 且会停止浏览器 poll。
- Generate 不在后台轮询历史 generation；详情弹层打开时才允许其独立持有对应 poll。
- 结果图点击打开 ImagePreviewDialog（单张 + 关闭）；不因结果图打开 Detail 弹层。
- Session 可内联重命名（PATCH）；自动创建名为 `session-` + id 前 8 位。

## Integration Points

typed client unit；generation POST contract；多 Provider fanout integration 沿用既有 job-engine tests；浏览器检查 inspector 在三档宽度的收纳与结果区 poll。

## Acceptance

满足 C02–C07、C09–C11；无重复参数区/Workspace 卡/Recent 列表；键盘可完成 Session、model、Prompt、Generate 全流程。

# History · 测试与验收

## Critical Scenarios

- 7 个 Session 中 2 个为空：只计/显示 5 个。
- 6 个非空 Session：第一页 5，第二页 1。
- 一组 23 条：10 + 10 + 3，无重漏，末次按钮消失。
- totals 来自全 Project，不随展开/页码错误变化。
- 自动重取、翻页、Load more 均不触发详情或 fake provider poll；无手动 Refresh 按钮。
- 默认最新一组展开、其余收起；键盘可折叠；折叠状态不触发详情 GET。
- 行内批次缩略图条 5–6 张 + `+N`；整行可点打开 Detail 弹层。
- page 快速切换时旧响应不覆盖。
- 空、404、组内失败、整体失败均可恢复。

## Strategy

临时 SQLite integration 覆盖聚合和 cursor；contract 覆盖 page 参数；client unit 覆盖追加/去重；人工检查 table/stacked row、键盘折叠、Detail 弹层的 focus return。

## Acceptance

满足 B02–B05、D01–D04、D10–D11、F11；严格 5 Session/页、10 Generation/批；使用 flat rows + hairline，不出现 Session 卡、空 Session、duration 或伪进度。

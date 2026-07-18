# History

## Design Goals

- 以 Session 为创作上下文回溯当前 Workspace 的所有 Generation。
- 在数据增长时仍保持可预测分页和高密度浏览。
- 保证列表完全只读，不因浏览历史触发 Provider 请求。

## Duties

1. 只显示当前 Project 下有 Generation 的 Session。
2. 每页展示 5 个 Session，每组首批 10 条并可加载更多。
3. 展示真实状态、缩略图、Prompt、Provider/model、图片数和时间。
4. 从完整 Generation row 打开共享 Generation Detail 弹层。

## Non-Duties

- 不创建/移动/删除 Session。
- 第一批不做全文、日期、Provider、状态筛选。
- 不轮询、不计算虚假时长/百分比，也不提供手动 Refresh。

路由：`/workspace/:projectId/history?page=1`。

# Gallery · 测试与验收

## Critical Scenarios

- 多 Workspace 收藏同时出现；预览中的 Workspace metadata 正确，tile 无持久 Workspace label。
- project/provider 单独和组合过滤跨两页无重漏。
- filter 改变重置 cursor，快速切换旧响应被丢弃。
- Load more 追加/终止/失败 Retry。
- 打开不同 Workspace 图片时不切换 shell；从预览进入正确 Detail 弹层（先关预览），列表本身不 poll。
- unfavorite 成功、失败 rollback；图片 URL 404 fallback。
- 无手动 Refresh；进入页面与标签页重新可见时自动重取并保留 filters。
- 预览弹层单张 + 关闭，无左右切换；任何时刻只开一个弹层。

## Strategy

临时 SQLite integration 验证过滤发生在分页前；API contract 验证 query；client unit 验证 filter/cursor reducer；浏览器检查 1440/1024/390 网格、focus overlay、预览→Detail 焦点流转。

## Acceptance

满足 B06–B08、D05–D11；默认全局而非当前 Workspace；无 Search/Download/Favorites only 虚假控件。

# Gallery · 交互与状态

## Filters

Workspace、Provider 写 URL query。Newest 固定且不写为可选 sort。任何 filter 改变：abort 旧请求 → 清空 items/cursor → 从第一页加载。

## Load more

同一 cursor 只发一个请求；追加并按 image/favorite ID 去重。失败保留已加载网格并显示 Retry；nextCursor null 时显示结果结束而非 disabled 空按钮。

## Image actions

- 点击图片：打开单图预览，不切换 Workspace shell。预览中的“查看生成详情”先关闭预览，再打开共享 Detail 弹层；详情数据使用 item 的 `projectId/generationId`，不做路由跳转。
- Unfavorite：可 optimistic 移除，失败恢复原位置并提示。

## States

initial loading、filtered empty、global empty、partial load error、image load error 分开处理。进入页面及标签页重新可见时自动重取并保留 filters；不设定时器、不提供 Refresh。

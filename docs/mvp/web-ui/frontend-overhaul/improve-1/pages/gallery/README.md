# Gallery

## Design Goals

- 让用户在一个全局收藏视图中浏览主动保留的图片。
- 在预览中查看图片所属 Workspace/Provider，并能打开对应 Generation 的详情。
- 在不堆叠卡片的前提下提供图片优先的编辑式浏览。

## Duties

1. 全局列出 Favorite Image。
2. 支持 Workspace、Provider 服务端过滤和 Load more；Newest 为固定默认排序。
3. 在 hover/focus 或预览中展示 Provider/model、收藏时间和 Workspace 来源。
4. 取消收藏；从预览弹层打开共享 Generation Detail。

## Non-Duties

- 不按当前 route Workspace 自动过滤。
- 第一批不做全文、方向、下载管理、批量处理或相册。
- 列表不触发 generation poll；预览进入详情弹层后才允许弹层持有 poll。

路由：`/workspace/:projectId/gallery`；`projectId` 只提供导航壳上下文。

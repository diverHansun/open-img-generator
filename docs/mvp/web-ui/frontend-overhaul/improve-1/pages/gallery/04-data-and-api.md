# Gallery · 数据与 API

## 数据流

1. 页面从 URL 得到 `workspace` filter、provider；`workspace` 是项目 ID 的语义别名。
2. `GET /api/favorites?limit=24&cursor=&projectId=&provider=&sort=newest`；客户端将 URL 的 `workspace` 映射为 API 的 `projectId`，sort 是固定值而非用户筛选项。
3. 服务端先过滤再按 favorite time/id 排序并生成 cursor。
4. 取消收藏调用 `DELETE /api/favorites/:imageId`。
5. 打开预览不请求 Generation；预览内打开 Detail 弹层后，弹层才按 generationId 请求详情。

## DTO

复用 `Page<GalleryItem>`；item 必须包含 `imageId/url/dimensions/favoritedAt/provider/model/generationId/sessionId/projectId/projectTitle`。不在客户端再请求 Project title。

## 所有权

Favorite 与 join 回溯由 library；Gallery 只维护页面 filter/cursor。当前 shell projectId 不是默认 filter，除非 URL 明确写 `workspace=<id>`。`projectTitle` 只用于预览 metadata，不作为 tile 持久标签。

## 错误与 cursor

未知 Provider/Project 返回明确 400/404。cursor 仅与创建它的 filters 同用；client helper 统一编码 query，避免手拼。

# Gallery · 组件

| 组件 | 职责 |
|---|---|
| `GalleryPage` | URL filters、自动重新验证、列表与预览状态 |
| `GalleryFilters` | Workspace/Provider/Newest 控件 |
| `GalleryGrid` | 图片集合和状态 |
| `GalleryItem` | 图片、hover/focus metadata/actions、预览触发 |
| `GalleryOverlay` | focus/hover/tap 可达的次要信息 |
| `ImagePreviewDialog` | shared 弹层：单图预览 + 右侧信息卡 + “查看生成详情”入口（见 `shared/03`） |
| `LoadMoreButton` | shared cursor action |
| `FavoriteButton` | shared 取消收藏与 rollback |

不要引入重型 masonry 包。若 CSS columns 打乱键盘/阅读顺序，使用规则 grid，即使视觉高度不完全齐平。预览与 Detail 任一时刻只显示一个弹层；进入 Detail 前先关闭预览。

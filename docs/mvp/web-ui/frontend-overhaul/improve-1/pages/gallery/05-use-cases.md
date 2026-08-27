# Gallery · 用户用例

## Use Case Overview

1. Browse Global Favorites。
2. Narrow Favorites。
3. Return To Generation。
4. Remove Favorite。

## Main Flows

### Browse/Narrow

打开 Gallery → 获取全局 newest → 选择 Workspace/Provider → 服务端重新过滤 → Load more。Workspace 来源仅在预览 metadata 中显示，避免图片墙的持续标签噪声。

### Return

选择图片 → 打开单图预览 → 查看来源与 prompt 摘要 → 选择“查看生成详情”时关闭预览并打开共享 Detail 弹层；Workspace shell 不切换。

### Remove

激活 favorite action → 暂时移除 → API 确认；失败恢复。

## Responsibility Boundaries

Gallery 组织收藏视图；不拥有图片文件生命周期、不推进 generation、不实现下载管理。

## Failure Points

过滤竞态、cursor 失效、图片文件缺失、取消收藏失败。每项都局部恢复，不清空整个 Gallery。

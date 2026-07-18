# Gallery · UI 布局与样式

PageHeader 后是一行轻量顶部 filters：Workspace select、Provider select；Newest 为固定排序，不做可变 sort 控件，也没有 Refresh。正文直接进入图片区，不设置 Workspace 左侧 rail。

图片区使用 CSS grid/可访问顺序优先的 masonry-like 布局，gutter 4–8px。图片默认尽量裸露；Provider/model、favorite time 和取消收藏在 hover/focus/tap overlay 出现，Workspace 不作持久标签。点击图片打开单图预览弹层：左侧大图，右侧简洁 metadata（Workspace、Provider/model、收藏时间、Prompt 摘要、查看生成详情）。

Load more 位于网格底部中央。无收藏时使用轻量空状态，链接到 Generate/History。

移动端 filters 收为横向 controls 或 drawer；网格 2 列，极窄/大图可 1 列。不能依赖 hover 才能看到取消收藏；图片来源信息在预览中始终可达。

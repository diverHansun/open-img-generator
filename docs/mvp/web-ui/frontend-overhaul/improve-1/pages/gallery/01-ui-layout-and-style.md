# Gallery · UI 布局与样式

## 1. 页面结构

```text
Gallery
[Workspace ▼] [Provider ▼]                           Newest
──────────────────────────────────────────────────────────────
[ portrait ][ landscape ][ square ][ tall ][ landscape ... ]
[   tall   ][ square    ][ wide                ][ portrait  ]
                         Load more
```

PageHeader 下是一行轻量 filters：Workspace、Provider；Newest 为固定排序文案，不渲染可变 sort 控件。正文直接进入图片区，不设置 Workspace rail、Refresh 或额外卡片容器。

## 2. 图片墙

- 使用图片原始宽高比形成参差错落、接近 Midjourney/Grok image gallery 的 masonry-like 节奏；不是强制等高卡片网格。
- gutter 约 4–8px，图片尽量裸露；默认无 Workspace 标签、标题条、厚边框或永久渐变 overlay。
- hover/focus/tap 时只显示 model、收藏时间与 Favorite 图标；触控设备可通过 tap/预览获得同等能力。
- 实现优先保证 DOM 与视觉阅读顺序一致。CSS columns 若造成键盘顺序明显错乱，改用规则 grid + aspect-ratio spans 或经过验证的轻量布局方案。
- 图片加载必须预留尺寸，避免 masonry 重排导致跳动。

## 3. 预览弹层

```text
┌──────────────────────────────┬──────────────────────────────┐
│                              │ Workspace                    │
│          large image         │ Provider / model             │
│                              │ time                          │
│                              │ Prompt…                       │
│                              │ View generation detail       │
└──────────────────────────────┴──────────────────────────────┘
```

左侧大图，右侧信息区展示 Workspace、Provider/model、收藏时间、Prompt 摘要和“查看生成详情”。第一批只做单图 + 关闭，不做上一/下一张或嵌套第二弹层。

## 4. 继续加载与空态

Load more 位于网格底部中央；加载/失败不清空已有图片。无收藏时使用无卡框的轻量空态，链接到 Generate/History。

## 5. 响应式与样式边界

- 桌面列宽根据可用主区自适应；小屏通常 2 列，极窄或大图场景可 1 列。
- filters 可换行或横向滚动，不引入首批范围外的 filter drawer 字段。
- 不使用常驻文字标签、任何渐变/gradient shimmer、蓝紫或多色 AI 光效、emoji Favorite 或厚卡片；仅 hover/focus/预览工具可使用单色局部 halo/glass 反馈。
- 实施模型可以调整列宽算法、圆角和 hover 过渡，但必须保留图片优先、细 gutter、可访问顺序和无常驻标签。

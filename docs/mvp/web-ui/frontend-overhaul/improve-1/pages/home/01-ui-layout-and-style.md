# Home · UI 布局与样式

## 1. 结构

Home 使用独立 `HomeShell`，不渲染 Workspace 完整侧栏。

```text
┌──────────────────────────────────────────────────────────────┐
│ Brand                                           中文 | EN    │ 56–64px
├──────────────────────────────────────────────────────────────┤
│                                                              │
│                         选择工作区                            │ 32–40px display
│                     创建或进入一个创作空间                    │ muted
│                                                              │
│          ┌────────────────────────────────────────┐          │
│          │ 选择已有… │ 新建工作区 [title] [创建]  │          │ one surface
│          └────────────────────────────────────────┘          │
│                                                              │
│ 最近工作区                                                   │
│ [cover/title/stats] [cover/title/stats] [initial/title] […]  │ 3–4 columns
└──────────────────────────────────────────────────────────────┘
```

顶部品牌条左侧只放本地产品标识，右侧只放语言切换。主区最大宽约 1280px；首屏上半部居中放标题、说明和 Workspace 入口，下半部显示 Recent workspaces。

## 2. 选择与创建 surface

- “选择已有 Workspace”和“新建 Workspace”共享一个边界明确、无重阴影的 surface，不做两个并列大卡。
- Create 是该屏唯一实心 accent；进入已有 Workspace 使用选择行/secondary 动作，不与 Create 争夺层级。
- 它不是 Prompt 输入器，不复制模板、附件、团队版或营销站控件。
- 表单错误紧贴对应输入；不以 toast 代替字段错误。

## 3. Recent workspaces

- 桌面使用 3–4 列，卡片是 Home 允许的主要卡片类型，因为每张卡代表一个可独立进入的对象。
- 每张卡只展示 cover、title、last activity、session/generation/image count。无 cover 时使用首字母或中性几何占位，不生成虚假图片。
- summary 数字使用 tabular nums；长标题最多两行。
- 0 Workspace 时整个 Recent section 不渲染，中央改为“创建第一个工作区”，不展示空卡网格。

## 4. 响应式

- 顶部品牌条始终一行；小屏压缩内边距而不是改成侧栏。
- 选择/创建 surface 在窄屏纵向排列；Recent 由 3–4 列降为 2 列，再到 1 列。
- 标题不与创建表单并排；390px 和 200% zoom 下 Create 仍完整可见。

## 5. 样式边界

- 使用共享亮色 canvas 与单一纯色 accent；不固定陶土色，不使用蓝紫渐变、光晕或玻璃拟态。
- 页面留白多于 Workspace 内页面，但控件仍使用 40px 高和圆角矩形。
- 无 Backend connected、主题切换、无功能顶部图标或 emoji。
- 具体 cover 占位构图、accent hue 和卡片细节留给视觉实现校准，但不得增加第二个主动作或卡片嵌套。

# 3. 参考界面与视觉方向

> 五张参考图由用户提供，只用于提炼信息架构、密度和视觉语言，不构成逐像素实现或业务承诺。

## 3.1 总体判断

目标不是把当前 UI “换一套卡片”，而是建立更像桌面创作工具的页面层级：稳定侧栏、宽内容平面、细分隔线、少量强调面、清楚的行式信息。当前暖白与陶土红适合继续保留，但需要让颜色服务于选中、主动作和状态，而不是让每个容器都成为有阴影的卡片。

视觉关键词：**Warm Studio / Editorial Utility / Quiet Density**。

## 3.2 各参考图的借鉴边界

### 3.2.1 Home（OpenDesign）

来源：`codex-clipboard-9a2e99b4-52eb-4b0a-9260-76e69784e23e.png`

借鉴：

- 顶部品牌条与主内容之间的清晰层级。
- 中央大留白、一个明确的首要动作。
- 最近项目位于首屏下半部，不与主动作争夺注意力。
- 标题尺度与克制的辅助说明。

不借鉴：

- Prompt 输入、模板选择、团队版、Star、Discord 等不属于本产品的功能。
- 过多顶部图标或不具备真实能力的入口。
- 横向模板轮播。

本项目转换：中央区域是“选择已有 Workspace / 创建 Workspace”，最近区域显示真实 Project 摘要。

### 3.2.2 Providers

来源：`codex-clipboard-4ecbfc4b-066f-41da-882f-983c6eb6f019.png`

借鉴：

- 单一平面上的列式目录，而非每家一个卡片。
- Provider 名称、配置摘要、模型数量和进入详情动作横向对齐。
- 当前行可通过轻背景或左侧细强调线表示 hover/focus。

不借鉴：

- Add provider。
- Connected、域名、Last checked 等没有真实后端探测依据的信息。
- “API keys never sent to our servers”之类不符合本地 same-origin 写入事实的文案。

本项目转换：状态列只显示 Configured / Not configured 和 `Environment` / `Encrypted local config` 来源。

### 3.2.3 Models

来源：`codex-clipboard-fa3b4a07-1383-4a6b-bc70-aae5a1318147.png`

借鉴：

- 按 Provider 分组的扁平行列表。
- 搜索与 Provider 筛选集中在页头右侧。
- 展开行显示能力，而不是为每项能力创建卡片。
- 启用状态使用真正的 Switch。

不借鉴：

- 不存在于 capability 的 Inpainting、Outpainting、Vector 等虚假能力。
- 静态写死的默认尺寸、协议或模型数。
- 启用开关只改变外观却不持久化。

### 3.2.4 History

来源：`codex-clipboard-9d81fb07-1e53-4334-9264-35a6fa255e72.png`

借鉴：

- Session 作为一级组，Generation 作为组内行。
- 缩略图、Prompt、模型/Provider、状态、图片数、完成时间形成稳定列。
- 页码放在页面底部，组级操作与组内容分离。
- 行进入详情，适合高密度回溯。

不借鉴：

- 第一批不做搜索、All time、Provider 高级筛选。
- 不显示后端没有准确记录的 duration。
- 不根据 job 数伪造百分比进度条；只显示离散状态和已产出图片数。
- 不展示空 Session。

### 3.2.5 Gallery

来源：`codex-clipboard-c6db6eb7-d58b-4815-9281-35030e476df3.png`

借鉴：

- 图片优先的编辑式网格，图片之间只保留细小 gutter。
- 顶部集中放 Workspace、Provider 过滤；排序固定为 Newest，不额外占用控件。
- 元数据在 hover/focus/选中时显露，默认不让文字压过图片。
- Load more 比无限滚动更可控。

不借鉴：

- 第一批不做搜索、方向、Favorites only（Gallery 本身已是 Favorite）。
- 不加入尚无 API 的下载与多选批处理。
- 不依赖第三方 masonry runtime；优先 CSS columns/grid，在可访问顺序与视觉效果间取平衡。

## 3.3 统一视觉语言

### 3.3.1 空间与表面

- 页面背景使用暖白，内容默认直接落在页面平面上。
- 只有需要独立边界的交互单元才使用 surface：输入组合、对话框、浮层、图片选中态。
- 列表主要依赖分隔线、对齐和留白，不给每一行加四周边框和阴影。
- 卡片保留给 Home 最近 Workspace、Generate 结果占位等真正独立的对象；不允许卡片内再嵌同等级卡片。

### 3.3.2 字体层级

- 页面标题：清晰但不过度展示型，桌面建议 32–40px，移动端 28–32px。
- Section title：18–22px。
- 行主信息：14–16px，中等字重。
- 辅助信息：12–14px，保证对比度，不用极浅灰。
- Provider ID、model ID、时间可使用等宽数字/字体特性，但正文仍用项目现有 sans-serif。

### 3.3.3 色彩

- 陶土色只承担 primary action、active nav、focus accent 和少量强调。
- 绿色表示成功/已配置；黄色表示 pending/running 或需要注意；红色表示 failed/destructive；灰色表示未配置/禁用。
- “Configured”不能使用与“Connected”相同的语义文案，即使颜色相近。
- 颜色不是唯一状态信号；必须配合文本、图标或形状。

### 3.3.4 边框、圆角与阴影

- 主分隔线 1px，低对比暖灰。
- 表格/列表行通常无圆角；输入、按钮、小浮层使用中等圆角。
- 大圆角只用于 Home 最近 Workspace 或媒体预览等明确对象。
- 常规页面 section 不使用投影；浮层、dialog、sticky 控件允许使用一级轻阴影。

## 3.4 页面视觉映射

| 页面 | 主视觉结构 | 允许的卡片 | 应避免 |
|---|---|---|---|
| Home | 中央选择/创建 + 最近 Workspace | 最近 Workspace、主创建器 | 完整 Workspace 侧栏、模板业务 |
| Generate | Prompt/结果主区 + 参数 inspector | Prompt composer、结果媒体 | 重复参数栏、Workspace 大卡 |
| Detail 弹层 | 状态头 + Job 列表 + 图片网格 | 图片/错误摘要 | 只为字段分组造卡片或再套第二个弹层 |
| History | Session header + generation rows | 缩略图本身 | 每个 Session 外框卡片 |
| Gallery | 全局过滤 + 密集图片网格 | 图片选中/预览 | 每张图厚卡片和常驻长文案 |
| Models | Provider 分组 + row + Switch | 展开能力面板可用浅底 | 模型卡片堆叠 |
| Providers | 固定目录表 | 无常规卡片 | Add provider、虚假健康徽章 |
| Provider Detail | 配置表单 + 能力摘要 | 密钥输入组合 | 回显已存 secret |

## 3.5 响应式方向

- 大屏：Workspace 侧栏固定，内容区自主宽度；只有 Generate 使用右 inspector。
- 中屏：侧栏可压缩；Generate inspector 收为可切换面板，列表保持关键列。
- 小屏：侧栏变抽屉；表格变语义明确的 stacked rows，但 DOM 阅读顺序不因 CSS masonry 被打乱。
- Gallery 小屏使用等宽两列或单列；hover-only 信息必须可由 focus/tap 获得。
- Home 在所有断点均使用顶部品牌条；小屏仅压缩其高度与内边距，不保留左侧 Rail。

## 3.6 视觉禁区

1. 不用十几个相近白色卡片制造层级。
2. 不在同一页面重复“Backend connected”。全局健康只在确有意义的位置展示。
3. 不显示后端未提供的数据，即使参考图中存在。
4. 不把所有按钮都填充为陶土色；每屏保持一个主要动作。
5. 不让禁用项永久占导航空间。
6. 不用 hover 作为唯一信息入口。
7. 不用动画掩盖请求延迟；遵循 `prefers-reduced-motion`。

## 3.7 验收方式

视觉验收以信息层级、页面密度、状态真实性和跨页一致性为准，而非像素对比参考图。实施阶段需在桌面、窄桌面、手机三档截图对照；重点检查空白 inspector、卡片嵌套、长 Prompt/模型名、错误态和键盘 focus，不建立对字体抗锯齿敏感的像素快照。

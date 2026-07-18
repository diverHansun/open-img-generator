# Home · UI 布局与样式

## 桌面布局

首页使用独立的顶部品牌条，而非 Workspace 内的完整侧边栏：左侧是产品标识，右侧仅保留语言切换。主区最大宽约 1280px；首屏上半部居中放品牌短句、标题“选择工作区”与组合选择器；下半部为 Recent workspaces。

主选择区是一块有边界但无重阴影的交互面：已有 Workspace 下拉/快速选择与“Create new”入口并列，主动作明确。它不是 Prompt 大输入框，也不复制参考图的模板控件。

Recent 区使用 3–4 列 Workspace 卡；卡片是首页允许的主要卡片类型，展示 title、last activity、session/generation/image 数和可选封面。无封面时使用克制的首字母/纹理占位，不生成虚假图片。

## 小屏

品牌条保持一行；主区左右 20px；选择器纵向排列；Recent 两列并在窄屏单列。标题不挤压创建表单。

## 样式约束

- 页面留白多于 Workspace 内页面，但交互控件仍符合共享 control height。
- 陶土色只用于 Enter/Create 主动作和 focus/selected。
- summary 数字采用 tabular nums。
- 不显示 Backend connected 徽章；API 错误由页面状态承担。

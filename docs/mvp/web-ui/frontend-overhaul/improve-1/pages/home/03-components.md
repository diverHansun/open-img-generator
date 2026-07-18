# Home · 组件

| 组件 | 类型 | 职责 |
|---|---|---|
| `HomePage` | page container | 加载 summaries、处理 create/navigation |
| `HomeBrandBar` | shared shell | 首页顶部品牌条与语言切换，不承载 Workspace 导航 |
| `WorkspaceChooser` | page | 选择已有或切到创建模式 |
| `CreateWorkspaceForm` | page | title 校验与提交 |
| `RecentWorkspaceGrid` | page | summary collection 与状态 |
| `WorkspaceSummaryCard` | page | 封面、title、counts、last activity link |
| `InlineNotice` | shared | 加载失败/创建失败 |
| `EmptyState` | shared | 无 Workspace 引导 |

`WorkspaceSummaryCard` 接收 `ProjectSummary` 与 href，不持有 API client。`WorkspaceChooser` 不抽成全局 Project selector，因为其他页面不再需要该控件。

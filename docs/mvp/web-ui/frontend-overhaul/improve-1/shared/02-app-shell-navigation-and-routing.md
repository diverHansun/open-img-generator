# App Shell、导航与路由

## 1. 两种壳

### 1.1 HomeShell

- 路由：仅 `/`。
- 顶部品牌条（高约 56–64px）：左侧品牌标记，右侧放语言切换；主题/帮助等未实现功能不占位。
- 不展示 Workspace 内导航。
- 小屏沿用同一顶部品牌条（可压至 56px），语言切换保持可达。

### 1.2 WorkspaceShell

- 路由：`/workspace/[projectId]/**`。
- 桌面侧栏宽约 248px，固定显示当前 Workspace 标题。
- 顶部第一动作是 `← Workspaces`，返回 `/`。
- 菜单顺序：Generate、History、Gallery、Models、Providers。
- 不显示 Home 与未定义的 Settings。
- 侧栏底部放语言切换；不做明暗主题开关。
- 主内容宽度按页面决定；壳不预留 inspector，只有 Generate 自己建立 inspector。

## 2. 路由表

| 路由 | 导航 active | 页面 |
|---|---|---|
| `/` | 无 | Home |
| `/workspace/:projectId/generate` | Generate | Generate |
| `/workspace/:projectId/history` | History | History |
| `/workspace/:projectId/gallery` | Gallery | Gallery |
| `/workspace/:projectId/models` | Models | Models |
| `/workspace/:projectId/providers` | Providers | Providers |
| `/workspace/:projectId/providers/:providerId` | Providers | Provider Detail |

Generation Detail 不是路由，而是共享弹层（见 `07-generation-detail-dialog.md`），从 History 行与 Gallery 预览弹层打开；打开期间对应父菜单保持 active。Generate 可使用 `?generation=:id` 表示同一页面内正在打开的 Stage，它不新增导航项或独立页面，active 仍为 Generate。

Workspace 根 `/workspace/:projectId` 应 redirect 到 `/generate`，避免出现无职责页面。

## 3. Project 加载与错误

Workspace layout 以 route `projectId` 调用 Project 查询。加载成功后向下提供只读 `WorkspaceContext { project }`；页面不得自行重复加载只为标题。不存在返回 not-found；API 不可用显示壳级错误和 Retry/Back to Workspaces。Gallery/Models/Providers 数据虽为全局，仍需合法 Project 才进入该壳。

## 4. 导航行为

- 使用 Next `Link`，保留浏览器 back/forward 和打开新标签能力。
- active 状态由 pathname 派生，不保存到 React state/localStorage。
- 列表打开 Detail 弹层后对应父菜单仍 active；Generate 在 Compose/Stage 间切换时 active 不变。
- 切页时关闭移动抽屉、取消当前页面可取消请求；不得隐式取消 generation。
- 导航图标配文本；窄屏收起文本时必须有 `aria-label`/tooltip。

## 5. 页面框架

共享 `PageHeader` 包含 title、description、可选 actions。页面内容不统一包成卡片。建议：

```text
WorkspaceShell
├── Sidebar
└── Main
    ├── PageHeader
    ├── Inline feedback / filters
    └── Page-specific content
```

Generate Compose 可在 Main 内再分 `minmax(0,1fr) + inspector`；Generate Stage 隐藏 inspector 并使用完整 Main 宽度；其他页面始终使用完整 Main 宽度。

## 6. 响应式

- `>=1180px`：完整侧栏；Generate Compose 双列，Stage 单列图片画布。
- `920–1179px`：侧栏可压至 216px；Generate Compose inspector 变为页内折叠 panel，Stage 保持无 inspector。
- `<920px`：Workspace 侧栏变顶部栏 + modal drawer；主内容全宽。
- `<620px`：PageHeader actions 换行或进入 overflow；不得横向裁掉主操作。

断点由内容承载能力决定，可在实施中微调，但七个路由页面共享同一套壳断点。

## 7. 焦点与语义

- 提供 Skip to main content。
- drawer 打开时焦点进入，关闭后返回触发按钮，并锁定背景滚动。
- 当前导航使用 `aria-current="page"`。
- not-found/error 页面标题可被屏幕阅读器首先感知。

## 8. 验收

刷新任意合法深链不丢页面；非法资源不闪现旧数据；非 Generate 无空 inspector；手机抽屉可仅用键盘/触控完成导航；无 `activeView` 作为导航真相；无明暗主题切换入口；语言切换在两种壳均可用并持久化。

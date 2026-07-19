# 共享组件边界

## 1. 原则

只有被两个以上页面以相同语义使用的组件才进入 `src/components/ui/`、`shell/`、`dialogs/` 或 `i18n/`。页面专属组合留在页面目录，即使 JSX 看起来相似。优先原生 HTML 语义，不为"统一"创建万能 `Card`、`DataTable`、`Page` 配置引擎。

UI primitives 基于 **shadcn/ui**（Tailwind CSS + Radix UI）源码复制落地，代码归本项目所有，可按 tokens 定制；不引入 Ant Design / MUI 等运行时组件库。

## 2. Shell 组件

| 组件 | 职责 | 不负责 |
|---|---|---|
| `HomeBrandBar` | Home 顶部品牌条 + 语言切换位 | Workspace 导航 |
| `WorkspaceSidebar` | 当前 Workspace、返回和主导航、语言切换位 | Session 选择、页面请求 |
| `MobileWorkspaceHeader` | 小屏 drawer 触发与标题 | 页面 actions |
| `PageHeader` | title/description/action slot | 自动发请求、面包屑推断 |
| `LocaleSwitcher` | 中/英文切换并持久化 | 服务端语言协商 |

## 3. UI primitives（shadcn/ui 落地）

| 组件 | 核心契约 |
|---|---|
| `Button` | `primary/secondary/ghost/danger`，默认 40px 高、8px 左右圆角矩形，不做全 pill；loading 不改变宽度，原生 button/link 语义 |
| `IconButton` | 使用统一线性图标集，必须有 accessible label；tooltip 不能替代 label；禁止 emoji 代替图标 |
| `Input` / `TextField` | label、description、error 关联；不隐藏浏览器 autocomplete 语义 |
| `PasswordField` | 基于 Input 组合眼睛按钮；只控制当前 draft 显隐；不接收 saved value/masked secret |
| `Select` | 原生 select 优先；复杂场景用 shadcn Select（Radix） |
| `Switch` | shadcn Switch（Radix）；checked、disabled、saving、error 清晰 |
| `Dialog` / `AlertDialog` | shadcn Dialog；focus trap/return、ESC、遮罩关闭按语义配置 |
| `Sonner`（toast） | 仅用于"结果在界面上不显而易见的成功操作"（首批：凭证保存/清除）；错误一律就地展示，不走 toast |
| `StatusText` | icon/point + 文本，映射统一 generation/config 状态（自定义组合） |
| `InlineNotice` | info/warning/error/success；可选恢复动作（自定义组合） |
| `EmptyState` | title、detail、可选单一主动作；不强制卡片外框 |
| `LoadingBlock` | 页面/section/row 三档，不伪造业务内容 |
| `Pagination` | 页码、Previous/Next、当前页 `aria-current`（自定义组合） |
| `LoadMoreButton` | loading/end/error 状态；不兼作无限滚动 |
| `Thumbnail` | 固定占位、alt 规则、失败 fallback |

同一可视区域最多一个 `primary` 实心按钮。`danger` 默认使用 outline；只有明确不可逆且需最高警示的动作才允许实心 danger。图标首选 `lucide-react`，页面不得自行混入 emoji、不同线宽 SVG 或品牌装饰图标。

## 4. 共享弹层与领域展示组件

| 组件 | 说明 |
|---|---|
| `GenerationDetailDialog` | Generation 完整视图弹层；poll 持有方之一。规格见 `07-generation-detail-dialog.md` |
| `ImagePreviewDialog` | 单图预览弹层：左图 + 右侧信息卡（Workspace、Provider/model、收藏时间、Prompt 摘要；Gallery 场景额外提供“查看生成详情”链接）；单张 + 关闭，无左右切换。Generate 结果区与 Gallery 共用 |
| `GenerationStatus` | History、Generate 结果区与 Detail 弹层使用同一离散状态映射 |
| `ProviderLabel` | Provider display name + 可选 model；不显示 Connected |
| `FavoriteButton` | Generate 结果区/Detail 弹层/Gallery 共用，支持 optimistic UI + rollback |
| `CapabilityList` | Models 与 Provider Detail 展示真实 capability |
| `CredentialSourceLabel` | Providers/Detail 展示 env/user-config/none |
| `ProviderApplicationLink` | Providers 目录与 Detail 表单复用 catalog 的官方申请 API key 外链与安全新标签属性 |

不得创建一个同时覆盖 History row、Gallery tile、Detail job 的万能 `GenerationCard`；三者信息层级不同。

## 5. 组件状态契约

每个可请求组件必须区分：idle、loading/saving、success、recoverable error、disabled。按钮 saving 时禁用重复提交但仍保持 label 可读；Switch 失败回到服务端已确认值；列表局部加载失败不清空已加载内容。成功 toast 不替代界面状态更新本身（保存成功后输入清空、摘要重取仍要发生）。

## 6. Props 与数据边界

- primitive props 使用 UI 值，不接收整个 API client。
- 页面容器负责请求，把明确数据/回调传给展示组件。
- secret draft 只存在 Provider Detail 表单容器和 `PasswordField` 内；不进入通用 form context。
- URL 构建集中在 typed route helpers（如确有多处），不在每个 row 拼字符串。
- 所有用户可见文案通过 `t()` 字典 key 注入（见 `06-i18n.md`），组件不硬编码中英文。

## 7. 不建立的抽象

1. 无 schema-driven page renderer。
2. 无万能 DataTable：History、Models、Providers 各自保持语义列和移动布局。
3. toast 严格限制为成功反馈；不建立全局通知中心。
4. 无 Card primitive 强制所有 section 外框。
5. 无新的状态管理/provider 层只为传 API client。

## 8. 验收

共享组件至少被两个页面真实使用；组件不导入页面目录；页面组件不因复用而携带无关 props；所有 icon-only/action/switch/dialog 有键盘和屏幕阅读器语义；无硬编码界面文案。

# Generate · 组件

| 组件 | 职责 |
|---|---|
| `GeneratePage` | 数据加载、Compose/Stage 局部状态、表单草稿与唯一 current-task 所有权 |
| `GenerateCompose` | 组合紧凑 Session 工具行、Prompt 与 Inspector；不渲染结果画布 |
| `SessionToolbar` | 与页名同一工具行内选择/创建/重命名 Session，并处理首次自动创建 |
| `PromptComposer` | 单层 Prompt surface、字符计数、Clear、Submit |
| `CurrentTaskEntry` | Compose 中整行可点击的当前任务入口；只展示最后快照，不持有 poll |
| `ModelTargetList` | 当次多选、Provider/model/protocol 摘要 |
| `GenerationParameters` | capability 交集驱动的参数 |
| `AdvancedParameters` | negative prompt/seed/reference 等真实支持项 |
| `GenerateInspector` | Compose 内组合 models/parameters，不负责页面壳；Stage 不挂载 |
| `SubmitNotice` | 校验/提交错误与恢复动作 |
| `GenerationStage` | 当前任务图片画布、返回编辑、Cancel 与当次 generation 的详情 poll |
| `GenerationStageSummary` | 从 jobs/images 派生整体摘要；不伪造 percent/duration/expected count |
| `CurrentJobDisclosure` | 当前 Generation 的 Job 可折叠明细；不读取 Session history |
| `GenerationImageGrid` | 按实际图片数量自适应排布，并为非终态无图 Job 提供有限 skeleton |
| `ImagePreviewDialog` | shared：结果图点击打开单图预览（单张 + 关闭，无左右切换） |

复用 shared `Button`、`Select`、`TextField`、`InlineNotice`、`GenerationStatus`、`FavoriteButton`、`ImagePreviewDialog`。capability 交集继续复用 `src/lib/web-client/capabilities.ts` 纯逻辑。

`GenerationStage` 与 `GenerationDetailDialog` 可以复用稳定的状态映射、Provider label、Favorite 和图片 primitive，但不合成万能详情组件：Stage 是 Generate 当前任务画布，Dialog 是 History/Gallery 的档案弹层，两者布局、导航与生命周期不同。不得建立通用动态表单或 schema-driven Stage 引擎。

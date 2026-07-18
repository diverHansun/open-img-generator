# Generate · 组件

| 组件 | 职责 |
|---|---|
| `GeneratePage` | 数据加载、表单状态、submit 与当次结果所有权 |
| `SessionBar` | 选择/创建/重命名当前 Project Session，并处理首次自动创建 |
| `PromptComposer` | Prompt、字符计数、Clear、Submit |
| `ModelTargetList` | 当次多选、Provider/model/protocol 摘要 |
| `GenerationParameters` | capability 交集驱动的参数 |
| `AdvancedParameters` | negative prompt/seed/reference 等真实支持项 |
| `GenerateInspector` | 组合 models/parameters，不负责页面壳 |
| `SubmitNotice` | 校验/提交错误与链接 |
| `CurrentGenerationResult` | 当次 job 状态、结果图、收藏与当次 generation 的详情 poll |
| `ImagePreviewDialog` | shared：结果图点击打开单图预览（单张 + 关闭，无左右切换） |

复用 shared `Button`、`Select`、`TextField`、`InlineNotice`、`StatusText`、`ImagePreviewDialog`。capability 交集继续复用 `src/lib/web-client/capabilities.ts` 纯逻辑。不得建立通用动态表单引擎。

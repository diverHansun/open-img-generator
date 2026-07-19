# Generate · UI 布局与样式

## 1. 两个局部视图

Generate 在同一路由内只有两个互斥视图：

- **Compose**：Session、Prompt、模型和参数编辑。
- **Stage**：当前 Generation 的图片、状态与 Job 明细。

两个视图共享 `GeneratePage` 的短生命周期表单与 current-task 状态，但不同时渲染。不得把 Prompt、Inspector、结果画布和 Job 明细重新堆回同一长页面。

## 2. Compose 桌面结构

Compose 是唯一显示 inspector 的状态：Workspace 侧栏约 248px，主区 `minmax(0,1fr)`，inspector 约 320–360px。

```text
┌──────────────┬────────────────────────────────────┬───────────────┐
│ ← 工作区列表 │ 生成  Session: session-a7f2 [∨][+ ]│ 模型 2/2      │
│ Workspace    ├────────────────────────────────────┤ ───────────   │
│ ───────────  │ ┌ 描述你想生成的画面……            │ [ ] FLUX      │
│ 生成         │ │                                  │ [x] GPT Image │
│ 历史         │ └──────────────────────────────────┤ ───────────   │
│ 图库         │ [清空]                    [生成]   │ 比例 1:1      │
│ 模型         ├────────────────────────────────────┤ 张数 1        │
│ 服务商       │ 当前任务 · 2 张已返回    [查看进度]│ Seed          │
│              │                                    │ Advanced      │
│ 中文 | EN    │                                    │               │
└──────────────┴────────────────────────────────────┴───────────────┘
```

- 不显示大号“生成”标题加说明段落；页名与 Session 位于同一紧凑工具行。
- Session 以 select/combobox、重命名和新建动作组成，不包成全宽卡片。
- Prompt 输入本身是 Compose 主区唯一主要 surface，不再使用“外层卡片 + 内层 textarea”。默认约 3–5 行，有限自动增高，达到上限后内部滚动。
- “清空”是低层级文字/ghost 动作，“生成”是 Compose 唯一实心 accent 动作。
- 没有 current task 时不渲染空结果框；有 current task 时只显示一条紧凑、整行可点击的入口，不伪装实时状态。

## 3. Stage 桌面结构

Stage 隐藏 inspector，主区使用 WorkspaceShell 剩余全部宽度。它是低 chrome 的生成画布，不是玻璃拟态、半透明浮层或厚边框大卡片。

```text
┌──────────────┬──────────────────────────────────────────────────────┐
│ ← 工作区列表 │ ← 返回编辑   session-a7f2   2 张已返回      [取消] │
│ Workspace    ├──────────────────────────────────────────────────────┤
│ ───────────  │                                                      │
│ 生成         │       [ 已完成图片 ]       [ Job 生成占位 ]          │
│ 历史         │       [ 已完成图片 ]       [ Job 生成占位 ]          │
│ 图库         │                                                      │
│ 模型         │ 当前任务 · 1 运行 / 1 完成 / 0 失败             [∨] │
│ 服务商       ├──────────────────────────────────────────────────────┤
│              │ fal.ai · FLUX Schnell             运行中            │
│ 中文 | EN    │ ZenMux · GPT Image 2              完成 · 2 张       │
└──────────────┴──────────────────────────────────────────────────────┘
```

### 3.1 图片画布

- 1 张：限制最大宽度后居中；2 张：并排；3–4 张：自适应两列；更多图片使用 `auto-fit` 网格换行。
- 已返回图片立即占据主要空间。非终态且尚无图片的 Job 可提供一个保持目标比例的 skeleton；不得捏造精确“剩余 N 张”。
- 图片边界由图片本身、间距和必要的轻微 surface 区分；画布无厚卡、无常规阴影、无装饰渐变。
- 点击图片打开 shared `ImagePreviewDialog`；收藏动作贴近图片但不遮挡主要内容。

### 3.2 当前 Job 明细

- 画布下方只展示**当前 Generation** 的 Job 摘要与可折叠明细，不展示当前 Session 之前的 Generation。
- 摘要常驻，显示由真实 DTO 可推导的 Job 数量状态与实际图片数；明细默认收起，用户显式展开。
- 明细行展示 Provider/model、`pending/running/completed/failed/cancelled`、实际图片数；失败时展示安全错误摘要。
- 不显示 duration、队列位置、成本、百分比或没有持久化依据的 `x/y`。

## 4. Inspector

Inspector 仅属于 Compose，顺序为 Selected models → shared parameters → Advanced。

- 模型使用紧凑 checkbox rows，不为每个模型创建厚卡。
- aspect/count/seed 等参数只在 inspector 出现一次，主区不得复制。
- Advanced 默认收起，只展示所有已选模型 capability 交集支持的字段。
- 不放 API health、Backend connected 或 Refresh。

## 5. 中小屏

- 小于约 1180px，Compose inspector 收为“模型与参数”页内折叠区或抽屉；Prompt 与主动作保持邻近。
- Stage 始终不显示 inspector；图片按可用宽度换列。
- Session 工具行可换行，但页名、当前 Session 和主要动作不拆成独立大卡。
- 小屏侧栏转 drawer 后，Compose/Stage 主区占满宽度；Stage 返回动作必须在 drawer 关闭时仍可达。

## 6. 样式边界

- 主区依靠间距与 1px hairline 分层，常规 section 无阴影。
- Compose 一屏只有 Generate 是实心主动作；Stage 非终态只有 danger-outline Cancel，返回编辑为普通导航动作。
- 使用少量统一线性图标，不使用 emoji、AI 渐变、glassmorphism 或装饰光效。
- 具体 accent hue、Prompt 高度、图片 gap 与画布最大宽度可在实现时校准；Compose/Stage 分离、Inspector 可见性和当前任务唯一性不可改变。

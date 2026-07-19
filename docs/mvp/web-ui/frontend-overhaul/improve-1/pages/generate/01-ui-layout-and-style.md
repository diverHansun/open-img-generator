# Generate · UI 布局与样式

## 1. 桌面结构

Generate 是唯一拥有 inspector 的页面：Workspace 侧栏 248px，主区 `minmax(0,1fr)`，inspector 320–360px。

```text
┌──────────────┬──────────────────────────────────┬───────────────┐
│ ← 工作区列表 │ Generate                         │ Models 2/2    │
│ Workspace    ├──────────────────────────────────┤ ───────────   │
│ ───────────  │ Session: session-a7f2  编辑 新建 │ [ ] FLUX      │
│ 生成         ├──────────────────────────────────┤ [x] GPT Image │
│ 历史         │ Prompt                           │ ───────────   │
│ 图库         │ ┌──────────────────────────────┐ │ 比例 1:1      │
│ 模型         │ │                              │ │ 张数 1        │
│ 服务商       │ └──────────────────────────────┘ │ Seed          │
│              │ Clear                 Generate   │ Advanced      │
│              ├──────────────────────────────────┤               │
│              │ fal 运行中                       │               │
│ 中文 | EN    │ zenmux 完成 [image] [image]      │               │
└──────────────┴──────────────────────────────────┴───────────────┘
```

Page title 下方是紧凑 Session bar：当前 Session、切换、创建、重命名。它不包成 Workspace 卡，也不影响其他页面。

## 2. 主区

顺序固定为 Prompt composer → 提交/字段反馈 → 当次 Generation 结果区：

- Prompt composer 是主区唯一允许的主要 surface，只含 Prompt、Clear 与 Generate/Cancel。
- 生成中原 Generate 按钮原位变为 danger-outline Cancel；不并排增加第二个取消按钮。
- 结果区按 provider/job 展示离散状态、局部错误和实际图片；不伪造 duration 或百分比。
- 完成图片可收藏/预览；不自动跳转，不保留 Recent 10。
- 无 generation 时使用紧凑空态，不做大卡套卡。

## 3. Inspector

顺序：Selected models → shared parameters → Advanced。

- 模型使用紧凑 checkbox rows，不为每个模型创建厚卡。
- aspect/count/seed 等参数只在 inspector 出现一次，主区底部不得复制。
- Advanced 默认收起，只展示所有已选模型 capability 交集支持的字段。
- 不放 API health、Backend connected 或 Refresh。

## 4. 中小屏

- 小于约 1180px，inspector 收为“Models & parameters”页内折叠区或抽屉；Prompt 与主动作保持邻近。
- Session bar 可换行；模型/参数打开方式必须可由键盘和触控完成。
- 小屏不固定三列；侧栏转 drawer 后主区占满宽度，结果图按可用宽度换列。

## 5. 样式边界

- 主区依靠间距与 1px hairline 分层，常规 section 无阴影。
- 主动作是圆角矩形；一屏同一时刻只有 Generate 或 Cancel 之一承担最高动作层级。
- 使用少量统一线性图标，不使用 emoji、AI 渐变或装饰光效。
- 具体 accent hue、Prompt surface 明度和图片列宽可在实现时校准，信息顺序和控件唯一性不可改变。

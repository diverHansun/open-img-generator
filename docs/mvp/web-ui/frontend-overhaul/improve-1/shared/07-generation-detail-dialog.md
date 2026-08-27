# Generation Detail 弹层

## 1. 定位

Generation Detail 是某一次生成的“完整档案视图”，以**共享卡片弹层**（`GenerationDetailDialog`）呈现，**不占路由**。它是浏览器端两个 poll 持有方之一（另一个是可见的 Generate Stage，见 `05-state-and-data-boundaries.md` §6）。

入口：

1. History 行（整行点击/键盘 Enter）。
2. Gallery 预览弹层内的"查看生成详情"链接。

不是入口：Generate Stage（Stage 本身就是 current task 视图，不再套弹层）；任何列表的自动预取。

## 2. 弹层层级规则

- 任何时刻只开一个弹层：从 Gallery 预览弹层进入 Detail 时，先关闭预览弹层再打开 Detail。
- Detail 弹层内点击图片不新开弹层，而是切换到弹层内的"单图视图"（大图 + 返回详情按钮）。
- ESC / 遮罩点击 / 关闭按钮均可关闭；关闭后焦点返回触发元素（History 行或预览触发点所在的列表）。

## 3. 布局

```text
┌ GenerationDetailDialog ────────────────────────┐
│ ● 部分完成                     [Cancel] [×]    │  ← 由 jobs 派生的展示摘要
│ Prompt 全文 · 创建时间 · 更新时间                │
├────────────────────────────────────────────────┤
│ fal.ai · FLUX Schnell    ✗ Failed              │
│   Error: 401 Unauthorized …                    │
│ ZenMux · GPT Image 2     ✓ Completed · 2 张     │
├────────────────────────────────────────────────┤
│ [图] [图]            ← 图片网格，Favorite 图标    │
└────────────────────────────────────────────────┘
```

- 状态头：后端整体五态（pending/running/completed/failed/cancelled）、Prompt 全文、创建/更新时间。若 jobs 同时包含 completed 与 failed/cancelled，可派生“部分完成”展示摘要，但不新增持久化状态。
- Job 列表：每个 Provider 一行：Provider/model、状态、失败时的错误摘要、产出图片数。无虚假 duration/百分比。
- 图片网格：可点击进单图视图；每张图有 FavoriteButton。
- Cancel 仅在 generation 非终态时显示，单击即调已有 cancel endpoint（无二次确认），结果以服务端状态为准。

## 4. 交互与状态

| 状态 | 表现 |
|---|---|
| 打开 | 立即 `GET /api/generations/:id`；加载中显示骨架，不展示旧数据 |
| 非终态 | 按既有 polling 规则调度下一次 GET；状态变化经 `GenerationStatus` 映射更新，轮询 tick 不重复播报相同状态 |
| 终态 | 停止轮询；Cancel 消失 |
| 关闭 | 清理 timer 与进行中的 fetch（AbortController）；不取消后台任务 |
| 不存在 | 内联"记录不存在或已删除"（404 场景），提供关闭动作 |
| 请求失败 | 内联错误 + Retry；不清空已展示内容 |
| 收藏切换 | optimistic + 失败回滚；成功后回调来源列表做局部更新 |

DTO 携带 `projectId`（见根级 `02` §2.5.3）：Gallery 为全局收藏，弹层用它展示来源 Workspace 并保证上下文一致；不做事先路由级归属 404。

## 5. 数据与 API

- 只调用：`GET /api/generations/:id`（唯一推进 poll 的读取）、已有 cancel endpoint、Favorite add/remove。
- 不调用任何列表接口；不修改原 generation；不自动重试厂商 job。
- 弹层内不显示后端未提供/未持久化的 count、aspect、seed、duration、费用、队列位置或进度百分比；实际图片数按 `images[].jobId` 统计。

## 6. 可访问性

- shadcn Dialog 语义：focus trap、ESC、关闭后焦点返回。
- 状态区使用适度 `aria-live="polite"`；图片 alt 用简短 Prompt 摘要。
- 单图视图有"返回详情"按钮并支持键盘返回。

## 7. 测试要点

- unit：打开→GET→终态停止/非终态调度的状态机；关闭清理；收藏回滚。
- integration：打开弹层推进对应 generation 的 poll；History/Gallery 列表本身不触发该 GET。
- 人工：键盘全流程；从两个入口打开/关闭的焦点返回；与 Generate Stage 分别打开时轮询所有权正确。
- 对应根级 `04` 的 C06–C11、D04。

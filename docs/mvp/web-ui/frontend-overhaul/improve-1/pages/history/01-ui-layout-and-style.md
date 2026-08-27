# History · UI 布局与样式

## 1. 桌面结构

History 使用 WorkspaceShell 完整主区，不使用 inspector，不放 Refresh 或第一批范围外的搜索/筛选。

```text
History · 8 sessions · 47 generations · 120 images
──────────────────────────────────────────────────────────────
▾ session-a7f2               12 generations · 30 images · 2h
  [thumb strip +N] Prompt…    fal / FLUX       Completed    2h
  [thumb strip]    Prompt…    zenmux           Completed    3h
  … 10 rows                                   Load more
──────────────────────────────────────────────────────────────
▸ session-b21e                8 generations · 16 images · 昨天
──────────────────────────────────────────────────────────────
                          Previous  1  2  3  Next
```

PageHeader 下显示全 Workspace 的真实 totals。Session 是一级可折叠组，Generation 是组内扁平行；用分隔线、展开和列对齐建立层级，不给每个 Session 加四周卡框。

## 2. Session group

- Header 包含 title/ID、最近时间、generation/image count 和展开状态。
- 最新组默认展开，其余默认收起；每页严格 5 个含 Generation 的 Session。
- Header 行高按目录密度 48–52px 起步；长 title 截断但可访问完整值。
- 只有存在 cursor 时，组尾显示 Load more；首批 10 条，追加而非替换。

## 3. Generation row

桌面列：batch thumbnail strip、Prompt、Model/Provider、Status、Updated。

- thumbnail strip 展示 5–6 张，超出以 `+N` 表示；图片数不再重复占独立列。
- Prompt 最多两行；model/session ID 可用等宽字体；status 是图标/点 + 明确文本。
- 不显示不可靠 duration、伪进度条或操作菜单。
- 整行是进入 Generation Detail 的唯一交互，不在行内嵌 Favorite/Cancel 等按钮。

## 4. 移动端

每条转为 stacked row：thumbnail strip → Prompt → status/provider/time。Session header 保留展开和 count；页码可换行但当前页、Previous/Next 始终明确。

## 5. 样式边界

- 无 Session card、Generation card 或阴影；hover/focus 使用 subtle surface。
- 分隔线和文本密度优先，accent 只用于 focus/active，不沿每行常驻铺色。
- 展开图标来自统一图标集，不使用字符 emoji；颜色不是状态唯一信号。
- 具体列宽允许按中英文和真实数据调整，但信息优先级与 5/10 分页结构不可改变。

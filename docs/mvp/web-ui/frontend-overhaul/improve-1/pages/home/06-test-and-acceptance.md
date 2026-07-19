# Home · 测试与验收

## Test Scope

覆盖 summary DTO、稳定排序、create/navigation 与页面状态；不测试 Session/Generation。

## Critical Scenarios

- 0/1/多 Workspace 正确布局。
- 无图与有图 summary，counts 与时间准确。
- 创建成功仅创建 Project，并进入正确 Generate URL；Home 不抢先创建 Session。
- 空 title 不发请求；失败保留输入；重复点击只发一次。
- cover 404 不破坏卡片 link。
- 0 Workspace 时不渲染空 Recent 区；多 Workspace 时桌面 3–4 列、小屏逐级收为 2/1 列。

## Integration Points

临时 SQLite 验证 `project-summaries` 聚合，contract 验证 Project create。人工检查 `/` 有顶部品牌条和语言切换、没有完整侧栏、Session 或 Backend connected。

## Acceptance

满足根级 A01、B01、C01、F11；1440/390px 可用；键盘可选择最近 Workspace 和提交创建表单；只有 Create 是实心 accent，页面无渐变、emoji 或第二主动作。

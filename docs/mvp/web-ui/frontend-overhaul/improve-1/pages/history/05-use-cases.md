# History · 用户用例

## Use Case Overview

1. Browse Sessions With Work。
2. Load Older Generations In Session。
3. Open Generation Detail。

## Main Flows

### Browse

打开当前 Workspace History → 服务端返回 5 个最近非空 Session 与 totals → 用户展开/浏览 → 用页码进入更早 Session。

### Load Older

某组超过 10 条 → 激活 Load more → 以 cursor 追加 → 直到 nextCursor null。

### Open Detail

选择一条完整 row → 打开共享 Detail 弹层；此时才允许弹层持有该 generation 的详情 poll。关闭弹层不会取消后端任务。

## Boundaries & Failures

空 Session 不是错误且不显示；组内失败不影响其他组；外层失败保留清晰 Retry。实时插入可能让 Session 跨页移动，用户通过自动重取后的新排序继续浏览。

# History · 交互与状态

## 外层分页

`page` 写入 URL。Previous/Next/页码导航重新请求 5 个非空 Session；超出页在有数据时规范化到有效页，或显示空并返回第一页动作。切页滚动到页面标题并保留 Workspace 壳。

## 组内加载

Session 可展开/收起；首批数据随外层 response 返回。Load more 使用该组 nextCursor，追加 10 条，失败保留已有行并就地 Retry。不同组可独立加载，但同组不得并发重复请求。

## 行动作

点击完整 Generation row 打开共享 Detail 弹层；不预取、不在打开前推进详情 API。弹层关闭后恢复 History 的滚动位置和当前展开状态。

## 状态

无非空 Session 时显示“还没有生成记录”，可去 Generate。进入页面及标签页重新可见时自动重取列表，不调用详情；不设置定时器，也没有 Refresh 按钮。展开状态只在当前页内存保存。

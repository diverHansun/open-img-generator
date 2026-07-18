# History · UI 布局与样式

PageHeader 下显示真实 totals（非空 sessions、generations、images），不放 Refresh。正文按 Session 分组：Session header 包含 title/日期、generation/image count、展开按钮；首个最新组默认展开，其余默认收起。组内是表式 Generation rows。

桌面行由 batch thumbnail strip（5–6 张缩略图，剩余显示 `+N`）、Prompt、Model/Provider、Status、Updated 组成；图片数由缩略图条与 `+N` 表达，不再单独占一列。整行作为打开详情弹层的单一按钮/链接，不能再嵌套可点击控件。无可靠 duration 列。Session 组使用顶部/底部分隔线，不包厚卡。

组尾只有存在 cursor 时显示 Load more。页面底部为 Session 数字分页，每页 5 组。

移动端每条变 stacked row：thumbnail strip、Prompt、status、provider、time；Session header 保留展开和 count。分页按钮可换行但当前页明确。

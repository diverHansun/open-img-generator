# Generate · UI 布局与样式

## 桌面

WorkspaceShell 内使用页面专属双列：主区 `minmax(0,1fr)`，inspector 320–360px。PageHeader 下方是紧凑 Session bar（当前 Session、切换、创建、重命名），不是大型 Workspace 卡。

主区顺序：Prompt composer → submit feedback → 当次 Generation 结果区。结果区在 pending/running 时显示每个 job 的进度与取消状态，完成后展示图像与收藏入口；不会另起详情页面。Prompt composer 内只保留一套 Prompt、Clear、Generate；不在底部再次复制 aspect/count/seed。

Inspector 顺序：Selected models → shared parameters → advanced parameters。模型选择使用紧凑 rows/check，避免每个模型厚卡片；不放 API health 或手动刷新入口。

## 中小屏

小于 1180px inspector 收为“Models & parameters”页内折叠区/抽屉；Generate 主按钮仍靠近 Prompt。Session bar 换行；触控不依赖 hover。

## 样式

Prompt composer 可作为单一 surface；其他区依靠分隔线。无 generation 时使用轻量空状态，不用大卡套卡。错误靠近对应字段/提交区。

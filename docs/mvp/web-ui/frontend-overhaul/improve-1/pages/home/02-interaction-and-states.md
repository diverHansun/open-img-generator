# Home · 交互与状态

## 进入已有 Workspace

点击 Recent card 或选择器中的 Workspace，导航到 `/workspace/:projectId/generate`。卡片内部不嵌套多个点击按钮；整卡使用明确 link 语义。

## 创建 Workspace

1. 点击 Create new，展开内联 title 输入。
2. trim 后空 title 时主按钮 disabled，并显示说明。
3. 提交期间锁定本表单，其他 Workspace link 仍可用。
4. 成功后直接进入新 Workspace Generate；不在 Home 创建 Session。
5. 失败时保留 title，就地显示 Retry/错误。

## 页面状态

- loading：保留稳定 hero，Recent 显示少量 skeleton。
- empty：主创建器成为唯一主动作，解释 Workspace 用途；Recent 区整体不渲染。
- error：不渲染假卡片；显示 Retry，创建能力是否可用取决于 API 健康，不静默禁用。
- long title：两行截断，完整值可访问。

本批没有删除/重命名，因此无卡片 overflow menu。

## 刷新与语言

进入首页时读取 Workspace summary；浏览器标签页重新可见时重取一次，不设置定时器，也不提供 Refresh 按钮。顶部语言切换立即替换本页文案并持久化 `locale`；它不改变当前 Workspace、表单输入或路由。

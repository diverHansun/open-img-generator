# Models · 交互与状态

## Search/filter

对固定、已加载模型集合客户端执行；搜索 display name、model ID、Provider name，大小写不敏感。Search/filter 可仅在内存，刷新重置可接受；若实现写 URL，两者必须同时一致，不能半套。

## Switch

点击后进入行级 saving，调用增量 PUT。建议立即视觉切换但锁定该行；成功确认，失败回滚并在行内显示错误。不同模型可并行保存，同一模型串行。

默认无 preference 记录按现有规则视为 enabled。不要为了展示先为所有模型写默认行。

## 展开

可多行同时展开；Enter/Space 操作；展开状态不持久化。capability 无某字段时省略，不用 “N/A” 填满表。

## Provider 配置变化与重新验证

进入页面及浏览器标签页重新可见时自动重取 capabilities/preferences，不设置定时器，也不提供 Refresh 按钮。已不配置 Provider 的组从本页消失，但其历史 preference 保留；重新配置后恢复原偏好。未配置 Provider 存在时只显示轻量去 Providers 提示，不渲染空模型组。

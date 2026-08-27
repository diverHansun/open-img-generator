# Models

## Design Goals

- 让用户明确决定哪些已配置 Provider 模型出现在 Generate 可选池。
- 用真实 Switch 和真实 capability 替代静态 Enabled 标签。
- 维持模型偏好与 Provider 凭证的职责分离。

## Duties

1. 列出已配置 Provider 的已知模型并按 Provider 分组。
2. 客户端搜索和 Provider 筛选。
3. 展开真实 capability。
4. 增量持久化 model preference。
5. 存在未配置 Provider 时在页头给出“去配置 →”轻提示。

## Non-Duties

- 不配置 API key、不注册自定义模型。
- 不探测远端模型列表、价格或可用性。
- 不允许未配置 Provider 的模型进入 Generate；未配置目录在 Providers 查看，本页不渲染其模型组。

路由：`/workspace/:projectId/models`；偏好为全局作用域。

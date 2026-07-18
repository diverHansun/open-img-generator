# Models · 组件

| 组件 | 职责 |
|---|---|
| `ModelsPage` | 加载/自动重新验证 capability/preferences，search/filter/saving map |
| `ModelToolbar` | search、Provider filter |
| `UnconfiguredProvidersHint` | 存在未配置 Provider 时的轻量去配置入口 |
| `ProviderModelGroup` | group heading 与 rows |
| `ModelRow` | 摘要、展开、Switch |
| `ModelCapabilityDetails` | 真实 capability definition list |
| `Switch` | shared 可访问开关 |
| `CapabilityList` | shared Models/Provider Detail 共同展示 |

页面容器完成 `capability + preference` join；Switch 只接收 checked/saving/onChange/error，不接 API client。

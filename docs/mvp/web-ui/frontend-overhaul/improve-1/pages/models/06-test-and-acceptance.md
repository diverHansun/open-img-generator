# Models · 测试与验收

## Critical Scenarios

- 缺 preference 行默认 enabled。
- 搜索 display/model/provider；Provider filter 与搜索组合。
- Switch 成功持久化；失败回滚；同 row 防重复。
- unconfigured Provider 不出现在 Models，配置后出现且恢复历史 preference。
- 有未配置 Provider 时显示去 Providers 提示；全配置时不显示空提示。
- 展开只显示真实 capability；Kling/Qwen 等协议与 mode 不混淆。
- Project 切换不改变全局 preference。

## Strategy

join/filter pure unit；model-preference contract；浏览器键盘/移动 stacked row；Generate 集成检查 disabled 模型不进入池。

## Acceptance

满足 E12、F11；页面有真实 Switch；主行字段保持最小集，无静态 Enabled pill、卡片堆叠、价格/健康等无关状态或虚假能力。

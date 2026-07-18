# Providers · 交互与状态

## 行导航

每行有明确 Detail link，进入 `/workspace/:projectId/providers/:providerId`。整行 hover 可提示，但不要把含内部元素的整行包成嵌套按钮。

## 自动重新验证

进入页面及标签页重新可见时重新请求 configuration summaries；不向七家厂商发请求，不生成 last checked，也不设置定时轮询。请求期间保留旧 rows；失败保留旧数据和 Inline Retry。页面没有 Refresh 按钮。

## 状态

- loading：固定七行 skeleton 或稳定表头。
- none configured：仍展示七家及进入配置动作。
- partial configured：逐行准确显示 source。
- error：不把所有行降级为 Not configured；说明摘要加载失败。

列表不提供密钥眼睛、Save/clear、模型 Switch 或 Add provider；申请 key 外链只打开官方页面，不会改变本地配置。

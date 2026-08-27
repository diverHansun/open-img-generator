# Providers · 测试与验收

## Critical Scenarios

- 无 key/部分 key/全部 key 始终返回七行。
- env 与 user-config source 准确，env 优先。
- Kling/Qwen credential 映射不混用。
- available/enabled model 数来自真实 catalog/preference。
- 自动重新验证不调用任何厂商 HTTP；失败不篡改旧 rows，也不提供 Refresh 按钮。
- 每家申请 key 链接来自 catalog allowlist，使用安全新标签属性。
- DTO/DOM 无 secret、masked suffix、Connected、Last checked、Add provider。

## Strategy

provider-config unit + route contract allowlist；临时 user-config integration；浏览器 table/stacked row、键盘 detail link。

## Acceptance

满足 E01–E04、F11；七家固定 flat directory 可用；状态文案不夸大真实能力；无 Provider 卡、常驻 accent 装饰或 emoji 外链图标。

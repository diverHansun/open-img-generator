# Models · 用户用例

## Use Case Overview

1. Find Model。
2. Inspect Capability。
3. Enable Or Disable Model。

## Main Flows

加载已配置模型与偏好 → 搜索/按 Provider 缩小 → 展开能力 → 切换 Switch → API 持久化 → Generate 下次加载反映新池。

## Responsibility Boundaries

Models 决定全局“是否出现在 Generate”；Generate 的当次勾选不回写 preference；Provider key 配置不在本页。

## Failure Points

Provider 无 key、偏好 GET 失败、单行 PUT 失败、Provider 配置在页面打开期间改变。失败不把全部模型误设为 disabled；无法建立可靠 join 时显示错误而非猜默认。

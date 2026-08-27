# 路由器 Fake-IP、模型标识与仅重试保存 · improve-5

> 状态：方案待用户审查；实施必须在后续会话按 02 + 04 执行。
>
> 日期：2026-07-21
>
> 代码基线：`mvp@f0adcc6`
>
> 前置批次：[improve-4](../improve-4/README.md)

## 为什么需要本批

macOS 的 HTTP、HTTPS 与 SOCKS 系统代理均已关闭，但 Node DNS 仍把公网媒体域名和 `www.apple.com` 解析到 `198.18.0.0/15`。默认路由经 `192.168.2.1`，没有本机 TUN 路由，因此证据指向路由器上的 Nikki/Mihomo Fake-IP DNS 与透明转发。网络本身可用，但后端的 SSRF 防护必须拒绝未声明的 Fake-IP 媒体主机；这就是 Qwen 已完成生成后无法落盘的直接原因。

本批同时修正 Doubao `Seedream 5.0 Lite` 的模型标识，并把“Provider 已完成、图片尚未安全保存”从不可逆失败改为可恢复的内部状态。用户可以只重试下载/校验/落盘，应用绝不重新提交生成请求、绝不重复计费。

## 范围

### In scope

- 将 Doubao `Seedream 5.0 Lite` 标识从 `doubao-seedream-5-0-260128` 修正为 `doubao-seedream-5-0-lite-260128`。
- 保留历史任务中的旧模型字符串；清理或忽略旧 model preference，不改写历史事实。
- Provider 私有 `ModelSpec` 声明已知、精确的媒体主机；环境变量继续作为本机用户的显式附加覆盖。
- 新增内部 `storage_blocked` phase，保留 Provider 结果快照并停止后台热循环。
- 新增“只重试保存”API 与 UI；重试仅执行 storage pipeline，不得调用 Provider submit。
- 取消、删除、并发点击、服务重启、部分图片已落盘等边界保持幂等。
- 为日志增加 `storage.blocked`、`storage.retry_requested`、`storage.retry_completed` 等脱敏事件。

### Out of scope

- 自研通用代理发现、PAC/Clash/Nikki 配置管理、自动修改 DNS 或路由器规则。
- 自动信任 Provider 返回 URL 中的任意域名、通配符白名单或关闭 SSRF 检查。
- 对已经进入旧版 terminal 且 `resultSnapshot` 已清空的任务自动重新生成。
- 为修正模型标识改写已存在的 Generation/Job 历史记录。
- 同一批扩展新的 Provider 模型或图片编辑/多图融合能力。

## 文档地图

1. [00-discussion.md](./00-discussion.md)：已确认目标、用户语义与待实施边界。
2. [01-problem-analysis-and-current-state.md](./01-problem-analysis-and-current-state.md)：网络证据、失败链路和代码缺口。
3. [02-optimization-plan-and-change-scope.md](./02-optimization-plan-and-change-scope.md)：状态机、API、模型与安全白名单实施契约。
4. `03-reference-projects.md`：本批由官方 Provider 文档、本地事故和现有代码充分驱动，不创建独立参考项目文档。
5. [04-test-and-acceptance.md](./04-test-and-acceptance.md)：单元、集成、构建、真实 Provider 与浏览器验收。

## 与前置批次的关系

improve-5 不改变 improve-3/4 已确认的图片保留规则、收藏语义、storage ownership、Base64 优先和 URL 立即转存。它补上“上游结果已取得但转存被网络/本地条件阻塞”的可恢复状态，并继续遵守 no-replay：没有明确的 Provider 结果快照时，绝不通过重试保存触发新生成。

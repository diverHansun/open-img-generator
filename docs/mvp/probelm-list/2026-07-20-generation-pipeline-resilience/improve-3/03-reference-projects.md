# 3. Provider 官方契约与方案借鉴

> 核对时间：2026-07-21。本文记录能直接影响本批设计的官方接口事实；厂商文档可能更新，实施/验收时应再次核对。未找到明确官方期限的 Provider 不猜测数值，一律按临时 URL 立即转存。

## 3.1 结论矩阵

| Provider | 官方/当前输出契约 | 官方 URL 有效期 | 本批选择 |
|---|---|---:|---|
| ZenMux GPT Image | 当前 adapter/真实响应支持 `b64_json`，也解析 `url`；公开资料未找到稳定期限承诺 | 未明确 | 保持 Base64 优先事实与 URL fallback |
| 豆包 Seedream | `response_format` 支持 `url`、`b64_json` | URL 约 24 小时 | 请求 `b64_json`，保留 URL parser |
| fal FLUX schnell | 普通 queue result 为 URL；`sync_mode=true` 可返回 Data URI，但输出不进入 request history | 媒体生命周期可按账户/请求配置，无统一固定值 | 保持 queue/poll + URL，避免生命周期回归 |
| SiliconFlow | image generation response 为 `images[].url`，未文档化输出 Base64 | 约 1 小时 | 完成后立即下载 |
| 智谱 GLM-Image | `data[].url`，未文档化输出 Base64 | 约 30 天 | 完成后立即下载，不依赖 30 天远端可用性 |
| 通义千问/Qwen Image | 异步 task 返回图片 URL；Base64 用于部分输入，不是输出结果契约 | task ID/结果 URL 约 24 小时 | poll 完成后立即下载 |
| 可灵 | 异步 task result URL；当前官方资料未找到明确输出 Base64/过期时长 | 未明确 | 按临时 URL 立即下载 |

上游有效期只决定 ingestion 紧迫度：SiliconFlow 的 1 小时比智谱 30 天更紧迫，但两者都不适合成为应用历史展示 URL。本地统一 7 天是独立产品策略。

## 3.2 豆包 Seedream

官方接口的 `response_format` 支持：

- `url`：返回临时 URL，官方说明约 24 小时有效；
- `b64_json`：在 JSON 中返回 Base64 图片数据。

资料：

- [火山引擎 ImageGenerations API](https://api.volcengine.com/api-docs/view?action=ImageGenerations&serviceCode=ark&version=2024-01-01)
- [火山方舟图片生成文档](https://www.volcengine.com/docs/6492/2221472?lang=zh)
- 仓库镜像：`model-interface-docs/doubao/seedream-image-and-edit.md`

对当前代码的直接启发：`src/lib/providers/adapters/doubao.ts::parseImages` 已兼容 `b64_json`，只需改变请求偏好，不需要 SDK、第二套 storage 或 Provider-specific persistence。

## 3.3 fal

[fal FLUX schnell API](https://fal.ai/models/fal-ai/flux/schnell/api) 说明 `sync_mode=true` 会将媒体返回为 Data URI，同时该输出不会进入 request history。[fal CDN 文档](https://fal.ai/docs/documentation/model-apis/fal-cdn) 与 [queue 文档](https://fal.ai/docs/documentation/model-apis/inference/queue) 说明常规输出为 CDN URL，媒体过期受生命周期设置影响。

可选方案比较：

| 方案 | 优点 | 代价 | 结论 |
|---|---|---|---|
| `sync_mode=true`/Data URI | 避免一次 CDN 下载 | 改变 queue/history/阻塞语义，削弱现有 restart recovery | 不采用 |
| 保持 queue/poll + URL | 延续 durable handle、poll、cancel 和重启恢复 | 仍需安全网络转存 | 采用 |

这里不能机械执行“能 Base64 就 Base64”。任务生命周期正确性高于减少一次下载，符合架构取舍和 KISS：不为表面统一破坏已验证的异步模型。

## 3.4 SiliconFlow

[SiliconFlow 图片生成 API](https://docs.siliconflow.cn/en/api-reference/images/images-generations) 的响应示例/Schema 使用 `images[].url`，并说明生成 URL 有效期约 1 小时；未提供输出 Base64 参数。

直接结论：adapter 应继续返回 URL，但 lifecycle 必须在完成后立即 materialize。不能把下载推迟到用户打开 History，更不能将 URL 当作 7 天本地缓存替代品。

## 3.5 智谱 GLM-Image

[智谱 GLM-Image 文档](https://docs.bigmodel.cn/cn/guide/models/image-generation/glm-image) 与仓库官方资料镜像 `model-interface-docs/zhipu/glm-image.md` 记录响应为图片 URL，临时链接有效期约 30 天；未提供输出 Base64 契约。

30 天并不等于可长期依赖：远端服务、鉴权/CDN 策略、代理环境与离线使用都可能变化。本产品需要重启后、离线时和 Provider 链接失效后仍能查看保留期内图片，因此仍应生成完成后立即转存。

## 3.6 通义千问 / DashScope

- [Model Studio 文生图文档](https://help.aliyun.com/en/model-studio/text-to-image)
- [Qwen Image API](https://help.aliyun.com/en/model-studio/qwen-image-api)

官方异步流程返回 task ID，完成结果为临时图片 URL，task/result 有效期约 24 小时。仓库 adapter 的 submit/poll 分离与该契约一致。Base64 是某些输入字段的可选传输方式，不能推导为输出图片支持 Base64。

本批不改变 Qwen 的 async lifecycle，只保持 poll 完成后立即转存。

## 3.7 可灵

仓库 `model-interface-docs/kling/` 保存了官方 API 资料入口，当前可得资料与 adapter 都使用异步 task + result URL。未找到可核实的官方输出 Base64 参数或统一 URL 有效期。

因此文档和错误提示不得编造“24 小时/7 天”等期限。工程策略按最保守、也最简单的规则处理：结果一旦完成立即转存；若 URL 已失效则按 Provider/Storage 安全诊断呈现。

## 3.8 ZenMux

`src/lib/providers/adapters/zenmux.ts` 和现有真实响应表明 GPT image 路径通常返回 `b64_json`；adapter 同时接受 URL。当前未找到足以冻结 URL 期限的公开官方说明，因此本批只把“Base64/URL 双解析”作为代码契约，不把未核实的期限写入产品规则。

不强制增加 `response_format` 的原因：当前默认响应已经内联，额外请求字段是否被 ZenMux 完整透传需要官方契约或 live test 证明。保持现状比为了形式一致引入潜在兼容回归更符合 KISS。

## 3.9 官方 SDK 不能解决什么

SDK 可以提供类型、认证和调用便利，但不能：

- 让只返回 URL 的 Provider 改为返回 Base64；
- 让 Node 后端自动等同于浏览器代理网络；
- 替代本地文件持久化、保留期和历史墓碑；
- 自动保证 submit timeout 后不重复计费；
- 替代项目已有的 URL/redirect/SSRF、MIME/magic 和 size 校验。

因此本批继续使用现有有界 HTTP client。未来单个 SDK 只有在能证明减少维护成本、且其重试/redirect/proxy/timeout 语义经过审计后，才作为独立可逆决策评估。

## 3.10 对本批的借鉴总结

1. 不追求所有 Provider 输出形态表面统一；优先保护各自任务生命周期。
2. Base64 能力属于 adapter/Provider contract，图片字节验证与落盘属于 shared storage。
3. 所有 URL 输出都在任务完成路径立即 materialize，不能 lazy-load。
4. 厂商 URL 期限不进入本地 retention 计算。
5. 未文档化的期限按未知处理，错误提示暴露安全分类与诊断编号，不暴露签名 URL。

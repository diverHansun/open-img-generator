# 3. 官方资料借鉴

## 3.1 来源

| Provider | 官方来源 | 用途 |
| --- | --- | --- |
| ZenMux | https://zenmux.ai/docs/api/openai/generate-an-image | GPT Image 模型、尺寸、Base64 结果 |
| Doubao | https://www.volcengine.com/docs/82379/1541523 | Seedream 4.0/4.5/5.0 请求与模型 ID |
| SiliconFlow | https://docs.siliconflow.cn/cn/api-reference/images/images-generations | 通用 Images 端点、字段适用范围、1 小时 URL |
| 本地快照 | `model-interface-docs/{zenmux,doubao,siliconflow}/` | 离线对照，不作为最终可用性证明 |

## 3.2 Adopt / Adapt / Reject

| 做法 | 取舍 |
| --- | --- |
| Adopt：ZenMux GPT Images 继续走 OpenAI Images 协议 | 当前 adapter 已有 Base64 安全转存，新增模型风险小 |
| Adapt：Doubao 共用端点但参数由 ModelSpec 控制 | 不假设 4.0/4.5/5.0 能力完全相同 |
| Adapt：SiliconFlow 先 live probe | 官方明确模型会动态调整，静态表不足以证明可用 |
| Reject：运行时调用模型列表并自动发布模型 | 会把网络失败、模型漂移和未测试能力带入产品启动路径 |
| Reject：厂商 SDK | 不能提升本批协议正确性，反而可能绕过现有安全 HTTP 语义 |

## 3.3 对方案的直接影响

- ModelSpec 必须能表达“同端点但字段适用范围不同”。
- SiliconFlow URL 约 1 小时有效，因此 live acceptance 必须验证立即落盘，而不是只看 provider 返回 200。
- 官方页面和真实响应冲突时，真实安全探测决定是否入目录，并回写本地快照。

# 3. 官方资料

| Provider | 官方资料 | 采用信息 |
| --- | --- | --- |
| ZenMux | `https://docs.zenmux.ai/api-reference/image-generation/google` | Vertex `generateContent` 端点、contents、responseModalities、inlineData |
| ZenMux | `https://zenmux.ai/api/vertex-ai/v1beta/models` | 当前公开精确模型 ID |
| Fal | 各模型的 `https://fal.ai/models/{model}/api` | Queue endpoint、输入字段与 images 输出 |

官方 SDK 示例只作 schema 参考；运行时继续使用现有受限 HTTP client，避免引入第二套重试、超时和代理行为。

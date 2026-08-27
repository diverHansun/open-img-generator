# 2. 优化方案与改动面

## ZenMux

新增 `gemini-generate-content` profile，保存 Vertex provider/model 路径、图片尺寸枚举和允许比例。adapter 按 profile 选择端点、body 与 parser；`inlineData.data` 转为受限 `data:` URL，继续由共享 staging 校验魔数和 25 MiB 上限。

## Fal

把 Fal profile 收敛为离散的 Banana 与 FLUX 变体。每个 profile 明确允许字段、默认输出格式、比例映射和数量上限；不得再透传未知 `providerOptions`。Queue handle 与输出 parser 保持共用。

## 改动面

- `src/lib/providers/capabilities/{zenmux,fal}.ts`
- `src/lib/providers/adapters/{zenmux,fal}.ts`
- 对应 adapter/model spec 单测与 Provider 文档

不改 DB、job snapshot、图片存储和公开 ProviderCapabilities 形状。任一模型可通过删除单个 spec 独立回滚。

# providers 模块 · test

> 模块路径: `src/lib/providers/`
> 前置文档: goals-duty.md, architecture.md, data-model.md, dfd-interface.md
> 文档顺序: ⑦ test(本文)

---

## 1. Test Scope（测试范围）

### 覆盖

- registry 按 env key 启用/禁用 provider 的行为
- zenmux、SiliconFlow、智谱 adapter 的请求翻译与响应解析（sync 路径）
- fal adapter 的请求翻译、submit 句柄解析、poll 状态机（async 路径）
- http-client 的超时与错误码映射
- capabilities 静态声明与 model 查询
- NormalizedRequest 到厂商请求体的字段映射

### 不覆盖

- job-engine 的任务编排与状态持久化（归属 job-engine test）
- storage 下载转存（归属 storage test）
- 真实厂商 API 端到端调用（归属集成测试，需真实 key，CI 不跑）
- prompt 模块处理逻辑（归属 prompt test）
- API 路由层（归属 API 集成测试）

---

## 2. Critical Scenarios（关键场景）

### 2.1 Registry 启用检测

| 场景 | 输入 | 预期 |
|------|------|------|
| FAL_KEY 存在 | env 含 FAL_KEY | listEnabled() 包含 fal |
| FAL_KEY 缺失 | env 无 FAL_KEY | listEnabled() 不包含 fal，不抛错 |
| Batch 1 key 存在 | env 含 FAL_KEY + ZENMUX_API_KEY + SILICONFLOW_API_KEY + ZHIPU_API_KEY | listEnabled() 按固定顺序包含四个 provider |
| 两个 key 都缺失 | env 无 key | listEnabled() 返回空数组 |
| getById 未启用 | getById("fal")，无 FAL_KEY | 抛出 ProviderNotEnabledError |

### 2.2 Zenmux Sync 路径

| 场景 | 输入 | 预期 |
|------|------|------|
| 正常文生图 | prompt="A cat", model="openai/gpt-image-2" | SubmitResult.kind="sync"，images 长度 >= 1，每张含 url |
| 指定尺寸 | width=1024, height=1024 | 请求体 size="1024x1024" |
| 指定张数 | count=2 | 请求体 n=2，images 长度 2 |
| 厂商 401 | mock 返回 401 | SubmitResult.kind="failed"，error.code="AUTH_FAILED" |
| 厂商 422 | mock 返回 422 | SubmitResult.kind="failed"，error.code="INVALID_REQUEST" |
| HTTP 超时 | mock 超时 | SubmitResult.kind="failed"，error.code="TIMEOUT" |

### 2.3 Fal Async 路径

| 场景 | 输入 | 预期 |
|------|------|------|
| 正常 submit | prompt="A cat", model="fal-ai/flux/schnell" | SubmitResult.kind="async"，handle.externalId 非空 |
| poll pending | mock status=IN_QUEUE | PollResult.status="pending" |
| poll running | mock status=IN_PROGRESS | PollResult.status="running" |
| poll completed | mock status=COMPLETED + response 含 images | PollResult.status="completed"，images 含 url |
| poll failed | mock 5xx | PollResult.status="failed"，error.code="PROVIDER_ERROR" |
| cancel | mock 202 | 正常返回，不抛错 |
| cancel 已完成任务 | mock 400 | 返回 `PollResult.status="failed"` |

### 2.4 SiliconFlow / 智谱 Sync 路径

| 场景 | 输入 | 预期 |
|------|------|------|
| SiliconFlow 正常 submit | model=`Kwai-Kolors/Kolors` | `kind="sync"`，解析 `images[].url` |
| SiliconFlow 公开比 | `aspectRatio="9:16"` | 请求体 `image_size="720x1280"` |
| SiliconFlow 负向词与 seed | `negativePrompt` + `seed` | 请求体分别含 `negative_prompt` + `seed` |
| 智谱正常 submit | model=`glm-image` | `kind="sync"`，解析 `data[].url` |
| 智谱公开比 | `aspectRatio="3:2"` | 请求体 `size="1568x1056"` |
| 智谱固定参数 | 任意合法请求 | `quality="hd"`、`watermark_enabled=true`、`user_id` 存在 |
| 两家 401/422/5xx | mock HTTP error | 映射统一 `ProviderError`，超时为可重试 `TIMEOUT` |

### 2.5 Capabilities 查询

| 场景 | 输入 | 预期 |
|------|------|------|
| 已知模型 | capabilities("openai/gpt-image-2") | 返回完整 ProviderCapabilities，protocol="sync" |
| 未知模型 | capabilities("nonexistent") | 返回 null |
| fal 模型 | capabilities("fal-ai/flux/schnell") | protocol="async"，supportsSeed=true |

### 2.6 请求翻译与公开宽高比映射

| 场景 | 输入 | 预期 |
|------|------|------|
| 默认尺寸 | 无 width/height/aspectRatio | zenmux size="1024x1024"；fal image_size="square_hd" |
| zenmux 公开比 | aspectRatio="1:1" | size="1024x1024" |
| zenmux 公开比 | aspectRatio="3:2" | size="1536x1024" |
| zenmux 公开比 | aspectRatio="2:3" | size="1024x1536" |
| fal 公开比 | aspectRatio="1:1" | image_size="square_hd" |
| fal 公开比 | aspectRatio="16:9" | image_size="landscape_16_9" |
| fal 公开比 | aspectRatio="9:16" | image_size="portrait_16_9" |
| width/height 优先 | width/height 与 aspectRatio 同时存在 | 按优先级用 width/height（或文档约定的等价翻译） |
| providerOptions 透传 | providerOptions={ "guidance_scale": 7 } | fal 请求体含 guidance_scale（若 adapter 认识） |

### 2.7 Capabilities 公开比

| 场景 | 预期 |
|------|------|
| fal capabilities | supportedAspectRatios 非空，含 `1:1` 等公开比（不再为空数组） |
| zenmux capabilities | 保持 `1:1`/`3:2`/`2:3` |
| SiliconFlow capabilities | `1:1`/`3:4`/`1:2`/`9:16`，负向词与 seed 为 true |
| 智谱 capabilities | 官方七种尺寸/公开比，`quality=hd`，负向词与 seed 为 false |

---

## 3. Integration Points（集成点测试）

### 3.1 与 job-engine 的契约

| 验证点 | 方式 |
|--------|------|
| SubmitResult 的 kind 枚举与 job-engine 分支匹配 | 类型导出一致性检查（TypeScript 编译） |
| JobHandle 可 JSON 序列化/反序列化 | 单元测试：serialize → deserialize → poll 可正常调用 |
| ProviderImageRef.url 为有效 URL 格式 | adapter 测试中断言 url 以 https:// 开头 |
| ProviderError.retryable 字段存在 | 各错误码映射测试覆盖 |

### 3.2 与外部厂商 API 的隔离

| 验证点 | 方式 |
|--------|------|
| adapter 不硬编码 API key | 代码审查 + 测试用 mock env |
| http-client 正确注入 Authorization | mock fetch 断言 header |
| fal 使用 `Key $FAL_KEY` 格式 | mock fetch 断言 header 值 |
| sync providers 使用 Bearer key | mock fetch 断言 ZenMux/SiliconFlow/智谱 header 值 |

---

## 4. Verification Strategy（验证策略）

### 4.1 单元测试（主力）

- **框架**: 项目标准测试框架（实现阶段确定，建议 vitest）
- **位置**: `src/lib/providers/__tests__/`
- **mock 策略**: 在 adapter 单测中 mock `global.fetch`，验证真实请求 URL、headers、body 与解析结果；不触发外部网络
- **覆盖重点**: adapter 请求翻译、响应解析、registry 启用逻辑

### 4.2 契约测试

- 导出 types 的 TypeScript 编译检查：`npm run typecheck` 确保 types 无循环依赖
- JobHandle JSON round-trip 测试

### 4.3 手工验证（可选，开发阶段）

- 配置真实 FAL_KEY / ZENMUX_API_KEY / SILICONFLOW_API_KEY / ZHIPU_API_KEY
- 通过 API 端点发起真实生成，确认 sync/async 两条路径端到端可用
- 不在 CI 中运行

### 4.4 测试文件建议布局

```
src/lib/providers/__tests__/
├── registry.test.ts
├── adapters/
│   ├── fal.test.ts
│   ├── zenmux.test.ts
│   ├── siliconflow.test.ts
│   └── zhipu.test.ts
├── http-client.test.ts
└── fixtures/
    ├── fal-submit-response.json
    ├── fal-poll-completed.json
    └── zenmux-generate-response.json
```

---

## 自检（提交前）

- 每个 Critical Scenario 可追溯到 goals-duty 中的一条 Duty
- sync 与 async 路径均有独立测试场景
- 明确区分单元测试（mock）与真实 API 测试（手工）
- 未测试 job-engine/storage 的职责（边界清晰）
